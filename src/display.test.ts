import { describe, expect, it } from 'vitest';
import { readView } from './glide';
import { qr } from './qr';
import { PARTY, canControl, eyesOf, fullPowers, miniShown, type MiniVal } from './rules';
import { Store } from './store';

describe('the table screen', () => {
  const mini = (x: number, z: number, extra: Partial<MiniVal> = {}): MiniVal => ({ x, y: 0, z, k: 'knight', c: '#fff', n: '', r: 0, s: 1, ...extra });

  it('never has powers, not even in free play', () => {
    const s = new Store('gm');
    expect(fullPowers(s, 'kid')).toBe(true);
    expect(fullPowers(s, PARTY)).toBe(false);
    expect(canControl(s, PARTY, mini(0, 0))).toBe(false);
    s.set(`gm:${PARTY}`, true); // somebody writes the seat in as a GM: still not
    expect(fullPowers(s, PARTY)).toBe(false);
    expect(miniShown(s, PARTY, mini(0, 0, { h: true }), null)).toBe('no');
  });

  it('sees what any player-owned mini sees, and nothing the players do not', () => {
    const s = new Store('gm');
    s.set('gm:gm', true);
    const ann = mini(0, 0, { o: 'ann' }), bob = mini(0, 6, { o: 'bob' }), anyone = mini(0, 1, { o: '*' });
    const goblin = mini(4, 0), wolf = mini(4, 6), lurker = mini(1, 1, { h: true }), npc = mini(-3, 0, { o: 'gm' });
    for (const [id, v] of Object.entries({ ann, bob, anyone, goblin, wolf, lurker, npc })) s.set(`m:${id}`, v);
    const eyes = () => eyesOf(s, PARTY);
    expect(eyes()).toBe(null); // line of sight is off: the open table
    expect(miniShown(s, PARTY, goblin, eyes())).toBe('yes');
    expect(miniShown(s, PARTY, lurker, eyes())).toBe('no'); // hidden is hidden, never ghosted
    s.set('set:los', true);
    // The party's eyes: every mini with an owner, except a hidden one and the GM's own.
    s.set('m:scout', mini(9, 9, { o: 'ann', h: true }));
    expect(eyes()!.length).toBe(3);
    expect(eyes()!.includes(npc)).toBe(false);
    expect(eyesOf(s, 'ann')!.length).toBe(2); // her own and everyone's
    // A wall across the table between Ann's side and Bob's, and one in front of the goblin.
    const wall = (x: number, z: number) => { s.set(`b:${x},0,${z}`, { i: 'stone' }); s.set(`b:${x},1,${z}`, { i: 'stone' }); };
    for (let x = -2; x <= 6; x++) wall(x, 3);
    wall(2, 0); wall(2, 1);
    expect(miniShown(s, 'ann', wolf, eyesOf(s, 'ann'))).toBe('no');
    expect(miniShown(s, PARTY, wolf, eyes())).toBe('yes'); // Bob sees it, so the screen shows it
    expect(miniShown(s, PARTY, goblin, eyes())).toBe('no'); // nobody sees the goblin
    for (const m of [ann, bob, anyone]) expect(miniShown(s, PARTY, m, eyes())).toBe('yes'); // the party itself is always there
    expect(miniShown(s, PARTY, npc, eyes())).toBe('yes'); // the GM's own mini is seen like any other
    s.set('f:4,6', true);
    expect(miniShown(s, PARTY, wolf, eyes())).toBe('no'); // under fog
    // With nobody owning a mini the screen is a spectator: the open table, minus what is hidden or fogged.
    for (const id of ['ann', 'bob', 'anyone', 'scout']) s.set(`m:${id}`, null);
    expect(eyes()).toEqual([]);
    expect(miniShown(s, PARTY, goblin, eyes())).toBe('yes');
    expect(miniShown(s, PARTY, wolf, eyes())).toBe('no');
  });

  it('takes up only a view that is one', () => {
    const view = (p: unknown, t: unknown) => readView(p, t, 96, 3, 90);
    expect(view([7, 9, 11], [0, 0, 0])).toEqual({ p: [7, 9, 11], t: [0, 0, 0] });
    for (const bad of [null, 'x', [1, 2], [1, 2, 3, 4], [1, NaN, 3], [1, Infinity, 3], ['1', 2, 3]]) {
      expect(view(bad, [0, 0, 0])).toBe(null);
      expect(view([7, 9, 11], bad)).toBe(null);
    }
    expect(view([0, 0, 0], [0, 0, 0])).toBe(null); // nowhere to look from
    expect(view([5, -4, 5], [0, 0, 0])).toBe(null); // from under the table
    // Too far, too near, or off the table: brought back, looking the same way.
    const far = view([0, 3000, 4000], [0, 0, 0])!;
    expect(Math.hypot(...far.p)).toBeCloseTo(90);
    expect(far.p[1] / far.p[2]).toBeCloseTo(0.75);
    expect(Math.hypot(...view([0, 0.3, 0.4], [0, 0, 0])!.p)).toBeCloseTo(3);
    const off = view([1e9, 10, 0], [1e9, 0, 0])!;
    expect(off.t).toEqual([96, 0, 0]);
    expect(off.p).toEqual([96, 10, 0]);
  });
});

describe('QR codes', () => {
  const draw = (g: boolean[][]) => g.map((row) => row.map((d) => (d ? '#' : '.')).join(''));

  it('draws the smallest code that holds the text', () => {
    expect(qr('')!.length).toBe(21);
    expect(qr('x'.repeat(17))!.length).toBe(21);
    expect(qr('x'.repeat(18))!.length).toBe(25);
    expect(qr('x'.repeat(230))!.length).toBe(53);
    expect(qr('x'.repeat(271))!.length).toBe(57);
    expect(qr('x'.repeat(272))).toBe(null); // too long to be worth scanning off a phone
    expect(qr('é'.repeat(9))!.length).toBe(25); // counted in bytes
  });

  it('has the squares a reader looks for', () => {
    for (const text of ['hello', 'https://example.org/?ui=2&display=1#room=amber-fox-1234', 'x'.repeat(200)]) {
      const g = draw(qr(text)!), n = g.length;
      const eye = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'];
      for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) expect(g.slice(y, y + 7).map((r) => r.slice(x, x + 7))).toEqual(eye);
      expect(g[6].slice(8, n - 8)).toBe(Array.from({ length: n - 16 }, (_, i) => (i % 2 ? '.' : '#')).join('')); // the timing row
      expect(g[n - 8][8]).toBe('#'); // the one square that is always dark
    }
  });

  // Checked once against a reader (every length from 1 to 271 bytes decoded to its text); this pins what was checked.
  it('is the code it was', () => {
    expect(draw(qr('cottontale')!)).toEqual(PINNED);
  });
});

const PINNED = [
  '#######...#.#.#######',
  '#.....#.....#.#.....#',
  '#.###.#.#.#...#.###.#',
  '#.###.#.....#.#.###.#',
  '#.###.#..#.##.#.###.#',
  '#.....#..###..#.....#',
  '#######.#.#.#.#######',
  '........#.#..........',
  '###.#####.#.###...#..',
  '.###.#..#.##.#.##.###',
  '..#...#...##.#####.##',
  '######..#..##..#....#',
  '####.##.##.#...###..#',
  '........###...#.#..##',
  '#######.###.#.###.###',
  '#.....#.#.#....##..##',
  '#.###.#.#...#..#.#...',
  '#.###.#..#.#...##..#.',
  '#.###.#.####.####.#.#',
  '#.....#.##.###..#..#.',
  '#######.#..#..##...##',
];
