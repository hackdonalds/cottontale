// Loose pieces: small things lying where they fell, at any spot and any angle.
//
// Props stand one to a cell, upright. A loose piece is stored as `l:<id>` →
// `{ i: kind, p: [x, y, z] in cm, q: [x, y, z, w] in ‰ }`: whole numbers, so every
// device holds exactly the same pose. This file is the pure part (shapes of the
// values, limits, and distrust of anything that arrives from the network); the
// fall is worked out in pour.ts and drawn by looseview.ts.

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

/** What is stored for one loose piece. */
export interface LooseVal { i: string; p: V3; q: Q4 }
/** The same, ready to use: where its middle is (in cells) and how it is turned (a unit quaternion). */
export interface Loose { kind: string; p: V3; q: Q4 }

/**
 * A kind of loose piece: its collider is a box (`h` = half extents) or, with `round`,
 * a short cylinder standing along its own y axis (`h[0]` radius, `h[1]` half height).
 */
export interface LooseKind { name: string; icon: string; thumb: string; h: V3; round?: boolean; mass: number }
export const LOOSE: Record<string, LooseKind> = {
  stone: { name: 'Rubble', icon: '🪨', thumb: 'p_rock', h: [0.13, 0.09, 0.11], mass: 2 },
  coin: { name: 'Coins', icon: '🪙', thumb: 'p_hoard', h: [0.09, 0.025, 0.09], round: true, mass: 0.6 },
  bone: { name: 'Bones', icon: '🦴', thumb: 'p_bones', h: [0.19, 0.045, 0.055], mass: 0.7 },
  crate: { name: 'Crates', icon: '📦', thumb: 'p_crate', h: [0.17, 0.17, 0.17], mass: 3 },
  barrel: { name: 'Kegs', icon: '🛢️', thumb: 'p_barrel', h: [0.14, 0.19, 0.14], round: true, mass: 3 },
};

/** How many loose pieces one board holds, and how many one pour drops. */
export const MAX_LOOSE = 150;
export const MAX_POUR = 24;
/** How many pieces a pour can be set to drop: the count control steps through these. */
export const POUR_COUNTS = [1, 3, 6, 12, MAX_POUR];
export const POUR_FPS = 30;
export const POUR_FRAMES = 120;
/** How far a pour can be strewn by dragging, in cells. */
export const POUR_REACH = 6;
// The table is 96 cells either way and 40 high (see board.ts).
const FAR = 96 * 100, HIGH = 41 * 100;

const whole = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const idOk = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9]{1,12}$/i.test(s);

/** Read a stored piece. Anything malformed (it may come from anyone at the table) is no piece at all. */
export function decodeLoose(v: unknown): Loose | null {
  const o = v as Partial<LooseVal> | null;
  if (!o || typeof o !== 'object' || typeof o.i !== 'string' || !Object.hasOwn(LOOSE, o.i)) return null;
  const { p, q } = o;
  if (!Array.isArray(p) || p.length !== 3 || !whole(p[0], -FAR, FAR) || !whole(p[1], 0, HIGH) || !whole(p[2], -FAR, FAR)) return null;
  if (!Array.isArray(q) || q.length !== 4 || !q.every((c) => whole(c, -1000, 1000))) return null;
  const len = Math.hypot(...q);
  if (len < 500) return null; // nowhere near a rotation
  return { kind: o.i, p: [p[0] / 100, p[1] / 100, p[2] / 100], q: [q[0] / len, q[1] / len, q[2] / len, q[3] / len] };
}

/** The value to store for a piece of this kind resting at `p` (cells), turned by `q`. */
export function encodeLoose(kind: string, p: V3, q: Q4): LooseVal {
  const len = Math.hypot(...q);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v * 100)));
  return {
    i: kind,
    p: [clamp(p[0], -FAR, FAR), clamp(p[1], 0, HIGH), clamp(p[2], -FAR, FAR)],
    q: (len < 1e-6 ? [0, 0, 0, 1000] : q.map((c) => Math.round((c / len) * 1000))) as Q4,
  };
}

/** How many pieces a pour may drop on a board that already holds `have`. */
export function pourRoom(have: number, want: number): number {
  const n = Number.isFinite(want) ? Math.floor(want) : 0;
  return Math.max(0, Math.min(n, MAX_POUR, MAX_LOOSE - have));
}

/**
 * A recorded pour: pieces of one kind, each with its id-to-be, and per piece the
 * delta-coded frames [x, y, z (cm from `o`, itself in cm), qx, qy, qz, qw (‰)].
 */
export interface Pour { o: V3; i: string; ids: string[]; n: number; q: number[][] }

/** The frames of a pour as plain numbers (7 a frame, positions in cells), or null if it is malformed. */
export function decodePour(t: unknown): { kind: string; ids: string[]; n: number; frames: Float32Array[] } | null {
  const r = t as Partial<Pour> | null;
  if (!r || typeof r !== 'object' || typeof r.i !== 'string' || !Object.hasOwn(LOOSE, r.i)) return null;
  if (!Array.isArray(r.o) || r.o.length !== 3 || !whole(r.o[0], -FAR, FAR) || !whole(r.o[1], 0, HIGH) || !whole(r.o[2], -FAR, FAR)) return null;
  if (!whole(r.n, 1, POUR_FRAMES) || !Array.isArray(r.ids) || !Array.isArray(r.q)) return null;
  const count = r.ids.length;
  if (count < 1 || count > MAX_POUR || r.q.length !== count || !r.ids.every(idOk) || new Set(r.ids).size !== count) return null;
  const n = r.n, frames: Float32Array[] = [];
  for (const d of r.q) {
    if (!Array.isArray(d) || d.length !== n * 7 || !d.every(Number.isInteger)) return null;
    const acc = [r.o[0], r.o[1], r.o[2], 0, 0, 0, 0], out = new Float32Array(n * 7);
    for (let f = 0; f < n; f++) {
      for (let c = 0; c < 7; c++) acc[c] += d[f * 7 + c];
      const len = Math.hypot(acc[3], acc[4], acc[5], acc[6]);
      if (!acc.every(Number.isFinite) || len < 1) return null;
      for (let c = 0; c < 3; c++) out[f * 7 + c] = acc[c] / 100;
      for (let c = 3; c < 7; c++) out[f * 7 + c] = acc[c] / len;
    }
    frames.push(out);
  }
  return { kind: r.i, ids: [...r.ids], n, frames };
}

/**
 * Where the pieces of a pour came to rest, as the keys and values to store. A piece that
 * ended up somewhere no piece may be (off the table, under it) is left out.
 */
export function restOf(t: Pour): [string, LooseVal][] {
  const d = decodePour(t);
  if (!d) return [];
  const out: [string, LooseVal][] = [];
  d.frames.forEach((f, i) => {
    const at = (d.n - 1) * 7;
    const v = encodeLoose(d.kind, [f[at], f[at + 1], f[at + 2]], [f[at + 3], f[at + 4], f[at + 5], f[at + 6]]);
    if (decodeLoose(v) && Math.abs(v.p[0] - f[at] * 100) < 1 && Math.abs(v.p[1] - f[at + 1] * 100) < 1 && Math.abs(v.p[2] - f[at + 2] * 100) < 1) out.push([`l:${d.ids[i]}`, v]);
  });
  return out;
}

/**
 * Where each piece of a pour is let go: over the spot tapped, or strewn along the stroke
 * from `a` to `b`. They start in layers, `size` (their largest half extent) apart, so
 * none starts inside another.
 */
export function pourStarts(n: number, a: V3, b: V3, size: number, rnd: () => number): V3[] {
  let dx = b[0] - a[0], dz = b[2] - a[2];
  const len = Math.hypot(dx, dz), along = Math.min(len, POUR_REACH), gap = size * 2.6;
  if (len > POUR_REACH) { dx *= POUR_REACH / len; dz *= POUR_REACH / len; }
  const y = Math.max(a[1], b[1]) + 0.8 + size, jit = () => (rnd() * 2 - 1) * 0.03;
  if (along < 0.5) { // a tap: four to a layer, around the spot
    const mx = a[0] + dx / 2, mz = a[2] + dz / 2;
    return Array.from({ length: n }, (_, i) => [mx + (i % 2 ? 0.5 : -0.5) * gap + jit(), y + Math.floor(i / 4) * gap, mz + (i % 4 < 2 ? 0.5 : -0.5) * gap + jit()] as V3);
  }
  const row = Math.max(2, Math.min(n, Math.floor(along / gap) + 1));
  return Array.from({ length: n }, (_, i) => {
    const t = (i % row) / (row - 1);
    return [a[0] + dx * t + jit(), y + Math.floor(i / row) * gap, a[2] + dz * t + jit()] as V3;
  });
}

/**
 * Which points lie within `radius` of a ray, no further along it than `far`: the loose
 * pieces under a fingertip, nearest first. `d` must be a unit vector.
 */
export function nearRay<T>(o: V3, d: V3, points: Iterable<[T, V3]>, radius: number, far = Infinity): T[] {
  const hits: [number, T][] = [];
  for (const [id, p] of points) {
    const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
    const t = x * d[0] + y * d[1] + z * d[2];
    if (t < 0 || t > far + radius) continue;
    if (x * x + y * y + z * z - t * t <= radius * radius) hits.push([t, id]);
  }
  return hits.sort((m, n) => m[0] - n[0]).map((h) => h[1]);
}

/** A fresh id for a loose piece. */
export function looseId(rnd: () => number): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rnd() * 36) % 36];
  return s;
}
