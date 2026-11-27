// Falls, shoves and blasts: what happens to the minis when something pushes them about.
// Pure functions of the shared Store that hand back ordinary edits of `m:` values, so the
// device that does the pushing works out the outcome once and everyone else just receives
// the new positions. Whole numbers only; nothing is drawn or animated in here.
import { BLOCKS, MINIS } from './catalog';
import { EDGES, edgeBetween, fogged, type CellVal, type EdgeVal, type MiniVal } from './rules';
import type { Store } from './store';

export type Edit = [key: string, value: unknown];
export interface Fall { id: string; cells: number }
export interface Outcome { edits: Edit[]; falls: Fall[] }

/** The furthest a blast throws anything, and the widest it can be, in cells. */
export const MAX_PUSH = 4, MAX_BLAST = 4;
/** A fall of this many cells or more leaves a mini lying where it landed. */
const HARD_FALL = 2;

const solid = (store: Store, x: number, y: number, z: number): boolean => {
  const v = store.get<CellVal>(`b:${x},${y},${z}`);
  return !!v && !!BLOCKS[v.i];
};
/** How high off the table a mini actually is: the surface it is over, plus its flying height. */
const height = (v: MiniVal) => v.y + (v.e ?? 0);

/** The level something let go of here comes to rest at: the top of the column below it. */
export function restY(store: Store, x: number, y: number, z: number): number {
  while (y > 0 && !solid(store, x, y - 1, z)) y--;
  return y;
}

/**
 * Let a mini drop if nothing is under it. Flying minis stay up. A hard fall knocks it down.
 * Returns the mini as it ends up (the same object if it did not fall) and how many cells it fell.
 */
export function land(store: Store, v: MiniVal): { v: MiniVal; fell: number } {
  if ((v.e ?? 0) > 0) return { v, fell: 0 };
  const y = restY(store, v.x, v.y, v.z), fell = v.y - y;
  if (fell <= 0) return { v, fell: 0 };
  return { v: fell >= HARD_FALL ? { ...v, y, d: true } : { ...v, y }, fell };
}

/** Can a body pass from one cell to its neighbour across a side? Walls stop it (doorways stand open), and so does a block in the way. */
function open(store: Store, y: number, ax: number, az: number, bx: number, bz: number): boolean {
  const e = store.get<EdgeVal>(edgeBetween(y, ax, az, bx, bz));
  if (e && EDGES[e.i] && e.i !== 'walldoor') return false;
  return !solid(store, bx, y, bz);
}

/** One step to a neighbouring cell, corner to corner included: round a corner, one of the two ways must be open. */
function passable(store: Store, y: number, x: number, z: number, sx: number, sz: number): boolean {
  if (!sx || !sz) return open(store, y, x, z, x + sx, z + sz);
  return (open(store, y, x, z, x + sx, z) && open(store, y, x + sx, z, x + sx, z + sz))
    || (open(store, y, x, z, x, z + sz) && open(store, y, x, z + sz, x + sx, z + sz));
}

/**
 * Who is on the table as far as the one pushing can tell. Hidden minis exist only for the GM
 * (`all`): a player's shove must neither move them nor be stopped by them, or it would give
 * them away.
 */
function crowd(store: Store, all: boolean): Map<string, MiniVal> {
  const out = new Map<string, MiniVal>();
  for (const k of store.keys('m:')) {
    const v = store.get<MiniVal>(k)!;
    if (all || !v.h) out.set(k.slice(2), v);
  }
  return out;
}

/**
 * Slide one mini along a path of single steps until something stops it: a wall on the edge it
 * would cross, a block, another mini, or (for a player) fog. If the ground gives out under it
 * on the way it falls there and goes no further. `minis` is everyone the pusher knows of, as
 * they stand right now.
 */
function slide(store: Store, id: string, v: MiniVal, path: [sx: number, sz: number][], minis: Map<string, MiniVal>, all: boolean): { v: MiniVal; moved: number; fell: number } {
  let moved = 0;
  for (const [sx, sz] of path) {
    const h = height(v), flying = (v.e ?? 0) > 0, x = v.x + sx, z = v.z + sz;
    if (!passable(store, h, v.x, v.z, sx, sz)) break;
    if (!all && fogged(store, x, z)) break;
    // It will end up either where it is pushed to or at the foot of the drop there.
    const y = restY(store, x, h, z), foot = flying ? h : y;
    let taken = false;
    for (const [oid, o] of minis) if (oid !== id && o.x === x && o.z === z && (height(o) === h || height(o) === foot)) { taken = true; break; }
    if (taken) break;
    moved++;
    // A flyer holds its height over whatever is below now; anyone else is on the ground or falling.
    if (flying) v = { ...v, x, z, y, e: h - y };
    else {
      const l = land(store, { ...v, x, z });
      v = l.v;
      if (l.fell) return { v, moved, fell: l.fell };
    }
  }
  return { v, moved, fell: 0 };
}

/** Round half away from zero, so a path to the left mirrors the one to the right. */
const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));
/** `n` single steps along the straight line that heads off in direction (dx, dz). */
function line(dx: number, dz: number, n: number): [number, number][] {
  const len = Math.max(Math.abs(dx), Math.abs(dz)), out: [number, number][] = [];
  for (let i = 1, px = 0, pz = 0; len && i <= n; i++) {
    const x = round((i * dx) / len), z = round((i * dz) / len);
    out.push([x - px, z - pz]);
    px = x;
    pz = z;
  }
  return out;
}

/**
 * Shove a mini one cell in a direction (each of `sx`, `sz` is -1, 0 or 1). Null if it does not
 * budge. `all`: the one shoving has the GM's view of the table.
 */
export function shove(store: Store, id: string, sx: number, sz: number, all: boolean): Outcome | null {
  const v = store.get<MiniVal>(`m:${id}`);
  sx = Math.sign(sx);
  sz = Math.sign(sz);
  if (!v || (!sx && !sz) || (v.h && !all)) return null;
  const r = slide(store, id, v, [[sx, sz]], crowd(store, all), all);
  if (!r.moved) return null;
  return { edits: [[`m:${id}`, r.v]], falls: r.fell ? [{ id, cells: r.fell }] : [] };
}

/**
 * A blast centred on a cell: every mini within `radius` cells is thrown straight outward by
 * (radius - distance + 1) cells, as far as walls, blocks and each other allow; those at the
 * centre or next to it are knocked down, and anyone thrown off an edge falls. Distances are
 * rounded to whole cells, the way the ruler counts them.
 */
export function blast(store: Store, [cx, cy, cz]: number[], radius: number, all: boolean): Outcome {
  radius = Math.max(1, Math.min(MAX_BLAST, Math.round(radius)));
  const minis = crowd(store, all), hit: { id: string; dx: number; dz: number; dist: number }[] = [];
  for (const [id, v] of minis) {
    const dx = v.x - cx, dz = v.z - cz, dist = Math.round(Math.hypot(dx, dz));
    if (dist <= radius && Math.abs(height(v) - cy) <= radius) hit.push({ id, dx, dz, dist });
  }
  // The outermost go first and make room for those behind them.
  hit.sort((a, b) => b.dist - a.dist || (a.id < b.id ? -1 : 1));
  const out: Outcome = { edits: [], falls: [] };
  for (const { id, dx, dz, dist } of hit) {
    const before = minis.get(id)!;
    const r = slide(store, id, before, line(dx, dz, Math.min(MAX_PUSH, radius - dist + 1)), minis, all);
    let v = r.v;
    if (dist <= 1 && !v.d && !(v.e ?? 0)) v = { ...v, d: true };
    if (v === before) continue;
    minis.set(id, v);
    out.edits.push([`m:${id}`, v]);
    if (r.fell) out.falls.push({ id, cells: r.fell });
  }
  return out;
}

/** What the chat log says about a fall, at 5 ft to the cell like the ruler. */
export function fellLine(v: MiniVal, cells: number): string {
  return `${v.n || MINIS[v.k]?.name || 'A piece'} fell ${cells * 5} ft`;
}

/** Which of the eight ways a point lies from a cell's middle (null if it is on the cell itself). */
export function heading(x: number, z: number, px: number, pz: number): [sx: number, sz: number] | null {
  const dx = px - x - 0.5, dz = pz - z - 0.5;
  if (Math.abs(dx) <= 0.5 && Math.abs(dz) <= 0.5) return null;
  const o = Math.round(Math.atan2(dz, dx) / (Math.PI / 4));
  return [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]][(o + 8) % 8] as [number, number];
}
