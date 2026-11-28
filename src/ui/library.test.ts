import { describe, expect, it } from 'vitest';
import { MAX_HOTBAR, hotbarKeys, steady } from './library';

describe('what the hotbar shows (ui/library.ts)', () => {
  const all = () => true;

  it('puts pinned pieces first, in their order, then the recent ones', () => {
    expect(hotbarKeys(['p_barrel', 'm_knight'], ['b_grass', 'p_crate'], all)).toEqual(['p_barrel', 'm_knight', 'b_grass', 'p_crate']);
    expect(hotbarKeys([], ['b_grass'], all)).toEqual(['b_grass']);
    expect(hotbarKeys(['p_barrel'], [], all)).toEqual(['p_barrel']);
    expect(hotbarKeys([], [], all)).toEqual([]);
  });

  it('shows a piece once, where its pin is', () => {
    expect(hotbarKeys(['p_barrel', 'm_knight'], ['m_knight', 'b_grass', 'p_barrel'], all)).toEqual(['p_barrel', 'm_knight', 'b_grass']);
    expect(hotbarKeys(['p_barrel', 'p_barrel'], ['b_grass', 'b_grass'], all)).toEqual(['p_barrel', 'b_grass']);
  });

  it('leaves out pieces this table does not have', () => {
    const has = (k: string) => !k.includes(':');
    expect(hotbarKeys(['p_ada:throne', 'p_barrel'], ['m_ada:ogre', 'b_grass'], has)).toEqual(['p_barrel', 'b_grass']);
    expect(hotbarKeys(['p_ada:throne'], ['m_ada:ogre'], has)).toEqual([]);
  });

  it('holds only so many, and never lets pins push out what was just used', () => {
    const favs = Array.from({ length: 30 }, (_, i) => `p_fav${i}`), recents = ['b_one', 'b_two', 'b_three'];
    const row = hotbarKeys(favs, recents, all);
    expect(row).toHaveLength(MAX_HOTBAR);
    expect(row.slice(0, MAX_HOTBAR - 2)).toEqual(favs.slice(0, MAX_HOTBAR - 2));
    expect(row.slice(-2)).toEqual(['b_one', 'b_two']);
    // With nothing recent beside the pins, the pins have the whole row.
    expect(hotbarKeys(favs, favs.slice(0, 3), all)).toEqual(favs.slice(0, MAX_HOTBAR));
    expect(hotbarKeys(favs, ['b_one'], all).slice(-2)).toEqual([`p_fav${MAX_HOTBAR - 2}`, 'b_one']);
    expect(hotbarKeys([], Array.from({ length: 12 }, (_, i) => `b_r${i}`), all)).toHaveLength(MAX_HOTBAR);
    expect(hotbarKeys(favs, recents, all, 4)).toEqual(['p_fav0', 'p_fav1', 'b_one', 'b_two']);
  });

  it('keeps the row in its order while it holds the same pieces', () => {
    const prev = ['p_barrel', 'b_grass', 'p_crate'];
    expect(steady(prev, ['p_barrel', 'p_crate', 'b_grass'])).toBe(prev); // a piece taken from the row became the most recent: nothing moves
    expect(steady(prev, ['p_barrel', 'p_crate', 'm_knight'])).toEqual(['p_barrel', 'p_crate', 'm_knight']);
    expect(steady(prev, ['p_barrel', 'b_grass'])).toEqual(['p_barrel', 'b_grass']);
    expect(steady([], ['b_grass'])).toEqual(['b_grass']);
  });
});
