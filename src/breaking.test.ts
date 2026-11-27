import { describe, expect, it } from 'vitest';
import { BLOCKS, PROPS } from './catalog';
import { EDGES } from './rules';
import { BREAK_KEY, DEBRIS_LIFE, broken, chunkAt, debrisOf, seedOf, shatter, type ChunkPose } from './breaking';

describe('breaking', () => {
  it('walls and doorways come down, built blocks go, the ground and water stay', () => {
    for (const id of Object.keys(EDGES)) expect(broken('w:1,0,2,n', id)).toBeNull();
    expect(broken('w:1,0,2,n', 'table')).toBeUndefined();
    expect(broken('b:1,0,2', 'brick')).toBeNull();
    expect(broken('b:1,0,2', 'stone')).toBeNull();
    for (const id of ['grass', 'dirt', 'snow', 'water', 'lava', 'no-such-piece']) expect(broken('b:1,0,2', id)).toBeUndefined();
    expect(broken('m:abc', 'knight')).toBeUndefined();
  });

  it('leaves rubble that exists in the library, and rubble itself breaks to nothing', () => {
    expect(broken('b:0,1,0', 'statue')).toEqual({ i: 'rock' });
    expect(broken('b:0,1,0', 'coffin')).toEqual({ i: 'bones' });
    expect(broken('b:0,1,0', 'table')).toBeNull();
    for (const id of Object.keys(PROPS)) {
      const left = broken('b:0,1,0', id);
      expect(left).not.toBeUndefined();
      if (left) {
        expect(PROPS[left.i]).toBeTruthy();
        expect(broken('b:0,1,0', left.i)).toBeNull(); // breaking never goes round in circles
      }
    }
  });

  it('every piece has debris colours', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const id of Object.keys(EDGES)) for (const t of debrisOf('w:0,0,0,w', id).tones) expect(t).toMatch(hex);
    for (const id of [...Object.keys(BLOCKS), ...Object.keys(PROPS)]) {
      const { tones } = debrisOf('b:0,0,0', id);
      expect(tones.length).toBeGreaterThan(0);
      for (const t of tones) expect(t).toMatch(hex);
    }
    expect(debrisOf('w:0,0,0,n', 'wall').wood).toBe(false);
    expect(debrisOf('w:0,0,0,n', 'wallwood').wood).toBe(true);
    expect(debrisOf('b:0,0,0', 'brick').tones).toEqual([BLOCKS.brick.color]);
  });

  it('only whole-number cells and edges are accepted from the wire', () => {
    for (const k of ['b:1,0,-2', 'w:-3,2,4,n', 'w:0,0,0,w']) expect(BREAK_KEY.test(k)).toBe(true);
    for (const k of ['b:1.5,0,2', 'b:1,0', 'w:1,0,2,x', 'w:1,0,2', 'm:abc', 'f:1,2', 'b:1,0,2,n', 'b:1,-1,2']) expect(BREAK_KEY.test(k)).toBe(false);
  });
});

describe('debris', () => {
  const flat = () => 1, wall = (): [number, number, number][] => [[2.5, 1.5, 3], [0.48, 0.48, 0.08]];
  const burst = (seed = seedOf('w:2,1,3,n'), top: (x: number, z: number) => number = flat) => shatter(seed, wall()[0], wall()[1], top);

  it('is 12 to 24 chunks, the same for the same seed', () => {
    for (let s = 0; s < 200; s++) {
      const n = burst(s).length;
      expect(n).toBeGreaterThanOrEqual(12);
      expect(n).toBeLessThanOrEqual(24);
    }
    expect(burst(7)).toEqual(burst(7));
    expect(burst(7)).not.toEqual(burst(8));
  });

  it('chunks start inside the piece, never sink through the floor, and end at rest on it', () => {
    const pose: ChunkPose = { p: [0, 0, 0], scale: 0, angle: 0 };
    for (let s = 0; s < 40; s++) for (const c of burst(s)) {
      expect(chunkAt(c, 0, pose)).toBe(true);
      expect(Math.abs(pose.p[0] - 2.5)).toBeLessThanOrEqual(0.48 + 1e-9);
      expect(Math.abs(pose.p[2] - 3)).toBeLessThanOrEqual(0.08 + 1e-9);
      let last: number[] = [], peak = 0;
      for (let t = 0; t < c.life; t += 1 / 60) {
        expect(chunkAt(c, t, pose)).toBe(true);
        expect(pose.p[1]).toBeGreaterThanOrEqual(c.floor - 1e-9);
        expect(pose.p.every(Number.isFinite)).toBe(true);
        expect(pose.scale).toBeGreaterThanOrEqual(0);
        expect(pose.scale).toBeLessThanOrEqual(c.size + 1e-9);
        peak = Math.max(peak, pose.p[1]);
        last = [...pose.p, pose.angle];
      }
      expect(peak).toBeLessThan(3.5); // a burst, not a fountain
      expect(Math.hypot(last[0] - 2.5, last[2] - 3)).toBeLessThan(4); // and it stays near where it broke
      // By the time it starts to shrink away it has stopped: no sliding, no spinning.
      chunkAt(c, c.life - 0.3, pose);
      const a = [...pose.p, pose.angle];
      chunkAt(c, c.life - 0.2, pose);
      expect([...pose.p, pose.angle]).toEqual(a);
      expect(pose.p[1]).toBeCloseTo(c.floor, 9);
    }
  });

  it('is all gone within two seconds, shrinking rather than popping', () => {
    const pose: ChunkPose = { p: [0, 0, 0], scale: 0, angle: 0 };
    expect(DEBRIS_LIFE).toBeLessThanOrEqual(2);
    for (const c of burst()) {
      expect(c.life).toBeLessThanOrEqual(DEBRIS_LIFE);
      expect(c.life).toBeGreaterThan(1);
      expect(chunkAt(c, c.life - 0.01, pose)).toBe(true);
      expect(pose.scale).toBeLessThan(c.size * 0.05);
      expect(chunkAt(c, c.life, pose)).toBe(false);
      expect(chunkAt(c, 2, pose)).toBe(false);
    }
  });

  it('lands on the columns around it, and drops at the foot of anything too tall to clear', () => {
    // A pit on the far side of the wall, a tower on the near side.
    const top = (_x: number, z: number) => (z < 3 ? -2 : 6);
    const chunks = burst(3, top);
    expect(chunks.some((c) => c.floor < 0)).toBe(true);
    for (const c of chunks) {
      expect(c.floor).toBeLessThanOrEqual(c.p[1]); // never asked to rest above where it started
      if (c.floor > 0) expect(Math.hypot(c.v[0], c.v[2])).toBeLessThan(0.9); // turned back by the tower
    }
  });
});
