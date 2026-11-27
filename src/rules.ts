// Table rules that are pure functions of the shared Store: who is the GM, what
// a player may see and move, and whose turn it is. No rendering in here, so it
// is all unit-testable.
//
// Trust model: everyone at the table holds the same room key, so these rules
// decide what each player's *app* shows and allows. They keep honest players
// from spoiling surprises; they are not a defence against someone who edits
// the code.
import { BLOCKS } from './catalog';
import type { Store } from './store';

export interface CellVal { i: string; r?: number }
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
/** With no GM the table is free play: everyone can do everything. */
export function fullPowers(store: Store, me: string): boolean {
  const g = gms(store);
  return !g.length || g.includes(me);
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
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len > SIGHT) return false;
  const steps = Math.ceil(len / 0.2);
  let px = Math.floor(a[0]), pz = Math.floor(a[2]);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(a[0] + d[0] * t), y = Math.floor(a[1] + d[1] * t), z = Math.floor(a[2] + d[2] * t);
    if (i < steps && opaque(store, x, y, z)) return false;
    if (x !== px || z !== pz) {
      // Stepping into another cell: a wall on the edge crossed stops the eye. Across a corner,
      // either way round it must be open.
      if (x !== px && z !== pz) {
        if ((walled(store, y, px, pz, x, pz) || walled(store, y, x, pz, x, z)) && (walled(store, y, px, pz, px, z) || walled(store, y, px, z, x, z))) return false;
      } else if (walled(store, y, px, pz, x, z)) return false;
      px = x;
      pz = z;
    }
  }
  return true;
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
 * minis they control.
 */
export function miniShown(store: Store, me: string, v: MiniVal, eyes: MiniVal[] | null): Shown {
  if (fullPowers(store, me)) return v.h ? 'ghost' : 'yes';
  if (v.h) return 'no';
  if (v.o === me || v.o === '*') return 'yes';
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
    if (!v.h && (v.o === me || v.o === '*')) out.push(v);
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
