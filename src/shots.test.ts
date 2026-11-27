import { describe, expect, it } from 'vitest';
import { ek, type MiniVal } from './rules';
import { SHOTS, readShot, shotAt, shotPath, shotTime } from './shots';
import { Store } from './store';

const mini = (x: number, z: number, more: Partial<MiniVal> = {}): MiniVal => ({ x, y: 1, z, k: 'knight', c: '#fff', n: '', r: 0, s: 1, ...more });

describe('shots', () => {
  const a: [number, number, number] = [0.5, 1.6, 0.5], b: [number, number, number] = [10.5, 1.6, 0.5];

  it('every kind leaves from one end and arrives at the other', () => {
    for (const kind of Object.keys(SHOTS)) {
      expect(shotAt(kind, a, b, 0)).toEqual(a);
      const end = shotAt(kind, a, b, 1);
      end.forEach((n, i) => expect(n).toBeCloseTo(b[i], 9));
      for (let u = 0; u <= 1; u += 0.05) expect(shotAt(kind, a, b, u).every(Number.isFinite)).toBe(true);
      expect(shotAt(kind, a, a, 0.5).every(Number.isFinite)).toBe(true); // a shot at nothing at all
    }
  });

  it('a rock is lobbed high and slow, an arrow flies flat and fast, a missile curves', () => {
    const top = (kind: string) => shotAt(kind, a, b, 0.5)[1] - a[1];
    expect(top('rock')).toBeGreaterThan(3);
    expect(top('arrow')).toBeLessThan(1);
    expect(shotTime('arrow', a, b)).toBeLessThan(shotTime('rock', a, b));
    expect(Math.abs(shotAt('missile', a, b, 0.5)[2] - a[2])).toBeGreaterThan(1);
    expect(shotAt('arrow', a, b, 0.5)[2]).toBe(a[2]);
    expect(shotTime('arrow', a, a)).toBeGreaterThan(0.2); // never too quick to see
    expect(shotTime('rock', a, [900, 0, 0])).toBeLessThan(2.5); // nor so slow the table waits
  });

  it('stops at a block or a solid wall in the way, and passes windows and props', () => {
    const s = new Store('me');
    const from = mini(0, 0), to = mini(8, 0);
    expect(shotPath(s, from, to).hit).toBe(true);
    expect(shotPath(s, from, [8, 1, 0.5]).b).toEqual([8, 1.1, 0.5]);
    s.set('b:4,1,0', { i: 'barrel' });
    expect(shotPath(s, from, to).hit).toBe(true);
    s.set('b:4,1,0', { i: 'stone' });
    const stopped = shotPath(s, from, to);
    expect(stopped.hit).toBe(false);
    expect(stopped.b[0]).toBeGreaterThan(3.5);
    expect(stopped.b[0]).toBeLessThanOrEqual(4);
    s.set('b:4,1,0', null);
    s.set(ek(3, 1, 0, 'w'), { i: 'wallwin' });
    expect(shotPath(s, from, to).hit).toBe(true);
    s.set(ek(3, 1, 0, 'w'), { i: 'wall' });
    const walled = shotPath(s, from, to);
    expect(walled.hit).toBe(false);
    expect(walled.b[0]).toBeGreaterThan(2.5);
    expect(walled.b[0]).toBeLessThanOrEqual(3);
  });

  it('only accepts shots that make sense, from someone who may play the shooter', () => {
    const s = new Store('gm');
    s.set('gm:gm', true);
    s.set('m:a', mini(0, 0, { o: 'ann' }));
    s.set('m:b', mini(5, 0));
    expect(readShot(s, { k: 'arrow', a: 'a', b: 'b' }, 'ann')).toEqual({ k: 'arrow', a: 'a', b: 'b' });
    expect(readShot(s, { k: 'fire', a: 'b', b: [2.5, 1, -3] }, 'gm')).toEqual({ k: 'fire', a: 'b', b: [2.5, 1, -3] });
    expect(readShot(s, { k: 'arrow', a: 'b', b: 'a' }, 'ann')).toBeNull(); // not hers to shoot with
    expect(readShot(s, { k: 'arrow', a: 'a', b: 'a' }, 'ann')).toBeNull();
    expect(readShot(s, { k: 'arrow', a: 'a', b: 'nobody' }, 'ann')).toBeNull();
    expect(readShot(s, { k: 'arrow', a: 'nobody', b: 'b' }, 'gm')).toBeNull();
    for (const k of ['cannon', 'constructor', 'toString', 7, undefined]) expect(readShot(s, { k, a: 'a', b: 'b' }, 'gm')).toBeNull();
    for (const b of [[1, 2], [1, 2, 3, 4], [NaN, 0, 0], [Infinity, 0, 0], [0.3, 1, 0], [1e6, 1, 0], [0, -1, 0], ['1', 1, 1], null, {}, 5]) {
      expect(readShot(s, { k: 'arrow', a: 'a', b }, 'gm')).toBeNull();
    }
  });
});
