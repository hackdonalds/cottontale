// Whole scenes from a seed: a wood, a dungeon, a cave, a tavern — or a pirate cove, a crypt, a ship's hold.
//
// A scene is a pure function of its options and a preset. Everything is worked out in whole
// numbers (no floating point, no Math.random), so the same seed gives the same scene on every
// device and a scene can be shared as a handful of numbers. The result is a list of
// ordinary edits (blocks, props, edge walls), so a generated scene is just a table that
// someone built very quickly: every brush still works on it afterwards.
//
// The four ways of laying a scene out (ALGOS) are code. Everything that gives one its
// character is data, a "preset": which blocks, props and wall pieces it places, its kinds
// of room and what furnishes them, its name, icon and slider labels. No preset is written
// into the app: the ones on offer are files (public/gens/*.json, listed in index.json) and
// a theme may bring its own. Either way it is somebody else's data: `parsePreset` keeps what
// it understands, clamps the numbers and drops pieces this build does not have.
import { dressing, ek, roomEdges, type Side } from './rules';

/** The id of a preset. (It was once one of four fixed names.) */
export type Theme = string;
/** `theme` names the preset. The three sliders run 0..4; what they mean depends on the preset. */
export interface GenOpts { theme: Theme; seed: number; size: number; density: number; detail: number }
export type Edit = [key: string, value: unknown];
/** A room of a scene. Its furnishing has a seed of its own, so one room can be redone; a locked room survives a new layout. */
export interface GenRoom { kind: string; x0: number; x1: number; z0: number; z1: number; seed: number; lock?: boolean }
export interface Scene { edits: Edit[]; bounds: [x0: number, x1: number, z0: number, z1: number]; rooms: GenRoom[] }

// ---- presets: the data a generator works from --------------------------------------------

export const ALGOS = ['wilderness', 'dungeon', 'cave', 'building'] as const;
export type Algo = typeof ALGOS[number];
/** Blocks by a smooth chance of 0..255 over the table: a cell gets the first block whose `below` its chance is under. */
export type Bands = [block: string, below: number][];
/** What stands on a cell, in shares of a thousand cells; the rest stay open. */
export type Shares = [prop: string, perMille: number][];
/** A kind of room. `walls` stand along its walls, `floor` in the open (a piece named twice turns up twice as often). */
export interface RoomKit {
  kind: string; name: string;
  /** Stands in the middle of the room. */
  centre?: string;
  /** Stands in a back corner (building: the two back rooms). */
  corner?: string;
  walls: string[]; floor: string[];
  /** Fuller than the Clutter slider says, by this much (0..2). */
  extra?: number;
}
export interface WallStyle { solid: string; window?: string; door?: string }
const CLUTTER = ['rim', 'gem', 'rubble', 'damp', 'dry', 'relic'] as const;
/**
 * The pieces a preset builds with. Each way of building reads what it needs:
 * - wilderness: `ground` (by lie of the land), `path`, `water` + `stream` (a stream in `stream` of 4 scenes), `sea` (0..4: how much of one side is under `water`), `dress`, `shore`
 * - dungeon: `floor` (rooms), `corridor`, `walls[0]`, `light`; the first of `rooms` is the way in
 * - cave: `ground` (by damp), `water` (pools), `rock`, `clutter`
 * - building: `floor`, `ground[0]` + `dress` (the yard), `path`, `walls` (one style per building), `light`, `table`, `seat`, `seat2`;
 *   `rooms` are the main room and the two back rooms, in that order
 */
export interface Palette {
  ground?: Bands; path?: string; water?: string; stream?: number; sea?: number;
  /** What grows on each ground: its own shares, or 'grow' for what the Grow brush plants there. */
  dress?: Record<string, 'grow' | Shares>;
  /** What stands beside water instead (grounds with shares of their own). */
  shore?: Shares;
  floor?: string; corridor?: string; rock?: string;
  walls?: WallStyle[];
  /** Stands in a corner of each furnished room. */
  light?: string;
  /** Cave: along the walls (`rim`, the rarer `gem`, `rubble`), in the open (on `damp` ground, on `dry` ground, the rare `relic`). */
  clutter?: Partial<Record<typeof CLUTTER[number], string>>;
  table?: string; seat?: string; seat2?: string;
}
/** `icon` names a drawing in the app's icon set. Made by `parsePreset`, which fills in what an algo cannot do without. */
export interface Preset { id: string; name: string; icon: string; algo: Algo; sliders: [string, string, string]; palette: Palette; rooms: RoomKit[] }

/** What this build of the app has: asked about every piece a preset mentions. */
export type KnownPiece = (kind: 'block' | 'prop' | 'edge', id: string) => boolean;

export const MAX_ROOM_KINDS = 12;
const MAX_LIST = 8;
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const whole = (v: unknown, lo: number, hi: number, or: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : or);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/**
 * Read a preset somebody else wrote. Null if it is not one (or builds in a way this app does not know);
 * otherwise only what this app understands. A piece it does not have is left out, and where a scene
 * cannot do without one (a floor, the ground) another of the preset's blocks stands in — so a scene
 * can always be built from what comes back.
 */
export function parsePreset(raw: unknown, known: KnownPiece): Preset | null {
  const r = obj(raw), id = text(r.id, 48), name = text(r.name, 24), algo = r.algo as Algo, p = obj(r.palette);
  if (!/^[a-z0-9][a-z0-9:_-]*$/.test(id) || !name || !ALGOS.includes(algo)) return null;
  const piece = (kind: 'block' | 'prop' | 'edge') => (v: unknown): string | undefined => (typeof v === 'string' && v.length <= 48 && known(kind, v) ? v : undefined);
  const block = piece('block'), prop = piece('prop'), edge = piece('edge');
  const props = (v: unknown): string[] => list(v, MAX_LIST).map(prop).filter((x): x is string => !!x);
  const shares = (v: unknown): Shares => {
    const out: Shares = [];
    let left = 1000;
    for (const e of list(v, MAX_LIST)) {
      const [i, n] = Array.isArray(e) ? e as unknown[] : [], id = prop(i), share = Math.min(left, whole(n, 0, 1000, 0));
      if (!id || share < 1) continue;
      out.push([id, share]);
      left -= share;
    }
    return out;
  };
  const bands = (v: unknown): Bands => {
    const out: Bands = [];
    for (const e of list(v, 6)) {
      const [i, n] = Array.isArray(e) ? e as unknown[] : [], id = block(i), below = whole(n, 1, 256, 256);
      if (id && below > (out[out.length - 1]?.[1] ?? 0)) out.push([id, below]);
    }
    if (out.length) out[out.length - 1][1] = 256; // the last ground is whatever is left
    return out;
  };
  const pal: Palette = {};
  const ground = bands(p.ground);
  if (ground.length) pal.ground = ground;
  for (const k of ['path', 'water', 'floor', 'corridor', 'rock'] as const) { const b = block(p[k]); if (b) pal[k] = b; }
  for (const k of ['stream', 'sea'] as const) if (p[k] !== undefined) pal[k] = whole(p[k], 0, 4, 0);
  const dress: Record<string, 'grow' | Shares> = {};
  for (const [g, d] of Object.entries(obj(p.dress)).slice(0, MAX_LIST)) if (block(g)) dress[g] = d === 'grow' ? 'grow' : shares(d);
  if (Object.keys(dress).length) pal.dress = dress;
  if (p.shore !== undefined) pal.shore = shares(p.shore);
  const walls: WallStyle[] = [];
  for (const w of list(p.walls, 4).map(obj)) {
    const solid = edge(w.solid), window = edge(w.window), door = edge(w.door);
    if (solid) walls.push({ solid, ...(window ? { window } : {}), ...(door ? { door } : {}) });
  }
  if (walls.length) pal.walls = walls;
  const clutter: NonNullable<Palette['clutter']> = {};
  for (const k of CLUTTER) { const c = prop(obj(p.clutter)[k]); if (c) clutter[k] = c; }
  if (Object.keys(clutter).length) pal.clutter = clutter;
  for (const k of ['light', 'table', 'seat', 'seat2'] as const) { const c = prop(p[k]); if (c) pal[k] = c; }
  const rooms: RoomKit[] = [];
  for (const q of list(r.rooms, MAX_ROOM_KINDS).map(obj)) {
    const kind = text(q.kind, 16), centre = prop(q.centre), corner = prop(q.corner);
    if (!/^[a-z0-9_-]+$/.test(kind) || rooms.some((o) => o.kind === kind)) continue;
    rooms.push({ kind, name: text(q.name, 24) || kind, ...(centre ? { centre } : {}), ...(corner ? { corner } : {}), walls: props(q.walls), floor: props(q.floor), ...(q.extra !== undefined ? { extra: whole(q.extra, 0, 2, 0) } : {}) });
  }
  // What this way of building cannot do without: another of the preset's blocks stands in, and plain rooms.
  const any = pal.ground?.[0][0] ?? pal.floor ?? pal.corridor ?? pal.path ?? pal.rock ?? pal.water;
  if (!any) return null;
  if (algo !== 'dungeon') pal.ground ??= [[any, 256]];
  if (algo === 'wilderness') pal.path ??= any;
  if (algo === 'cave') pal.rock ??= any;
  if (algo === 'dungeon' || algo === 'building') pal.floor ??= any;
  if (algo === 'dungeon') pal.corridor ??= pal.floor;
  if (algo === 'building') pal.path ??= pal.floor;
  for (let i = 1; rooms.length < (algo === 'building' ? 3 : algo === 'dungeon' ? 1 : 0); i++) if (!rooms.some((o) => o.kind === `room${i}`)) rooms.push({ kind: `room${i}`, name: 'Room', walls: [], floor: [] });
  const labels = list(r.sliders, 3).map((v) => text(v, 14)), icon = text(r.icon, 16);
  return {
    id, name, icon: /^[a-z0-9-]+$/.test(icon) ? icon : 'spark', algo,
    sliders: [labels[0] || 'Size', labels[1] || 'Density', labels[2] || 'Detail'], palette: pal, rooms,
  };
}

/**
 * The presets this device has loaded, by id: what "is this generator known" is asked of (`id in PRESETS`).
 * Filled by `addPresets`; `generate` never looks here — it is handed its preset.
 */
export const PRESETS: Record<string, Preset> = {};
/** The same list under its old name: each entry still has a `name`, an `icon` and `sliders`. */
export const THEMES = PRESETS;
/** What each kind of room is called, over every loaded preset (see `roomName` for one preset's own). */
export const ROOM_NAMES: Record<string, string> = {};
export function addPresets(presets: Preset[]): void {
  for (const p of presets) {
    PRESETS[p.id] = p;
    for (const q of p.rooms) ROOM_NAMES[q.kind] = q.name;
  }
}
export const roomName = (p: Preset | null | undefined, kind: string): string => p?.rooms.find((q) => q.kind === kind)?.name ?? ROOM_NAMES[kind] ?? kind;

/** The presets on offer: `<dir>/index.json` lists them, one file each. A missing or broken one is skipped. */
export async function loadPresets(dir: string, known: KnownPiece, get: (url: string) => Promise<unknown> = async (url) => (await fetch(url)).json()): Promise<Preset[]> {
  const names = await get(`${dir}/index.json`).catch(() => null);
  if (!Array.isArray(names)) return [];
  const files = names.filter((n): n is string => typeof n === 'string' && /^[a-z0-9_-]+$/.test(n)).slice(0, 64);
  const all = await Promise.all(files.map((n) => get(`${dir}/${n}.json`).then((raw) => parsePreset(raw, known), () => null)));
  return all.filter((p): p is Preset => !!p);
}

// ---- chance, in whole numbers --------------------------------------------------------

interface Rng { int(n: number): number; chance(num: number, den: number): boolean; pick<T>(from: readonly T[]): T }
function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { int: (n) => next() % n, chance: (num, den) => next() % den < num, pick: (from) => from[next() % from.length] };
}
function hash(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const div = (a: number, b: number) => Math.floor(a / b);
/** Smooth chance over the table, 0..255: lattice values `step` cells apart, blended between. */
function noise(x: number, z: number, step: number, seed: number): number {
  const x0 = div(x, step), z0 = div(z, step), fx = x - x0 * step, fz = z - z0 * step;
  const v = (i: number, j: number) => hash(x0 + i, z0 + j, seed) & 255;
  return div((v(0, 0) * (step - fx) + v(1, 0) * fx) * (step - fz) + (v(0, 1) * (step - fx) + v(1, 1) * fx) * fz, step * step);
}

/** The scene being built: later writes to a key replace earlier ones. */
class Build {
  private map = new Map<string, unknown>();
  block(x: number, y: number, z: number, i: string): void { this.map.set(`b:${x},${y},${z}`, { i }); }
  prop(x: number, y: number, z: number, i: string, r = 0): void { this.map.set(`b:${x},${y},${z}`, r ? { i, r } : { i }); }
  edge(x: number, y: number, z: number, s: Side, i: string): void { this.map.set(ek(x, y, z, s), { i }); }
  set(key: string, value: unknown): void { this.map.set(key, value); }
  has(x: number, y: number, z: number): boolean { return this.map.has(`b:${x},${y},${z}`); }
  drop(x: number, y: number, z: number): void { this.map.delete(`b:${x},${y},${z}`); }
  edits(): Edit[] { return [...this.map]; }
}
const NEAR: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ck = (x: number, z: number) => `${x},${z}`;

// ---- wilderness ------------------------------------------------------------------------

/** What grows on a cell: the preset's own shares, or what the Grow brush would plant. */
function dress(pal: Palette, ground: string, x: number, z: number, wet: boolean, salt: number, seed: number): string | null {
  const d = pal.dress?.[ground];
  if (!d) return null;
  if (d === 'grow') return dressing(ground, x, z, wet, salt);
  let roll = hash(x, z, seed + 17 + salt) % 1000;
  for (const [prop, share] of wet && pal.shore ? pal.shore : d) {
    if (roll < share) return prop;
    roll -= share;
  }
  return null;
}
const band = (bands: Bands, n: number): string => (bands.find(([, below]) => n < below) ?? bands[bands.length - 1])[0];

function wilderness(o: GenOpts, pal: Palette): Scene {
  const b = new Build(), r = rng(o.seed), half = 8 + o.size * 2, grounds = pal.ground!, sea = pal.water ? pal.sea ?? 0 : 0;
  const stream = r.chance(pal.stream ?? 3, 4) && !!pal.water, bend = r.int(1000), across = r.chance(1, 2);
  // The stream wanders about a line through the scene; the path crosses it the other way.
  const wander = (t: number, salt: number, reach: number) => div((noise(t, salt, 6, o.seed + salt) - 128) * reach, 128);
  const streamAt = (z: number) => wander(z + bend, 3, div(half, 2)) + div(half, 3) * (across ? 1 : -1);
  const pathAt = (x: number) => wander(x, 5, 3);
  const level = (x: number, z: number): number => {
    if (x * x + z * z < 20) return 0; // a level clearing in the middle
    const lift = div((noise(x, z, 7, o.seed) - 118) * o.detail, 70);
    return Math.max(0, Math.min(3, lift));
  };
  // The sea takes one side of the scene, along a wandering shore.
  const wet = (x: number, z: number) => stream && x === streamAt(z) || sea > 0 && z - wander(x, 9, 2) >= half - div(half * sea, 5);
  for (let x = -half; x < half; x++) for (let z = -half; z < half; z++) {
    const path = z === pathAt(x), n = noise(x, z, 9, o.seed + 1);
    const ground = band(grounds, n);
    if (wet(x, z)) { b.block(x, 0, z, pal.water!); continue; }
    const banks = stream && Math.abs(x - streamAt(z)) <= 1;
    const h = banks || path ? Math.min(level(x, z), banks ? 0 : 1) : level(x, z);
    for (let y = 0; y <= h; y++) b.block(x, y, z, path ? pal.path! : ground);
    if (path || x * x + z * z < 10) continue;
    // Growth: more passes of the same dressing rule make a thicker wood.
    const beside = NEAR.some(([dx, dz]) => wet(x + dx, z + dz));
    const passes = o.density >= 3 ? o.density - 1 : 1;
    for (let p = 0; p < passes; p++) {
      const prop = dress(pal, ground, x, z, beside, p * 7, o.seed);
      if (!prop) continue;
      if (o.density < 2 && hash(x, z, o.seed + 9) % 4 > o.density + 1) break; // thinned out
      b.prop(x, h + 1, z, prop);
      break;
    }
  }
  return { edits: b.edits(), bounds: [-half, half - 1, -half, half - 1], rooms: [] };
}

// ---- dungeon ---------------------------------------------------------------------------

function dungeon(o: GenOpts, pal: Palette, kits: RoomKit[], prior: GenRoom[], fixed: boolean): Scene {
  // Layout, kinds and corridors each draw from their own run of chance, so keeping the
  // rooms where they are also keeps the corridors between them.
  const b = new Build(), r = rng(o.seed), dig_r = rng(o.seed + 2), half = 9 + o.size * 2 + (o.size >> 1);
  const want = 3 + o.density * 2 + o.size, rooms: GenRoom[] = prior.filter((q) => fixed || q.lock).map((q) => ({ ...q }));
  for (let tries = 0; !fixed && tries < 300 && rooms.length < want; tries++) {
    const w = 3 + r.int(4), d = 3 + r.int(4), x0 = -half + 1 + r.int(2 * half - w - 1), z0 = -half + 1 + r.int(2 * half - d - 1);
    const room = { kind: '', x0, x1: x0 + w - 1, z0, z1: z0 + d - 1, seed: 0 };
    if (rooms.some((q) => room.x0 <= q.x1 + 2 && room.x1 >= q.x0 - 2 && room.z0 <= q.z1 + 2 && room.z1 >= q.z0 - 2)) continue;
    rooms.push(room);
  }
  rooms.sort((a, c) => a.x0 + a.x1 - c.x0 - c.x1 || a.z0 - c.z0);
  const kinds = kits.map((k) => k.kind), kind_r = rng(o.seed + 1), style = pal.walls?.[0];
  rooms.forEach((room, i) => {
    if (room.kind) return; // kept from before
    room.kind = i === 0 ? kinds[0] : kind_r.pick(kinds); // the first kind is the way in
    room.seed = hash(room.x0, room.z0, o.seed) % 100000;
  });
  // Which room a cell belongs to (-1: a corridor), for every cell of floor.
  const floor = new Map<string, number>();
  rooms.forEach((q, i) => { for (let x = q.x0; x <= q.x1; x++) for (let z = q.z0; z <= q.z1; z++) floor.set(ck(x, z), i); });
  const doors = new Set<string>(), doorway = new Set<string>();
  const step = (ax: number, az: number, bx: number, bz: number) => {
    const from = floor.get(ck(ax, az)) ?? -1;
    if (!floor.has(ck(bx, bz))) floor.set(ck(bx, bz), -1);
    const to = floor.get(ck(bx, bz))!;
    if (from !== to) { // crossing a room's wall: that is a doorway
      doors.add(ax !== bx ? ek(Math.max(ax, bx), 1, az, 'w') : ek(ax, 1, Math.max(az, bz), 'n'));
      doorway.add(ck(ax, az)).add(ck(bx, bz));
    }
  };
  const dig = (a: GenRoom, c: GenRoom) => {
    let x = a.x0 + dig_r.int(a.x1 - a.x0 + 1), z = a.z0 + dig_r.int(a.z1 - a.z0 + 1);
    const tx = c.x0 + dig_r.int(c.x1 - c.x0 + 1), tz = c.z0 + dig_r.int(c.z1 - c.z0 + 1), xFirst = dig_r.chance(1, 2);
    for (let leg = 0; leg < 2; leg++) {
      if ((leg === 0) === xFirst) while (x !== tx) { const nx = x + Math.sign(tx - x); step(x, z, nx, z); x = nx; }
      else while (z !== tz) { const nz = z + Math.sign(tz - z); step(x, z, x, nz); z = nz; }
    }
  };
  for (let i = 1; i < rooms.length; i++) dig(rooms[i - 1], rooms[i]);
  for (let i = 2; i < rooms.length; i++) if (dig_r.chance(1, 4)) dig(rooms[i], rooms[dig_r.int(i - 1)]); // a few ways round
  for (const [key, room] of floor) {
    const [x, z] = key.split(',').map(Number);
    b.block(x, 0, z, room < 0 ? pal.corridor! : pal.floor!);
    for (const [dx, dz] of NEAR) {
      const other = floor.get(ck(x + dx, z + dz));
      if (other === room) continue;
      const edge = dx ? ek(Math.max(x, x + dx), 1, z, 'w') : ek(x, 1, Math.max(z, z + dz), 'n');
      const wall = other !== undefined && doors.has(edge) ? style?.door : style?.solid; // no door piece: an open gap
      if (wall) b.set(edge, { i: wall });
    }
  }
  // A room is furnished from its own seed alone, so it comes out the same wherever the
  // corridors happen to enter; then whatever stands in a doorway is taken away.
  // (A room kept from a scene of another preset may be of a kind this one does not have: it is furnished as the first kind.)
  rooms.forEach((q, i) => {
    const kit = kits.find((k) => k.kind === q.kind) ?? kits[0];
    furnish(b, rng(q.seed), q, kit, o.detail + (kit.extra ?? 0), new Set(), floor, i, pal.light);
  });
  for (const k of doorway) {
    const [x, z] = k.split(',').map(Number);
    b.drop(x, 1, z);
  }
  const lo = (pick: (q: GenRoom) => number) => Math.min(-half, ...rooms.map(pick)) - 1, hi = (pick: (q: GenRoom) => number) => Math.max(half, ...rooms.map(pick)) + 1;
  return { edits: b.edits(), bounds: [lo((q) => q.x0), hi((q) => q.x1), lo((q) => q.z0), hi((q) => q.z1)], rooms };
}

/** Fill a room: a centrepiece, things along the walls, the odd thing on the floor. Doorways stay clear. */
function furnish(b: Build, r: Rng, q: GenRoom, kit: { centre?: string; walls: string[]; floor: string[] }, clutter: number,
  keepClear: Set<string>, floor: Map<string, number> | null, id: number, light?: string): void {
  const free = (x: number, z: number) => !b.has(x, 1, z) && !keepClear.has(ck(x, z)) && !NEAR.some(([dx, dz]) => keepClear.has(ck(x + dx, z + dz)))
    && (!floor || floor.get(ck(x, z)) === id);
  const cx = (q.x0 + q.x1) >> 1, cz = (q.z0 + q.z1) >> 1;
  if (kit.centre && q.x1 - q.x0 >= 2 && q.z1 - q.z0 >= 2 && free(cx, cz)) b.prop(cx, 1, cz, kit.centre, r.int(4));
  const along: [number, number][] = [], inner: [number, number][] = [];
  for (let x = q.x0; x <= q.x1; x++) for (let z = q.z0; z <= q.z1; z++) {
    (x === q.x0 || x === q.x1 || z === q.z0 || z === q.z1 ? along : inner).push([x, z]);
  }
  const area = (q.x1 - q.x0 + 1) * (q.z1 - q.z0 + 1);
  // Pieces are modelled facing +z. Against a wall they turn their backs to it and face the room.
  const facing = (x: number, z: number) => (z === q.z0 ? 0 : z === q.z1 ? 2 : x === q.x0 ? 1 : x === q.x1 ? 3 : r.int(4));
  const place = (cells: [number, number][], from: string[], count: number) => {
    for (let n = 0, tries = 0; n < count && tries < 40 && cells.length && from.length; tries++) {
      const [x, z] = cells[r.int(cells.length)];
      if (!free(x, z)) continue;
      b.prop(x, 1, z, r.pick(from), facing(x, z));
      n++;
    }
  };
  place(along, kit.walls, div(area * (clutter + 1), 14));
  place(inner, kit.floor, div(area * clutter, 40));
  if (light && clutter && free(q.x0, q.z0)) b.prop(q.x0, 1, q.z0, light);
}

// ---- cave ------------------------------------------------------------------------------

function cave(o: GenOpts, pal: Palette): Scene {
  const b = new Build(), r = rng(o.seed), half = 9 + o.size * 2, n = half * 2, lies = pal.clutter ?? {};
  let open = new Uint8Array(n * n);
  const at = (g: Uint8Array, x: number, z: number) => (x < 1 || z < 1 || x >= n - 1 || z >= n - 1 ? 0 : g[x + z * n]);
  for (let i = 0; i < n * n; i++) open[i] = r.int(100) < 41 + o.density * 3 ? 1 : 0;
  for (let pass = 0; pass < 4; pass++) { // rock gathers into walls, gaps into chambers
    const next = new Uint8Array(n * n);
    for (let x = 1; x < n - 1; x++) for (let z = 1; z < n - 1; z++) {
      let rock = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && !at(open, x + dx, z + dz)) rock++;
      next[x + z * n] = rock >= 5 ? 0 : 1;
    }
    open = next;
  }
  // Keep the biggest cave; pockets nobody could walk into are filled back in.
  const group = new Int32Array(n * n).fill(-1);
  let best = -1, bestSize = 0;
  for (let i = 0; i < n * n; i++) {
    if (!open[i] || group[i] >= 0) continue;
    const todo = [i];
    let size = 0;
    group[i] = i;
    while (todo.length) {
      const c = todo.pop()!, x = c % n, z = div(c, n);
      size++;
      for (const [dx, dz] of NEAR) {
        const j = x + dx + (z + dz) * n;
        if (at(open, x + dx, z + dz) && group[j] < 0) { group[j] = i; todo.push(j); }
      }
    }
    if (size > bestSize) { best = i; bestSize = size; }
  }
  const isOpen = (x: number, z: number) => at(open, x, z) === 1 && group[x + z * n] === best;
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
    const wx = x - half, wz = z - half;
    if (isOpen(x, z)) {
      const damp = noise(wx, wz, 5, o.seed + 4);
      const edge = NEAR.some(([dx, dz]) => !isOpen(x + dx, z + dz));
      if (damp < 34 && !edge && pal.water) { b.block(wx, 0, wz, pal.water); continue; }
      b.block(wx, 0, wz, band(pal.ground!, damp));
      if (!o.detail) continue;
      const roll = hash(wx, wz, o.seed + 6) % 100, much = o.detail * 3;
      const prop = edge ? (roll < much * 2 ? lies.rim : roll < much * 2 + 3 ? lies.gem : roll < much * 3 + 2 ? lies.rubble : null)
        : roll < much ? (damp < 90 ? lies.damp : lies.dry) : roll < much + 1 ? lies.relic : null;
      if (prop) b.prop(wx, 1, wz, prop);
      continue;
    }
    // Rock: a bank where it faces the cave, climbing behind that. Solid rock further in is not built at all.
    let near = 3;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (isOpen(x + dx, z + dz)) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dz)));
    if (near > 2) continue;
    for (let y = 0; y <= near + 1; y++) b.block(wx, y, wz, pal.rock!);
  }
  return { edits: b.edits(), bounds: [-half, half - 1, -half, half - 1], rooms: [] };
}

// ---- building --------------------------------------------------------------------------

function building(o: GenOpts, pal: Palette, kits: RoomKit[], prior: GenRoom[]): Scene {
  const b = new Build(), r = rng(o.seed), w = 6 + o.size + r.int(2), d = 6 + (o.size >> 1) + r.int(2), styles = pal.walls ?? [], style = styles[r.int(styles.length || 1)] as WallStyle | undefined;
  const yardGround = pal.ground![0][0], pieces: Record<string, string | undefined> = { wall: style?.solid, wallwin: style?.window ?? style?.solid, walldoor: style?.door };
  const x0 = -(w >> 1), x1 = x0 + w - 1, z0 = -(d >> 1), z1 = z0 + d - 1, yard = 4;
  const door = x0 + ((w - 1) >> 1);
  for (let x = x0 - yard; x <= x1 + yard; x++) for (let z = z0 - yard; z <= z1 + yard; z++) {
    const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1;
    const path = x === door && z > z1;
    b.block(x, 0, z, inside ? pal.floor! : path ? pal.path! : yardGround);
    if (inside || path || Math.abs(x - door) < 2 && z > z1) continue;
    const far = Math.max(x0 - x, x - x1, z0 - z, z - z1);
    const prop = far >= 2 ? dress(pal, yardGround, x, z, false, o.seed % 97, o.seed) : null;
    if (prop && hash(x, z, o.seed) % 3 === 0) b.prop(x, 1, z, prop);
  }
  for (const [k, piece] of roomEdges(x0, x1, z0, z1, 1, false)) if (pieces[piece]) b.set(k, { i: pieces[piece] }); // no door piece: an open doorway
  // Two back rooms behind a partition, each with its own doorway into the hall.
  const back = z0 + 1, split = x0 + (w >> 1), solid = style?.solid;
  // The building follows from the scene's seed; each room's furnishing from the room's own.
  const was = (kind: string, salt: number) => {
    const q = prior.find((p) => p.kind === kind);
    return { seed: q ? q.seed : o.seed + salt, ...(q?.lock ? { lock: true } : {}) };
  };
  const rooms: GenRoom[] = [
    { kind: kits[0].kind, x0, x1, z0: back + 1, z1, ...was(kits[0].kind, 11) },
    { kind: kits[1].kind, x0, x1: split - 1, z0, z1: back, ...was(kits[1].kind, 12) },
    { kind: kits[2].kind, x0: split, x1, z0, z1: back, ...was(kits[2].kind, 13) },
  ];
  const doors = [x0 + r.int(split - x0), split + r.int(x1 - split + 1)], clear = new Set<string>([ck(door, z1)]);
  for (let x = x0; x <= x1; x++) {
    const open = doors.includes(x);
    const piece = open ? style?.door : solid;
    if (piece) b.edge(x, 1, back + 1, 'n', piece);
    if (open) clear.add(ck(x, back)).add(ck(x, back + 1));
  }
  for (let z = z0; solid && z <= back; z++) b.edge(split, 1, z, 'w', solid);
  // The main room: tables with seats around them, more of them as the slider goes up.
  const hall = rooms[0], spots: [number, number][] = [], hall_r = rng(hall.seed);
  for (let x = hall.x0 + 1; x <= hall.x1 - 1; x += 3) for (let z = hall.z0 + 1; z <= hall.z1 - 1; z += 3) spots.push([x, z]);
  const tables = Math.max(1, div(spots.length * (o.density + 1), 5));
  for (let i = 0; pal.table && i < tables && spots.length; i++) {
    const [x, z] = spots.splice(hall_r.int(spots.length), 1)[0];
    if (clear.has(ck(x, z)) || x === door) continue;
    b.prop(x, 1, z, pal.table, hall_r.int(2));
    for (const [dx, dz, turn] of [[1, 0, 3], [-1, 0, 1], [0, 1, 2], [0, -1, 0]] as const) { // each seat faces the table
      const sx = x + dx, sz = z + dz;
      if (sx < hall.x0 || sx > hall.x1 || sz < hall.z0 || sz > hall.z1 || clear.has(ck(sx, sz)) || sx === door || b.has(sx, 1, sz) || !hall_r.chance(2, 3)) continue;
      const seat = hall_r.chance(1, 4) ? pal.seat2 ?? pal.seat : pal.seat ?? pal.seat2;
      if (seat) b.prop(sx, 1, sz, seat, turn);
    }
  }
  const none = new Set<string>();
  for (const k of clear) {
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of NEAR) none.add(ck(x + dx, z + dz));
  }
  for (const k of clear) none.add(k);
  furnish(b, rng(hall.seed + 1), hall, kits[0], o.detail + (kits[0].extra ?? 0), none, null, 0, pal.light);
  for (const i of [1, 2]) {
    const q = rooms[i], kit = kits[i];
    if (kit.corner && !none.has(ck(q.x1, q.z0))) b.prop(q.x1, 1, q.z0, kit.corner); // a bed: headboard to the back wall
    furnish(b, rng(q.seed), q, kit, o.detail + (kit.extra ?? 0), none, null, 0, pal.light);
  }
  return { edits: b.edits(), bounds: [x0 - yard, x1 + yard, z0 - yard, z1 + yard], rooms };
}

/**
 * Build a scene from a preset (see `parsePreset`). Sliders outside 0..4 are brought into range.
 * Pure: the same numbers and the same preset give the same scene; nothing is looked up or fetched.
 * @param prior the rooms of the scene this one replaces: a locked room is kept as it is
 * @param fixed keep every prior room where it is (redoing one room's furnishing, not the layout)
 */
export function generate(opts: GenOpts, preset: Preset, prior: GenRoom[] = [], fixed = false): Scene {
  const c = (v: number) => Math.max(0, Math.min(4, Math.floor(v) || 0));
  const o = { ...opts, seed: opts.seed >>> 0, size: c(opts.size), density: c(opts.density), detail: c(opts.detail) }, { palette: pal, rooms } = preset;
  return preset.algo === 'dungeon' ? dungeon(o, pal, rooms, prior, fixed) : preset.algo === 'building' ? building(o, pal, rooms, prior) : preset.algo === 'cave' ? cave(o, pal) : wilderness(o, pal);
}
