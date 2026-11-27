import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BLOCKS, BLOCK_SHELVES, MINIS, MINI_SHELVES, PROPS, PROP_SHELVES } from './catalog';
import { kindsFor, reading, results, rollValues, shape, simulate, type Kind } from './dice';
import { deriveRoom, pack, seal, unpack, unseal } from './net';
import { canControl, eyesOf, fullPowers, measure, miniShown, nextTurn, sees, turnOrder, type MiniVal } from './rules';
import { Store, type Row } from './store';

describe('Store', () => {
  it('converges regardless of delivery order', () => {
    const rows: Row[] = [
      ['b:0,0,0', { i: 'grass' }, 10, 'aa'],
      ['b:0,0,0', { i: 'stone' }, 12, 'bb'],
      ['b:0,0,0', null, 11, 'cc'],
      ['m:1', { x: 1 }, 5, 'aa'],
      ['m:1', { x: 2 }, 5, 'bb'], // same time: higher author id wins
    ];
    const a = new Store('a'), b = new Store('b');
    rows.forEach((r) => a.merge(r));
    [...rows].reverse().forEach((r) => b.merge(r));
    expect(a.dump().sort()).toEqual(b.dump().sort());
    expect(a.get('b:0,0,0')).toEqual({ i: 'stone' });
    expect(a.get('m:1')).toEqual({ x: 2 });
  });

  it('keeps deletions as tombstones that beat older writes', () => {
    const s = new Store('a');
    s.merge(['k', 1, 10, 'x']);
    s.merge(['k', null, 20, 'x']);
    expect(s.merge(['k', 2, 15, 'y'])).toBe(false);
    expect(s.get('k')).toBeNull();
    expect([...s.keys('k')]).toEqual([]);
  });

  it('local writes always win over what was seen before', () => {
    const s = new Store('a');
    const out: Row[] = [];
    s.onLocal = (r) => out.push(r);
    s.merge(['k', 1, Date.now() + 60_000, 'z']); // a peer with a fast clock
    s.set('k', 2);
    expect(s.get('k')).toBe(2);
    expect(out).toHaveLength(1);
  });
});

describe('boards', () => {
  it('keeps each board\'s pieces apart while sharing table-wide keys', () => {
    const s = new Store('a');
    const seen: string[] = [];
    s.onChange = (k) => seen.push(k);
    s.set('b:0,0,0', { i: 'grass' });
    s.set('gm:a', true);
    s.setBoard('cave');
    expect(s.get('b:0,0,0')).toBeNull();
    expect(s.get('gm:a')).toBe(true);
    s.set('b:1,0,0', { i: 'stone' });
    s.set('turn', { id: 'x', round: 1 });
    expect([...s.keys('b:')]).toEqual(['b:1,0,0']);
    expect(s.entries.has('@cave/b:1,0,0')).toBe(true);
    s.merge(['b:9,9,9', { i: 'dirt' }, Date.now() + 5, 'z']); // a peer edits the main board meanwhile
    expect(seen).toEqual(['b:0,0,0', 'gm:a', 'b:1,0,0', 'turn']); // ...which this view does not hear about
    s.setBoard('');
    expect([...s.keys('b:')].sort()).toEqual(['b:0,0,0', 'b:9,9,9']);
    expect(s.get('turn')).toBeNull();
  });
});

describe('room crypto', () => {
  it('round-trips small and large payloads, and rejects other rooms', async () => {
    const a = await deriveRoom('Secret-Code-1');
    const same = await deriveRoom('  secret-code-1 ');
    const other = await deriveRoom('secret-code-2');
    expect(same.tag).toBe(a.tag);
    expect(other.tag).not.toBe(a.tag);
    const big = Array.from({ length: 2000 }, (_, i) => [`b:${i},0,0`, { i: 'grass' }, i, 'aa']);
    for (const data of [{ y: 'chat', m: 'hi 🐇' }, big]) {
      const sealed = await seal(a.key, data);
      expect(await unseal(same.key, sealed)).toEqual(data);
      await expect(unseal(other.key, sealed)).rejects.toThrow();
    }
  });
});

describe('dice', () => {
  it('builds every die with the right faces, numbered like real dice', () => {
    const faces: Record<string, number> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };
    for (const [kind, n] of Object.entries(faces)) {
      const sh = shape(kind as Kind);
      expect(sh.faces.length, kind).toBe(n);
      if (kind === 'd4') continue;
      expect([...sh.labels].sort((a, b) => a - b), kind).toEqual(Array.from({ length: n }, (_, i) => (kind === 'd10' ? i : i + 1)));
      sh.normals.forEach((m, f) => { // opposite faces share a constant sum
        const opp = sh.normals.findIndex((o) => o.dot(m) < -0.9999);
        expect(sh.labels[f] + sh.labels[opp], kind).toBe(kind === 'd10' ? 9 : n + 1);
      });
    }
  });

  it('reads the face that points up', () => {
    const sh = shape('d20');
    sh.normals.forEach((n, f) => {
      const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 1, 0));
      expect(reading('d20', q)).toBe(sh.labels[f]);
    });
  });

  it('maps labels to values, including percentile dice', () => {
    expect(rollValues(['d10', 'd10'], [0, 7])).toEqual([10, 7]);
    expect(rollValues(kindsFor(3, 100)!, [0, 0, 4, 2, 0, 5])).toEqual([100, 42, 5]);
    expect(rollValues(['d6', 'd100', 'd10', 'd10'], [3, 9, 0, 0])).toEqual([3, 90, 10]); // mixed hands
    expect(kindsFor(2, 100)).toEqual(['d100', 'd10', 'd100', 'd10']);
    expect(kindsFor(1, 7)).toBeNull();
    expect(kindsFor(13, 6)).toBeNull();
  });

  it('simulates a throw onto terrain that settles flat and replays to the same result', async () => {
    const store = new Store('a');
    for (let x = -2; x < 2; x++) for (let z = -2; z < 2; z++) store.set(`b:${x},0,${z}`, { i: 'grass' });
    const kinds = kindsFor(3, 6)!.concat(kindsFor(1, 20)!, kindsFor(1, 4)!, kindsFor(1, 100)!);
    const starts = kinds.map((_, i) => ({ p: [-2 + i * 0.6, 2.5, 3] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number] }));
    const t = await simulate(kinds, starts, [2, 0, -9], [0, 1, 0], store);
    expect(t.q[0].slice(0, 3)).toEqual([-200, 150, 300]); // starts exactly where the hand let go
    expect(t.n).toBeGreaterThan(20);
    expect(t.n).toBeLessThan(190); // came to rest before the time limit
    const labels = results(t)!;
    expect(labels).toHaveLength(7);
    expect(results(JSON.parse(JSON.stringify(t)))).toEqual(labels); // survives the wire
    labels.slice(0, 3).forEach((l) => expect([1, 2, 3, 4, 5, 6]).toContain(l));
    // Every die ended inside the tray, resting on the table (y=0) or on the grass (y=1), not mid-air.
    t.q.forEach((d) => {
      const end = [0, 1, 2].map((c) => d.reduce((s, v, i) => (i % 7 === c ? s + v : s), 0) / 100);
      expect(Math.abs(end[0])).toBeLessThan(6.5);
      expect(Math.abs(end[2])).toBeLessThan(6.5);
      expect(end[1] + 1).toBeGreaterThan(0.1);
      expect(end[1] + 1).toBeLessThan(1.6);
    });
    expect(results({ ...t, n: t.n + 1 })).toBeNull(); // malformed recordings are rejected
  });
});

describe('table rules', () => {
  const mini = (x: number, z: number, extra: Partial<MiniVal> = {}): MiniVal => ({ x, y: 0, z, k: 'knight', c: '#fff', n: '', r: 0, s: 1, ...extra });

  it('is free play until someone is GM, then only the GM and owners have power', () => {
    const s = new Store('gm');
    expect(fullPowers(s, 'kid')).toBe(true);
    s.set('gm:gm', true);
    expect(fullPowers(s, 'gm')).toBe(true);
    expect(fullPowers(s, 'kid')).toBe(false);
    expect(canControl(s, 'kid', mini(0, 0))).toBe(false);
    expect(canControl(s, 'kid', mini(0, 0, { o: 'kid' }))).toBe(true);
    expect(canControl(s, 'kid', mini(0, 0, { o: '*' }))).toBe(true);
    s.set('gm:gm', null);
    expect(fullPowers(s, 'kid')).toBe(true);
  });

  it('blocks line of sight with walls but not with water or over low cover', () => {
    const s = new Store('gm');
    const a = mini(0, 0), b = mini(4, 0);
    expect(sees(s, a, b)).toBe(true);
    s.set('b:2,0,0', { i: 'water' });
    expect(sees(s, a, b)).toBe(true);
    s.set('b:2,0,0', { i: 'stone' });
    expect(sees(s, a, b)).toBe(false); // a one-block wall hides head and feet
    expect(sees(s, mini(0, 0, { e: 3 }), b)).toBe(true); // ...unless you fly above it
  });

  it('shows players only what they should see', () => {
    const s = new Store('gm');
    s.set('gm:gm', true);
    const hero = mini(0, 0, { o: 'kid' }), goblin = mini(4, 0), lurker = mini(1, 1, { h: true });
    s.set('m:hero', hero);
    s.set('m:goblin', goblin);
    expect(miniShown(s, 'gm', lurker, null)).toBe('ghost');
    expect(miniShown(s, 'kid', lurker, null)).toBe('no');
    expect(miniShown(s, 'kid', goblin, eyesOf(s, 'kid'))).toBe('yes'); // line of sight is off by default
    s.set('set:los', true);
    s.set('b:2,0,0', { i: 'stone' });
    s.set('b:2,1,0', { i: 'stone' });
    expect(miniShown(s, 'kid', goblin, eyesOf(s, 'kid'))).toBe('no');
    expect(miniShown(s, 'kid', hero, eyesOf(s, 'kid'))).toBe('yes');
    expect(miniShown(s, 'other', goblin, eyesOf(s, 'other'))).toBe('yes'); // spectators without a mini see the open table
    s.set('set:los', false);
    s.set('f:4,0', true);
    expect(miniShown(s, 'kid', goblin, eyesOf(s, 'kid'))).toBe('no'); // under fog
    expect(miniShown(s, 'gm', goblin, null)).toBe('yes');
  });

  it('runs the turn order by initiative and counts rounds', () => {
    const s = new Store('gm');
    s.set('m:a', mini(0, 0, { ini: 12 }));
    s.set('m:b', mini(1, 0, { ini: 18 }));
    s.set('m:c', mini(2, 0));
    expect(turnOrder(s).map((o) => o.id)).toEqual(['b', 'a']);
    const seq: string[] = [];
    for (let i = 0; i < 4; i++) { const t = nextTurn(s)!; s.set('turn', t); seq.push(`${t.id}${t.round}`); }
    expect(seq).toEqual(['b1', 'a1', 'b2', 'a2']);
    expect(measure([0.5, 0, 0.5], [3.5, 0, 4.5])).toEqual({ cells: 5, feet: 25 });
  });
});

describe('library', () => {
  it('shelves every block, prop and mini exactly once, and every piece builds', () => {
    for (const [all, shelves] of [[BLOCKS, BLOCK_SHELVES], [PROPS, PROP_SHELVES], [MINIS, MINI_SHELVES]] as const) {
      const shelved = Object.values(shelves).flat();
      expect([...shelved].sort()).toEqual(Object.keys(all).sort());
    }
    for (const p of Object.values(PROPS)) expect(p.make().children.length).toBeGreaterThan(0);
    for (const m of Object.values(MINIS)) expect(m.make().length).toBeGreaterThan(0);
    expect(Object.keys(PROPS).length).toBeGreaterThan(45);
    expect(Object.keys(MINIS).length).toBeGreaterThan(40);
  });

  it('packs slabs into text and back', async () => {
    const slab = { w: 2, h: 1, d: 1, cells: [[0, 0, 0, { i: 'stone' }], [1, 0, 0, { i: 'door', r: 1 }]] };
    expect(await unpack(await pack(slab))).toEqual(slab);
  });
});
