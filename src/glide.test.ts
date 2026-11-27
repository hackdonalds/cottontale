import { describe, expect, it } from 'vitest';
import { AMBIENT_MS, Glide, ambientDue, ambientLive, ease, flicker, nudge, outOfView, safeArea } from './glide';

describe('camera moves', () => {
  it('eases from rest to rest', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    expect(ease(0.1)).toBeLessThan(0.1); // slow away
    expect(ease(0.9)).toBeGreaterThan(0.9); // slow home
  });

  it('only goes to what is off the screen or near its edge', () => {
    const area = safeArea(390, 844);
    expect(area.x0).toBeGreaterThanOrEqual(48);
    expect(outOfView({ x: 195, y: 422 }, area)).toBe(false);
    expect(outOfView({ x: 10, y: 422 }, area)).toBe(true);
    expect(outOfView({ x: 195, y: 840 }, area)).toBe(true);
    expect(outOfView({ x: -300, y: 422 }, area)).toBe(true);
    expect(outOfView(null, area)).toBe(true); // behind the camera
  });

  it('nudges just far enough, and not at all when already in view', () => {
    const area = { x0: 50, y0: 50, x1: 350, y1: 750 };
    expect(nudge({ x0: 100, y0: 100, x1: 200, y1: 200 }, area)).toEqual([0, 0]);
    expect(nudge({ x0: 300, y0: 100, x1: 400, y1: 200 }, area)).toEqual([-50, 0]);
    expect(nudge({ x0: 100, y0: -30, x1: 200, y1: 60 }, area)).toEqual([0, 80]);
    expect(nudge({ x0: 500, y0: 900, x1: 520, y1: 920 }, area)).toEqual([-170, -170]);
    // Too wide to fit: centred.
    expect(nudge({ x0: 0, y0: 100, x1: 600, y1: 200 }, area)).toEqual([-100, 0]);
  });

  it('a glide hands out exactly its whole slide, then stops', () => {
    const g = new Glide([4, 0, -2], 0.5);
    const sum = [0, 0, 0];
    let steps = 0;
    for (let s = g.step(0.05); s; s = g.step(0.05)) { sum[0] += s[0]; sum[1] += s[1]; sum[2] += s[2]; steps++; }
    expect(sum[0]).toBeCloseTo(4);
    expect(sum[1]).toBeCloseTo(0);
    expect(sum[2]).toBeCloseTo(-2);
    expect(steps).toBe(10);
    expect(g.done).toBe(true);
    expect(g.step(0.05)).toBeNull();
  });

  it('a glide with no time to take jumps (reduced motion)', () => {
    const g = new Glide([3, 1, 2], 0);
    expect(g.step(0.016)).toEqual([3, 1, 2]);
    expect(g.step(0.016)).toBeNull();
  });
});

describe('ambient life', () => {
  const ok = { on: true, hidden: false, slowed: false, alive: true };
  it('stirs only when switched on, visible, able and with something to move', () => {
    expect(ambientLive(ok)).toBe(true);
    for (const k of ['on', 'alive'] as const) expect(ambientLive({ ...ok, [k]: false })).toBe(false);
    for (const k of ['hidden', 'slowed'] as const) expect(ambientLive({ ...ok, [k]: true })).toBe(false);
  });

  it('draws well under 30 frames a second', () => {
    expect(1000 / AMBIENT_MS).toBeLessThan(16);
    expect(1000 / AMBIENT_MS).toBeGreaterThan(11);
    // A display calling 60 times a second for one second:
    let last = 0, drawn = 0;
    for (let now = 0; now < 1000; now += 1000 / 60) if (ambientDue(ok, now, last)) { drawn++; last = now; }
    expect(drawn).toBeGreaterThanOrEqual(11);
    expect(drawn).toBeLessThanOrEqual(15);
    expect(ambientDue({ ...ok, on: false }, 1e6, 0)).toBe(false);
  });

  it('firelight trembles a little around its set brightness', () => {
    let lo = 9, hi = 0;
    for (let t = 0; t < 60; t += 0.07) for (let i = 0; i < 4; i++) { const f = flicker(t, i); lo = Math.min(lo, f); hi = Math.max(hi, f); }
    expect(lo).toBeGreaterThan(0.9);
    expect(hi).toBeLessThan(1.1);
    expect(hi - lo).toBeGreaterThan(0.08);
    expect(flicker(3, 0)).not.toBe(flicker(3, 1)); // lamps are out of step
  });
});
