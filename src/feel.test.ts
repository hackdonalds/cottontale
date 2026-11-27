import { describe, expect, it } from 'vitest';
import { RISE, SQUASH, TOPPLE, hopAt, hopPlan, nearestDir, riseAt, squashAt, toppleAt } from './feel';

const steps = (to: number, n = 200) => Array.from({ length: n + 1 }, (_, i) => (to * i) / n);

describe('feel', () => {
  it('a knocked mini falls faster and faster, bounces, and ends exactly flat', () => {
    expect(toppleAt(0)).toBe(0);
    expect(toppleAt(TOPPLE)).toBe(1);
    expect(toppleAt(9)).toBe(1);
    const fall = steps(0.34, 50).map(toppleAt), speed = fall.slice(1).map((a, i) => a - fall[i]);
    expect(speed.every((s, i) => s > 0 && (i === 0 || s >= speed[i - 1] - 1e-12))).toBe(true); // accelerating
    const all = steps(TOPPLE).map(toppleAt);
    expect(Math.max(...all)).toBeLessThanOrEqual(1); // never through the table
    expect(Math.min(...steps(TOPPLE).filter((t) => t > 0.36).map(toppleAt))).toBeGreaterThan(0.85); // a small bounce
    expect(toppleAt(0.43)).toBeLessThan(0.95);
    for (let i = 1; i < all.length; i++) expect(Math.abs(all[i] - all[i - 1])).toBeLessThan(0.05); // no snap
  });

  it('standing up overshoots a little and ends exactly upright', () => {
    expect(riseAt(0)).toBe(1);
    expect(riseAt(RISE)).toBe(0);
    const all = steps(RISE).map(riseAt), low = Math.min(...all);
    expect(low).toBeLessThan(-0.03);
    expect(low).toBeGreaterThan(-0.2);
    expect(Math.max(...all)).toBeLessThanOrEqual(1);
  });

  it('a landing squashes, springs back and ends at full height', () => {
    expect(squashAt(0)).toBe(1);
    expect(squashAt(SQUASH)).toBe(1);
    const all = steps(SQUASH).map(squashAt);
    expect(Math.min(...all)).toBeLessThan(0.9);
    expect(Math.min(...all)).toBeGreaterThan(0.75);
    expect(Math.max(...all)).toBeGreaterThan(1.01);
    expect(Math.abs(squashAt(SQUASH - 0.001) - 1)).toBeLessThan(0.01); // no pop at the end
  });

  it('a longer move is one bigger, slower arc; setting down in place is no hop at all', () => {
    const one = hopPlan(1, 0), far = hopPlan(6, 0), put = hopPlan(0, -0.3);
    expect(far.h).toBeGreaterThan(one.h);
    expect(far.dur).toBeGreaterThan(one.dur);
    expect(put.h).toBe(0);
    expect(hopPlan(900, 0)).toEqual({ h: 1.2, dur: 0.6 });
  });

  it('a hop starts and ends exactly on the cells, and rises between', () => {
    const a: [number, number, number] = [0.5, 1, 0.5], b: [number, number, number] = [3.5, 1, 0.5];
    expect(hopAt(a, b, 0.5, 0)).toEqual(a);
    expect(hopAt(a, b, 0.5, 1)).toEqual(b);
    expect(hopAt(a, b, 0.5, 0.5)).toEqual([2, 1.5, 0.5]);
  });

  it('a drop in height falls faster and faster and never rises above where it started', () => {
    const ys = steps(1, 40).map((u) => hopAt([0, 4, 0], [0, 0, 0], 0, u)[1]);
    const speed = ys.slice(1).map((y, i) => ys[i] - y);
    expect(ys.every((y) => y <= 4 && y >= 0)).toBe(true);
    expect(speed.slice(1, -1).every((s, i) => s > speed[i])).toBe(true);
  });

  it('finds the nearest neighbour within reach, and nobody beyond it', () => {
    expect(nearestDir(0, 0, [[5, 0], [0, 2], [-1, 0]], 2.5)).toEqual([-1, 0]);
    expect(nearestDir(0, 0, [[0, 2]], 2.5)).toEqual([0, 1]);
    expect(nearestDir(0, 0, [[5, 0]], 2.5)).toBeNull();
    expect(nearestDir(0, 0, [[0, 0]], 2.5)).toBeNull(); // someone on the same spot gives no direction
  });
});
