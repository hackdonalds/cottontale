// Blobs from player to player, for tables without a file server (or when the
// servers said no). Everything here moves ciphertext only, and the receiver
// checks its hash, so any player who has a blob is as good a source as any other.
//
//   asker  → table : bq  "who has <hash>?"
//   holder → asker : bh  "I do"
//   asker  ⇄ holder: bo / ba / bi   WebRTC offer, answer and ICE candidates
//   then one data channel per blob (its label is the hash): a line of JSON with
//   the size, then the bytes in 16 KiB pieces.
//
// All of it travels inside the encrypted room envelope (net.ts). If WebRTC
// cannot connect (strict NATs: we only use STUN), small blobs are sent through
// the relays instead, in a few numbered pieces (br / bc).
//
// NB: blob.ts and this file import each other; nothing from blob.ts may be used
// at the top level here.
import { Assembler, RELAY_CHUNK, RELAY_MAX, b64, isHash, slices, unb64, type BlobRef, type Progress, type Signal } from './blob';
import type { Msg } from './net';

const ASK_MS = 4000; // how long to wait for someone to say they have it
const CONNECT_MS = 15_000;
const STALL_MS = 15_000; // a transfer that stays silent this long is dead
const IDLE_MS = 30_000; // keep a connection around for the next blob
const RELAY_MS = 20_000;
const HIGH = 1024 * 1024, LOW = 256 * 1024; // data channel send buffer: pause above, resume below
const MAX_LINKS = 8;

export interface PeerOpts {
  net: Signal;
  ice: () => string[];
  /** A blob's ciphertext from the local cache, if we have it. */
  read: (hash: string) => Promise<Uint8Array | null>;
  has: (hash: string) => Promise<boolean>;
  progress: Progress;
}

/** One WebRTC connection to a player: `out` ones we opened to fetch, `inn` ones opened to us. */
interface Link {
  id: string;
  pk: string;
  pc: RTCPeerConnection;
  /** Settles when the connection is usable (or will never be). */
  up: Promise<void>;
  /** Transfers on this link run one after another. */
  chain: Promise<unknown>;
  /** Candidates that arrived before the other side's description. */
  early: RTCIceCandidateInit[];
  described: boolean;
  mine: RTCIceCandidateInit[];
  flush?: ReturnType<typeof setTimeout>;
  idle?: ReturnType<typeof setTimeout>;
}

const rid = () => Math.random().toString(36).slice(2, 12);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export class PeerBlobs {
  private out = new Map<string, Link>();
  private inn = new Map<string, Link>();
  /** Blobs we are looking for: who said they have them. */
  private asks = new Map<string, { holders: string[]; wake: () => void }>();
  /** Blobs coming in through the relays. */
  private relayIn = new Map<string, { pk: string; add: (i: number, part: Uint8Array) => void }>();
  /** Players we are sending a blob to through the relays right now. */
  private relayOut = new Set<string>();
  private tap = (msg: Msg, from: string) => this.onMsg(msg, from);

  constructor(private o: PeerOpts) { o.net.taps.push(this.tap); }

  close(): void {
    const i = this.o.net.taps.indexOf(this.tap);
    if (i >= 0) this.o.net.taps.splice(i, 1);
    for (const l of [...this.out.values(), ...this.inn.values()]) this.hangUp(l);
  }

  // ---- asking ----------------------------------------------------------------

  /**
   * Get a blob from whoever at the table has it. `check` says whether bytes are
   * the right ones; a player who sends wrong ones is skipped. Null if nobody could help.
   */
  async fetch(ref: BlobRef, check: (bytes: Uint8Array) => Promise<boolean>): Promise<{ bytes: Uint8Array; via: 'peer' | 'relay' } | null> {
    const { net } = this.o;
    if (net.peers && !net.peers.size) return null; // alone at the table
    if (this.asks.has(ref.h)) return null;
    const ask = { holders: [] as string[], wake: () => {} };
    this.asks.set(ref.h, ask);
    try {
      await net.send({ y: 'bq', h: ref.h });
      const tried = new Set<string>();
      /** The next player who has it and was not tried yet, waiting a while for one to speak up. */
      const next = async (ms: number): Promise<string | null> => {
        for (const until = Date.now() + ms; ;) {
          const pk = ask.holders.find((p) => !tried.has(p));
          if (pk) { tried.add(pk); return pk; }
          const left = until - Date.now();
          if (left <= 0) return null;
          await new Promise<void>((r) => { ask.wake = r; setTimeout(r, left); });
        }
      };
      if (typeof RTCPeerConnection !== 'undefined') {
        for (let n = 0; n < 3; n++) {
          const pk = await next(n ? 300 : ASK_MS);
          if (!pk) break;
          try {
            const bytes = await this.direct(pk, ref);
            if (await check(bytes)) return { bytes, via: 'peer' };
          } catch { /* try the next player */ }
        }
      }
      if (ref.n > RELAY_MAX) return null;
      if (!ask.holders.length) await next(ASK_MS);
      for (const pk of ask.holders.slice(0, 2)) {
        try {
          const bytes = await this.viaRelay(pk, ref);
          if (await check(bytes)) return { bytes, via: 'relay' };
        } catch { /* try the next player */ }
      }
      return null;
    } finally {
      this.asks.delete(ref.h);
    }
  }

  // ---- WebRTC ----------------------------------------------------------------

  private link(pk: string, id: string, pc: RTCPeerConnection, book: Map<string, Link>): Link {
    const l: Link = { id, pk, pc, up: Promise.resolve(), chain: Promise.resolve(), early: [], described: false, mine: [] };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      l.mine.push(e.candidate.toJSON());
      // A handful of candidates arrive in a burst: send them as one message.
      l.flush ??= setTimeout(() => {
        l.flush = undefined;
        void this.o.net.send({ y: 'bi', to: pk, id, c: l.mine.splice(0) });
      }, 150);
    };
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.hangUp(l);
    });
    const old = book.get(pk); // one connection per player and direction
    if (old) this.hangUp(old);
    book.set(pk, l);
    return l;
  }

  private hangUp(l: Link): void {
    clearTimeout(l.idle);
    clearTimeout(l.flush);
    for (const book of [this.out, this.inn]) if (book.get(l.pk) === l) book.delete(l.pk);
    try { l.pc.close(); } catch { /* already gone */ }
  }

  private async describe(l: Link, type: RTCSdpType, sdp: string): Promise<void> {
    await l.pc.setRemoteDescription({ type, sdp });
    l.described = true;
    for (const c of l.early.splice(0)) void l.pc.addIceCandidate(c).catch(() => {});
  }

  /** Our connection to a player for fetching, opened on first use. */
  private dial(pk: string): Link {
    const old = this.out.get(pk);
    if (old) return old;
    const urls = this.o.ice();
    const pc = new RTCPeerConnection({ iceServers: urls.length ? [{ urls }] : [] });
    const l = this.link(pk, rid(), pc, this.out);
    const ctl = pc.createDataChannel('ct'); // gives the offer something to negotiate, and tells us when the link is up
    l.up = new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('no connection')), CONNECT_MS);
      ctl.onopen = () => { clearTimeout(t); res(); };
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { clearTimeout(t); rej(new Error('no connection')); }
      });
    });
    l.up.catch(() => this.hangUp(l));
    void (async () => {
      await pc.setLocalDescription(await pc.createOffer());
      await this.o.net.send({ y: 'bo', to: pk, id: l.id, sdp: pc.localDescription!.sdp });
    })().catch(() => this.hangUp(l));
    return l;
  }

  /** Fetch over WebRTC; transfers from one player wait their turn. */
  private direct(pk: string, ref: BlobRef): Promise<Uint8Array> {
    const l = this.dial(pk);
    clearTimeout(l.idle);
    const run = l.chain.then(() => l.up).then(() => this.pull(l, ref));
    l.chain = run.catch(() => {});
    return run;
  }

  private pull(l: Link, ref: BlobRef): Promise<Uint8Array> {
    return new Promise<Uint8Array>((res, rej) => {
      clearTimeout(l.idle);
      const ch = l.pc.createDataChannel(ref.h);
      ch.binaryType = 'arraybuffer';
      let asm: Assembler | null = null, i = 0, t: ReturnType<typeof setTimeout>;
      const end = (err?: string) => {
        clearTimeout(t);
        ch.onmessage = ch.onclose = null;
        try { ch.close(); } catch { /* already closed */ }
        clearTimeout(l.idle);
        l.idle = setTimeout(() => this.hangUp(l), IDLE_MS);
        if (err || !asm) rej(new Error(err ?? 'nothing sent')); else res(asm.bytes());
      };
      const alive = () => { clearTimeout(t); t = setTimeout(() => end('stalled'), STALL_MS); };
      alive();
      ch.onclose = () => end('closed');
      ch.onmessage = (e) => {
        alive();
        if (typeof e.data === 'string') { // the size line: the holder must agree with the reference
          let n = -1;
          try { n = Number(JSON.parse(e.data).n); } catch { /* refused below */ }
          if (asm || n !== ref.n) return end('refused');
          asm = new Assembler(ref.n);
          return;
        }
        if (!asm || !asm.add(i++, new Uint8Array(e.data as ArrayBuffer))) return end('bad piece');
        this.o.progress(ref.h, asm.loaded, ref.n);
        if (asm.done) end();
      };
    });
  }

  /** A player wants to fetch from us: answer the call. Blobs are then asked for by opening channels. */
  private async answer(from: string, id: string, sdp: string): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    if (this.inn.size >= MAX_LINKS && !this.inn.has(from)) return;
    const urls = this.o.ice();
    const pc = new RTCPeerConnection({ iceServers: urls.length ? [{ urls }] : [] });
    const l = this.link(from, id, pc, this.inn);
    const rest = () => { clearTimeout(l.idle); l.idle = setTimeout(() => this.hangUp(l), IDLE_MS * 2); };
    rest();
    pc.ondatachannel = (e) => {
      const ch = e.channel;
      if (!isHash(ch.label)) return;
      clearTimeout(l.idle);
      l.chain = l.chain.then(() => this.serve(ch)).catch(() => {}).then(rest);
    };
    try {
      await this.describe(l, 'offer', sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      await this.o.net.send({ y: 'ba', to: from, id, sdp: pc.localDescription!.sdp });
    } catch {
      this.hangUp(l);
    }
  }

  /** Send one blob down a channel, no faster than the channel drains. */
  private async serve(ch: RTCDataChannel): Promise<void> {
    const until = (set: (done: () => void) => void, ms: number) => Promise.race([new Promise<void>(set), wait(ms)]);
    if (ch.readyState === 'connecting') await until((r) => { ch.onopen = r; }, 5000);
    if (ch.readyState !== 'open') return;
    const bytes = await this.o.read(ch.label);
    ch.send(JSON.stringify({ n: bytes ? bytes.length : -1 }));
    if (!bytes) return;
    ch.bufferedAmountLowThreshold = LOW;
    for (const part of slices(bytes)) {
      if (ch.bufferedAmount > HIGH) await until((r) => { ch.onbufferedamountlow = r; ch.onclose = r; }, STALL_MS);
      if (ch.readyState !== 'open') return;
      ch.send(part as Uint8Array<ArrayBuffer>);
    }
    // The asker closes the channel when it has everything; only then is this player's turn over.
    if (ch.readyState === 'open') await until((r) => { ch.onclose = r; }, STALL_MS);
  }

  // ---- through the relays (small blobs, last resort) -----------------------------

  private viaRelay(pk: string, ref: BlobRef): Promise<Uint8Array> {
    return new Promise<Uint8Array>((res, rej) => {
      const asm = new Assembler(ref.n, RELAY_CHUNK);
      const t = setTimeout(() => { this.relayIn.delete(ref.h); rej(new Error('timed out')); }, RELAY_MS);
      this.relayIn.set(ref.h, {
        pk,
        add: (i, part) => {
          if (!asm.add(i, part)) return;
          this.o.progress(ref.h, asm.loaded, ref.n);
          if (!asm.done) return;
          clearTimeout(t);
          this.relayIn.delete(ref.h);
          res(asm.bytes());
        },
      });
      void this.o.net.send({ y: 'br', to: pk, h: ref.h });
    });
  }

  private async relaySend(to: string, h: string): Promise<void> {
    if (this.relayOut.has(to)) return;
    this.relayOut.add(to);
    try {
      const bytes = await this.o.read(h);
      if (!bytes || bytes.length > RELAY_MAX) return;
      let i = 0;
      for (const part of slices(bytes, RELAY_CHUNK)) {
        if (i) await wait(120); // relays limit how fast one key may post
        await this.o.net.send({ y: 'bc', to, h, i: i++, d: b64(part) });
      }
    } finally {
      this.relayOut.delete(to);
    }
  }

  // ---- incoming messages -----------------------------------------------------------

  /** Handle a table message if it is one of ours. Everything in it is checked: it comes from another device. */
  onMsg(msg: Msg, from: string): boolean {
    switch (msg.y) {
      case 'bq':
        if (isHash(msg.h)) {
          const h = msg.h;
          void this.o.has(h).then((yes) => { if (yes) void this.o.net.send({ y: 'bh', h, to: from }); });
        }
        return true;
      case 'bh': {
        const ask = msg.to === this.o.net.pk && isHash(msg.h) ? this.asks.get(msg.h) : undefined;
        if (ask && !ask.holders.includes(from) && ask.holders.length < 16) { ask.holders.push(from); ask.wake(); }
        return true;
      }
      case 'bo':
        if (msg.to === this.o.net.pk && str(msg.id, 32) && str(msg.sdp, 20_000)) void this.answer(from, msg.id, msg.sdp);
        return true;
      case 'ba': {
        const l = this.out.get(from);
        if (msg.to === this.o.net.pk && l && l.id === msg.id && !l.described && str(msg.sdp, 20_000)) void this.describe(l, 'answer', msg.sdp).catch(() => this.hangUp(l));
        return true;
      }
      case 'bi': {
        if (msg.to !== this.o.net.pk || !Array.isArray(msg.c)) return true;
        const l = [this.out.get(from), this.inn.get(from)].find((x) => x?.id === msg.id);
        for (const c of l ? msg.c.slice(0, 32) : []) {
          if (!c || typeof c !== 'object' || !str(c.candidate, 500)) continue;
          if (l!.described) void l!.pc.addIceCandidate(c).catch(() => {});
          else if (l!.early.length < 64) l!.early.push(c);
        }
        return true;
      }
      case 'br':
        if (msg.to === this.o.net.pk && isHash(msg.h)) void this.relaySend(from, msg.h).catch(() => {});
        return true;
      case 'bc': {
        const want = msg.to === this.o.net.pk && isHash(msg.h) ? this.relayIn.get(msg.h) : undefined;
        if (want && want.pk === from && str(msg.d, RELAY_CHUNK * 2)) {
          try { want.add(msg.i, unb64(msg.d)); } catch { /* not base64 */ }
        }
        return true;
      }
    }
    return false;
  }
}
