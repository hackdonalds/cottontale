import { describe, expect, it } from 'vitest';
import { LOOSE, MAX_LOOSE, MAX_POUR, POUR_FRAMES, POUR_REACH, decodeLoose, decodePour, encodeLoose, looseId, nearRay, pourRoom, pourStarts, restOf, type Pour, type V3 } from './loose';
import { pour, simulatePour, type PourHost } from './pour';
import { Store } from './store';

describe('loose pieces', () => {
  it('round-trips a pose through whole numbers', () => {
    const v = encodeLoose('coin', [1.234, 0.026, -7.5], [0, 0.7071, 0, 0.7071]);
    expect(v).toEqual({ i: 'coin', p: [123, 3, -750], q: [0, 707, 0, 707] });
    expect([...v.p, ...v.q].every(Number.isInteger)).toBe(true);
    const d = decodeLoose(v)!;
    expect(d.kind).toBe('coin');
    expect(d.p).toEqual([1.23, 0.03, -7.5]);
    expect(Math.hypot(...d.q)).toBeCloseTo(1, 6);
    expect(d.q[1]).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it('keeps what it encodes on the table, and gives a turn to a piece without one', () => {
    const v = encodeLoose('stone', [500, -3, -500], [0, 0, 0, 0]);
    expect(v.p).toEqual([9600, 0, -9600]);
    expect(v.q).toEqual([0, 0, 0, 1000]);
    expect(decodeLoose(v)).not.toBeNull();
  });

  it('refuses malformed values from the network', () => {
    const ok = { i: 'stone', p: [0, 0, 0], q: [0, 0, 0, 1000] };
    expect(decodeLoose(ok)).not.toBeNull();
    const bad: unknown[] = [
      null, undefined, 7, 'stone', [], {},
      { ...ok, i: 'dragon' }, { ...ok, i: 'constructor' }, { ...ok, i: 3 },
      { ...ok, p: [0, 0] }, { ...ok, p: [0, 0, 0, 0] }, { ...ok, p: 'abc' }, { ...ok, p: [0.5, 0, 0] }, { ...ok, p: [NaN, 0, 0] },
      { ...ok, p: [1e9, 0, 0] }, { ...ok, p: [0, -1, 0] }, { ...ok, p: [0, 99999, 0] }, { ...ok, p: ['1', 0, 0] },
      { ...ok, q: [0, 0, 0] }, { ...ok, q: [0, 0, 0, 0] }, { ...ok, q: [0, 0, 0, 1e6] }, { ...ok, q: [0, 0, 0, 0.5] }, { ...ok, q: [0, 0, 0, Infinity] }, { ...ok, q: null },
    ];
    for (const v of bad) expect(decodeLoose(v), JSON.stringify(v)).toBeNull();
  });

  it('caps a pour and a board', () => {
    expect(pourRoom(0, 6)).toBe(6);
    expect(pourRoom(0, 999)).toBe(MAX_POUR);
    expect(pourRoom(MAX_LOOSE - 2, 12)).toBe(2);
    expect(pourRoom(MAX_LOOSE, 1)).toBe(0);
    expect(pourRoom(MAX_LOOSE + 50, 1)).toBe(0);
    expect(pourRoom(0, -3)).toBe(0);
    expect(pourRoom(0, NaN)).toBe(0);
    expect(pourRoom(0, 2.9)).toBe(2);
  });

  it('lets the pieces of a pour go apart from each other, above the spot or along the stroke', () => {
    let s = 1;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (const [a, b] of [[[2, 1, 2], [2, 1, 2]], [[0, 0, 0], [3, 0, 4]], [[0, 0, 0], [40, 2, 0]]] as [V3, V3][]) {
      for (const kind of Object.keys(LOOSE)) {
        const size = Math.max(...LOOSE[kind].h), at = pourStarts(MAX_POUR, a, b, size, rnd);
        expect(at.length).toBe(MAX_POUR);
        for (let i = 0; i < at.length; i++) {
          expect(at[i][1]).toBeGreaterThan(Math.max(a[1], b[1]) + 0.5);
          expect(Math.hypot(at[i][0] - a[0], at[i][2] - a[2])).toBeLessThan(POUR_REACH + 1);
          for (let j = 0; j < i; j++) expect(Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1], at[i][2] - at[j][2])).toBeGreaterThan(size * 2);
        }
      }
    }
  });

  it('finds the pieces under a fingertip, nearest first, and none behind what was touched', () => {
    const pts: [string, V3][] = [['far', [0, 0, 5]], ['near', [0.1, 0, 2]], ['off', [1, 0, 2]], ['behind', [0, 0, -1]]];
    expect(nearRay([0, 0, 0], [0, 0, 1], pts, 0.3)).toEqual(['near', 'far']);
    expect(nearRay([0, 0, 0], [0, 0, 1], pts, 0.3, 3)).toEqual(['near']);
    expect(nearRay([0, 0, 0], [0, 0, 1], [], 0.3)).toEqual([]);
  });

  it('makes ids a key can carry', () => {
    const ids = new Set(Array.from({ length: 200 }, () => looseId(Math.random)));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(looseId(() => 0.999999999999)).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe('recorded pours', () => {
  const rec = (): Pour => ({ o: [150, 0, -250], i: 'bone', ids: ['aa', 'bb'], n: 2, q: [[0, 200, 0, 0, 0, 0, 1000, 10, -195, 0, 0, 0, 0, 0], [50, 300, 0, 1000, 0, 0, 0, 0, -296, 5, 0, 0, 0, 0]] });

  it('decodes to absolute poses, and to the values to store', () => {
    const d = decodePour(rec())!;
    expect(d.kind).toBe('bone');
    expect(d.n).toBe(2);
    expect([...d.frames[0]].map((v) => +v.toFixed(3))).toEqual([1.5, 2, -2.5, 0, 0, 0, 1, 1.6, 0.05, -2.5, 0, 0, 0, 1]);
    expect(restOf(rec())).toEqual([
      ['l:aa', { i: 'bone', p: [160, 5, -250], q: [0, 0, 0, 1000] }],
      ['l:bb', { i: 'bone', p: [200, 4, -245], q: [1000, 0, 0, 0] }],
    ]);
  });

  it('refuses malformed recordings', () => {
    const bad: unknown[] = [
      null, 'pour', {}, { ...rec(), i: 'd20' }, { ...rec(), o: [0, 0] }, { ...rec(), o: [0.5, 0, 0] }, { ...rec(), o: [0, 0, 1e9] },
      { ...rec(), n: 0 }, { ...rec(), n: POUR_FRAMES + 1 }, { ...rec(), n: 1.5 }, { ...rec(), n: 3 },
      { ...rec(), ids: ['aa'] }, { ...rec(), ids: ['aa', 'aa'] }, { ...rec(), ids: ['aa', '../x'] }, { ...rec(), ids: ['aa', 7] }, { ...rec(), ids: 'ab' },
      { ...rec(), q: [rec().q[0]] }, { ...rec(), q: [rec().q[0], 'x'] }, { ...rec(), q: [rec().q[0], rec().q[1].map((v) => v + 0.5)] },
      { ...rec(), q: [rec().q[0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] }, // no rotation at all
      { ...rec(), ids: Array.from({ length: MAX_POUR + 1 }, (_, i) => `p${i}`), q: Array.from({ length: MAX_POUR + 1 }, () => rec().q[0]) },
    ];
    for (const t of bad) {
      expect(decodePour(t), JSON.stringify(t)?.slice(0, 80)).toBeNull();
      expect(restOf(t as Pour)).toEqual([]);
    }
  });

  it('leaves out a piece that came to rest off the table', () => {
    const t = rec();
    t.q[1][0] = 2_000_000; // flung far past the edge
    expect(restOf(t).map(([k]) => k)).toEqual(['l:aa']);
  });
});

describe('pouring', () => {
  it('drops pieces that fall, settle on the ground and on blocks, and record whole numbers', async () => {
    const store = new Store('me');
    for (let x = 4; x <= 6; x++) for (let z = 4; z <= 6; z++) store.set(`b:${x},0,${z}`, { i: 'stone' });
    for (const kind of Object.keys(LOOSE)) {
      const t = await simulatePour(kind, 8, [5.5, 1, 5.5], [5.5, 1, 5.5], store);
      expect(t.n).toBeGreaterThan(5);
      expect(t.n).toBeLessThanOrEqual(POUR_FRAMES);
      expect(t.q.flat().every(Number.isInteger) && t.o.every(Number.isInteger)).toBe(true);
      const d = decodePour(t)!, rest = restOf(t);
      expect(d.frames.length).toBe(8);
      expect(rest.length).toBe(8);
      const thin = Math.min(...LOOSE[kind].h);
      for (const [k, v] of rest) {
        expect(k).toMatch(/^l:[a-z0-9]{8}$/);
        const p = decodeLoose(v)!.p;
        expect(p[1], `${kind} came down`).toBeLessThan(2.2);
        // On the block (its top is at 1) or beside it on the table, and not sunk into either.
        const on = p[0] > 4 && p[0] < 7 && p[2] > 4 && p[2] < 7;
        expect(p[1], `${kind} rests on something`).toBeGreaterThan((on ? 1 : 0) + thin * 0.5);
        expect(Math.abs(p[0] - 5.5) + Math.abs(p[2] - 5.5), `${kind} stayed near`).toBeLessThan(12);
      }
    }
  }, 30_000);

  it('bounces off what already lies there', async () => {
    const store = new Store('me');
    // A slab lying over the spot, tipped a quarter turn: only its rotation makes it wide and low.
    const slab = { p: [0, 0.5, 0] as V3, h: [0.5, 3, 3] as V3, q: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number, number] };
    const t = await simulatePour('crate', 4, [0, 1, 0], [0, 1, 0], store, [slab]);
    const rest = restOf(t);
    expect(rest.length).toBe(4);
    for (const [, v] of rest) {
      const p = decodeLoose(v)!.p;
      if (Math.abs(p[0]) < 2.8 && Math.abs(p[2]) < 2.8) expect(p[1]).toBeGreaterThan(1);
    }
  }, 30_000);

  it('plays, then writes the resting places once, and never more than the board holds', async () => {
    const store = new Store('me'), log: string[] = [], sent: Pour[] = [];
    let have = MAX_LOOSE - 3;
    const host: PourHost = {
      store, here: () => '', count: () => have, solidsNear: () => [],
      send: (t) => { sent.push(t); log.push('send'); },
      play: async () => { log.push('play'); },
      commit: (edits) => { log.push('commit'); for (const [k, v] of edits) store.set(k, v); have += edits.length; },
    };
    expect(await pour(host, 'coin', 12, [0, 0, 0], [2, 0, 0])).toBe(3);
    expect(log).toEqual(['send', 'play', 'commit']);
    expect([...store.keys('l:')].sort()).toEqual(sent[0].ids.map((id) => `l:${id}`).sort());
    expect(sent[0].ids.length).toBe(3);
    expect(await pour(host, 'coin', 12, [0, 0, 0], [0, 0, 0])).toBe(0);
    expect(await pour({ ...host, count: () => 0 }, 'gold', 3, [0, 0, 0], [0, 0, 0])).toBe(0);
    expect(log.length).toBe(3);
  }, 30_000);

  it('keeps the pieces on the board they fell on if the pourer looks at another one meanwhile', async () => {
    const store = new Store('me');
    let here = 'cave';
    store.setBoard(here);
    const host: PourHost = {
      store, here: () => here, count: () => 0, solidsNear: () => [], send: () => {},
      play: async () => { here = ''; store.setBoard(''); },
      commit: () => { throw new Error('wrong board'); },
    };
    expect(await pour(host, 'stone', 2, [0, 0, 0], [0, 0, 0])).toBe(2);
    expect([...store.keys('l:')].length).toBe(0);
    store.setBoard('cave');
    expect([...store.keys('l:')].length).toBe(2);
  }, 30_000);
});

describe('loose pieces in the store', () => {
  it('belong to their board', () => {
    const store = new Store('me');
    store.set('l:a', encodeLoose('stone', [1, 0, 1], [0, 0, 0, 1]));
    store.setBoard('two');
    expect([...store.keys('l:')]).toEqual([]);
    store.set('l:b', encodeLoose('coin', [1, 0, 1], [0, 0, 0, 1]));
    expect(store.dump().map((r) => r[0]).sort()).toEqual(['@two/l:b', 'l:a']);
  });
});
