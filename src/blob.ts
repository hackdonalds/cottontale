// Files without a server: the GM's own images, models and sounds.
//
// A file is encrypted with a key derived from the table code, and the result is
// named by the SHA-256 of the *ciphertext*. Anyone can then store or pass on the
// blob without being able to read it, and whoever fetches it can check it got
// the right bytes before trusting them. What goes into the shared store is only
// a small reference: { h: hash, n: size, m: mime, s: servers that took it }.
//
// A blob is looked for in three places, in order:
//   1. this device's cache (Cache API, least-recently-used cleanup),
//   2. Blossom servers: public content-addressed blob servers (BUD-01/02/06),
//   3. another player at the table who has it (WebRTC, see blobpeer.ts).
// The first part of this file is pure and runs under node (unit tests).
import { finalizeEvent } from 'nostr-tools/pure';
import { hex, type Msg } from './net';
import { PeerBlobs } from './blobpeer';

/** What the store holds for a file. `n` is the size of the ciphertext (the file itself is 28 bytes smaller). */
export interface BlobRef { h: string; n: number; m: string; s?: string[] }
/** How one server answered an upload. */
export interface ServerOutcome { url: string; ok: boolean; status?: number; reason?: string }
export type BlobSource = 'cache' | 'server' | 'peer' | 'relay';
export type Progress = (hash: string, loaded: number, total: number) => void;

export const MAX_BLOB = 20 * 1024 * 1024;
export const CACHE_CAP = 300 * 1024 * 1024;
/** Nonce (12) + GCM tag (16) around the file. */
export const OVERHEAD = 28;
/** Piece size on a WebRTC data channel. */
export const CHUNK = 16 * 1024;
/** Blobs up to this size may travel through the relays when WebRTC fails; pieces are this big / this small. */
export const RELAY_MAX = 48 * 1024;
export const RELAY_CHUNK = 12 * 1024;
/**
 * Public servers that took an encrypted (application/octet-stream) upload from a
 * throwaway key and gave back identical bytes when probed (Nov 2026). Many others
 * refuse opaque files or unknown keys; a refusal only means the next source is used.
 */
export const DEFAULT_SERVERS = ['https://nostr.download', 'https://blossom.data.haus'];
export const DEFAULT_ICE = ['stun:stun.l.google.com:19302'];

const te = new TextEncoder();
const HASH = /^[0-9a-f]{64}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,40}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,60}$/;
/** WebCrypto and friends want a plain ArrayBuffer behind the view. */
const raw = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export const isHash = (h: unknown): h is string => typeof h === 'string' && HASH.test(h);

export async function sha256hex(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', raw(bytes))));
}

/** A tidy mime type (lower case, no parameters), or '' if it is not one. */
export function cleanMime(m: unknown): string {
  const s = typeof m === 'string' ? m.split(';')[0].trim().toLowerCase() : '';
  return MIME.test(s) ? s : '';
}

/**
 * Server addresses we are willing to talk to: https (plain http only on this
 * machine or the local network), no credentials or queries, no duplicates.
 */
export function cleanServers(v: unknown, max = 8): string[] {
  const out: string[] = [];
  for (const s of Array.isArray(v) ? v : []) {
    if (typeof s !== 'string' || s.length > 200) continue;
    let u: URL;
    try { u = new URL(s.trim()); } catch { continue; }
    const near = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && near)) continue;
    if (u.username || u.password || u.search || u.hash) continue;
    const url = u.origin + u.pathname.replace(/\/+$/, '');
    if (!out.includes(url) && out.length < max) out.push(url);
  }
  return out;
}

/**
 * Which servers to use: this device's own list if it has one (JSON text from
 * local storage), else the table's setting, else the defaults. An empty list is
 * a valid answer: the table then passes files from player to player only.
 */
export function pickServers(device: string | null | undefined, table: unknown, fallback: string[] = DEFAULT_SERVERS): string[] {
  let own: unknown = null;
  try { own = JSON.parse(device ?? 'null'); } catch { /* not a list: ignore */ }
  return cleanServers(Array.isArray(own) ? own : Array.isArray(table) ? table : fallback);
}

/** STUN servers for player-to-player transfers: this device's own list (JSON text; may be empty), else the default. */
export function pickIce(device: string | null | undefined, fallback: string[] = DEFAULT_ICE): string[] {
  let own: unknown = null;
  try { own = JSON.parse(device ?? 'null'); } catch { /* not a list: ignore */ }
  return (Array.isArray(own) ? own : fallback).filter((u): u is string => typeof u === 'string' && /^stuns?:[\w.:[\]-]+$/.test(u)).slice(0, 4);
}

/** Check a reference read from the store (anyone at the table may have written it). Null if it is not one. */
export function parseRef(v: unknown, max = MAX_BLOB): BlobRef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { h, n, m, s } = v as Record<string, unknown>;
  if (!isHash(h)) return null;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= OVERHEAD || n > max + OVERHEAD) return null;
  if (typeof m !== 'string' || cleanMime(m) !== m) return null;
  if (s !== undefined && !Array.isArray(s)) return null;
  const servers = cleanServers(s, 4);
  return servers.length ? { h, n, m, s: servers } : { h, n, m };
}

// ---- encryption --------------------------------------------------------------

export interface BlobKey { aes: CryptoKey; mac: CryptoKey }

/** The table's key for files: derived from the table code like the room key, but separate from it. */
export async function deriveBlobKey(code: string): Promise<BlobKey> {
  const base = await crypto.subtle.importKey('raw', te.encode(code.trim().toLowerCase()), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('cottontale/blob/v1'), iterations: 150_000 }, base, 512),
  );
  return {
    aes: await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']),
    mac: await crypto.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  };
}

/** The mime type is sealed in with the file, so a reference cannot pass an image off as something else. */
const aad = (mime: string) => te.encode(`cottontale/blob/v1 ${mime}\n`);

/**
 * Encrypt a file: 12-byte nonce, then AES-256-GCM ciphertext and tag. The nonce
 * is a keyed hash of the file, so the same file at the same table always gives
 * the same blob (one upload, one cache entry) and never shares a nonce with another.
 */
export async function sealBlob(key: BlobKey, bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const extra = aad(mime);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw(bytes)));
  const seed = new Uint8Array(extra.length + digest.length);
  seed.set(extra);
  seed.set(digest, extra.length);
  const iv = new Uint8Array(await crypto.subtle.sign('HMAC', key.mac, seed)).slice(0, 12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: extra }, key.aes, raw(bytes)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

/** Decrypt a blob; throws if it was sealed with another key, as another type, or changed. */
export async function openBlob(key: BlobKey, cipher: Uint8Array, mime: string): Promise<Uint8Array> {
  if (cipher.length < OVERHEAD) throw new Error('blob too short');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(cipher.subarray(0, 12)), additionalData: aad(mime) }, key.aes, raw(cipher.subarray(12)));
  return new Uint8Array(plain);
}

/** Are these the bytes the reference names? Always asked before anything is decrypted or cached. */
export async function matches(ref: BlobRef, cipher: Uint8Array): Promise<boolean> {
  return cipher.length === ref.n && (await sha256hex(cipher)) === ref.h;
}

// ---- pieces ------------------------------------------------------------------

export function* slices(bytes: Uint8Array, size = CHUNK): Generator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, Math.min(i + size, bytes.length));
}

/** Puts a blob back together from numbered pieces, in any order; refuses pieces that cannot belong. */
export class Assembler {
  loaded = 0;
  readonly count: number;
  private out: Uint8Array;
  private got: Uint8Array;
  constructor(readonly total: number, readonly size = CHUNK) {
    this.count = Math.ceil(total / size);
    this.out = new Uint8Array(total);
    this.got = new Uint8Array(this.count);
  }
  /** False if the piece is out of range or the wrong length (the sender is confused or lying). */
  add(i: number, part: Uint8Array): boolean {
    if (!Number.isInteger(i) || i < 0 || i >= this.count) return false;
    if (part.length !== (i === this.count - 1 ? this.total - i * this.size : this.size)) return false;
    if (this.got[i]) return true; // relays may deliver twice
    this.got[i] = 1;
    this.out.set(part, i * this.size);
    this.loaded += part.length;
    return true;
  }
  get done(): boolean { return this.loaded === this.total; }
  bytes(): Uint8Array { return this.out; }
}

export function b64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---- local cache -------------------------------------------------------------

/** One cached blob: hash, size, last use, and whether this device may hold the only copy. */
export interface CacheEntry { h: string; n: number; t: number; k?: 1 }

/**
 * Which blobs to drop so the cache fits under `cap`: least recently used first.
 * Blobs no server took (`k`) go last: until someone else fetches them, this copy is the file.
 */
export function evictions(index: Iterable<CacheEntry>, cap: number, keep?: string): string[] {
  const all = [...index];
  let total = all.reduce((sum, e) => sum + e.n, 0);
  const out: string[] = [];
  for (const e of all.sort((a, b) => (a.k ?? 0) - (b.k ?? 0) || a.t - b.t)) {
    if (total <= cap) break;
    if (e.h === keep) continue;
    out.push(e.h);
    total -= e.n;
  }
  return out;
}

/** The part of the Cache API we use (so tests can pass a stand-in). */
export interface Bin {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
  keys?(): Promise<ReadonlyArray<{ url: string }>>;
}

const INDEX = '/blob/index';
const at = (h: string) => `/blob/${h}`;

/**
 * Ciphertext by hash. On disk when the browser allows (Cache API), in memory
 * otherwise (private windows). It may lose anything at any time; callers fetch again.
 */
export class BlobCache {
  private index = new Map<string, CacheEntry>();
  private mem = new Map<string, Uint8Array>();
  private bin: Bin | null = null;
  private ready: Promise<void>;
  private clock = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private cap = CACHE_CAP,
    open: () => Promise<Bin> = () => caches.open('cottontale-blobs') as unknown as Promise<Bin>,
    /** Budget when everything has to stay in memory. */
    private memCap = 64 * 1024 * 1024,
  ) {
    this.ready = this.load(open).catch(() => { this.bin = null; });
  }

  private async load(open: () => Promise<Bin>): Promise<void> {
    const bin = await open();
    const saved = await bin.match(INDEX);
    for (const e of (saved ? await saved.json() : []) as CacheEntry[]) {
      if (isHash(e?.h) && Number.isFinite(e.n) && Number.isFinite(e.t)) this.index.set(e.h, { h: e.h, n: e.n, t: e.t, ...(e.k ? { k: 1 } : {}) });
    }
    // Blobs another tab wrote since the index was saved: count them too (as the oldest).
    for (const req of (await bin.keys?.()) ?? []) {
      const h = new URL(req.url, 'http://x').pathname.slice(6);
      if (!isHash(h) || this.index.has(h)) continue;
      const n = Number((await bin.match(at(h)))?.headers.get('content-length'));
      if (n > 0) this.index.set(h, { h, n, t: 0 });
    }
    this.bin = bin;
  }

  private now(): number { return (this.clock = Math.max(Date.now(), this.clock + 1)); }
  private saveSoon(): void {
    if (!this.bin) return;
    this.timer ??= setTimeout(() => void this.flush(), 1500);
  }
  /** Write the index now (it is otherwise saved a moment after each change). */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    try { await this.bin?.put(INDEX, new Response(JSON.stringify([...this.index.values()]))); } catch { /* disposable */ }
  }

  get size(): number { let n = 0; for (const e of this.index.values()) n += e.n; return n; }
  list(): CacheEntry[] { return [...this.index.values()]; }
  async has(h: string): Promise<boolean> { await this.ready; return this.index.has(h); }

  async get(h: string): Promise<Uint8Array | null> {
    await this.ready;
    const e = this.index.get(h);
    if (!e) return null;
    let bytes = this.mem.get(h) ?? null;
    if (!bytes && this.bin) {
      try {
        const res = await this.bin.match(at(h));
        if (res) bytes = new Uint8Array(await res.arrayBuffer());
      } catch { /* treated as gone */ }
    }
    if (!bytes) { this.index.delete(h); this.saveSoon(); return null; } // the browser cleared it
    e.t = this.now();
    this.saveSoon();
    return bytes;
  }

  /** Store a blob. `pin`: no server has it, so keep it as long as we can. */
  async put(h: string, bytes: Uint8Array, pin = false): Promise<void> {
    await this.ready;
    let onDisk = false;
    if (this.bin) {
      try {
        await this.bin.put(at(h), new Response(raw(bytes), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) } }));
        onDisk = true;
      } catch { /* full or blocked: memory will do */ }
    }
    if (onDisk) this.mem.delete(h); else this.mem.set(h, bytes);
    this.index.set(h, { h, n: bytes.length, t: this.now(), ...(pin ? { k: 1 } : {}) });
    for (const old of evictions(this.index.values(), this.bin ? this.cap : Math.min(this.cap, this.memCap), h)) await this.drop(old);
    this.saveSoon();
  }

  /** Mark or unmark a blob as "ours to keep" (see `put`). */
  async pin(h: string, on: boolean): Promise<void> {
    await this.ready;
    const e = this.index.get(h);
    if (!e || !!e.k === on) return;
    if (on) e.k = 1; else delete e.k;
    this.saveSoon();
  }

  async drop(h: string): Promise<void> {
    await this.ready;
    this.index.delete(h);
    this.mem.delete(h);
    try { await this.bin?.delete(at(h)); } catch { /* disposable */ }
    this.saveSoon();
  }
}

// ---- Blossom servers ---------------------------------------------------------

/** The signed note a Blossom server wants with an upload (BUD-02): "this key uploads this hash, soon". */
export function uploadAuth(sk: Uint8Array, hash: string, now = Date.now()): string {
  const at = Math.floor(now / 1000);
  const ev = finalizeEvent({ kind: 24242, content: 'Upload blob', created_at: at, tags: [['t', 'upload'], ['x', hash], ['expiration', String(at + 600)]] }, sk);
  return `Nostr ${b64(te.encode(JSON.stringify(ev)))}`;
}

const WHY: Record<number, string> = { 400: 'refused', 401: 'not allowed', 402: 'wants payment', 403: 'not allowed', 413: 'too large', 415: 'file type not allowed', 429: 'too many requests' };
const why = (res: Response) => (res.headers.get('x-reason') ?? WHY[res.status] ?? `error ${res.status}`).slice(0, 200);
/** Give a transfer time in proportion to its size (a slow phone line still gets there). */
const patience = (n: number) => AbortSignal.timeout(20_000 + n / 20);

/** Offer a blob to one server. Never throws: any trouble is that server saying no. */
export async function upload(url: string, cipher: Uint8Array, hash: string, auth: string): Promise<ServerOutcome> {
  try {
    // Already there (an earlier try, or another player)? Then there is nothing to send.
    const there = await fetch(`${url}/${hash}`, { method: 'HEAD', signal: patience(0) }).catch(() => null);
    if (there?.ok && Number(there.headers.get('content-length')) === cipher.length) return { url, ok: true, status: there.status };
    // BUD-06: ask first, so a refusal costs no upload. Servers without it answer 404/405; then we just try.
    const ask = await fetch(`${url}/upload`, {
      method: 'HEAD', signal: patience(0),
      headers: { Authorization: auth, 'X-SHA-256': hash, 'X-Content-Length': String(cipher.length), 'X-Content-Type': 'application/octet-stream' },
    }).catch(() => null);
    if (ask && !ask.ok && ![404, 405, 501].includes(ask.status)) return { url, ok: false, status: ask.status, reason: why(ask) };
    // Always /upload, never /media: a server may rewrite what is sent there.
    const res = await fetch(`${url}/upload`, {
      method: 'PUT', body: raw(cipher), signal: patience(cipher.length),
      headers: { Authorization: auth, 'Content-Type': 'application/octet-stream' },
    });
    if (!res.ok) return { url, ok: false, status: res.status, reason: why(res) };
    const said = (await res.json().catch(() => null)) as { sha256?: unknown } | null;
    if (said && typeof said.sha256 === 'string' && said.sha256.toLowerCase() !== hash) return { url, ok: false, status: res.status, reason: 'the server changed the file' };
    return { url, ok: true, status: res.status };
  } catch (e) {
    return { url, ok: false, reason: e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : 'unreachable' };
  }
}

/** Fetch a blob's ciphertext from one server (BUD-01), giving up as soon as it cannot be the right one. */
export async function download(url: string, ref: BlobRef, progress: Progress = () => {}): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${url}/${ref.h}`, { signal: patience(ref.n) });
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) {
      const all = new Uint8Array(await res.arrayBuffer());
      return all.length === ref.n ? all : null;
    }
    const out = new Uint8Array(ref.n);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > ref.n) { void reader.cancel(); return null; }
      out.set(value, got);
      progress(ref.h, (got += value.length), ref.n);
    }
    return got === ref.n ? out : null;
  } catch {
    return null;
  }
}

// ---- the whole thing ---------------------------------------------------------

/** What blobs need from the network layer (`Net` fits): a way to talk to the table, and to listen. */
export interface Signal {
  pk: string;
  send(msg: Msg): Promise<void>;
  taps: Array<(msg: Msg, from: string) => boolean | void>;
  peers?: { size: number };
}

export interface BlobOpts {
  /** From `deriveBlobKey(code)`; a promise is fine. */
  key: BlobKey | Promise<BlobKey>;
  /** The player's Nostr key (signs uploads). */
  sk: Uint8Array;
  /** The table channel, for fetching from other players. Without it there are only servers. */
  net?: Signal;
  /** The servers to use right now (see `pickServers`). May be empty. */
  servers?: () => string[];
  /** STUN servers for player-to-player transfers. */
  ice?: () => string[];
  maxSize?: number;
  /** How many servers one upload goes to. */
  maxServers?: number;
  cache?: BlobCache;
}

/** URL types a page can safely be handed; anything else is given out as plain bytes. */
const SHOWABLE = /^(image|audio|video|font|model)\//;

export class Blobs {
  readonly cache: BlobCache;
  readonly peer?: PeerBlobs;
  private max: number;
  private fetching = new Map<string, Promise<Uint8Array>>();
  private urls = new Map<string, { url: Promise<string>; refs: number }>();
  private listeners = new Set<Progress>();
  private sources = new Map<string, BlobSource>();
  private uploads = new Map<string, ServerOutcome[]>();
  private asked = false;

  constructor(private o: BlobOpts) {
    this.max = o.maxSize ?? MAX_BLOB;
    this.cache = o.cache ?? new BlobCache();
    if (o.net) {
      this.peer = new PeerBlobs({
        net: o.net,
        ice: o.ice ?? (() => DEFAULT_ICE),
        read: (h) => this.cache.get(h),
        has: (h) => this.cache.has(h),
        progress: this.emit,
      });
    }
  }

  private emit: Progress = (h, loaded, total) => { for (const fn of this.listeners) fn(h, loaded, total); };
  /** Hear how transfers are going (downloads; an upload reports 0 and then the full size). Returns a function that stops it. */
  onProgress(fn: Progress): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  servers(): string[] { return cleanServers(this.o.servers?.() ?? DEFAULT_SERVERS); }

  /**
   * Take in a file: encrypt it, keep it in the cache, and offer it to the
   * configured servers. Returns the reference to put in the store. Throws only
   * for a file we cannot take (empty, too big, no proper mime type); servers
   * saying no is normal — see `outcomes(ref.h)` or pass `report`. With no
   * server, other players get the file from this device while it is at the table.
   */
  async put(data: Uint8Array | ArrayBuffer, mime: string, opts: { report?: (outcomes: ServerOutcome[]) => void } = {}): Promise<BlobRef> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const m = cleanMime(mime);
    if (!m) throw new Error('not a mime type');
    if (!bytes.length) throw new Error('empty file');
    if (bytes.length > this.max) throw new Error('file too large');
    const cipher = await sealBlob(await this.o.key, bytes, m);
    const h = await sha256hex(cipher);
    const ref: BlobRef = { h, n: cipher.length, m };
    await this.cache.put(h, cipher, true);
    this.sources.set(h, 'cache');
    if (!this.asked) { // ask the browser not to clear our storage: it may hold the only copy
      this.asked = true;
      void Promise.resolve().then(() => navigator.storage?.persist?.()).catch(() => {});
    }
    this.emit(h, 0, ref.n);
    const auth = uploadAuth(this.o.sk, h);
    const outcomes = await Promise.all(this.servers().slice(0, this.o.maxServers ?? 3).map((url) => upload(url, cipher, h, auth)));
    this.emit(h, ref.n, ref.n);
    this.uploads.set(h, outcomes);
    const took = outcomes.filter((x) => x.ok).map((x) => x.url);
    if (took.length) { ref.s = took; await this.cache.pin(h, false); }
    opts.report?.(outcomes);
    return ref;
  }

  /** How each server answered the last `put` of this blob (empty if none was asked). */
  outcomes(hash: string): ServerOutcome[] { return this.uploads.get(hash) ?? []; }
  /** Where the last `get`/`put` of this blob found its bytes. */
  source(hash: string): BlobSource | undefined { return this.sources.get(hash); }
  /** Is the blob on this device already? */
  has(ref: BlobRef | string): Promise<boolean> { return this.cache.has(typeof ref === 'string' ? ref : ref.h); }

  /**
   * The file a reference names. Rejects if the reference is malformed, the blob
   * cannot be found anywhere right now, or what was found is not what was named.
   * Asking twice at once for the same blob fetches it once.
   */
  async get(ref: unknown): Promise<Uint8Array> {
    const r = parseRef(ref, this.max);
    if (!r) throw new Error('bad blob reference');
    let job = this.fetching.get(r.h);
    if (!job) {
      job = this.cipher(r).finally(() => this.fetching.delete(r.h));
      this.fetching.set(r.h, job);
    }
    const cipher = await job;
    if (cipher.length !== r.n) throw new Error('blob does not match its reference');
    return openBlob(await this.o.key, cipher, r.m);
  }

  /** Find the ciphertext: cache, then servers, then other players. Only hash-checked bytes come back. */
  private async cipher(ref: BlobRef): Promise<Uint8Array> {
    const cached = await this.cache.get(ref.h);
    if (cached) {
      if (await matches(ref, cached)) { this.sources.set(ref.h, 'cache'); return cached; }
      if ((await sha256hex(cached)) !== ref.h) await this.cache.drop(ref.h); // damaged on disk: fetch again
    }
    let found: Uint8Array | null = null, via: BlobSource = 'server';
    for (const url of cleanServers([...(ref.s ?? []), ...this.servers()], 12)) {
      const got = await download(url, ref, this.emit);
      if (got && (await matches(ref, got))) { found = got; break; }
    }
    if (!found && this.peer) {
      const got = await this.peer.fetch(ref, (bytes) => matches(ref, bytes));
      if (got) { found = got.bytes; via = got.via; }
    }
    if (!found) throw new Error('blob not available');
    this.sources.set(ref.h, via);
    this.emit(ref.h, ref.n, ref.n);
    await this.cache.put(ref.h, found);
    return found;
  }

  /**
   * A URL for the decrypted file (for <img>, audio, loaders). Each call must be
   * paired with a `release`; the URL is revoked when the last user lets go.
   */
  objectUrl(ref: unknown): Promise<string> {
    const r = parseRef(ref, this.max);
    if (!r) return Promise.reject(new Error('bad blob reference'));
    const id = `${r.h} ${r.m}`;
    let e = this.urls.get(id);
    if (!e) {
      const url = this.get(r).then((bytes) => URL.createObjectURL(new Blob([raw(bytes)], { type: SHOWABLE.test(r.m) ? r.m : 'application/octet-stream' })));
      this.urls.set(id, (e = { url, refs: 0 }));
      url.catch(() => { if (this.urls.get(id) === e) this.urls.delete(id); }); // a failed fetch can be tried again
    }
    e.refs++;
    return e.url;
  }
  release(ref: unknown): void {
    const r = parseRef(ref, this.max);
    const id = r ? `${r.h} ${r.m}` : '';
    const e = this.urls.get(id);
    if (!e || --e.refs > 0) return;
    this.urls.delete(id);
    void e.url.then((u) => URL.revokeObjectURL(u), () => {});
  }

  /** Stop player-to-player connections (leaving the table). */
  close(): void { this.peer?.close(); }
}
