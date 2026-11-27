import { describe, expect, it } from 'vitest';
import { blast, fellLine, heading, land, restY, shove } from './forces';
import { ek, type MiniVal } from './rules';
import { Store } from './store';

const mini = (x: number, y: number, z: number, more: Partial<MiniVal> = {}): MiniVal => ({ x, y, z, k: 'knight', c: '#fff', n: '', r: 0, s: 1, ...more });
/** A flat stone floor at level 0 from (x0, z0) to (x1, z1): minis stand on it at y = 1. */
function floor(s: Store, x0: number, x1: number, z0: number, z1: number, y = 0): void {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) s.set(`b:${x},${y},${z}`, { i: 'stone' });
}
const at = (s: Store, id: string) => { const v = s.get<MiniVal>(`m:${id}`)!; return [v.x, v.y, v.z]; };
const apply = (s: Store, edits: [string, unknown][]) => { for (const [k, v] of edits) s.set(k, v); };

describe('falls', () => {
  it('finds the top of the column below', () => {
    const s = new Store('a');
    floor(s, 0, 0, 0, 0);
    s.set('b:0,3,0', { i: 'stone' });
    expect(restY(s, 0, 9, 0)).toBe(4);
    expect(restY(s, 0, 3, 0)).toBe(1);
    expect(restY(s, 5, 7, 5)).toBe(0); // nothing there at all: the bare table
    s.set('b:0,2,0', { i: 'chair' }); // furniture is not ground
    expect(restY(s, 0, 3, 0)).toBe(1);
  });

  it('drops a mini with nothing under it, and a hard fall knocks it down', () => {
    const s = new Store('a');
    floor(s, 0, 2, 0, 0);
    expect(land(s, mini(0, 1, 0))).toEqual({ v: mini(0, 1, 0), fell: 0 });
    expect(land(s, mini(0, 2, 0))).toEqual({ v: mini(0, 1, 0), fell: 1 });
    expect(land(s, mini(0, 5, 0))).toEqual({ v: mini(0, 1, 0, { d: true }), fell: 4 });
  });

  it('leaves flying minis in the air', () => {
    const s = new Store('a');
    const v = mini(0, 5, 0, { e: 2 });
    expect(land(s, v)).toEqual({ v, fell: 0 });
  });

  it('reports a fall at 5 ft to the cell', () => {
    expect(fellLine(mini(0, 0, 0, { n: 'Goblin' }), 4)).toBe('Goblin fell 20 ft');
    expect(fellLine(mini(0, 0, 0), 1)).toBe('Knight fell 5 ft');
  });
});

describe('shove', () => {
  it('moves a mini one cell, straight or cornerwise', () => {
    const s = new Store('a');
    floor(s, 0, 4, 0, 4);
    s.set('m:a', mini(2, 1, 2));
    expect(shove(s, 'a', 1, 0, true)).toEqual({ edits: [['m:a', mini(3, 1, 2)]], falls: [] });
    expect(shove(s, 'a', -1, -1, true)!.edits[0][1]).toEqual(mini(1, 1, 1));
    expect(shove(s, 'a', 0, 0, true)).toBeNull();
    expect(shove(s, 'nobody', 1, 0, true)).toBeNull();
  });

  it('is stopped by blocks, walls and other minis, but not by a doorway', () => {
    const s = new Store('a');
    floor(s, 0, 4, 0, 4);
    s.set('m:a', mini(2, 1, 2));
    s.set('b:3,1,2', { i: 'stone' });
    expect(shove(s, 'a', 1, 0, true)).toBeNull();
    s.set(ek(2, 1, 2, 'w'), { i: 'wall' }); // on the low-x side of the cell
    expect(shove(s, 'a', -1, 0, true)).toBeNull();
    s.set(ek(2, 1, 2, 'w'), { i: 'wallwin' }); // you can see through a window, not walk through it
    expect(shove(s, 'a', -1, 0, true)).toBeNull();
    s.set(ek(2, 1, 2, 'w'), { i: 'walldoor' });
    expect(shove(s, 'a', -1, 0, true)).not.toBeNull();
    s.set('m:b', mini(2, 1, 3));
    expect(shove(s, 'a', 0, 1, true)).toBeNull();
    s.set(ek(2, 1, 2, 'n'), { i: 'wall' });
    expect(shove(s, 'a', 0, -1, true)).toBeNull();
    // Cornerwise: the block on one side leaves the other way round open, until that is walled too.
    s.set(ek(2, 1, 2, 'n'), null);
    expect(shove(s, 'a', 1, -1, true)).not.toBeNull();
    s.set(ek(2, 1, 2, 'n'), { i: 'wall' });
    expect(shove(s, 'a', 1, -1, true)).toBeNull();
  });

  it('falls off an edge and is knocked down by a long drop', () => {
    const s = new Store('a');
    floor(s, 0, 4, 0, 0);
    for (let y = 1; y <= 4; y++) s.set(`b:0,${y},0`, { i: 'stone' });
    s.set('b:1,1,0', { i: 'stone' });
    s.set('m:a', mini(0, 5, 0, { n: 'Goblin' }));
    expect(shove(s, 'a', 1, 0, true)).toEqual({ edits: [['m:a', mini(1, 2, 0, { n: 'Goblin', d: true })]], falls: [{ id: 'a', cells: 3 }] });
    s.set('m:a', mini(1, 2, 0));
    expect(shove(s, 'a', 1, 0, true)).toEqual({ edits: [['m:a', mini(2, 1, 0)]], falls: [{ id: 'a', cells: 1 }] });
    // It cannot be pushed up a step, or off onto someone standing below.
    expect(shove(s, 'a', -1, 0, true)).toBeNull();
    s.set('m:a', mini(1, 2, 0));
    s.set('m:b', mini(2, 1, 0));
    expect(shove(s, 'a', 1, 0, true)).toBeNull();
  });

  it('carries a flyer over a drop at the height it was', () => {
    const s = new Store('a');
    floor(s, 0, 2, 0, 0);
    s.set('b:0,1,0', { i: 'stone' });
    s.set('m:a', mini(0, 2, 0, { e: 2 }));
    expect(shove(s, 'a', 1, 0, true)).toEqual({ edits: [['m:a', mini(1, 1, 0, { e: 3 })]], falls: [] });
  });

  it('keeps hidden minis and fog secret from players', () => {
    const s = new Store('a');
    floor(s, 0, 4, 0, 4);
    s.set('m:a', mini(2, 1, 2));
    s.set('m:spy', mini(3, 1, 2, { h: true }));
    expect(shove(s, 'a', 1, 0, true)).toBeNull(); // the GM knows it is there
    expect(shove(s, 'a', 1, 0, false)).not.toBeNull(); // a player's shove must not feel it
    expect(shove(s, 'spy', 1, 0, false)).toBeNull();
    s.set('f:1,2', true);
    expect(shove(s, 'a', -1, 0, false)).toBeNull();
    expect(shove(s, 'a', -1, 0, true)).not.toBeNull();
  });
});

describe('blast', () => {
  it('throws everyone outward, further the closer they stood', () => {
    const s = new Store('a');
    floor(s, -8, 8, -8, 8);
    s.set('m:near', mini(1, 1, 0));
    s.set('m:mid', mini(0, 1, 2));
    s.set('m:edge', mini(-3, 1, 0));
    s.set('m:out', mini(5, 1, 0));
    s.set('m:mid2', mini(0, 1, -2, { d: true }));
    const r = blast(s, [0, 1, 0], 3, true);
    apply(s, r.edits);
    expect(at(s, 'near')).toEqual([4, 1, 0]); // 3 - 1 + 1 cells
    expect(s.get<MiniVal>('m:near')!.d).toBe(true); // next to the centre: down it goes
    expect(at(s, 'mid')).toEqual([0, 1, 4]);
    expect(s.get<MiniVal>('m:mid')!.d).toBeUndefined();
    expect(at(s, 'edge')).toEqual([-4, 1, 0]);
    expect(at(s, 'out')).toEqual([5, 1, 0]); // out of range: untouched
    expect(r.edits.map(([k]) => k).sort()).toEqual(['m:edge', 'm:mid', 'm:mid2', 'm:near']);
    expect(r.falls).toEqual([]);
  });

  it('stops near at the mini that was out of range', () => {
    const s = new Store('a');
    floor(s, -8, 8, -8, 8);
    s.set('m:near', mini(1, 1, 0));
    s.set('m:out', mini(3, 1, 0));
    apply(s, blast(s, [0, 1, 0], 2, true).edits);
    expect(at(s, 'near')).toEqual([2, 1, 0]);
    expect(at(s, 'out')).toEqual([3, 1, 0]);
  });

  it('knocks down whoever stands on the centre without moving them', () => {
    const s = new Store('a');
    floor(s, -2, 2, -2, 2);
    s.set('m:a', mini(0, 1, 0));
    expect(blast(s, [0, 1, 0], 2, true).edits).toEqual([['m:a', mini(0, 1, 0, { d: true })]]);
  });

  it('caps the push, stops at walls and drops minis off ledges', () => {
    const s = new Store('a');
    floor(s, -8, 3, -8, 8, 0);
    floor(s, -8, 3, -8, 8, 1);
    floor(s, -8, 3, -8, 8, 2); // a plateau three high that ends after x = 3
    floor(s, 4, 9, -8, 8, 0);
    s.set('m:a', mini(2, 3, 0));
    s.set('m:b', mini(0, 3, 2));
    s.set(ek(0, 3, 4, 'n'), { i: 'wall' });
    const r = blast(s, [0, 3, 0], 4, true);
    apply(s, r.edits);
    expect(at(s, 'a')).toEqual([4, 1, 0]); // over the edge after two cells, and no further
    expect(s.get<MiniVal>('m:a')!.d).toBe(true);
    expect(r.falls).toEqual([{ id: 'a', cells: 2 }]);
    expect(at(s, 'b')).toEqual([0, 3, 3]); // the wall on the far side of z = 3 holds
    for (const [, v] of r.edits) for (const n of [(v as MiniVal).x, (v as MiniVal).y, (v as MiniVal).z]) expect(Number.isInteger(n)).toBe(true);
  });

  it('moves minis in a line without stacking them', () => {
    const s = new Store('a');
    floor(s, -8, 8, -8, 8);
    s.set('m:a', mini(1, 1, 0));
    s.set('m:b', mini(2, 1, 0));
    s.set('b:5,1,0', { i: 'stone' });
    apply(s, blast(s, [0, 1, 0], 4, true).edits);
    expect(at(s, 'b')).toEqual([4, 1, 0]);
    expect(at(s, 'a')).toEqual([3, 1, 0]);
  });

  it('leaves hidden minis alone unless the GM set it off, and ignores other floors', () => {
    const s = new Store('a');
    floor(s, -8, 8, -8, 8);
    s.set('m:spy', mini(1, 1, 0, { h: true }));
    s.set('m:roof', mini(1, 9, 0, { e: 1 }));
    expect(blast(s, [0, 1, 0], 2, false).edits).toEqual([]);
    expect(blast(s, [0, 1, 0], 2, true).edits.map(([k]) => k)).toEqual(['m:spy']);
  });
});

describe('heading', () => {
  it('reads one of eight ways from a tap', () => {
    expect(heading(2, 2, 2.6, 2.4)).toBeNull();
    expect(heading(2, 2, 5.5, 2.5)).toEqual([1, 0]);
    expect(heading(2, 2, 2.5, -3)).toEqual([0, -1]);
    expect(heading(2, 2, 0.5, 4.5)).toEqual([-1, 1]);
    expect(heading(2, 2, -4, 2.2)).toEqual([-1, 0]);
  });
});
