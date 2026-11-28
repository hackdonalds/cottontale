// Multiplayer over Nostr.
//
// A table is identified by a secret room code. From it we derive
//   - an AES-GCM key  (all event content is encrypted; relays see only noise)
//   - a public tag    (so relays can route events to people at the same table)
//
// Two kinds of events are used:
//   - kind 21420 (ephemeral): live ops, chat, dice, pings, presence. Not stored.
//   - kind 30078 (addressable app data): each player's snapshot of the board,
//     split in chunks, so late joiners and returning players get the full map.
import { finalizeEvent, verifyEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import type { Ruler } from './board';
import type { Roll } from './boulder';
import type { Throw } from './dice';
import type { Pour } from './loose';
import type { Shot } from './shots';
import type { Row, Store } from './store';

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const LIVE = 21420;
const SNAP = 30078;
const CHUNK_ROWS = 1000;

type Body =
  | { y: 'ops'; o: Row[] }
  | { y: 'hi'; n: string; c: string; re?: boolean; d?: 1 } // `d`: a table screen (src/ui/display.ts), not a player
  | { y: 'bye' }
  | { y: 'chat'; m: string; to?: string }
  | { y: 'roll'; d: string; r: number[]; mod: number; t?: Throw; s?: boolean }
  // A roll made from a character sheet (src/ui/sheet.ts): `x` is the dice notation with its numbers worked
  // out, `v` the numbers rolled for what has no physical die; the result is read from these and the throw.
  | { y: 'sroll'; k: string; id: string; ri: string; n: string; x: string; v: number[]; t?: Throw; tg?: string; vs?: number; s?: boolean }
  // A line the rules say, from the device that applies them. `k` names it, so it is shown once.
  | { y: 'sys'; k: string; m: string }
  | { y: 'boulder'; t: Roll }
  | { y: 'ruler'; r: Ruler | null }
  | { y: 'emote'; id: string; e: string }
  | ({ y: 'shot' } & Shot)
  | { y: 'ping'; p: [number, number, number] }
  // The GM's camera, for table screens to take up: where it stands and what it looks at (read with `readView`, glide.ts).
  | { y: 'cam'; p: [number, number, number]; t: [number, number, number] }
  | { y: 'mv'; id: string; p: [number, number, number] }
  /** A piece (`i`) at a cell or edge key was broken on purpose: burst it when its removal arrives. */
  | { y: 'broke'; k: string; i: string }
  | { y: 'pour'; t: Pour }
  /** A mini fell `n` cells (for the log), and a blast went off at cell `c` with radius `r` (so props rock). */
  | { y: 'fall'; id: string; n: number }
  | { y: 'blast'; c: [number, number, number]; r: number }
  // A soundboard button the GM tapped (src/sounds.ts): the table's effect `id`, for everyone to hear.
  | { y: 'sfx'; id: string }
  // Files passed between players (src/blobpeer.ts): who has a blob, WebRTC signalling, small blobs in pieces.
  | { y: 'bq'; h: string }
  | { y: 'bh'; h: string; to: string }
  | { y: 'bo' | 'ba'; to: string; id: string; sdp: string }
  | { y: 'bi'; to: string; id: string; c: RTCIceCandidateInit[] }
  | { y: 'br'; to: string; h: string }
  | { y: 'bc'; to: string; h: string; i: number; d: string };

/** `bd` says which board a live action happened on, so it is only shown to players who are there. */
export type Msg = Body & { bd?: string };

export interface Peer { name: string; color: string; last: number; /** A table screen: it looks on, and is nobody's seat. */ disp?: boolean }

const te = new TextEncoder();
const td = new TextDecoder();
export const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

function b64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(t as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Compact text form of any JSON value (for codes people copy and paste to each other). */
export async function pack(data: unknown): Promise<string> {
  return b64(await pipe(te.encode(JSON.stringify(data)), new CompressionStream('gzip')));
}
export async function unpack<T = unknown>(text: string): Promise<T> {
  return JSON.parse(td.decode(await pipe(unb64(text.trim()), new DecompressionStream('gzip')))) as T;
}

export async function deriveRoom(code: string): Promise<{ key: CryptoKey; tag: string }> {
  const base = await crypto.subtle.importKey('raw', te.encode(code.trim().toLowerCase()), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('cottontale/v1'), iterations: 150_000 }, base, 384),
  );
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, tag: hex(bits.slice(32, 48)) };
}

export async function seal(key: CryptoKey, data: unknown): Promise<string> {
  let body: Uint8Array = te.encode(JSON.stringify(data));
  let flag = 0;
  if (body.length > 400) { body = await pipe(body, new CompressionStream('gzip')); flag = 1; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(body.length + 1);
  plain[0] = flag;
  plain.set(body, 1);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64(out);
}

export async function unseal<T = unknown>(key: CryptoKey, content: string): Promise<T> {
  const raw = unb64(content);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12)));
  const body = plain[0] === 1 ? await pipe(plain.subarray(1), new DecompressionStream('gzip')) : plain.subarray(1);
  return JSON.parse(td.decode(body)) as T;
}

/** One relay connection with auto-reconnect. */
class Relay {
  open = false;
  private ws?: WebSocket;
  private retry = 1000;
  private timer?: ReturnType<typeof setTimeout>;
  private dead = false;
  constructor(
    readonly url: string,
    private filters: () => object[],
    private onEvent: (e: Event) => void,
    private onState: (r: Relay) => void,
    private onEose: () => void,
  ) { this.connect(); }

  private connect(): void {
    clearTimeout(this.timer);
    if (this.dead) return;
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.again(); return; }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.open = true;
      this.retry = 1000;
      ws.send(JSON.stringify(['REQ', 'ct', ...this.filters()]));
      this.onState(this);
    };
    ws.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data as string);
        if (d[0] === 'EVENT' && d[2]) this.onEvent(d[2]);
        else if (d[0] === 'EOSE') this.onEose();
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded by wake()
      const was = this.open;
      this.open = false;
      if (was) this.onState(this);
      this.again();
    };
    ws.onerror = () => ws.close();
  }
  private again(): void {
    if (this.dead) return;
    this.timer = setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 30_000);
  }
  /**
   * Reconnect now instead of waiting out the backoff. With `force`, also replace
   * a socket that claims to be open: phones silently kill sockets of
   * backgrounded tabs, and a fresh subscription re-delivers the snapshots.
   */
  wake(force: boolean): void {
    if (this.dead || (!force && (this.open || this.ws?.readyState === WebSocket.CONNECTING))) return;
    const old = this.ws;
    this.ws = undefined;
    if (this.open) { this.open = false; this.onState(this); }
    old?.close();
    this.retry = 1000;
    this.connect();
  }
  send(e: Event): void { if (this.open) this.ws!.send(JSON.stringify(['EVENT', e])); }
  close(): void { this.dead = true; clearTimeout(this.timer); this.ws?.close(); }
}

export interface NetOpts {
  code: string;
  relays: string[];
  sk: Uint8Array;
  name: string;
  color: string;
  /** This device is a table screen: said with every hello, so nobody takes it for a player. */
  display?: boolean;
  store: Store;
  /** Keys loaded from local storage that the relays have not yet confirmed. */
  unconfirmed?: Set<string>;
  onMsg: (msg: Msg, from: string) => void;
  onPeers: () => void;
  onStatus: (open: number, total: number) => void;
}

export class Net {
  readonly pk: string;
  peers = new Map<string, Peer>();
  tag = '';
  synced = false;
  /** A relay has sent all it holds of this table and it has been taken in: what the store lacks now, that relay does not have (`synced` also turns true when none answers). */
  heard = false;
  /** Other modules listening for live messages (file transfers); one that returns true has dealt with it. */
  taps: Array<(msg: Msg, from: string) => boolean | void> = [];
  private key!: CryptoKey;
  private relays: Relay[] = [];
  private seen = new Set<string>();
  private ops: Row[] = [];
  private opTimer?: ReturnType<typeof setTimeout>;
  private snapTimer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private beat?: ReturnType<typeof setInterval>;
  private unconfirmed: Set<string>;
  /** Events that have arrived and are still being opened (decrypting is not instant): the table is not in sync before they are in. */
  private opening = 0;

  constructor(private o: NetOpts) {
    this.pk = getPublicKey(o.sk);
    this.unconfirmed = o.unconfirmed ?? new Set();
  }

  async start(): Promise<void> {
    const { key, tag } = await deriveRoom(this.o.code);
    this.key = key;
    this.tag = tag;
    const since = Math.floor(Date.now() / 1000) - 15;
    const filters = () => [{ kinds: [SNAP], '#t': [tag] }, { kinds: [LIVE], '#t': [tag], since }];
    const finishSync = (heard = false) => {
      if (this.opening) { setTimeout(() => finishSync(heard), 100); return; }
      if (heard) this.heard = true;
      if (this.synced) return;
      this.synced = true;
      // Anything we had locally that no relay knows about (e.g. the relay
      // dropped it) gets re-published.
      if (this.unconfirmed.size) this.snapshotSoon(500);
    };
    this.relays = this.o.relays.map((url) => new Relay(
      url, filters,
      (e) => { this.opening++; void this.receive(e).finally(() => { this.opening--; }); },
      () => {
        this.o.onStatus(this.relays.filter((r) => r.open).length, this.relays.length);
        this.hello();
        if (this.synced && this.o.store.entries.size) this.snapshotSoon(2000);
      },
      () => setTimeout(() => finishSync(true), 300),
    ));
    setTimeout(() => finishSync(), 5000);
    this.o.store.onLocal = (row) => this.queueOp(row);
    this.beat = setInterval(() => {
      this.hello();
      const now = Date.now();
      let changed = false;
      for (const [pk, p] of this.peers) if (now - p.last > 55_000) { this.peers.delete(pk); changed = true; }
      if (changed) this.o.onPeers();
    }, 20_000);
  }

  setProfile(name: string, color: string): void {
    this.o.name = name;
    this.o.color = color;
    this.hello();
  }

  private hello(re = false): void {
    void this.send({ y: 'hi', n: this.o.name, c: this.o.color, ...(re ? { re } : {}), ...(this.o.display ? { d: 1 as const } : {}) });
  }

  async send(msg: Msg): Promise<void> {
    if (!this.relays.some((r) => r.open)) return;
    this.publish(LIVE, [['t', this.tag]], await seal(this.key, msg));
  }

  private publish(kind: number, tags: string[][], content: string): void {
    const ev = finalizeEvent({ kind, tags, content, created_at: Math.floor(Date.now() / 1000) }, this.o.sk);
    this.seen.add(ev.id);
    for (const r of this.relays) r.send(ev);
  }

  private queueOp(row: Row): void {
    this.ops.push(row);
    this.snapshotSoon(5000);
    this.opTimer ??= setTimeout(() => {
      this.opTimer = undefined;
      const all = this.ops;
      this.ops = [];
      for (let i = 0; i < all.length; i += 300) void this.send({ y: 'ops', o: all.slice(i, i + 300) });
    }, 120);
  }

  private snapshotSoon(ms: number): void {
    this.dirty = true;
    this.snapTimer ??= setTimeout(() => void this.snapshot(), ms);
  }

  /** Publish our full view of the board as replaceable chunks. */
  async snapshot(): Promise<void> {
    clearTimeout(this.snapTimer);
    this.snapTimer = undefined;
    if (!this.relays.some((r) => r.open)) return; // retried on reconnect
    this.dirty = false;
    this.unconfirmed.clear();
    const rows = this.o.store.dump().sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (let i = 0, n = 0; i < rows.length; i += CHUNK_ROWS, n++) {
      const content = await seal(this.key, rows.slice(i, i + CHUNK_ROWS));
      this.publish(SNAP, [['d', `cottontale:${this.tag}:${n}`], ['t', this.tag]], content);
    }
  }

  private async receive(ev: Event): Promise<void> {
    if (!ev?.id || this.seen.has(ev.id)) return;
    this.seen.add(ev.id);
    if (ev.kind !== LIVE && ev.kind !== SNAP) return;
    if (!verifyEvent(ev)) return;
    let data: unknown;
    try { data = await unseal(this.key, ev.content); } catch { return; } // not for this table

    if (ev.kind === SNAP) {
      if (Array.isArray(data)) this.mergeRows(data as Row[]);
      return;
    }
    if (ev.pubkey === this.pk) return;
    const msg = data as Msg;
    const known = this.peers.get(ev.pubkey);
    if (known) known.last = Date.now();
    switch (msg.y) {
      case 'ops':
        if (Array.isArray(msg.o)) this.mergeRows(msg.o);
        break;
      case 'hi': {
        const name = String(msg.n ?? '?').slice(0, 24);
        const color = /^#[0-9a-f]{6}$/i.test(msg.c) ? msg.c : '#cccccc';
        this.peers.set(ev.pubkey, { name, color, last: Date.now(), ...(msg.d === 1 ? { disp: true } : {}) });
        this.o.onPeers();
        if (!known) {
          if (!msg.re) setTimeout(() => this.hello(true), Math.random() * 400);
          if (this.dirty) void this.snapshot(); // make sure the newcomer can fetch a fresh map
        }
        break;
      }
      case 'bye':
        if (this.peers.delete(ev.pubkey)) this.o.onPeers();
        break;
      default:
        if (!this.taps.some((tap) => tap(msg, ev.pubkey))) this.o.onMsg(msg, ev.pubkey);
    }
  }

  private mergeRows(rows: Row[]): void {
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      this.o.store.merge(row);
      if (this.unconfirmed.size && row[2] >= (this.o.store.entries.get(row[0])?.t ?? 0)) this.unconfirmed.delete(row[0]);
    }
  }

  nameOf(pk: string): string {
    return pk === this.pk ? this.o.name : this.peers.get(pk)?.name ?? pk.slice(0, 6);
  }
  colorOf(pk: string): string {
    return pk === this.pk ? this.o.color : this.peers.get(pk)?.color ?? '#cccccc';
  }

  /** The page came back to the foreground or the network returned. */
  wake(force: boolean): void {
    for (const r of this.relays) r.wake(force);
  }

  /** The page is being hidden and may never run again: get our edits out, but stay resumable. */
  async pause(): Promise<void> {
    if (this.dirty) await this.snapshot();
    await this.send({ y: 'bye' });
  }

  async stop(): Promise<void> {
    clearInterval(this.beat);
    await this.pause();
    setTimeout(() => this.relays.forEach((r) => r.close()), 200);
  }
}
