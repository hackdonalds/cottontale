import { describe, expect, it } from 'vitest';
import { boundsOf, copyEdits, kindOf, moveEdits, removeEdits, turnEdits } from './pick';
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
});
