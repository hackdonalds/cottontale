import { describe, expect, it } from 'vitest';
import { moveInOrder, nextTurn, turnOrder, type MiniVal } from './rules';
import { Store } from './store';

const mini = (more: Partial<MiniVal> = {}): MiniVal => ({ x: 0, y: 1, z: 0, k: 'knight', c: '#fff', n: '', r: 0, s: 1, ...more });
const table = (inis: Record<string, number | undefined>): Store => {
  const s = new Store('gm');
  for (const [id, ini] of Object.entries(inis)) s.set(`m:${id}`, mini(ini === undefined ? {} : { ini }));
  return s;
};
const ids = (s: Store) => turnOrder(s).map((o) => o.id).join('');
/** Move, write the edits, and say what the order is now and who was written. */
const move = (s: Store, id: string, to: number) => {
  const edits = moveInOrder(s, id, to);
  for (const [k, v] of edits) s.set(k, v);
  return { order: ids(s), wrote: edits.map(([k]) => k.slice(2)).sort().join('') };
};

describe('the turn order, rearranged by hand', () => {
  it('reads old tables as before: by initiative, ties by id', () => {
    const s = table({ c: 10, a: 10, b: 18, d: undefined, e: 3 });
    expect(ids(s)).toBe('bace');
    s.set('m:f', mini({ ini: 10, io: 'x' as unknown as number })); // junk from a stranger counts as none
    expect(ids(s)).toBe('bacfe');
  });

  it('moves one mini to every place of every order, changing nobody else\'s score', () => {
    const tables: Record<string, number>[] = [{ a: 20, b: 15, c: 10, d: 5 }, { a: 10, b: 10, c: 10, d: 10 }, { a: 12, b: 11, c: 11, d: 10 }, { d: 20, c: 20, b: 7, a: 7 }];
    for (const inis of tables) {
      const start = ids(table(inis));
      for (const id of start) for (let to = 0; to < start.length; to++) {
        const s = table(inis), rest = start.replace(id, '');
        const { order, wrote } = move(s, id, to);
        expect(order, `${id} to ${to} in ${start}`).toBe(rest.slice(0, to) + id + rest.slice(to));
        for (const o of turnOrder(s)) if (o.id !== id) expect(o.v.ini).toBe(inis[o.id]);
        if (to === start.indexOf(id)) expect(wrote).toBe('');
      }
    }
  });

  it('pulls the score only as far as the neighbour it passed, and spells out a tie only when id order would not do', () => {
    const s = table({ a: 20, b: 15, c: 10, d: 5 });
    expect(move(s, 'd', 1)).toEqual({ order: 'adbc', wrote: 'bd' }); // between a (20) and b (15): takes 15, ahead of b
    expect(s.get<MiniVal>('m:d')).toEqual(mini({ ini: 15 }));
    expect(s.get<MiniVal>('m:b')).toEqual(mini({ ini: 15, io: 1 }));

    const t = table({ a: 20, b: 15, c: 10, d: 5 });
    expect(move(t, 'a', 1)).toEqual({ order: 'bacd', wrote: 'a' });
    expect(t.get<MiniVal>('m:a')).toEqual(mini({ ini: 15, io: 1 })); // b stays as it was: no io means first

    const w = table({ a: 20, c: 15, b: 10 });
    expect(move(w, 'b', 1)).toEqual({ order: 'abc', wrote: 'b' });
    expect(w.get<MiniVal>('m:b')).toEqual(mini({ ini: 15 })); // ahead of c by id already: no io at all

    const u = table({ a: 20, b: 15, c: 10, d: 5 });
    u.set('m:b', mini({ ini: 12 }));
    expect(move(u, 'd', 2)).toEqual({ order: 'abdc', wrote: 'cd' }); // 12 ≥ 10 ≥ 10: takes c's score
    const v = table({ a: 20, b: 10, c: 14 });
    expect(move(v, 'c', 1)).toEqual({ order: 'acb', wrote: '' }); // already there
  });

  it('keeps a score that already fits its new place', () => {
    const s = table({ a: 20, b: 20, c: 10, d: 10 });
    move(s, 'b', 0);
    expect(ids(s)).toBe('bacd');
    expect(s.get<MiniVal>('m:b')!.ini).toBe(20);
    expect(s.get<MiniVal>('m:c')).toEqual(mini({ ini: 10 }));
  });

  it('survives many moves, and a typed score still wins', () => {
    const s = table({ a: 10, b: 10, c: 10, d: 10, e: 10 });
    let want = 'abcde';
    const steps: [string, number][] = [['e', 0], ['a', 4], ['c', 1], ['b', 3], ['e', 2], ['d', 0], ['a', 0], ['c', 4]];
    for (const [id, to] of steps) {
      const rest = want.replace(id, '');
      want = rest.slice(0, to) + id + rest.slice(to);
      expect(move(s, id, to).order).toBe(want);
    }
    for (const o of turnOrder(s)) expect(Number.isInteger(o.v.io ?? 0)).toBe(true);
    s.set('m:c', { ...s.get<MiniVal>('m:c')!, ini: 30 });
    expect(ids(s)[0]).toBe('c');
  });

  it('leaves the turn with whoever has it', () => {
    const s = table({ a: 20, b: 15, c: 10 });
    s.set('turn', { id: 'b', round: 2 });
    move(s, 'c', 0);
    expect(ids(s)).toBe('cab');
    expect(nextTurn(s)).toEqual({ id: 'c', round: 3 }); // b is last now
  });

  it('does nothing for a mini outside the fight or a place that is none', () => {
    const s = table({ a: 20, b: 15, x: undefined });
    expect(moveInOrder(s, 'x', 0)).toEqual([]);
    expect(moveInOrder(s, 'nobody', 0)).toEqual([]);
    expect(moveInOrder(s, 'a', NaN)).toEqual([]);
    expect(move(s, 'a', 99).order).toBe('ba'); // past the end is the end
    expect(move(s, 'a', -5).order).toBe('ab');
  });
});
