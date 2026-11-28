import { describe, expect, it } from 'vitest';
import { REGION_MAX, ek, playerEyes, regions, roomEdges, shownToPlayers, type MiniVal } from './rules';
import { Store } from './store';

/** A floor of `id` under level `y`, from (x0, z0) to (x1, z1). */
function floor(s: Store, x0: number, x1: number, z0: number, z1: number, y = 1, id = 'wood'): void {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) s.set(`b:${x},${y - 1},${z}`, { i: id });
}
const sorted = (cells: [number, number][] | null) => cells && cells.map(([x, z]) => `${x},${z}`).sort();
const mini = (x: number, z: number, more: Partial<MiniVal> = {}): MiniVal => ({ x, y: 1, z, k: 'knight', c: '#fff', n: '', r: 0, s: 1, ...more });

describe('regions (fog by the room)', () => {
  it('fills a closed room and stops at its walls', () => {
    const s = new Store('gm');
    floor(s, -10, 10, -10, 10);
    for (const x of [0, 1, 2]) { s.set(ek(x, 1, 0, 'n'), { i: 'wall' }); s.set(ek(x, 1, 2, 'n'), { i: 'wallwood' }); }
    for (const z of [0, 1]) { s.set(ek(0, 1, z, 'w'), { i: 'wall' }); s.set(ek(3, 1, z, 'w'), { i: 'wall' }); }
    expect(sorted(regions(s, 1, 1, 1))).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1']);
    expect(sorted(regions(s, 2, 1, 0))).toEqual(sorted(regions(s, 0, 1, 1))); // wherever in the room the finger lands
    expect(regions(s, 3, 1, 0)).toBeNull(); // just outside it: open ground
  });

  it('ends a room at its doorway and windows: walls of every kind bound it', () => {
    const s = new Store('gm');
    floor(s, -10, 10, -10, 10);
    for (const [k, piece] of roomEdges(-4, 0, -4, -1, 1, false)) s.set(k, { i: piece });
    expect([...s.keys('w:')].map((k) => s.get<{ i: string }>(k)!.i)).toEqual(expect.arrayContaining(['walldoor', 'wallwin', 'wall']));
    const room = regions(s, -2, 1, -2)!;
    expect(room.length).toBe(20);
    expect(room.every(([x, z]) => x >= -4 && x <= 0 && z >= -4 && z <= -1)).toBe(true);
    s.set('b:-3,1,-3', { i: 'table' }); // furniture does not divide a room, nor is it left out of it
    expect(regions(s, -2, 1, -2)!.length).toBe(20);
    expect(regions(s, -3, 1, -3)!.length).toBe(20);
    s.set(ek(-2, 1, 0, 'n'), null); // the doorway taken out: the room runs into the open
    expect(regions(s, -2, 1, -2)).toBeNull();
  });

  it('is bounded by solid blocks at its level', () => {
    const s = new Store('gm');
    floor(s, 0, 4, 0, 4, 1, 'stone');
    for (let i = 0; i <= 4; i++) s.set(`b:2,1,${i}`, { i: 'stone' }); // a wall of blocks down the middle
    expect(sorted(regions(s, 0, 1, 0))).toEqual(['0,0', '0,1', '0,2', '0,3', '0,4', '1,0', '1,1', '1,2', '1,3', '1,4']);
    expect(regions(s, 2, 1, 2)).toBeNull(); // inside a block there is no room
    s.set('b:2,1,2', null);
    expect(regions(s, 0, 1, 0)!.length).toBe(21); // a gap in it joins the two halves
  });

  it('gives up on open ground instead of flooding the table', () => {
    const s = new Store('gm');
    expect(regions(s, 0, 0, 0)).toBeNull(); // the bare table
    floor(s, 0, 19, 0, 19);
    expect(regions(s, 5, 1, 5)!.length).toBe(REGION_MAX); // a platform of exactly the cap is still one region
    floor(s, 20, 20, 0, 0);
    expect(regions(s, 5, 1, 5)).toBeNull();
    expect(regions(s, 5, 1, 5, 500)!.length).toBe(401);
    expect(regions(s, 5, 1, 5, 10)).toBeNull();
  });

  it('keeps to the level it was asked about', () => {
    const s = new Store('gm');
    floor(s, 0, 5, 0, 5);
    floor(s, 0, 1, 0, 1, 2); // a dais of four cells, one level up
    expect(regions(s, 0, 2, 0)!.length).toBe(4); // on top of it: where the floor ends, so does the region
    expect(regions(s, 3, 1, 3)!.length).toBe(32); // around it, at its foot
    expect(regions(s, 3, 2, 3)).toBeNull(); // in the air above the lower floor
    for (const [k, piece] of roomEdges(0, 1, 0, 1, 2, true)) s.set(k, { i: piece }); // walls up there do nothing down here
    expect(regions(s, 3, 1, 3)!.length).toBe(32);
    expect(regions(s, 0.5, 1, 3)).toBeNull(); // whole numbers only
  });
});

describe('see as players', () => {
  it('shows what the players between them see, never the GM\'s secrets', () => {
    const s = new Store('gm');
    s.set('gm:gm', true);
    const hero = mini(0, 0, { o: 'kid' }), goblin = mini(5, 0), lurker = mini(1, 0, { h: true });
    s.set('m:hero', hero);
    expect(playerEyes(s)).toBeNull(); // line of sight is off
    expect(shownToPlayers(s, lurker, null)).toBe('no');
    expect(shownToPlayers(s, goblin, null)).toBe('yes');
    s.set('f:5,0', true);
    expect(shownToPlayers(s, goblin, null)).toBe('no');
    expect(shownToPlayers(s, { ...hero, x: 5 }, null)).toBe('yes'); // their own figure, even under fog
    s.set('f:5,0', null);
    s.set('set:los', true);
    expect(playerEyes(s)).toEqual([hero]);
    expect(shownToPlayers(s, goblin, playerEyes(s))).toBe('yes');
    for (let y = 1; y < 4; y++) s.set(`b:3,${y},0`, { i: 'stone' });
    expect(shownToPlayers(s, goblin, playerEyes(s))).toBe('no'); // behind a pillar
  });
});
