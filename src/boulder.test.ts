import { describe, expect, it } from 'vitest';
import { BOULDER_R, boulderHits, decodeRoll, simulateBoulder, slabs, type Roll } from './boulder';
import { ek, type MiniVal } from './rules';
import { Store } from './store';

const mini = (x: number, y: number, z: number, more: Partial<MiniVal> = {}): MiniVal => ({ x, y, z, k: 'knight', c: '#fff', n: '', r: 0, s: 1, ...more });
/** A flat floor of grass from x0..x1, z -3..3, one block thick. */
function floor(store: Store, x0: number, x1: number): void {
  for (let x = x0; x <= x1; x++) for (let z = -3; z <= 3; z++) store.set(`b:${x},0,${z}`, { i: 'grass' });
}
/** A recording of a straight roll along +x at a steady height, without the physics. */
function straight(from: number, to: number, y: number, z = 0.5): Roll {
  const q: number[] = [];
  const n = Math.round((to - from) * 5) + 1;
  for (let f = 0; f < n; f++) q.push(f ? 20 : 0, 0, 0, 0, 0, 0, f ? 0 : 1000);
  return { o: [from, y, z], n, q };
}

describe('boulder', () => {
  it('joins flat ground into few boxes', () => {
    const cols: [number, number, number, number][] = [];
    for (let x = 0; x < 6; x++) for (let z = 0; z < 4; z++) cols.push([x, 0, z, x < 3 ? 1 : 2]);
    const s = slabs(cols);
    expect(s).toHaveLength(2);
    expect(s.reduce((a, [, , , w, , d]) => a + w * d, 0)).toBe(24);
  });

  it('rolls along a push over the ground and comes to rest', async () => {
    const store = new Store('a');
    floor(store, -4, 20);
    const t = await simulateBoulder([0.5, 1.9, 0.5], [8, 0, 0], store);
    const d = decodeRoll(t)!;
    const end = d.pos[t.n - 1];
    expect(end.x).toBeGreaterThan(5);
    expect(Math.abs(end.z - 0.5)).toBeLessThan(1);
    expect(end.y).toBeCloseTo(1 + BOULDER_R, 1); // resting on the grass
    expect(t.n).toBeLessThan(240); // it stopped by itself
    for (const p of d.pos) expect(p.y).toBeGreaterThan(1 + BOULDER_R - 0.06); // never sinks into the ground
    // It turns as it goes.
    expect(Math.abs(d.rot[10].w)).toBeLessThan(0.999);
  });

  it('rolls down a staircase', async () => {
    const store = new Store('a');
    for (let x = -3; x <= 14; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= Math.max(0, 4 - Math.max(0, Math.floor(x / 2))); y++) store.set(`b:${x},${y},${z}`, { i: 'stone' });
    const t = await simulateBoulder([0.5, 6, 0.5], [3, 0, 0], store);
    const d = decodeRoll(t)!, end = d.pos[t.n - 1];
    expect(end.y).toBeLessThan(d.pos[0].y - 2);
    expect(end.x).toBeGreaterThan(6);
  });

  it('stops at a wall of blocks, and at a thin wall', async () => {
    const store = new Store('a');
    floor(store, -4, 20);
    for (let z = -3; z <= 3; z++) for (let y = 1; y <= 3; y++) store.set(`b:6,${y},${z}`, { i: 'stone' });
    const far = (t: Roll) => Math.max(...decodeRoll(t)!.pos.map((p) => p.x));
    expect(far(await simulateBoulder([0.5, 1.9, 0.5], [10, 0, 0], store))).toBeLessThan(6 - BOULDER_R + 0.2);
    const open = new Store('b');
    floor(open, -4, 20);
    const thin = [-1, 0, 1].map((z) => ({ p: [5, 1.5, z + 0.5] as [number, number, number], h: [0.1, 0.5, 0.5] as [number, number, number] }));
    expect(far(await simulateBoulder([0.5, 1.9, 0.5], [10, 0, 0], open, thin))).toBeLessThan(5);
    expect(far(await simulateBoulder([0.5, 1.9, 0.5], [10, 0, 0], open))).toBeGreaterThan(7);
  });

  it('is gone once it leaves the built area', async () => {
    const store = new Store('a');
    floor(store, -2, 4);
    const t = await simulateBoulder([0.5, 1.9, 0.5], [12, 0, 0], store);
    const end = decodeRoll(t)!.pos[t.n - 1];
    expect(end.x).toBeGreaterThan(5);
    expect(end.x).toBeLessThan(9);
    // Let go out on the bare table, it simply rolls there.
    const bare = await simulateBoulder([12.5, 0.9, 0.5], [8, 0, 0], store);
    expect(decodeRoll(bare)!.pos[bare.n - 1].x).toBeGreaterThan(17);
  });

  it('records small, survives a round trip, and rejects malformed recordings', async () => {
    const store = new Store('a');
    floor(store, -4, 20);
    const t = await simulateBoulder([0.5, 1.9, 0.5], [8, 0, 0], store);
    expect(t.q.every(Number.isInteger)).toBe(true);
    const back = JSON.parse(JSON.stringify(t)) as Roll;
    expect(decodeRoll(back)!.pos[t.n - 1].toArray()).toEqual(decodeRoll(t)!.pos[t.n - 1].toArray());
    expect(JSON.stringify(t).length).toBeLessThan(t.n * 30);
    expect(decodeRoll(null as unknown as Roll)).toBeNull();
    expect(decodeRoll({} as Roll)).toBeNull();
    expect(decodeRoll({ ...t, n: t.n + 1 })).toBeNull();
    expect(decodeRoll({ ...t, n: 1e6 })).toBeNull();
    expect(decodeRoll({ ...t, n: 1.5 })).toBeNull();
    expect(decodeRoll({ ...t, o: [0, 0] as unknown as Roll['o'] })).toBeNull();
    expect(decodeRoll({ ...t, o: [0, NaN, 0] })).toBeNull();
    expect(decodeRoll({ ...t, q: t.q.map((v, i) => (i === 9 ? ('x' as unknown as number) : v)) })).toBeNull();
    expect(decodeRoll({ o: [0, 0, 0], n: 1, q: [0, 0, 0, 0, 0, 0, 0] })).toBeNull();
  });

  it('bowls over the figures in its way and shoves them a cell on', () => {
    const store = new Store('a');
    floor(store, -4, 20);
    store.set('m:hit', mini(4, 1, 0));
    store.set('m:beside', mini(4, 1, 2)); // out of its way
    store.set('m:above', mini(8, 1, 0, { e: 4 })); // flying over it
    store.set('m:hidden', mini(10, 1, 0, { h: true }));
    const hits = boulderHits(straight(0.5, 14.5, 1 + BOULDER_R), store);
    expect(hits.map((h) => h.id)).toEqual(['hit', 'hidden']);
    expect(hits[0]).toMatchObject({ from: [4, 1, 0], to: [5, 1, 0] });
    expect(hits[0].f).toBeLessThan(hits[1].f);
    expect(hits.every((h) => h.to.every(Number.isInteger))).toBe(true);
    expect(boulderHits({ o: [0, 0, 0], n: 3, q: [] }, store)).toEqual([]);
  });

  it('does not shove a figure through a wall, into a block or onto another figure; off a ledge it drops', () => {
    const run = (prep: (s: Store) => void) => {
      const store = new Store('a');
      floor(store, -4, 6);
      store.set('m:a', mini(4, 1, 0));
      prep(store);
      return boulderHits(straight(0.5, 4.5, 1 + BOULDER_R), store).find((h) => h.id === 'a')!.to;
    };
    expect(run(() => {})).toEqual([5, 1, 0]);
    expect(run((s) => s.set(ek(5, 1, 0, 'w'), { i: 'wall' }))).toEqual([4, 1, 0]);
    expect(run((s) => s.set(ek(5, 1, 0, 'w'), { i: 'walldoor' }))).toEqual([5, 1, 0]);
    expect(run((s) => s.set('b:5,1,0', { i: 'stone' }))).toEqual([4, 1, 0]);
    expect(run((s) => s.set('b:5,1,0', { i: 'barrel' }))).toEqual([4, 1, 0]);
    expect(run((s) => s.set('m:b', mini(5, 1, 0)))).toEqual([4, 1, 0]);
    expect(run((s) => s.set('b:5,0,0', null))).toEqual([5, 0, 0]);
  });
});
