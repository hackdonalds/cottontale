import { describe, expect, it } from 'vitest';
import { AREA_MAX, areaKeys, boundsOf, copyEdits, kindOf, moveEdits, removeEdits, turnAreaEdits, turnEdits } from './pick';
import type { MiniVal } from './rules';
import { Store } from './store';

const mini = (x: number, y: number, z: number, more: Partial<MiniVal> = {}): MiniVal => ({ x, y, z, k: 'knight', c: '#fff', n: '', r: 0, s: 1, ...more });
const apply = (s: Store, edits: [string, unknown][]) => { for (const [k, v] of edits) s.set(k, v); };
function table(): Store {
  const s = new Store('a');
  for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) s.set(`b:${x},0,${z}`, { i: 'stone' });
  return s;
}

describe('a selection of pieces', () => {
  it('knows what a key names', () => {
    expect([kindOf('b:0,0,0'), kindOf('w:0,1,0,n'), kindOf('l:abc'), kindOf('m:abc'), kindOf('set:los')]).toEqual(['cell', 'wall', 'loose', 'mini', null]);
  });

  it('moves a prop to a free cell and leaves nothing behind', () => {
    const s = table();
    s.set('b:1,1,1', { i: 'barrel', r: 2 });
    const out = moveEdits(s, ['b:1,1,1'], [2, 0, 1])!;
    apply(s, out.edits);
    expect(out.keys).toEqual(['b:3,1,2']);
    expect(s.get('b:1,1,1')).toBeNull();
    expect(s.get('b:3,1,2')).toEqual({ i: 'barrel', r: 2 });
  });

  it('refuses a move onto another piece or off the table', () => {
    const s = table();
    s.set('b:1,1,1', { i: 'barrel' });
    s.set('b:2,1,1', { i: 'crate' });
    expect(moveEdits(s, ['b:1,1,1'], [1, 0, 0])).toBeNull();
    expect(moveEdits(s, ['b:1,1,1'], [0, -2, 0])).toBeNull();
    expect(moveEdits(s, ['b:1,1,1'], [200, 0, 0])).toBeNull();
    expect(moveEdits(s, ['b:9,9,9'], [1, 0, 0])).toBeNull(); // nothing there
  });

  it('moves several pieces together, through each other', () => {
    const s = table();
    s.set('b:1,1,1', { i: 'barrel' });
    s.set('b:2,1,1', { i: 'crate' });
    s.set('w:1,1,1,n', { i: 'wall' });
    const out = moveEdits(s, ['b:1,1,1', 'b:2,1,1', 'w:1,1,1,n'], [1, 0, 0])!;
    apply(s, out.edits);
    expect(out.keys).toEqual(['b:2,1,1', 'b:3,1,1', 'w:2,1,1,n']);
    expect([s.get('b:1,1,1'), s.get('w:1,1,1,n')]).toEqual([null, null]);
    expect(s.get('b:2,1,1')).toEqual({ i: 'barrel' });
    expect(s.get('b:3,1,1')).toEqual({ i: 'crate' });
    expect(s.get('w:2,1,1,n')).toEqual({ i: 'wall' });
  });

  it('moves minis and loose pieces by value, and keeps a mini out of the ground', () => {
    const s = table();
    s.set('m:a', mini(0, 1, 0, { hp: 5 }));
    s.set('l:x', { i: 'stone', p: [50, 100, 50], q: [0, 0, 0, 1000] });
    const out = moveEdits(s, ['m:a', 'l:x'], [2, 0, 1])!;
    apply(s, out.edits);
    expect(s.get('m:a')).toEqual(mini(2, 1, 1, { hp: 5 }));
    expect(s.get<{ p: number[] }>('l:x')!.p).toEqual([250, 100, 150]);
    expect(moveEdits(s, ['m:a'], [0, -1, 0])).toBeNull(); // into the floor
  });

  it('turns props a quarter, minis an eighth and a wall onto the other side', () => {
    const s = table();
    s.set('b:1,1,1', { i: 'chair', r: 3 });
    s.set('m:a', mini(0, 1, 0, { r: 7 }));
    s.set('w:1,1,1,n', { i: 'wall' });
    const out = turnEdits(s, ['b:1,1,1', 'm:a', 'w:1,1,1,n'])!;
    apply(s, out.edits);
    expect(s.get('b:1,1,1')).toEqual({ i: 'chair' });
    expect(s.get<MiniVal>('m:a')!.r).toBe(0);
    expect(s.get('w:1,1,1,n')).toBeNull();
    expect(s.get('w:1,1,1,w')).toEqual({ i: 'wall' });
    expect(out.keys).toEqual(['b:1,1,1', 'm:a', 'w:1,1,1,w']);
    expect(turnEdits(s, ['b:0,0,0'])).toBeNull(); // a block has no facing
  });

  it('copies onto the nearest free spot, with new ids for minis', () => {
    const s = table();
    s.set('b:1,1,1', { i: 'barrel' });
    s.set('b:2,1,1', { i: 'crate' }); // in the way of the first try
    const out = copyEdits(s, ['b:1,1,1'], () => 'n1')!;
    expect(out.keys).toEqual(['b:1,1,2']);
    expect(out.edits).toEqual([['b:1,1,2', { i: 'barrel' }]]);
    s.set('m:a', mini(0, 1, 0, { ini: 12, hp: 3 }));
    const twin = copyEdits(s, ['m:a'], () => 'n2')!;
    expect(twin.keys).toEqual(['m:n2']);
    expect(twin.edits[0][1]).toEqual(mini(1, 1, 0, { hp: 3 })); // beside it, and not in the fight
  });

  it('removes what is there and measures it', () => {
    const s = table();
    s.set('b:1,1,1', { i: 'barrel' });
    s.set('m:a', mini(3, 1, 2));
    expect(boundsOf(s, ['b:1,1,1', 'm:a', 'b:9,9,9'])).toEqual({ min: [1, 1, 1], max: [3, 1, 2] });
    expect(removeEdits(s, ['b:1,1,1', 'm:a', 'b:9,9,9'])!.edits).toEqual([['b:1,1,1', null], ['m:a', null]]);
    expect(removeEdits(s, ['b:9,9,9'])).toBeNull();
  });

  describe('an area', () => {
    /** A camp on the stone: a barrel and a turned chair, a wall on each low side of the barrel's cell, a figure and a coin. */
    function camp(): { s: Store; keys: string[] } {
      const s = table();
      s.set('b:1,1,1', { i: 'barrel' });
      s.set('b:2,1,2', { i: 'chair', r: 3 });
      s.set('w:1,1,1,n', { i: 'wall' });
      s.set('w:1,1,1,w', { i: 'window' });
      s.set('m:a', mini(2, 1, 1, { r: 7 }));
      s.set('l:x', { i: 'stone', p: [130, 100, 260], q: [0, 0, 0, 1000] });
      return { s, keys: ['b:1,1,1', 'b:2,1,2', 'w:1,1,1,n', 'w:1,1,1,w', 'm:a', 'l:x'] };
    }
    const dump = (s: Store) => JSON.stringify(['b:', 'w:', 'l:', 'm:'].flatMap((p) => [...s.keys(p)].sort().map((k) => [k, s.get(k)])));

    it('is found by its columns, from a level up, and is never more than a selection holds', () => {
      const { s, keys } = camp();
      expect(areaKeys(s, 1, 2, 1, 2, 1)!.sort()).toEqual([...keys].sort());
      expect(areaKeys(s, 1, 1, 1, 1, 1)!.sort()).toEqual(['b:1,1,1', 'w:1,1,1,n', 'w:1,1,1,w']); // a wall belongs to the cell it is a side of
      expect(areaKeys(s, 1, 2, 1, 2, 0)).toHaveLength(keys.length + 4); // with the ground under it
      expect(areaKeys(s, 1, 2, 1, 2, 1, (_x, y) => y >= 1)).toEqual([]); // above the cutaway
      expect(areaKeys(s, 3, 3, 3, 3, 1)).toEqual([]);
      const big = new Store('a');
      for (let i = 0; i <= AREA_MAX; i++) big.set(`b:${i % 90},${1 + Math.floor(i / 8100)},${Math.floor(i / 90) % 90}`, { i: 'stone' });
      expect(areaKeys(big, 0, 89, 0, 89, 0)).toBeNull();
    });

    it('is copied beside itself, clear of the original', () => {
      const { s, keys } = camp();
      let n = 0;
      const out = copyEdits(s, keys, () => `n${n++}`)!;
      apply(s, out.edits);
      expect(out.keys).toEqual(['b:3,1,1', 'b:4,1,2', 'w:3,1,1,n', 'w:3,1,1,w', 'm:n0', 'l:n1']); // two cells wide: two cells over
      expect(s.get<MiniVal>('m:n0')).toEqual(mini(4, 0, 1, { r: 7 })); // (off the stone, it comes to rest on the bare table)
      expect(s.get<{ p: number[] }>('l:n1')!.p).toEqual([330, 100, 260]);
      for (const k of keys) expect(s.get(k)).not.toBeNull();
      // With something in the way on that side, the copy goes to the next side: still a whole footprint away.
      const t = camp();
      t.s.set('b:4,1,2', { i: 'crate' });
      expect(copyEdits(t.s, t.keys, () => `n${n++}`)!.keys.slice(0, 2)).toEqual(['b:1,1,3', 'b:2,1,4']);
    });

    it('keeps a figure on the floor that is copied with it', () => {
      const s = table();
      s.set('b:1,1,1', { i: 'stone' });
      s.set('m:a', mini(1, 2, 1));
      const out = copyEdits(s, ['b:1,1,1', 'm:a'], () => 'n')!;
      expect(out.edits).toEqual([['b:2,1,1', { i: 'stone' }], ['m:n', mini(2, 2, 1)]]);
    });

    it('turns a quarter about its middle: cells go round, props and figures turn with them, walls change side', () => {
      const { s, keys } = camp();
      const out = turnAreaEdits(s, keys)!;
      apply(s, out.edits);
      // A 2 × 2 footprint at (1,1): (x, z) goes to (1 + z - 1, 1 + 1 - (x - 1)).
      expect(s.get('b:1,1,2')).toEqual({ i: 'barrel', r: 1 });
      expect(s.get('b:2,1,1')).toEqual({ i: 'chair' }); // r 3 + 1
      expect(s.get('w:1,1,2,w')).toEqual({ i: 'wall' }); // its low-z side is now the low-x side
      expect(s.get('w:1,1,3,n')).toEqual({ i: 'window' }); // its low-x side is now the far side: the low-z side of the cell after
      expect(s.get<MiniVal>('m:a')).toEqual(mini(1, 1, 1, { r: 1 }));
      expect(s.get('l:x')).toEqual({ i: 'stone', p: [260, 100, 270], q: [0, 707, 0, 707] });
      expect([s.get('b:1,1,1'), s.get('b:2,1,2'), s.get('w:1,1,1,n'), s.get('w:1,1,1,w')]).toEqual([null, null, null, null]);
      expect(out.keys).toEqual(['b:1,1,2', 'b:2,1,1', 'w:1,1,2,w', 'w:1,1,3,n', 'm:a', 'l:x']);
    });

    it('comes back to where it began after four turns', () => {
      const s = table();
      s.set('b:0,1,1', { i: 'barrel', r: 1 });
      s.set('b:2,1,1', { i: 'stone' });
      s.set('w:1,1,1,w', { i: 'wall' });
      s.set('m:a', mini(1, 1, 1, { r: 3 }));
      const before = dump(s);
      let keys = ['b:0,1,1', 'b:2,1,1', 'w:1,1,1,w', 'm:a'];
      for (let i = 0; i < 4; i++) {
        const out = turnAreaEdits(s, keys)!;
        apply(s, out.edits);
        keys = out.keys;
        if (i === 0) expect(keys).toEqual(['b:1,1,2', 'b:1,1,0', 'w:1,1,2,n', 'm:a']); // three in a row along x now stand along z, about the same middle
      }
      expect(dump(s)).toBe(before);
    });

    it('will not turn onto pieces outside the selection, or off the table', () => {
      const s = table();
      s.set('b:0,1,1', { i: 'barrel' });
      s.set('b:2,1,1', { i: 'crate' });
      s.set('b:1,1,0', { i: 'rock' }); // where the end of the row would come round to
      expect(turnAreaEdits(s, ['b:0,1,1', 'b:2,1,1'])).toBeNull();
      expect(turnAreaEdits(s, ['b:0,1,1', 'b:2,1,1', 'b:1,1,0'])).not.toBeNull(); // unless it turns with them
      s.set('b:1,1,0', null);
      s.set('m:a', mini(0, 1, 1));
      s.set('b:0,1,1', null);
      s.set('b:1,1,2', { i: 'stone' }); // a block where the figure would come to stand
      expect(turnAreaEdits(s, ['m:a', 'b:2,1,1'])).toBeNull();
      const edge = new Store('a');
      edge.set('b:95,0,0', { i: 'stone' });
      edge.set('b:95,0,6', { i: 'stone' });
      expect(turnAreaEdits(edge, ['b:95,0,0', 'b:95,0,6'])).toBeNull();
      expect(turnAreaEdits(edge, ['b:9,9,9'])).toBeNull();
    });
  });
});
