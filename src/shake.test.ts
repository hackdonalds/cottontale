import { describe, expect, it } from 'vitest';
import { shakeDetector, toScreen } from './shake';

type V3 = [number, number, number];
/** Feed samples 16 ms apart; returns the shakes that came out, with when. */
function run(feed: ReturnType<typeof shakeDetector>, samples: V3[], t0 = 0, raw = false) {
  const out: { at: number; x: number; y: number; power: number }[] = [];
  samples.forEach((a, i) => {
    const s = feed(a, t0 + i * 16, raw);
    if (s) out.push({ at: i, ...s });
  });
  return out;
}
const still = (n: number, a: V3 = [0, 0, 0]): V3[] => Array.from({ length: n }, () => a);
/** A hand going one way and back: `n` samples of push, then `n` of pull. */
const swing = (a: V3, n = 4): V3[] => [...still(n, a), ...still(n, a.map((v) => -v) as V3)];

describe('shake to roll', () => {
  it('ignores a phone lying still, being carried, or knocked once', () => {
    const feed = shakeDetector();
    expect(run(feed, still(50))).toEqual([]);
    const walk: V3[] = Array.from({ length: 200 }, (_, i) => [Math.sin(i / 5) * 3, Math.cos(i / 7) * 4, Math.sin(i / 3) * 2]);
    expect(run(feed, walk)).toEqual([]);
    expect(run(feed, [...still(5), [25, 0, 0], [20, 0, 0], ...still(40)])).toEqual([]); // one jolt, no way back
    // Two knocks the same way, or too far apart to be one movement, are not a shake either.
    expect(run(shakeDetector(), [[25, 0, 0], ...still(5), [25, 0, 0], ...still(40)])).toEqual([]);
    expect(run(shakeDetector(), [[25, 0, 0], ...still(40), [-25, 0, 0]])).toEqual([]);
  });

  it('fires once on a shake, pointing the way the hand set off', () => {
    const right = run(shakeDetector(), [...still(5), ...swing([20, 0, 0])]);
    expect(right).toHaveLength(1);
    expect(right[0].at).toBe(9); // on the first sample of the way back
    expect(right[0].x).toBeCloseTo(1);
    expect(right[0].y).toBeCloseTo(0);

    const away = run(shakeDetector(), swing([-12, 16, 3]))[0];
    expect(away.x).toBeCloseTo(-0.6);
    expect(away.y).toBeCloseTo(0.8);

    // Pumped in and out of the screen: a throw with no particular direction.
    expect(run(shakeDetector(), swing([1, 1, 30]))[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('throws harder for a harder shake', () => {
    const soft = run(shakeDetector(), swing([15, 0, 0]))[0].power, hard = run(shakeDetector(), swing([32, 0, 0]))[0].power;
    expect(soft).toBeGreaterThanOrEqual(0);
    expect(hard).toBeGreaterThan(soft);
    expect(run(shakeDetector(), swing([90, 0, 0]))[0].power).toBe(1);
  });

  it('counts one long shake as one throw, then listens again', () => {
    const feed = shakeDetector();
    const rattle = Array.from({ length: 5 }, () => swing([20, 5, 0])).flat(); // 40 samples = 640 ms of shaking
    expect(run(feed, rattle)).toHaveLength(1);
    expect(run(feed, rattle, 5000)).toHaveLength(1);
  });

  it('takes gravity out of raw readings', () => {
    const g: V3 = [0, 9.81, 0]; // held upright
    const feed = shakeDetector();
    expect(run(feed, still(100, g), 0, true)).toEqual([]); // 9.81 on its own is not a jolt…
    const tilted: V3[] = Array.from({ length: 100 }, (_, i) => [9.81 * Math.sin(i / 60), 9.81 * Math.cos(i / 60), 0]);
    expect(run(feed, tilted, 1600, true)).toEqual([]); // …nor is turning the phone over slowly
    const shaken = swing([18, 0, 0]).map((a) => [a[0] + g[0], a[1] + g[1], a[2] + g[2]] as V3);
    const out = run(shakeDetector(), [...still(30, g), ...shaken], 0, true);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeGreaterThan(0.95);
  });

  it('survives junk from the sensor', () => {
    const feed = shakeDetector();
    expect(feed([NaN, 0, 0], 0)).toBeNull();
    expect(feed([Infinity, 0, 0], 16)).toBeNull();
    expect(run(feed, swing([20, 0, 0]), 32)).toHaveLength(1);
  });

  it('turns device axes to match a rotated screen', () => {
    const near = (v: [number, number], x: number, y: number) => { expect(v[0]).toBeCloseTo(x); expect(v[1]).toBeCloseTo(y); };
    near(toScreen(1, 0, 0), 1, 0);
    near(toScreen(0, 1, 90), -1, 0); // top of the phone is at the left of the picture
    near(toScreen(1, 0, 90), 0, 1);
    near(toScreen(0, 1, 270), 1, 0);
    near(toScreen(0, 1, 180), 0, -1);
  });
});
