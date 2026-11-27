// Shake to roll: with dice in hand, a firm shake of the phone throws them.
//
// An extra on top of the touch throw, never the only way. The motion sensor is
// listened to only while there are dice in hand, so an idle table does no work.
// iOS wants permission, asked from a tap; elsewhere the events just arrive.

type V3 = [number, number, number];

/** A detected shake: which way across the screen (unit vector, y up; 0,0 if it was all in and out), and how hard (0–1). */
export interface Shake { x: number; y: number; power: number }

export interface ShakeOptions {
  /** How hard a jolt has to be, m/s² with gravity taken out. A walk is 2–4, a firm shake 15 and up. */
  jolt?: number;
  /** A shake is two jolts in opposing directions no further apart than this (ms): there and back. */
  within?: number;
  /** After a shake, ignore the sensor this long (ms), so one shake is one throw. */
  rest?: number;
}

/**
 * The threshold logic, as a pure function of acceleration samples (device axes, m/s², time in
 * ms). One knock — a bump in the road, a nudge — is a single jolt and does nothing; a shake
 * goes there and back. The direction is that of the first jolt: the way the hand set off.
 * Pass `raw` for samples that still include gravity; it is filtered out here.
 */
export function shakeDetector(o: ShakeOptions = {}): (a: V3, t: number, raw?: boolean) => Shake | null {
  const jolt = o.jolt ?? 13, within = o.within ?? 450, rest = o.rest ?? 1000;
  let first: { a: V3; m: number; t: number } | null = null;
  let quietUntil = -Infinity, g: V3 | null = null, gt = 0;
  return (a, t, raw = false) => {
    if (!a.every(Number.isFinite)) return null;
    if (raw) {
      // Gravity is whatever the reading has been lately (a slow average); the rest is the hand.
      if (!g) g = [...a];
      const k = 1 - Math.exp(-Math.max(0, t - gt) / 400);
      g = [g[0] + (a[0] - g[0]) * k, g[1] + (a[1] - g[1]) * k, g[2] + (a[2] - g[2]) * k];
      gt = t;
      a = [a[0] - g[0], a[1] - g[1], a[2] - g[2]];
    }
    if (t < quietUntil) return null;
    const m = Math.hypot(...a);
    if (m < jolt) return null;
    if (first && t - first.t > within) first = null;
    if (!first) { first = { a, m, t }; return null; }
    const dot = a[0] * first.a[0] + a[1] * first.a[1] + a[2] * first.a[2];
    if (dot >= 0) { // still the same swing: remember its peak
      if (m > first.m) first = { a, m, t: first.t };
      return null;
    }
    const f = first, flat = Math.hypot(f.a[0], f.a[1]);
    first = null;
    quietUntil = t + rest;
    const power = Math.min(1, (Math.max(m, f.m) - jolt) / (jolt * 2));
    return flat < f.m * 0.35 ? { x: 0, y: 0, power } : { x: f.a[0] / flat, y: f.a[1] / flat, power };
  };
}

/** Device axes to screen axes: the picture turns with the phone, the sensor does not. */
export function toScreen(x: number, y: number, angle: number): [number, number] {
  const r = (angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

type Asking = { requestPermission?: () => Promise<string> };
const DM = (): (typeof DeviceMotionEvent & Asking) | undefined => (typeof DeviceMotionEvent === 'undefined' ? undefined : DeviceMotionEvent);

/** Worth offering: a touch device with a motion sensor API. */
export const canShake = (): boolean => !!DM() && navigator.maxTouchPoints > 0;
/** Whether the browser makes us ask first (iOS). If so, shaking starts switched off. */
export const shakeNeedsAsking = (): boolean => typeof DM()?.requestPermission === 'function';
/** Ask for the motion sensor. Must be called from a tap. True if we may listen. */
export async function askShake(): Promise<boolean> {
  const dm = DM();
  if (!dm?.requestPermission) return !!dm;
  try { return (await dm.requestPermission()) === 'granted'; } catch { return false; }
}

/** Listen for shakes until the returned function is called. */
export function watchShake(on: (s: Shake) => void, o?: ShakeOptions): () => void {
  const feed = shakeDetector(o);
  const h = (e: DeviceMotionEvent) => {
    const pure = e.acceleration, a = pure && pure.x != null ? pure : e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const s = feed([a.x, a.y ?? 0, a.z ?? 0], performance.now(), a !== pure);
    if (!s) return;
    const [x, y] = toScreen(s.x, s.y, screen.orientation?.angle ?? 0);
    on({ x, y, power: s.power });
  };
  addEventListener('devicemotion', h);
  return () => removeEventListener('devicemotion', h);
}
