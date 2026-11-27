// How pieces feel in the hand: the shapes of a hop, a landing, a fall and a getting-up.
// All of it is for show. Each device works it out from what the table already shares (a mini
// moved, was knocked down, is being dragged), so nothing here is sent or stored, and every
// curve ends exactly on the resting pose.

type P3 = [x: number, y: number, z: number];

/** Seconds a knocked mini takes to fall and stop bouncing, to stand back up, and to settle after landing. */
export const TOPPLE = 0.62, RISE = 0.45, SQUASH = 0.45;
const FALL = 0.34, BOUNCE = 0.52;

/**
 * How far over a mini is `t` seconds after being knocked down: 0 upright, 1 flat. It tips slowly,
 * speeds up as it goes (as a falling thing does), then bounces off the table twice, each time less.
 */
export function toppleAt(t: number): number {
  if (t <= 0) return 0;
  if (t >= TOPPLE) return 1;
  if (t < FALL) { const u = t / FALL; return u * u * (0.5 + 0.5 * u); }
  const [from, to, high] = t < BOUNCE ? [FALL, BOUNCE, 0.11] : [BOUNCE, TOPPLE, 0.03];
  const v = (t - from) / (to - from);
  return 1 - high * 4 * v * (1 - v);
}

/** The same while standing back up: from 1 (flat) to 0, swinging a little past upright before settling. */
export function riseAt(t: number): number {
  if (t <= 0) return 1;
  if (t >= RISE) return 0;
  const u = t / RISE - 1, back = 1.9;
  return -((back + 1) * u * u * u + back * u * u);
}

/** How tall a mini stands `t` seconds after landing (1 = as modelled): it squashes, springs up a little, and settles. */
export function squashAt(t: number): number {
  return t <= 0 || t >= SQUASH ? 1 : 1 - 0.2 * Math.sin(t * 26) * Math.exp(-t * 9);
}

/** The arc for a move: how high it rises and how long it takes. A longer move is one bigger arc, not more hops. */
export function hopPlan(dist: number, dy: number): { h: number; dur: number } {
  return { h: Math.min(1.2, 0.3 * Math.sqrt(dist)), dur: Math.min(0.6, 0.16 + 0.1 * Math.sqrt(dist) + 0.08 * Math.sqrt(Math.abs(dy))) };
}

/**
 * Where a hopping mini is, `u` of the way (0–1) from `a` to `b`, on an arc `h` high.
 * Going down it falls faster and faster; going up it slows as it arrives.
 */
export function hopAt(a: P3, b: P3, h: number, u: number): P3 {
  if (u <= 0) return [...a];
  if (u >= 1) return [...b];
  const dy = b[1] - a[1], drop = dy < 0 ? u * u : 1 - (1 - u) * (1 - u);
  return [a[0] + (b[0] - a[0]) * u, a[1] + dy * drop + h * 4 * u * (1 - u), a[2] + (b[2] - a[2]) * u];
}

/** The direction (a unit step on the ground) to the nearest of `others` within `reach` cells, if any. */
export function nearestDir(x: number, z: number, others: Iterable<[x: number, z: number]>, reach: number): [dx: number, dz: number] | null {
  let best = reach, out: [number, number] | null = null;
  for (const [ox, oz] of others) {
    const dx = ox - x, dz = oz - z, d = Math.hypot(dx, dz);
    if (d > 0 && d <= best) { best = d; out = [dx / d, dz / d]; }
  }
  return out;
}
