import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BLOCKS, BLOCK_SHELVES, MINIS, MINI_SHELVES, PROPS, PROP_SHELVES, makeMini, makeProp } from './catalog';
import { kindOf, known as has, namespaceOf, onRegistry, pieceId, registerPack, registered, unregisterPack } from './registry';
import { kindsFor, reading, results, rollValues, shape, simulate, type Kind } from './dice';
import { deriveRoom, pack, seal, unpack, unseal } from './net';
import { canControl, columnTop, dressing, edgeBetween, ek, grow, levelTo, resurface, sculpt, eyesOf, fullPowers, measure, miniShown, nextTurn, roomEdges, sees, turnOrder, type MiniVal } from './rules';
import { buildTerrain } from './terrain';
import { THEMES, generate, type GenOpts, type Theme } from './gen';
import { EDGES, edgeBetween as between, nextLight } from './rules';
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

describe('lights', () => {
  it('steps a light through its strengths and back, keeping what else it is', () => {
    let v: { i: string; r?: number; l?: number } = { i: 'torch', r: 2 };
    const seen = [];
    for (let i = 0; i < 4; i++) { v = nextLight(v); seen.push(v.l ?? 1); expect(v.i).toBe('torch'); expect(v.r).toBe(2); }
    expect(seen).toEqual([2, 0.5, 0, 1]);
    expect(v).toEqual({ i: 'torch', r: 2 }); // back to normal leaves no trace
  });
});

describe('edge walls', () => {
  const mini = (x: number, z: number): MiniVal => ({ x, y: 0, z, k: 'knight', c: '#fff', n: '', r: 0, s: 1 });

  it('gives every edge one key, whichever side you come from', () => {
    expect(edgeBetween(0, 2, 5, 3, 5)).toBe(ek(3, 0, 5, 'w'));
    expect(edgeBetween(0, 3, 5, 2, 5)).toBe(ek(3, 0, 5, 'w'));
    expect(edgeBetween(1, 2, 5, 2, 4)).toBe(ek(2, 1, 5, 'n'));
  });

  it('stops sight at a wall on the edge, but not at a window, a doorway or over the top', () => {
    const s = new Store('gm');
    const a = mini(0, 0), b = mini(1, 0);
    expect(sees(s, a, b)).toBe(true);
    s.set(ek(1, 0, 0, 'w'), { i: 'wall' });
    expect(sees(s, a, b)).toBe(false); // neighbours, with a wall between them
    expect(sees(s, b, a)).toBe(false);
    expect(sees(s, a, mini(0, 1))).toBe(true); // nothing on that side
    s.set(ek(1, 0, 0, 'w'), { i: 'wallwin' });
    expect(sees(s, a, b)).toBe(true);
    s.set(ek(1, 0, 0, 'w'), { i: 'walldoor' });
    expect(sees(s, a, b)).toBe(true);
    s.set(ek(1, 0, 0, 'w'), { i: 'wall' });
    expect(sees(s, { ...a, e: 2 }, { ...b, e: 2 })).toBe(true);
  });

  it('cannot be peeked round at a closed corner', () => {
    const s = new Store('gm');
    s.set(ek(1, 0, 0, 'w'), { i: 'wall' });
    s.set(ek(0, 0, 1, 'n'), { i: 'wall' });
    expect(sees(s, mini(0, 0), mini(1, 1))).toBe(false);
    s.set(ek(0, 0, 1, 'n'), null);
    expect(sees(s, mini(0, 0), mini(1, 1))).toBe(true);
  });

  it('outlines a room with one doorway and no window beside a corner', () => {
    const edges = roomEdges(0, 4, 0, 2, 1, false);
    expect(edges.length).toBe(2 * 5 + 2 * 3);
    expect(new Set(edges.map(([k]) => k)).size).toBe(edges.length);
    expect(edges.filter(([, i]) => i === 'walldoor').map(([k]) => k)).toEqual([ek(2, 1, 3, 'n')]);
    const at = new Map(edges);
    for (const k of [ek(0, 1, 0, 'n'), ek(4, 1, 0, 'n'), ek(0, 1, 0, 'w'), ek(0, 1, 2, 'w'), ek(5, 1, 0, 'w')]) expect(at.get(k)).toBe('wall');
    expect(at.get(ek(2, 1, 0, 'n'))).toBe('wallwin');
    expect(roomEdges(0, 2, 0, 2, 1, true).every(([, i]) => ['wallwood', 'woodwin', 'walldoor'].includes(i))).toBe(true);
  });

  it('belongs to its board', () => {
    const s = new Store('gm');
    s.set(ek(0, 0, 0, 'n'), { i: 'wall' });
    s.setBoard('cellar');
    expect([...s.keys('w:')]).toEqual([]);
    s.setBoard('');
    expect([...s.keys('w:')]).toEqual([ek(0, 0, 0, 'n')]);
  });
});

describe('shaping the land', () => {
  const land = () => {
    const s = new Store('gm');
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) s.set(`b:${x},0,${z}`, { i: 'grass' });
    return { s, put: (k: string, v: unknown) => s.set(k, v) };
  };

  it('raises and lowers ground a level, carrying what stands on it', () => {
    const { s, put } = land();
    s.set('b:1,1,1', { i: 'tree' });
    s.set('m:a', { x: 1, y: 1, z: 1, k: 'knight', c: '#fff', n: '', r: 0, s: 1 });
    expect(sculpt(s, 1, 1, 1, put)).toBe(true);
    expect(columnTop(s, 1, 1)).toEqual({ y: 1, id: 'grass' });
    expect(s.get('b:1,2,1')).toEqual({ i: 'tree' });
    expect(s.get<MiniVal>('m:a')!.y).toBe(2);
    expect(sculpt(s, 1, 1, -1, put)).toBe(true);
    expect(columnTop(s, 1, 1)).toEqual({ y: 0, id: 'grass' });
    expect(s.get('b:1,1,1')).toEqual({ i: 'tree' });
    expect(s.get('b:1,2,1')).toBeNull();
    expect(s.get<MiniVal>('m:a')!.y).toBe(1);
  });

  it('carries a wall up with the ground it stands on, unless the ground beside it stays', () => {
    const { s, put } = land();
    s.set(ek(1, 1, 1, 'n'), { i: 'wall' }); // between (1,0) and (1,1)
    s.set(ek(1, 2, 1, 'n'), { i: 'wallwood' }); // a storey on top of it
    sculpt(s, 1, 1, 1, put);
    expect(s.get(ek(1, 1, 1, 'n'))).toEqual({ i: 'wall' }); // (1,0) is still at its level: it stays
    sculpt(s, 1, 0, 1, put);
    expect(s.get(ek(1, 1, 1, 'n'))).toBeNull(); // now both sides have risen: so has the wall
    expect(s.get(ek(1, 2, 1, 'n'))).toEqual({ i: 'wall' });
    expect(s.get(ek(1, 3, 1, 'n'))).toEqual({ i: 'wallwood' });
    sculpt(s, 1, 0, -1, put);
    sculpt(s, 1, 1, -1, put);
    expect(s.get(ek(1, 1, 1, 'n'))).toEqual({ i: 'wall' });
    expect(s.get(ek(1, 2, 1, 'n'))).toEqual({ i: 'wallwood' });
    expect(s.get(ek(1, 3, 1, 'n'))).toBeNull();
  });

  it('never digs through the last layer, and leaves floors alone', () => {
    const { s, put } = land();
    s.set('b:1,1,1', null);
    expect(sculpt(s, 0, 0, -1, put)).toBe(false);
    expect(columnTop(s, 0, 0)).toEqual({ y: 0, id: 'grass' });
    s.set('b:2,0,2', { i: 'wood' });
    expect(sculpt(s, 2, 2, 1, put)).toBe(false);
    expect(sculpt(s, 9, 9, 1, put)).toBe(true); // bare table: new ground appears
    expect(columnTop(s, 9, 9)).toEqual({ y: 0, id: 'grass' });
  });

  it('levels a column to a height and repaints its surface', () => {
    const { s, put } = land();
    levelTo(s, 0, 0, 3, put);
    expect(columnTop(s, 0, 0)).toEqual({ y: 3, id: 'grass' });
    levelTo(s, 0, 0, 1, put);
    expect(columnTop(s, 0, 0)).toEqual({ y: 1, id: 'grass' });
    expect(s.get('b:0,2,0')).toBeNull();
    resurface(s, 0, 0, 'sand', put);
    expect(columnTop(s, 0, 0)).toEqual({ y: 1, id: 'sand' });
    expect(s.get('b:0,0,0')).toEqual({ i: 'grass' }); // only the surface changes
  });

  it('grows what suits the ground, the same for everyone, and reeds by the water', () => {
    const kinds = (ground: string, wet = false) => {
      const seen = new Set<string>();
      for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) { const p = dressing(ground, x, z, wet); if (p) seen.add(p); }
      return seen;
    };
    expect(kinds('sand').has('cactus')).toBe(true);
    expect(kinds('sand').has('pine')).toBe(false);
    expect([...kinds('snow')].every((p) => ['pine', 'rock', 'deadtree'].includes(p))).toBe(true);
    expect([...kinds('grass', true)]).toEqual(['reeds']);
    for (const p of [...kinds('grass'), ...kinds('moss'), ...kinds('basalt'), ...kinds('mud'), ...kinds('meadow'), ...kinds('dirt'), ...kinds('clay')]) expect(PROPS[p], p).toBeTruthy();
    expect(dressing('grass', 7, 3, false)).toBe(dressing('grass', 7, 3, false));
    let open = 0;
    for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) if (!dressing('grass', x, z, false)) open++;
    expect(open / 1600).toBeGreaterThan(0.6); // a wood you can still walk through

    const { s, put } = land();
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) grow(s, x, z, put);
    const first = JSON.stringify(s.dump().map(([k, v]) => [k, v]).sort());
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) grow(s, x, z, put);
    expect(JSON.stringify(s.dump().map(([k, v]) => [k, v]).sort())).toBe(first);
  });
});

describe('scene generators', () => {
  const themes = Object.keys(THEMES) as Theme[];
  const opts = (theme: Theme, seed = 7, v = 2): GenOpts => ({ theme, seed, size: v, density: v, detail: v });
  /** Cells you can walk to from a start, over floor, not through walls. */
  const reach = (edits: Map<string, { i: string }>, start: string, floors: (id: string) => boolean): Set<string> => {
    const seen = new Set([start]), todo = [start];
    while (todo.length) {
      const [x, z] = todo.pop()!.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${z + dz}`, ground = edits.get(`b:${x + dx},0,${z + dz}`);
        if (seen.has(k) || !ground || !floors(ground.i)) continue;
        const wall = edits.get(between(1, x, z, x + dx, z + dz));
        if (wall && wall.i !== 'walldoor') continue;
        seen.add(k);
        todo.push(k);
      }
    }
    return seen;
  };

  it('builds the same scene from the same numbers, and another from another seed', () => {
    for (const t of themes) {
      const a = JSON.stringify(generate(opts(t)).edits);
      expect(JSON.stringify(generate(opts(t)).edits)).toBe(a);
      expect(JSON.stringify(generate(opts(t, 8)).edits)).not.toBe(a);
    }
  });

  it('uses only pieces the library has, inside its bounds, at every slider setting', () => {
    for (const t of themes) for (const v of [0, 2, 4]) for (const seed of [1, 2, 3]) {
      const { edits, bounds: [x0, x1, z0, z1] } = generate(opts(t, seed, v));
      expect(edits.length).toBeGreaterThan(20);
      expect(edits.length).toBeLessThan(6000);
      for (const [k, val] of edits) {
        const id = (val as { i: string }).i, [x, , z] = k.slice(2).split(',').map(Number);
        if (k.startsWith('w:')) expect(EDGES[id], `${t} ${id}`).toBeTruthy();
        else expect(BLOCKS[id] ?? PROPS[id], `${t} ${id}`).toBeTruthy();
        expect(x >= x0 && x <= x1 + 1 && z >= z0 && z <= z1 + 1, `${t} ${k}`).toBe(true);
      }
    }
  });

  it('never stands a prop in mid-air or inside a block', () => {
    for (const t of themes) {
      const map = new Map(generate(opts(t, 5, 4)).edits) as Map<string, { i: string }>;
      for (const [k, v] of map) {
        if (!k.startsWith('b:') || !PROPS[v.i]) continue;
        const [x, y, z] = k.slice(2).split(',').map(Number), under = map.get(`b:${x},${y - 1},${z}`);
        expect(under && BLOCKS[under.i], `${t} ${k} ${v.i}`).toBeTruthy();
      }
    }
  });

  it('joins every dungeon room to every other through its doorways', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { edits, rooms } = generate(opts('dungeon', seed, seed % 5));
      const map = new Map(edits) as Map<string, { i: string }>;
      expect(rooms.length).toBeGreaterThan(2);
      const seen = reach(map, `${rooms[0].x0},${rooms[0].z0}`, () => true);
      for (const q of rooms) for (let x = q.x0; x <= q.x1; x++) for (let z = q.z0; z <= q.z1; z++) expect(seen.has(`${x},${z}`), `seed ${seed}`).toBe(true);
      expect(edits.some(([, v]) => (v as { i: string }).i === 'walldoor')).toBe(true);
    }
  });

  it('redoes one room without touching the rest, and keeps locked rooms through a new layout', () => {
    for (const theme of ['dungeon', 'tavern'] as const) {
      const a = generate(opts(theme, 3, 4));
      const again = generate(opts(theme, 3, 4), a.rooms, true);
      expect(JSON.stringify(again.edits)).toBe(JSON.stringify(a.edits)); // nothing rerolled: nothing moves
      const which = 1, q = a.rooms[which];
      const b = generate(opts(theme, 3, 4), a.rooms.map((r, i) => (i === which ? { ...r, seed: r.seed + 1 } : r)), true);
      const before = new Map(a.edits.map(([k, v]) => [k, JSON.stringify(v)])), after = new Map(b.edits.map(([k, v]) => [k, JSON.stringify(v)]));
      let changed = 0;
      for (const k of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(k) === after.get(k)) continue;
        changed++;
        const [x, , z] = k.slice(2).split(',').map(Number);
        expect(k.startsWith('b:') && x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1, `${theme} ${k}`).toBe(true);
      }
      expect(changed).toBeGreaterThan(0);
    }
    // A new dungeon around a locked room: the room is where it was, furnished as it was.
    const a = generate(opts('dungeon', 3, 4)), kept = { ...a.rooms[2], lock: true };
    const b = generate(opts('dungeon', 99, 4), a.rooms.map((r, i) => (i === 2 ? kept : r)));
    expect(b.rooms.filter((r) => r.lock)).toEqual([kept]);
    expect(b.rooms.length).toBeGreaterThan(3);
    const inside = (edits: [string, unknown][]) => new Map(edits.filter(([k]) => {
      const [x, y, z] = k.slice(2).split(',').map(Number);
      return k.startsWith('b:') && y === 1 && x >= kept.x0 && x <= kept.x1 && z >= kept.z0 && z <= kept.z1;
    }).map(([k, v]) => [k, JSON.stringify(v)]));
    const was = inside(a.edits), now = inside(b.edits);
    expect(was.size).toBeGreaterThan(2);
    let same = 0;
    for (const [k, v] of now) { expect(was.get(k) ?? v).toBe(v); if (was.has(k)) same++; } // nothing moved or changed
    expect(same).toBeGreaterThanOrEqual(was.size - 3); // only what stood in a new doorway is gone
    const map = new Map(b.edits) as Map<string, { i: string }>;
    expect(reach(map, `${b.rooms[0].x0},${b.rooms[0].z0}`, () => true).has(`${kept.x0},${kept.z0}`)).toBe(true);
  });

  it('digs one cave you can walk the whole of', () => {
    for (const seed of [1, 2, 3]) {
      const map = new Map(generate(opts('cave', seed)).edits) as Map<string, { i: string }>;
      const walk = (id: string) => id !== 'basalt';
      const open = [...map].filter(([k, v]) => /^b:-?\d+,0,/.test(k) && walk(v.i)).map(([k]) => k.slice(2).split(',')).map(([x, , z]) => `${x},${z}`);
      expect(open.length).toBeGreaterThan(60);
      expect(reach(map, open[0], walk).size).toBe(open.length);
    }
  });

  it('builds a tavern you can enter, with every room reachable from the yard', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { edits, rooms, bounds } = generate(opts('tavern', seed, seed));
      const map = new Map(edits) as Map<string, { i: string }>;
      const seen = reach(map, `${bounds[0]},${bounds[2]}`, () => true);
      for (const q of rooms) expect(seen.has(`${q.x0},${q.z0}`), `${q.kind} seed ${seed}`).toBe(true);
      expect(rooms.map((q) => q.kind)).toEqual(['hall', 'store', 'bedroom']);
    }
  });
});

describe('library', () => {
  it('shelves every block, prop and mini exactly once, and every piece builds', () => {
    for (const [all, shelves] of [[BLOCKS, BLOCK_SHELVES], [PROPS, PROP_SHELVES], [MINIS, MINI_SHELVES]] as const) {
      const shelved = Object.values(shelves).flat();
      expect([...shelved].sort()).toEqual(Object.keys(all).sort());
    }
    for (const p of Object.values(PROPS)) expect(p.make!().children.length).toBeGreaterThan(0);
    for (const m of Object.values(MINIS)) expect(m.make!().length).toBeGreaterThan(0);
    expect(Object.keys(PROPS).length).toBeGreaterThan(45);
    expect(Object.keys(MINIS).length).toBeGreaterThan(20);
  });

  it('takes in a pack of pieces under its own namespace, and lets it go again without a trace', () => {
    const before = JSON.stringify([Object.keys(BLOCKS), Object.keys(PROPS), Object.keys(MINIS), BLOCK_SHELVES, PROP_SHELVES, MINI_SHELVES]);
    const heard: string[] = [], stop = onRegistry((ns) => heard.push(ns));
    const mesh = { geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshStandardMaterial() };
    const ids = registerPack('ada', {
      blocks: { moonrock: { name: 'Moon rock', color: '#99a' } },
      props: { lamp: { name: 'Lamp', icon: '💡', make: () => new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())) }, sign: { name: 'Sign', icon: '🪧', mesh }, 'Bad Name': { name: 'x', icon: 'x', mesh }, empty: { name: 'Nothing to draw', icon: 'x' } },
      minis: { robot: { name: 'Robot', icon: '🤖', height: 1.1, mesh }, lamp: { name: 'Same name as the prop', icon: 'x', height: 1, mesh } },
      shelves: { blocks: { Terrain: ['moonrock'] }, props: { Space: ['lamp', 'sign', 'nope'], Nature: ['lamp'] }, minis: { Heroes: ['robot'] } },
    });
    expect(ids).toEqual(['ada:moonrock', 'ada:lamp', 'ada:sign', 'ada:robot']);
    expect(pieceId('ada', 'lamp')).toBe('ada:lamp');
    expect([namespaceOf('ada:lamp'), namespaceOf('tree')]).toEqual(['ada', '']);
    expect([kindOf('ada:moonrock'), kindOf('ada:lamp'), kindOf('ada:robot'), kindOf('knight'), kindOf('ada:nope'), kindOf('toString')]).toEqual(['block', 'prop', 'mini', 'mini', null, null]);
    expect(has.prop('ada:sign') && has.block('stone') && !has.prop('ada:robot') && !has.mini('constructor')).toBe(true);
    expect(PROP_SHELVES.Space).toEqual(['ada:lamp', 'ada:sign']);
    expect(PROP_SHELVES.Nature.at(-1)).toBe('ada:lamp');
    expect(BLOCK_SHELVES.Terrain.at(-1)).toBe('ada:moonrock');
    expect(MINI_SHELVES.Heroes.at(-1)).toBe('ada:robot');
    expect(registered()).toEqual(['ada']);
    // Ready geometry is shared by every copy; a made piece is merged once and shared the same way.
    const [a, b] = [makeProp('ada:sign'), makeProp('ada:sign')].map((g) => g.children[0] as THREE.Mesh);
    expect(a.geometry === mesh.geometry && b.geometry === mesh.geometry && a.material === mesh.material).toBe(true);
    const [c, d] = [makeProp('ada:lamp'), makeProp('ada:lamp')].map((g) => g.children[0] as THREE.Mesh);
    expect(c.geometry === d.geometry && c.material === d.material && !makeProp('ada:lamp').userData.pending).toBe(true);
    expect(makeMini('ada:robot')[0].geometry).toBe(mesh.geometry);
    // The same namespace again replaces what it held; other namespaces are their own.
    registerPack('ada', { props: { lamp: { name: 'Lamp 2', icon: '💡', mesh } } });
    registerPack('Not A Namespace', { props: { lamp: { name: 'x', icon: 'x', mesh } } });
    expect([PROPS['ada:lamp'].name, has.prop('ada:sign'), has.block('ada:moonrock'), PROP_SHELVES.Space, registered()]).toEqual(['Lamp 2', false, false, undefined, ['ada']]);
    expect((makeProp('ada:lamp').children[0] as THREE.Mesh).geometry).toBe(mesh.geometry); // not the shape baked for the old one
    unregisterPack('ada');
    unregisterPack('ada'); // nothing left to take out: nobody is told
    expect(heard).toEqual(['ada', 'ada', 'ada']);
    expect(JSON.stringify([Object.keys(BLOCKS), Object.keys(PROPS), Object.keys(MINIS), BLOCK_SHELVES, PROP_SHELVES, MINI_SHELVES])).toBe(before);
    stop();
    registerPack('ada', {});
    unregisterPack('ada');
    expect(heard.length).toBe(3);
  });

  it('stands a plain marker in for a piece it does not have, one shape for all of them', () => {
    const [a, b] = [makeProp('ada:gone'), makeProp('someday')];
    expect(a.userData.pending && b.userData.pending).toBe(true);
    const [m, n] = [a.children[0], b.children[0]] as THREE.Mesh[];
    expect(m.geometry === n.geometry && m.material === n.material).toBe(true);
    const [x, y] = [makeMini('ada:gone')[0], makeMini('__proto__')[0]];
    expect(x.geometry === y.geometry && x.material === m.material).toBe(true);
    expect(makeProp('tree').userData.pending).toBeUndefined();
  });

  it('packs slabs into text and back', async () => {
    const slab = { w: 2, h: 1, d: 1, cells: [[0, 0, 0, { i: 'stone' }], [1, 0, 0, { i: 'door', r: 1 }]] };
    expect(await unpack(await pack(slab))).toEqual(slab);
  });
});

describe('terrain', () => {
  const cols = (cells: [number, number, number, string][]) => new Map(cells.map(([x, y, z, id]) => [`${x},${z}`, { y, id }]));
  const heights = (t: ReturnType<typeof buildTerrain>, x: number, z: number) => {
    const p = t.geometry.getAttribute('position'), out: number[] = [];
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - x) < 1e-6 && Math.abs(p.getZ(i) - z) < 1e-6) out.push(p.getY(i));
    return out;
  };

  it('draws level ground as two triangles a cell, with nothing marked as a bank', () => {
    const t = buildTerrain(cols([[0, 0, 0, 'grass'], [1, 0, 0, 'grass'], [0, 0, 1, 'grass'], [1, 0, 1, 'grass']]), () => 0);
    expect(t.sloped.size).toBe(0);
    expect(t.side.filter((s) => !s).length).toBe(8);
  });

  it('turns a step into a bank that meets halfway, and keeps a level pad under each cell', () => {
    const t = buildTerrain(cols([[0, 0, 0, 'grass'], [1, 1, 0, 'grass']]), () => 0);
    expect(t.sloped).toEqual(new Set(['0,0', '1,0']));
    expect(heights(t, 1, 0.5).filter((h) => h === 1.5).length).toBe(1); // the shared edge, one vertex, between 1 and 2
    expect(heights(t, 0.2, 0.2)).toEqual([1]); // the low cell's pad
    expect(heights(t, 1.8, 0.8)).toEqual([2]); // the high cell's pad
  });

  it('does not let floors lift the ground beside them, and closes the gap with a cut face', () => {
    const t = buildTerrain(cols([[0, 1, 0, 'grass'], [1, 0, 0, 'wood']]), () => 0);
    expect(t.sloped.size).toBe(0);
    expect(t.cells.every((c) => c.join() === '0,1,0')).toBe(true);
    expect(t.side.some(Boolean)).toBe(true);
  });
});

describe('themes', async () => {
  const { MAX_PIECES, activeTheme, atmo, loadThemes, moodEdits, parseTheme, setAtmo, themeLook } = await import('./theme');
  const { SOUNDSCAPES } = await import('./sound');
  const { readFile } = await import('node:fs/promises' as string) as { readFile: (path: string, enc: string) => Promise<string> }; // no node types in this project
  const known = { ...has, amb: (id: string) => id in SOUNDSCAPES, gen: (id: string) => id in THEMES };
  const file = async (url: string): Promise<unknown> => JSON.parse(await readFile(url, 'utf8'));

  it('every theme file that ships names only pieces, sounds and generators that exist', async () => {
    const names = await file('public/themes/index.json') as string[], shipped = await loadThemes('public/themes', known, file);
    expect(shipped.map((t) => t.id)).toEqual(names);
    for (const t of shipped) {
      expect(t, t.id).toEqual(await file(`public/themes/${t.id}.json`)); // nothing dropped or clamped
      expect(t.pieces.props.length && t.pieces.minis.length && t.pieces.blocks.length, t.id).toBeTruthy();
      expect(t.mood.light && t.mood.grade && t.dice, `${t.id} has a look of its own`).toBeTruthy();
    }
    expect(new Set(shipped.map((t) => JSON.stringify([t.mood.light, t.mood.fog, t.mood.grade, t.dice]))).size).toBe(shipped.length);
  });

  it('offers what it can read and skips the rest', async () => {
    const files: Record<string, unknown> = { 'd/index.json': ['a', '../x', 'gone', 'bad', 7], 'd/a.json': { v: 1, id: 'a', name: 'A' }, 'd/bad.json': { v: 9, id: 'bad', name: 'B' } };
    const get = async (url: string) => { if (!(url in files)) throw new Error(url); return files[url]; };
    expect((await loadThemes('d', known, get)).map((t) => t.id)).toEqual(['a']);
    expect(await loadThemes('nowhere', known, get)).toEqual([]);
  });

  it('reads a theme somebody else wrote, keeping only what it understands', () => {
    const t = parseTheme({
      v: 1, id: 'ada:space', name: '  Space opera  ', icon: '🚀🚀🚀🚀🚀🚀', gen: 'asteroid', extra: { run: 'alert(1)' },
      mood: { sky: 'noon', season: 'winter', glow: 99, amb: 'lasers' },
      pieces: { blocks: ['stone', 'stone', 'moonrock', 7], props: Array(60).fill(0).map((_, i) => Object.keys(PROPS)[i % 40]), minis: 'knight' },
    }, known)!;
    expect(t).toMatchObject({ id: 'ada:space', name: 'Space opera', gen: '', mood: { sky: 'day', season: 'winter', glow: 2, amb: 'off' } });
    expect([...t.icon].length).toBe(4);
    expect(t.pieces.blocks).toEqual(['stone']);
    expect(t.pieces.props.length).toBe(MAX_PIECES);
    expect(new Set(t.pieces.props).size).toBe(MAX_PIECES);
    expect(t.pieces.minis).toEqual([]);
    expect('extra' in t).toBe(false);
  });

  it('refuses what is not a theme, or is from a format it does not know', () => {
    for (const bad of [null, 'pirate', 7, [], {}, { v: 2, id: 'x', name: 'X' }, { v: 1, id: 'Bad Id', name: 'X' }, { v: 1, id: 'x', name: '' }]) expect(parseTheme(bad, known)).toBeNull();
  });

  it('the table carries its whole theme, and a mood is four settings', () => {
    const t = activeTheme({ v: 1, id: 'ada:x', name: 'Mine', mood: { sky: 'night', season: 'winter', glow: 1.75, amb: 'rain' } }, known)!;
    expect(activeTheme(null, known)).toBeNull();
    expect(moodEdits(t)).toEqual([['sky', 'night'], ['season', 'winter'], ['glow', 1.75], ['amb', 'rain']]);
  });

  it('keeps a look only as far as it makes sense: colours as #rrggbb, numbers within bounds', () => {
    const base = { v: 1, id: 'x', name: 'X' };
    const t = parseTheme({
      ...base, dice: { body: '#AA0011', ink: 'red', rough: -3, metal: 9, run: 'x' },
      mood: {
        sky: 'night',
        light: { bg: '#0A0B0C', sun: 'url(x)', sunI: 1e9, hemi: '#12345', hemiI: -1, spill: 0.5, sheen: '1', extra: 1 },
        fog: { color: '#101820', near: 500, far: 3 },
        grade: { sat: 9, warmth: -9, contrast: 0.4, vignette: NaN },
      },
    }, known)!;
    expect(t.mood.light).toEqual({ bg: '#0a0b0c', sunI: 8, hemiI: 0, spill: 0.5 });
    expect(t.mood.fog).toEqual({ color: '#101820', near: 200, far: 201 });
    expect(t.mood.grade).toEqual({ sat: 1.5, warmth: -1, contrast: 0.4 });
    expect(t.dice).toEqual({ body: '#aa0011', rough: 0, metal: 1 });
    // Nothing usable is the same as nothing given: the keys are not there at all.
    const plain = parseTheme({ ...base, dice: 7, mood: { light: { sun: 'blue' }, fog: { color: '#000000', near: 5 }, grade: [] } }, known)!;
    expect(['light', 'fog', 'grade'].some((k) => k in plain.mood) || 'dice' in plain).toBe(false);
  });

  it('a theme lights its own sky; under another only its grade and dice stay', () => {
    const t = parseTheme({ v: 1, id: 'x', name: 'X', dice: { ink: '#ffffff' }, mood: { sky: 'night', light: { sunI: 1 }, fog: { near: 10, far: 50 }, grade: { sat: 0.5 } } }, known)!;
    expect(themeLook(t, 'night')).toEqual({ light: { sunI: 1 }, fog: { near: 10, far: 50 }, grade: { sat: 0.5 }, dice: { ink: '#ffffff' } });
    expect(themeLook(t, 'day')).toEqual({ grade: { sat: 0.5 }, dice: { ink: '#ffffff' } });
    expect(themeLook(null, 'day')).toEqual({});
    expect(themeLook(parseTheme({ v: 1, id: 'x', name: 'X' }, known), 'day')).toEqual({});
  });

  it('keeps pieces from a pack this device has not got, and shelves them when it arrives', () => {
    const raw = { v: 1, id: 'x', name: 'X', pieces: { blocks: ['stone', 'ada:moonrock'], props: ['tree', 'ada:lamp', 'nonsense', 'Ada:Lamp', 'a:b:c'], minis: ['ada:robot'] } };
    const kept = { blocks: ['stone', 'ada:moonrock'], props: ['tree', 'ada:lamp'], minis: ['ada:robot'] };
    expect(parseTheme(raw, known)!.pieces).toEqual(kept);
    expect(activeTheme(raw, known)!.pieces).toEqual({ blocks: ['stone'], props: ['tree'], minis: [] });
    registerPack('ada', { props: { lamp: { name: 'Lamp', icon: '💡', mesh: { geometry: new THREE.BufferGeometry(), material: new THREE.MeshBasicMaterial() } } } });
    expect(activeTheme(raw, known)!.pieces).toEqual({ blocks: ['stone'], props: ['tree', 'ada:lamp'], minis: [] });
    expect(activeTheme(parseTheme(raw, known), known)!.pieces.props).toEqual(['tree', 'ada:lamp']); // what the table carries is the whole list
    unregisterPack('ada');
  });

  it('gives every board its own atmosphere, over the table\'s as the default', () => {
    const s = new Store('gm');
    s.set('set:sky', 'dusk'); // what a table from before boards had atmospheres holds
    s.set('set:theme', { v: 1, id: 'old', name: 'Old' });
    s.set('bd:crypt', { n: 'Crypt' });
    expect([atmo(s, 'sky', 'day'), atmo(s, 'season', 'summer'), atmo(s, 'glow', 1)]).toEqual(['dusk', 'summer', 1]);
    s.setBoard('crypt');
    expect(atmo(s, 'sky', 'day')).toBe('dusk'); // a board nobody has dressed looks like the table
    setAtmo(s, 'sky', 'night');
    setAtmo(s, 'glow', 0);
    setAtmo(s, 'theme', { v: 1, id: 'vampire', name: 'Vampires' });
    expect([atmo(s, 'sky', 'day'), atmo(s, 'glow', 1), activeTheme(atmo(s, 'theme', null), known)?.id]).toEqual(['night', 0, 'vampire']);
    setAtmo(s, 'theme', null); // letting go of the board's theme does not bring the table's back
    expect(activeTheme(atmo(s, 'theme', null), known)).toBeNull();
    s.setBoard('');
    expect([atmo(s, 'sky', 'day'), atmo(s, 'glow', 1), activeTheme(atmo(s, 'theme', null), known)?.id]).toEqual(['dusk', 1, 'old']);
    setAtmo(s, 'sky', 'day');
    expect([s.get('at:sky'), s.get('set:sky'), s.entries.get('@crypt/at:sky')?.v, s.entries.has('@crypt/set:sky')]).toEqual(['day', 'dusk', 'night', false]);
    // Another board's atmosphere changing is not this board's news.
    const seen: string[] = [];
    s.onChange = (k) => seen.push(k);
    s.merge(['@crypt/at:sky', 'dusk', Date.now() + 1e6, 'zz']);
    s.merge(['at:season', 'winter', Date.now() + 1e6, 'zz']);
    expect(seen).toEqual(['at:season']);
  });
});
