// Packs in the table: the GM's own pieces, as data that travels with the table.
//
// A custom pack is one store key, `pk:<ns>` (table-wide), holding a small manifest:
//
//   { v: 1, id: ns, name, pieces: { props: { <name>: Entry }, minis: { <name>: Entry } }, shelves? }
//   Entry = { name, icon?, kind, ref: BlobRef, …what the kind adds… }
//
// The files themselves are not in the store: an entry points at one with a blob reference
// (blob.ts). Every device follows `pk:*`: a pack's pieces go into the registry at once, as
// plain stand-ins that know their name, and each is fetched and built the first time it is
// actually drawn on the board in front of us (or its picture is asked for by the library).
// Nothing here ever waits for a download before the table works.
//
// What a piece *is* — a flat picture, a tile, later a model — is a "kind", added with
// `registerPieceKind`. This module knows none of them (standee.ts brings the first two).
//
// Everything read from the store is somebody else's data: `parsePack` keeps only what it
// understands, clamps counts and sizes, and reads references with `parseRef`.
import * as THREE from 'three';
import { MAX_BLOB, parseRef, type BlobRef, type ServerOutcome } from './blob';
import { STANDIN_HEIGHT, type MiniDef, type PropDef } from './catalog';
import { pieceId, registerPack, unregisterPack, type Pack } from './registry';
import type { Store } from './store';

export const PACK_FORMAT = 1;
/** A table follows at most this many packs (the first by namespace), each with at most this many pieces. */
export const MAX_PACKS = 8, MAX_PIECES = 64, MAX_SHELVES = 12;
/** What a table's packs may weigh in all: past the soft line the Packs page warns, past the hard one nothing more is added. */
export const SOFT_BYTES = 40 * 1024 * 1024, HARD_BYTES = 100 * 1024 * 1024;
export const PACK_KEY = 'pk:';

export type Group = 'props' | 'minis';
export const GROUPS: readonly Group[] = ['props', 'minis'];

/** One piece of a pack. `kind` says how to build it; a kind adds its own fields beside these. */
export interface Entry { name: string; icon?: string; kind: string; ref: BlobRef; /** A small picture for the library, for a piece whose file is not one (a model). */ pic?: BlobRef; [field: string]: unknown }
/** The most a piece's library picture (`pic`) may weigh. */
export const PIC_BYTES = 48 * 1024;
/** The picture the library shows for a piece: its file when that is a picture, else the small one stored beside it. */
const picOf = (e: Entry): BlobRef | null => (/^image\//.test(e.ref.m) ? e.ref : e.pic ?? null);
export interface PackManifest {
  v: 1;
  /** The namespace: the same as the key it is stored under. */
  id: string;
  name: string;
  pieces: Record<Group, Record<string, Entry>>;
  /** Library shelf → names within the pack. A piece on no shelf goes on one named after the pack. */
  shelves?: Partial<Record<Group, Record<string, string[]>>>;
}

// ---- kinds of piece ---------------------------------------------------------------------------

export interface KindCtx { ns: string; name: string; group: Group; /** `ns:name` */ id: string }
/** What a kind builds from a piece's file: the definition for the group asked for (see registry.ts). */
export interface Built {
  prop?: PropDef;
  mini?: MiniDef;
  /** Called when the piece leaves, or is built again: free textures, geometry, atlas cells. */
  dispose?(): void;
}
export interface PieceKind {
  /** The kind's own fields of an entry, read from untrusted data and clamped. Null: not a valid entry of this kind. */
  parse(raw: unknown): object | null;
  /** Build the piece from its file. Runs at most once per piece and file; rejects if the file is not what it should be. */
  build(entry: Entry, bytes: Uint8Array, ctx: KindCtx): Promise<Built>;
  /** The most bytes a file of this kind may have (a number, or worked out from the kind's fields). Larger entries are dropped. */
  budget?: number | ((fields: object) => number);
  /** Where pieces of this kind may be (default: both). */
  groups?: readonly Group[];
}

const kinds = new Map<string, PieceKind>();
/** Add a kind of piece ('standee', 'flat', …), or replace it. Packs already at the table are read again with it. */
export function registerPieceKind(kind: string, impl: PieceKind): void {
  kinds.set(kind, impl);
  if (S) { for (const p of live.values()) p.sig = ''; follow(); }
}
export const pieceKinds = (): string[] => [...kinds.keys()];

// ---- reading a manifest (pure) ---------------------------------------------------------------

const NS = /^[a-z0-9][a-z0-9_-]{0,31}$/, PIECE = /^[a-z0-9][a-z0-9_.-]{0,39}$/, KIND = /^[a-z][a-z0-9-]{0,23}$/;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** A number from untrusted data, inside [min, max]; `def` if it is not one. */
export const clampNum = (v: unknown, min: number, max: number, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);

export function parseEntry(raw: unknown, group: Group): Entry | null {
  const r = obj(raw), kind = r ? text(r.kind, 24) : '';
  if (!r || !KIND.test(kind)) return null;
  const impl = kinds.get(kind);
  if (impl?.groups && !impl.groups.includes(group)) return null;
  // A kind this app does not have (yet, or any more) keeps its place as a stand-in; its own fields are not read.
  const fields = impl ? impl.parse(r) : {};
  if (!fields) return null;
  const max = typeof impl?.budget === 'function' ? impl.budget(fields) : impl?.budget ?? MAX_BLOB;
  const ref = parseRef(r.ref, Math.min(MAX_BLOB, Math.max(1, max)));
  if (!ref) return null;
  const icon = text(r.icon, 8), pic = /^image\//.test(ref.m) ? null : parseRef(r.pic, PIC_BYTES);
  return { ...fields, name: text(r.name, 32) || 'Piece', ...(icon ? { icon } : {}), kind, ref, ...(pic && /^image\/(png|jpeg|webp)$/.test(pic.m) ? { pic } : {}) };
}

/** Read a manifest somebody else wrote. Null if it is not one (or not the one for `ns`). */
export function parsePack(raw: unknown, ns?: string): PackManifest | null {
  const r = obj(raw);
  if (!r || r.v !== PACK_FORMAT || typeof r.id !== 'string' || !NS.test(r.id) || (ns !== undefined && r.id !== ns)) return null;
  const pieces: PackManifest['pieces'] = { props: {}, minis: {} }, from = obj(r.pieces) ?? {}, taken = new Set<string>();
  let n = 0;
  for (const group of GROUPS) {
    for (const [name, e] of Object.entries(obj(from[group]) ?? {})) {
      if (n >= MAX_PIECES) break;
      if (!PIECE.test(name) || taken.has(name)) continue; // one name is one piece, whichever group it is in
      const entry = parseEntry(e, group);
      if (!entry) continue;
      pieces[group][name] = entry;
      taken.add(name);
      n++;
    }
  }
  const shelves: NonNullable<PackManifest['shelves']> = {}, given = obj(r.shelves) ?? {};
  for (const group of GROUPS) {
    const out: Record<string, string[]> = {};
    for (const [shelf, names] of Object.entries(obj(given[group]) ?? {})) {
      const label = text(shelf, 24);
      if (!label || !Array.isArray(names) || Object.keys(out).length >= MAX_SHELVES) continue;
      const mine = [...new Set(names.filter((x): x is string => typeof x === 'string' && Object.hasOwn(pieces[group], x)))];
      if (mine.length) out[label] = [...(out[label] ?? []), ...mine.filter((x) => !out[label]?.includes(x))];
    }
    if (Object.keys(out).length) shelves[group] = out;
  }
  return { v: 1, id: r.id, name: text(r.name, 32) || 'Pieces', pieces, ...(Object.keys(shelves).length ? { shelves } : {}) };
}

/** The namespace of a device's own pack: from the player's id, so two GMs never write the same one. */
export function ownNs(me: string): string {
  const id = me.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  return `u-${id || 'me'}`;
}

/** A piece's name within its pack, made from what the GM called it: lower case, no spaces, not taken yet. */
export function pieceKey(label: string, taken: (key: string) => boolean): string {
  const base = label.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'piece';
  for (let i = 1; ; i++) {
    const key = i === 1 ? base : `${base}-${i}`;
    if (!taken(key)) return key;
  }
}

/** The bytes a pack's files take (as stored: a few more than the files themselves). */
export function packBytes(m: PackManifest): number {
  let n = 0;
  for (const group of GROUPS) for (const e of Object.values(m.pieces[group])) n += e.ref.n + (e.pic?.n ?? 0);
  return n;
}
export const pieceCount = (m: PackManifest): number => Object.keys(m.pieces.props).length + Object.keys(m.pieces.minis).length;

export interface Budget { bytes: number; soft: number; hard: number; level: 'ok' | 'soft' | 'hard'; /** 0–1 of the hard limit. */ part: number }
/** Where a table's packs stand against the limits. */
export function budget(bytes: number, soft = SOFT_BYTES, hard = HARD_BYTES): Budget {
  return { bytes, soft, hard, level: bytes >= hard ? 'hard' : bytes >= soft ? 'soft' : 'ok', part: Math.min(1, Math.max(0, bytes / hard)) };
}
/** May a file of `n` bytes still be added to a table that holds `bytes`? */
export const fits = (bytes: number, n: number, hard = HARD_BYTES): boolean => n > 0 && bytes + n <= hard;

/** The table's valid packs, in the order every device agrees on, at most MAX_PACKS of them. */
export function readPacks(store: Pick<Store, 'keys' | 'get'>): PackManifest[] {
  const out: PackManifest[] = [];
  for (const key of [...store.keys(PACK_KEY)].sort()) {
    const m = out.length < MAX_PACKS ? parsePack(store.get(key), key.slice(PACK_KEY.length)) : null;
    if (m) out.push(m);
  }
  return out;
}

/** Where a file ended up after `blobs.put`, in words for the person who added it. */
export function storedText(ref: BlobRef, outcomes: readonly ServerOutcome[] = []): string {
  const took = ref.s?.length ?? 0, refused = outcomes.filter((o) => !o.ok);
  if (took) return `Stored on ${took} server${took === 1 ? '' : 's'}${refused.length ? ` (${refused.length} more said no)` : ''}`;
  const why = refused.map((o) => o.reason || (o.status ? `error ${o.status}` : '')).find(Boolean);
  return `Saved on this phone and shared with players directly${refused.length ? ` (no server took it${why ? `: ${text(why, 60)}` : ''})` : ''}`;
}

// ---- following the table's packs -------------------------------------------------------------

export type PieceState = 'waiting' | 'loading' | 'ready' | 'failed' | 'unknown';
interface Piece {
  entry: Entry; group: Group; name: string; id: string; sig: string;
  state: PieceState; built?: Built; tried: number;
  /** The stand-in drawn until the piece is built: its own (tiny) geometry, so being drawn can be noticed. */
  wait?: THREE.BufferGeometry;
  thumb?: string; thumbAsked?: number;
}
interface Live { manifest: PackManifest; sig: string; pieces: Map<string, Piece> }

export interface PackHost {
  store: Store;
  /** The table's files (blob.ts). */
  blobs: { get(ref: unknown): Promise<Uint8Array>; objectUrl(ref: unknown): Promise<string>; release(ref: unknown): void };
  /** This player's id (see `pid` in rules.ts). */
  me: string;
  /** May this device change the table? Packs are only written when it may. */
  full?(): boolean;
}

let S: PackHost | null = null;
const live = new Map<string, Live>();
const listeners = new Set<() => void>();
const RETRY_MS = 15_000, LOADS = 2;
let loading = 0, told: ReturnType<typeof setTimeout> | undefined;
const queue: Piece[] = [], again = new Map<string, ReturnType<typeof setTimeout>>();

/** Hear when packs or their pieces change (arrived, built, a picture ready). Returns how to stop. */
export function onPacks(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function tell(): void {
  told ??= setTimeout(() => { told = undefined; for (const fn of [...listeners]) fn(); }, 40);
}

// What stands in for a piece whose file is not here yet: grey and see-through, like any piece
// this device does not have. Being drawn is what asks for the file.
const WAIT = { props: new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0), minis: new THREE.ConeGeometry(0.2, 0.7, 8).translate(0, 0.43, 0) };
const WAITING = new THREE.MeshStandardMaterial({ color: '#8b8f98', roughness: 0.9, transparent: true, opacity: 0.6 });
WAITING.onBeforeRender = (_r, _s, _c, geometry) => { if (typeof geometry.userData.piece === 'string') want(geometry.userData.piece); };
/** Is this the material of a piece that is still waiting for its file? */
export const isWaiting = (m: unknown): boolean => m === WAITING;

function standIn(p: Piece): PropDef | MiniDef {
  // (A tag of its own: a cloned geometry shares its `userData` with the one it was cloned from, and a
  // shared tag would have every stand-in ask for the file of whichever piece was tagged last.)
  if (!p.wait) { p.wait = WAIT[p.group].clone(); p.wait.userData = { piece: p.id }; }
  const def = { name: p.entry.name, icon: p.entry.icon ?? '🖼️', mesh: { geometry: p.wait, material: WAITING } };
  return p.group === 'minis' ? { ...def, height: STANDIN_HEIGHT } : def;
}

function drop(p: Piece): void {
  p.built?.dispose?.();
  p.built = undefined;
  p.wait?.dispose();
  p.wait = undefined;
  if (p.thumb) S?.blobs.release(picOf(p.entry));
  p.thumb = undefined;
  p.state = 'waiting';
}

/** Put a pack into the registry as it stands now: built pieces as themselves, the rest as stand-ins. */
function register(ns: string): void {
  const l = live.get(ns);
  if (!l) return;
  const pack: Required<Pick<Pack, 'props' | 'minis'>> & { shelves: Record<Group, Record<string, string[]>> } = { props: {}, minis: {}, shelves: { props: {}, minis: {} } };
  for (const p of l.pieces.values()) {
    const made = p.group === 'props' ? p.built?.prop : p.built?.mini;
    const def = made ? { ...made, name: p.entry.name, icon: p.entry.icon ?? made.icon } : standIn(p);
    (pack[p.group] as Record<string, unknown>)[p.name] = def;
  }
  for (const group of GROUPS) {
    const shelved = new Set<string>();
    for (const [shelf, names] of Object.entries(l.manifest.shelves?.[group] ?? {})) {
      pack.shelves[group][shelf] = names;
      for (const n of names) shelved.add(n);
    }
    const loose = Object.keys(l.manifest.pieces[group]).filter((n) => !shelved.has(n));
    if (loose.length) pack.shelves[group][l.manifest.name] = [...(pack.shelves[group][l.manifest.name] ?? []), ...loose];
  }
  registerPack(ns, pack);
}
function registerSoon(ns: string): void {
  if (again.has(ns)) return;
  again.set(ns, setTimeout(() => { again.delete(ns); register(ns); }, 60));
}

/** Read `pk:*` again and make the registry match: new packs in, changed ones redone, gone ones out. */
function follow(): void {
  if (!S) return;
  const found = new Map(readPacks(S.store).map((m) => [m.id, m]));
  for (const [ns, l] of live) {
    if (found.has(ns)) continue;
    for (const p of l.pieces.values()) drop(p);
    live.delete(ns);
    unregisterPack(ns);
  }
  for (const [ns, manifest] of found) {
    const sig = JSON.stringify(manifest), was = live.get(ns);
    if (was?.sig === sig) continue;
    const pieces = new Map<string, Piece>();
    for (const group of GROUPS) {
      for (const [name, entry] of Object.entries(manifest.pieces[group])) {
        const key = `${group}/${name}`, old = was?.pieces.get(key);
        // The same file built the same way: keep what was built, whatever else about the entry changed (its name, say).
        const { name: _n, icon: _i, ...how } = entry, psig = JSON.stringify(how);
        if (old && old.sig === psig) {
          old.entry = entry;
          if (old.state === 'unknown' && kinds.has(entry.kind)) old.state = 'waiting';
          pieces.set(key, old);
          was!.pieces.delete(key);
          continue;
        }
        pieces.set(key, { entry, group, name, id: pieceId(ns, name), sig: psig, state: kinds.has(entry.kind) ? 'waiting' : 'unknown', tried: 0 });
      }
    }
    for (const p of was?.pieces.values() ?? []) drop(p);
    live.set(ns, { manifest, sig, pieces });
    register(ns);
  }
  tell();
}

function find(id: string): Piece | null {
  const cut = id.indexOf(':'), l = cut > 0 ? live.get(id.slice(0, cut)) : undefined;
  if (!l) return null;
  const name = id.slice(cut + 1);
  return l.pieces.get(`props/${name}`) ?? l.pieces.get(`minis/${name}`) ?? null;
}
const current = (p: Piece): boolean => find(p.id) === p;

/** This piece is needed (it is being drawn): fetch its file and build it, if that is not under way. Cheap to call often. */
export function want(id: string): void {
  const p = find(id);
  if (!p || (p.state !== 'waiting' && !(p.state === 'failed' && Date.now() - p.tried > RETRY_MS))) return;
  p.state = 'loading';
  queue.push(p);
  pump();
}
function pump(): void {
  while (loading < LOADS && queue.length) {
    const p = queue.shift()!;
    if (!current(p)) continue;
    loading++;
    void build(p).finally(() => { loading--; pump(); tell(); });
  }
}
async function build(p: Piece): Promise<void> {
  const impl = kinds.get(p.entry.kind), ns = p.id.slice(0, p.id.indexOf(':'));
  try {
    if (!S || !impl) throw new Error('no such kind');
    const bytes = await S.blobs.get(p.entry.ref);
    if (!current(p)) return;
    const built = await impl.build(p.entry, bytes, { ns, name: p.name, group: p.group, id: p.id });
    if (!current(p) || p.state !== 'loading') { built.dispose?.(); return; }
    if (!(p.group === 'props' ? built.prop : built.mini)) { built.dispose?.(); throw new Error('nothing built'); }
    p.built = built;
    p.state = 'ready';
    registerSoon(ns);
  } catch {
    if (current(p)) { p.state = 'failed'; p.tried = Date.now(); }
  }
}

/** Where a piece of a pack stands: null if no pack at the table has it. */
export const pieceState = (id: string): PieceState | null => find(id)?.state ?? null;

/**
 * The picture of a pack's piece for the library, as inline CSS (like the built-in thumbnails),
 * or null while there is none. Asking is what fetches it; `onPacks` says when to look again.
 */
export function packThumb(id: string): string | null {
  const p = find(id);
  if (!p || !S) return null;
  if (p.thumb) return `background-image:url(${p.thumb});background-size:contain;background-repeat:no-repeat;background-position:center`;
  const ref = picOf(p.entry), host = S;
  if (!ref || (p.thumbAsked && Date.now() - p.thumbAsked < RETRY_MS)) return null;
  p.thumbAsked = Date.now();
  host.blobs.objectUrl(ref).then((url) => {
    if (current(p) && !p.thumb && picOf(p.entry)?.h === ref.h) { p.thumb = url; p.thumbAsked = undefined; tell(); } else host.blobs.release(ref);
  }, () => {});
  return null;
}
/** The same picture as a URL (or null while there is none). */
export const packThumbUrl = (id: string): string | null => (packThumb(id), find(id)?.thumb ?? null);

/** Start following the table's packs. Call once the store and the files are up. */
export function initPacks(host: PackHost): void {
  S = host;
  follow();
}
/** A `pk:` key changed in the store (call from the store's onChange; anything else is ignored). */
export function packChanged(key: string): void {
  if (S && key.startsWith(PACK_KEY)) follow();
}
/** Stop following (tests; leaving the table). */
export function stopPacks(): void {
  for (const [ns, l] of live) { for (const p of l.pieces.values()) drop(p); unregisterPack(ns); }
  for (const t of again.values()) clearTimeout(t);
  again.clear();
  live.clear();
  queue.length = 0;
  S = null;
}

// ---- what the pages show -------------------------------------------------------------------------

export interface PieceInfo { id: string; group: Group; name: string; entry: Entry; bytes: number; state: PieceState }
export interface PackInfo { ns: string; name: string; own: boolean; bytes: number; pieces: PieceInfo[] }

/** The table's packs with their pieces and what each weighs. */
export function listPacks(): PackInfo[] {
  return [...live.entries()].map(([ns, l]) => ({
    ns, name: l.manifest.name, own: !!S && ns === ownNs(S.me), bytes: packBytes(l.manifest),
    pieces: [...l.pieces.values()].map((p) => ({ id: p.id, group: p.group, name: p.name, entry: p.entry, bytes: p.entry.ref.n + (p.entry.pic?.n ?? 0), state: p.state })),
  }));
}
/** The bytes of one pack's files (0 if the table has no such pack). */
export const packSize = (ns: string): number => { const l = live.get(ns); return l ? packBytes(l.manifest) : 0; };
/** The bytes of all the table's packs together. */
export const tableSize = (): number => [...live.values()].reduce((n, l) => n + packBytes(l.manifest), 0);

// ---- changing packs ---------------------------------------------------------------------------------

export type Done = { ok: true; id?: string } | { ok: false; reason: string };
const no = (reason: string): Done => ({ ok: false, reason });

/** The manifest as it is stored (so fields a newer app wrote survive our edits), or a fresh one. Null if we may not write. */
function editable(ns: string, name?: string): Record<string, unknown> | string {
  if (!S) return 'The table is not ready yet.';
  if (S.full && !S.full()) return 'Only the GM can change the table\'s packs.';
  if (!NS.test(ns)) return 'That is not a pack.';
  const raw = S.store.get(PACK_KEY + ns);
  if (raw !== null && parsePack(raw, ns)) return structuredClone(raw) as Record<string, unknown>;
  if (name === undefined) return 'The table has no such pack.';
  if (!live.has(ns) && readPacks(S.store).length >= MAX_PACKS) return `A table holds at most ${MAX_PACKS} packs.`;
  return { v: PACK_FORMAT, id: ns, name: text(name, 32) || 'Pieces', pieces: { props: {}, minis: {} } };
}
function write(ns: string, raw: Record<string, unknown>): Done {
  if (!parsePack(raw, ns)) return no('That would not be a valid pack.');
  S!.store.set(PACK_KEY + ns, raw);
  return { ok: true };
}
const sub = (o: Record<string, unknown>, k: string): Record<string, unknown> => (obj(o[k]) ?? (o[k] = {})) as Record<string, unknown>;
function unshelve(raw: Record<string, unknown>, group: Group, name: string): void {
  const shelves = obj(obj(raw.shelves)?.[group]);
  for (const [shelf, names] of Object.entries(shelves ?? {})) {
    if (!Array.isArray(names)) continue;
    const rest = names.filter((n) => n !== name);
    if (rest.length) shelves![shelf] = rest; else delete shelves![shelf];
  }
}

/**
 * Add a piece to a pack (or replace the one of that name), creating the pack if the table does
 * not have it: `opts.pack` names a new pack, `opts.shelf` puts the piece on a library shelf
 * (without one it goes on the pack's own).
 */
export function addPiece(ns: string, group: Group, name: string, entry: Entry, opts: { shelf?: string; pack?: string } = {}): Done {
  const raw = editable(ns, opts.pack ?? 'My pieces');
  if (typeof raw === 'string') return no(raw);
  if (!PIECE.test(name)) return no('That name will not do for a piece.');
  const clean = parseEntry(entry, group);
  if (!clean) return no('That piece is not one this table can hold (too large, or not a kind it knows).');
  const pieces = sub(raw, 'pieces'), mine = sub(pieces, group), other = sub(pieces, group === 'props' ? 'minis' : 'props');
  const had = obj(mine[name]), before = (parseRef(had?.ref)?.n ?? 0) + (parseRef(had?.pic)?.n ?? 0);
  if (!had && Object.keys(mine).length + Object.keys(other).length >= MAX_PIECES) return no(`A pack holds at most ${MAX_PIECES} pieces.`);
  if (!fits(tableSize() - before, clean.ref.n + (clean.pic?.n ?? 0))) return no('The table\'s packs are full (100 MB). Remove something first.');
  delete other[name];
  mine[name] = { ...entry, ...clean };
  unshelve(raw, group, name);
  const shelf = text(opts.shelf, 24);
  if (shelf) {
    const on = sub(sub(raw, 'shelves'), group);
    on[shelf] = [...(Array.isArray(on[shelf]) ? (on[shelf] as unknown[]) : []), name];
  }
  const done = write(ns, raw);
  return done.ok ? { ok: true, id: pieceId(ns, name) } : done;
}

/** Take a piece out of its pack. Copies on a board stay in the table's data and are drawn as stand-ins. */
export function removePiece(ns: string, group: Group, name: string): Done {
  const raw = editable(ns);
  if (typeof raw === 'string') return no(raw);
  const mine = sub(sub(raw, 'pieces'), group);
  if (!Object.hasOwn(mine, name)) return no('The pack has no such piece.');
  delete mine[name];
  unshelve(raw, group, name);
  return write(ns, raw);
}

export function renamePack(ns: string, name: string): Done {
  const raw = editable(ns), label = text(name, 32);
  if (typeof raw === 'string') return no(raw);
  if (!label) return no('A pack needs a name.');
  raw.name = label;
  return write(ns, raw);
}

/** Take a whole pack off the table. (Its files stay where they were stored; nothing points at them any more.) */
export function removePack(ns: string): Done {
  if (!S) return no('The table is not ready yet.');
  if (S.full && !S.full()) return no('Only the GM can change the table\'s packs.');
  if (!NS.test(ns) || S.store.get(PACK_KEY + ns) === null) return no('The table has no such pack.');
  S.store.set(PACK_KEY + ns, null);
  return { ok: true };
}
