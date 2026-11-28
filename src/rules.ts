// Table rules that are pure functions of the shared Store: who is the GM, what
// a player may see and move, and whose turn it is. No rendering in here, so it
// is all unit-testable.
//
// Trust model: everyone at the table holds the same room key, so these rules
// decide what each player's *app* shows and allows. They keep honest players
// from spoiling surprises; they are not a defence against someone who edits
// the code.
import { BLOCKS } from './catalog';
import { GROUND } from './terrain';
import type { Store } from './store';

/** `l`: for something that sheds light, how strongly (absent = as modelled, 0 = unlit). */
export interface CellVal { i: string; r?: number; l?: number }
/** The strengths a light can be set to, in the order a tap steps through them. */
export const LIGHT_LEVELS: [level: number, name: string][] = [[1, 'normal'], [2, 'bright'], [0.5, 'dim'], [0, 'out']];
export function nextLight(v: CellVal): CellVal {
  const i = LIGHT_LEVELS.findIndex(([l]) => l === (v.l ?? 1));
  const [level] = LIGHT_LEVELS[(i + 1) % LIGHT_LEVELS.length];
  const { l: _, ...rest } = v;
  return level === 1 ? rest : { ...rest, l: level };
}
export interface MiniVal {
  x: number; y: number; z: number;
  k: string; c: string; n: string; r: number; s: number;
  /** Hit points and their maximum (absent = not tracked). */
  hp?: number; mhp?: number;
  /** Initiative score; minis that have one are in the turn order. */
  ini?: number;
  /** Hidden by the GM: players do not see it at all. */
  h?: boolean;
  /** Flying height above the surface it stands over, in cells. */
  e?: number;
  /** Who may move it besides the GM: a player id, '*' for everyone, absent for nobody. */
  o?: string;
  /** Knocked down: drawn lying on its side. */
  d?: boolean;
  /** Up to four free-form stat lines, e.g. "AC 15". */
  st?: string[];
  /** With a game system on the table (`src/system.ts`): what was entered on its sheet, by field id. */
  sv?: Record<string, number | string | boolean>;
  /** The conditions it is under (ids from the system). */
  cn?: string[];
  /** The last few events whose effects were applied to it, so none is applied twice. */
  fx?: string[];
}
export interface Turn { id: string; round: number }

/**
 * Thin walls stand on the edges between cells, not in them: `w:x,y,z,n` is the edge on the
 * low-z side of cell (x, y, z) and `w:x,y,z,w` the one on its low-x side. The far sides of a
 * cell are the near sides of its neighbours, so every edge has exactly one key.
 */
export type Side = 'n' | 'w';
export interface EdgeVal { i: string }
/** What can stand on an edge: `see` lets sight through (a window, a doorway), `timber` is the wooden build. */
export const EDGES: Record<string, { see?: boolean; timber?: boolean }> = {
  wall: {}, wallwin: { see: true }, walldoor: { see: true },
  wallwood: { timber: true }, woodwin: { see: true, timber: true },
};
export const ek = (x: number, y: number, z: number, s: Side) => `w:${x},${y},${z},${s}`;
export function parseEdge(key: string): [x: number, y: number, z: number, s: Side] {
  const p = key.slice(2).split(',');
  return [+p[0], +p[1], +p[2], p[3] as Side];
}
/** The key of the edge between two cells that share a side on level `y`. */
export function edgeBetween(y: number, ax: number, az: number, bx: number, bz: number): string {
  return ax !== bx ? ek(Math.max(ax, bx), y, az, 'w') : ek(ax, y, Math.max(az, bz), 'n');
}
/** The outline of a room, as edge keys with what to stand on each: a doorway in the middle of its high-z side, windows in a rhythm. */
export function roomEdges(x0: number, x1: number, z0: number, z1: number, y: number, timber: boolean): [key: string, piece: string][] {
  const solid = timber ? 'wallwood' : 'wall', win = timber ? 'woodwin' : 'wallwin';
  // Never a window in the end stretch of a wall; spaced evenly about its middle.
  const windowed = (i: number, n: number) => i > 0 && i < n - 1 && (n % 2 ? (i - (n - 1) / 2) % 2 === 0 : i === n / 2 - 1 || i === n / 2);
  const out: [string, string][] = [], w = x1 - x0 + 1, d = z1 - z0 + 1, door = x0 + Math.floor((w - 1) / 2);
  for (let x = x0; x <= x1; x++) {
    out.push([ek(x, y, z0, 'n'), windowed(x - x0, w) ? win : solid]);
    out.push([ek(x, y, z1 + 1, 'n'), x === door ? 'walldoor' : windowed(x - x0, w) && Math.abs(x - door) > 1 ? win : solid]);
  }
  for (let z = z0; z <= z1; z++) {
    out.push([ek(x0, y, z, 'w'), windowed(z - z0, d) ? win : solid]);
    out.push([ek(x1 + 1, y, z, 'w'), windowed(z - z0, d) ? win : solid]);
  }
  return out;
}

/** Short player id used inside the store (prefix of the Nostr public key). */
export const pid = (pubkey: string) => pubkey.slice(0, 10);

export function gms(store: Store): string[] {
  return [...store.keys('gm:')].map((k) => k.slice(3));
}
/**
 * The seat of a table screen (src/ui/display.ts): not a player's id, so it never has powers,
 * not even in free play. It looks on with the whole party: what any player's mini sees, it sees.
 */
export const PARTY = '*party';
/** With no GM the table is free play: everyone can do everything. */
export function fullPowers(store: Store, me: string): boolean {
  const g = gms(store);
  return me !== PARTY && (!g.length || g.includes(me));
}
/** Is this mini one of `me`'s own to see with? For the party: any mini that has an owner who is not a GM. */
function owns(store: Store, me: string, v: MiniVal): boolean {
  if (me === PARTY) return !!v.o && !gms(store).includes(v.o);
  return v.o === me || v.o === '*';
}
export const fogged = (store: Store, x: number, z: number) => store.get(`f:${x},${z}`) === true;
export const setting = <T>(store: Store, name: string, fallback: T) => store.get<T>(`set:${name}`) ?? fallback;

export function canControl(store: Store, me: string, v: MiniVal): boolean {
  return fullPowers(store, me) || v.o === me || v.o === '*';
}

/** Does this cell block sight? Solid blocks do; water and other see-through blocks do not. */
function opaque(store: Store, x: number, y: number, z: number): boolean {
  const v = store.get<CellVal>(`b:${x},${y},${z}`);
  const d = v && BLOCKS[v.i];
  return !!d && d.opacity === undefined;
}

/** Is there a wall you cannot see through between two neighbouring cells of one level? */
function walled(store: Store, y: number, ax: number, az: number, bx: number, bz: number): boolean {
  const v = store.get<EdgeVal>(edgeBetween(y, ax, az, bx, bz));
  return !!v && !!EDGES[v.i] && !EDGES[v.i].see;
}

const eye = (v: MiniVal): [number, number, number] => [v.x + 0.5, v.y + (v.e ?? 0) + 0.75 * (v.s || 1), v.z + 0.5];
const SIGHT = 60;

function clear(store: Store, a: [number, number, number], b: [number, number, number]): boolean {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) <= SIGHT && openTo(store, a, b) === 1;
}

/**
 * How far the straight line from `a` to `b` runs before something solid stands in it (a block,
 * or a wall that is not a window or a doorway), as a share of the way: 1 when it is open.
 */
export function openTo(store: Store, a: [number, number, number], b: [number, number, number]): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const steps = Math.ceil(len / 0.2);
  let px = Math.floor(a[0]), pz = Math.floor(a[2]);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(a[0] + d[0] * t), y = Math.floor(a[1] + d[1] * t), z = Math.floor(a[2] + d[2] * t);
    if (i < steps && opaque(store, x, y, z)) return (i - 1) / steps;
    if (x !== px || z !== pz) {
      // Stepping into another cell: a wall on the edge crossed stops the eye. Across a corner,
      // either way round it must be open.
      if (x !== px && z !== pz) {
        if ((walled(store, y, px, pz, x, pz) || walled(store, y, x, pz, x, z)) && (walled(store, y, px, pz, px, z) || walled(store, y, px, z, x, z))) return (i - 1) / steps;
      } else if (walled(store, y, px, pz, x, z)) return (i - 1) / steps;
      px = x;
      pz = z;
    }
  }
  return 1;
}

/** Line of sight between two minis: from the looker's eyes to the other's head or feet. */
export function sees(store: Store, from: MiniVal, to: MiniVal): boolean {
  const e = eye(from), head = eye(to);
  return clear(store, e, head) || clear(store, e, [head[0], to.y + (to.e ?? 0) + 0.2, head[2]]);
}

export type Shown = 'yes' | 'ghost' | 'no';

/**
 * How a mini appears to player `me`. The GM (and everyone in free play) sees
 * all, with hidden minis ghosted. Players never see hidden minis or ones under
 * fog, and with line of sight on they see others only through the eyes of the
 * minis they control. The table screen (`PARTY`) sees through every player's.
 */
export function miniShown(store: Store, me: string, v: MiniVal, eyes: MiniVal[] | null): Shown {
  if (fullPowers(store, me)) return v.h ? 'ghost' : 'yes';
  if (v.h) return 'no';
  if (owns(store, me, v)) return 'yes';
  if (fogged(store, v.x, v.z)) return 'no';
  if (!eyes || !eyes.length) return 'yes'; // line of sight off, or a spectator with no mini
  return eyes.some((e) => sees(store, e, v)) ? 'yes' : 'no';
}

/** The minis a player sees through, or null when line of sight is switched off. */
export function eyesOf(store: Store, me: string): MiniVal[] | null {
  if (!setting(store, 'los', false)) return null;
  const out: MiniVal[] = [];
  for (const k of store.keys('m:')) {
    const v = store.get<MiniVal>(k)!;
    if (!v.h && owns(store, me, v)) out.push(v);
  }
  return out;
}

/** Everyone with an initiative score, highest first. */
export function turnOrder(store: Store): { id: string; v: MiniVal }[] {
  const out: { id: string; v: MiniVal }[] = [];
  for (const k of store.keys('m:')) {
    const v = store.get<MiniVal>(k)!;
    if (typeof v.ini === 'number') out.push({ id: k.slice(2), v });
  }
  return out.sort((a, b) => b.v.ini! - a.v.ini! || (a.id < b.id ? -1 : 1));
}

export function nextTurn(store: Store): Turn | null {
  const order = turnOrder(store);
  if (!order.length) return null;
  const cur = store.get<Turn>('turn');
  const i = cur ? order.findIndex((o) => o.id === cur.id) : -1;
  if (i < 0) return { id: order[0].id, round: cur?.round ?? 1 };
  const last = i === order.length - 1;
  return { id: order[last ? 0 : i + 1].id, round: (cur!.round || 1) + (last ? 1 : 0) };
}

/** Straight-line distance between two points in cells, and in feet at 5 ft per cell. */
export function measure(a: number[], b: number[]): { cells: number; feet: number } {
  const cells = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return { cells, feet: Math.round(cells) * 5 };
}

// ---- shaping the land ------------------------------------------------------------
// The brushes that sculpt and dress terrain, as pure edits of the store. Each takes a
// `put` to write through, so the board can make a whole stroke one undo step.

const MAX_Y = 40;
type Put = (key: string, value: unknown) => void;
const bk = (x: number, y: number, z: number) => `b:${x},${y},${z}`;

/** The highest block in a column. */
export function columnTop(store: Store, x: number, z: number): { y: number; id: string } | null {
  for (let y = MAX_Y - 1; y >= 0; y--) {
    const v = store.get<CellVal>(bk(x, y, z));
    if (v && BLOCKS[v.i]) return { y, id: v.i };
  }
  return null;
}

/** Carry whatever stands on a column (minis, walls along its sides) up or down with its surface. */
function carry(store: Store, x: number, z: number, from: number, by: number, put: Put): void {
  // A wall rides along unless the ground on its other side is staying at its level: then it
  // still has something to stand on there. Upper storeys move with the wall under them.
  const sides: [key: (y: number) => string, nx: number, nz: number][] = [
    [(y) => ek(x, y, z, 'n'), x, z - 1], [(y) => ek(x, y, z + 1, 'n'), x, z + 1],
    [(y) => ek(x, y, z, 'w'), x - 1, z], [(y) => ek(x + 1, y, z, 'w'), x + 1, z],
  ];
  for (const [key, nx, nz] of sides) {
    if (!store.get(key(from))) continue;
    const beside = columnTop(store, nx, nz);
    if ((beside ? beside.y + 1 : 0) === from) continue;
    let top = from;
    while (top + 1 < MAX_Y && store.get(key(top + 1))) top++;
    const levels = Array.from({ length: top - from + 1 }, (_, i) => from + i);
    for (const y of by > 0 ? levels.reverse() : levels) {
      if (y + by < 0 || y + by >= MAX_Y) continue;
      put(key(y + by), store.get(key(y)));
      put(key(y), null);
    }
  }
  for (const k of [...store.keys('m:')]) {
    const m = store.get<MiniVal>(k)!;
    if (m.x === x && m.z === z && m.y === from) put(k, { ...m, y: from + by });
  }
}

/**
 * Raise (`by` 1) or lower (-1) the ground of one column by a level. Only natural ground
 * moves: floors, paving and water stay as they were built. What stands on it rides along.
 */
export function sculpt(store: Store, x: number, z: number, by: 1 | -1, put: Put): boolean {
  const top = columnTop(store, x, z);
  if (!top) {
    if (by > 0) put(bk(x, 0, z), { i: 'grass' });
    return by > 0;
  }
  if (!GROUND[top.id]) return false;
  const on = store.get<CellVal>(bk(x, top.y + 1, z));
  if (by > 0) {
    if (top.y + 2 >= MAX_Y) return false;
    if (on) put(bk(x, top.y + 2, z), on);
    put(bk(x, top.y + 1, z), { i: top.id });
  } else {
    if (top.y === 0) return false; // the table always keeps its last layer of ground
    put(bk(x, top.y, z), on ?? null);
    if (on) put(bk(x, top.y + 1, z), null);
  }
  carry(store, x, z, top.y + 1, by, put);
  return true;
}

/** Bring a column's ground to the given height, a level at a time. */
export function levelTo(store: Store, x: number, z: number, y: number, put: Put): void {
  for (let i = 0; i < MAX_Y; i++) {
    const top = columnTop(store, x, z);
    const at = top ? top.y : -1;
    if (at === y || !sculpt(store, x, z, at < y ? 1 : -1, put)) return;
  }
}

/** Change what the surface of a column is made of: grass to sand, a path of stone, a river of water. */
export function resurface(store: Store, x: number, z: number, id: string, put: Put): void {
  const top = columnTop(store, x, z);
  if (!top) put(bk(x, 0, z), { i: id });
  else if (top.id !== id && !store.get(bk(x, top.y + 1, z))) put(bk(x, top.y, z), { i: id });
}

function chance(x: number, z: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** What grows or lies on each kind of ground, and how often (the rest of the cells stay open). */
const DRESSING: Record<string, [prop: string, share: number][]> = {
  grass: [['tree', 0.09], ['bush', 0.05], ['flowers', 0.05], ['rock', 0.02]],
  meadow: [['flowers', 0.12], ['bush', 0.06], ['tree', 0.04], ['reeds', 0.04]],
  moss: [['pine', 0.15], ['mushroom', 0.06], ['log', 0.03], ['stump', 0.03], ['rock', 0.03]],
  dirt: [['stump', 0.04], ['log', 0.04], ['rock', 0.04], ['deadtree', 0.03]],
  mud: [['reeds', 0.14], ['log', 0.03], ['deadtree', 0.03]],
  sand: [['cactus', 0.07], ['palm', 0.05], ['rock', 0.04]],
  gravel: [['rock', 0.1], ['deadtree', 0.02]],
  clay: [['cactus', 0.05], ['rock', 0.06], ['deadtree', 0.03]],
  basalt: [['rock', 0.08], ['stalagmite', 0.05], ['crystal', 0.02]],
  snow: [['pine', 0.14], ['rock', 0.04], ['deadtree', 0.03]],
};

/**
 * What the grow brush would put on a cell of this ground, if anything. It follows from the
 * spot alone, so everyone grows the same wood and brushing twice changes nothing. Woods
 * gather by kind, and reeds crowd the water's edge.
 */
export function dressing(ground: string, x: number, z: number, wet: boolean, salt = 0): string | null {
  const r = chance(x, z, 1 + salt);
  if (wet && (ground === 'grass' || ground === 'meadow' || ground === 'mud' || ground === 'dirt')) return r < 0.4 ? 'reeds' : null;
  let acc = 0;
  for (const [prop, share] of DRESSING[ground] ?? []) {
    acc += share;
    if (r >= acc) continue;
    if (prop !== 'tree') return prop;
    const wood = chance(Math.floor(x / 5), Math.floor(z / 5), 2); // one kind of tree to a stretch of wood
    return wood < 0.3 ? 'pine' : wood < 0.5 ? 'birch' : wood < 0.62 ? 'poplar' : 'tree';
  }
  return null;
}

/** Dress one column with what suits its ground. Leaves alone anything already standing there. */
export function grow(store: Store, x: number, z: number, put: Put): void {
  const top = columnTop(store, x, z);
  if (!top || !GROUND[top.id] || top.y + 1 >= MAX_Y || store.get(bk(x, top.y + 1, z))) return;
  for (const k of store.keys('m:')) {
    const m = store.get<MiniVal>(k)!;
    if (m.x === x && m.z === z) return;
  }
  const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => columnTop(store, x + dx, z + dz)?.id === 'water');
  const prop = dressing(top.id, x, z, wet);
  if (prop) put(bk(x, top.y + 1, z), { i: prop });
}
