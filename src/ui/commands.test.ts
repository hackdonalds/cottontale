import { describe, expect, it } from 'vitest';
import { MAX_RESULTS, commandScore, searchCommands, type Command } from './commands';

const LIST: Command[] = [
  { id: 'act:fog', title: 'Fog brush', group: 'Action', keywords: ['hide', 'cover'] },
  { id: 'act:reveal', title: 'Reveal all', group: 'Action', keywords: ['fog', 'uncover', 'show everything'] },
  { id: 'act:gm', title: 'Become the GM', group: 'Action', keywords: ['game master', 'referee', 'dm'] },
  { id: 'act:ruler', title: 'Ruler', group: 'Action', keywords: ['measure', 'distance'] },
  { id: 'set:sound', title: 'Sound', group: 'Setting', keywords: ['mute', 'audio', 'volume', 'off', 'on'], hint: 'This device' },
  { id: 'page:sound', title: 'Sound', group: 'Page', keywords: ['soundscape', 'music'] },
  { id: 'page:theme', title: 'Theme', group: 'Page', keywords: ['mood', 'look'] },
  { id: 'act:los', title: 'Line of sight', group: 'Action', available: false, hint: 'GM only' },
  { id: 'piece:p_barrel', title: 'Barrel', group: 'Piece' },
  { id: 'piece:p_chateau', title: 'Château gate', group: 'Piece' },
  { id: 'piece:p_gunbarrel', title: 'Gun barrel', group: 'Piece' },
  { id: 'piece:p_soundingboard', title: 'Resounding gong', group: 'Piece' },
];
const ids = (q: string, max?: number) => searchCommands(LIST, q, max).map((c) => c.id);

describe('searchCommands', () => {
  it('finds nothing for nothing typed', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(ids('—!')).toEqual([]);
    expect(commandScore(LIST[0], '')).toBe(0);
  });
  it('reads past case, accents and punctuation', () => {
    expect(ids('BARREL')[0]).toBe('piece:p_barrel');
    expect(ids('chateau')).toEqual(['piece:p_chateau']);
    expect(ids('Château-GATE')).toEqual(['piece:p_chateau']);
    expect(ids('line  of-sight')).toEqual(['act:los']);
  });
  it('finds entries by their keywords', () => {
    expect(ids('fog')).toContain('act:reveal');
    expect(ids('gm')).toEqual(['act:gm']);
    expect(ids('dm')).toEqual(['act:gm']);
    expect(ids('mute')).toEqual(['set:sound']);
    expect(ids('measure')).toEqual(['act:ruler']);
  });
  it('puts a title before a keyword, and a start before a middle', () => {
    expect(ids('fog')).toEqual(['act:fog', 'act:reveal']); // the title, then the keyword
    expect(ids('barrel')).toEqual(['piece:p_barrel', 'piece:p_gunbarrel']); // starts with it, then a later word does
    expect(ids('sound')).toEqual(['set:sound', 'page:sound', 'piece:p_soundingboard']); // the titles, then a name that merely contains it
    expect(commandScore(LIST[1], 'reveal')).toBeGreaterThan(commandScore(LIST[1], 'fog'));
    expect(commandScore(LIST[1], 'fog')).toBeGreaterThan(commandScore(LIST[1], 'cover')); // "uncover" only contains it
  });
  it('keeps the order entries came in when they answer equally well', () => {
    expect(ids('sound').slice(0, 2)).toEqual(['set:sound', 'page:sound']);
    const same: Command[] = ['c', 'a', 'b'].map((x) => ({ id: x, title: 'Torch', group: 'Piece' }));
    expect(searchCommands(same, 'torch').map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });
  it('wants every word typed, in the title or across the keywords', () => {
    expect(ids('reveal all')).toEqual(['act:reveal']);
    expect(ids('reveal barrel')).toEqual([]);
    expect(ids('sound off')).toEqual(['set:sound']); // one word from the title, one from a keyword
    expect(ids('sound music')).toEqual(['page:sound']);
  });
  it('keeps entries a seat cannot use: they are shown, not hidden', () => {
    const found = searchCommands(LIST, 'sight');
    expect(found.map((c) => c.id)).toEqual(['act:los']);
    expect(found[0].available).toBe(false);
    expect(found[0].hint).toBe('GM only');
  });
  it('stops at the cap', () => {
    const many: Command[] = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, title: `Tree ${i}`, group: 'Piece' as const }));
    expect(searchCommands(many, 'tree')).toHaveLength(MAX_RESULTS);
    expect(searchCommands(many, 'tree', 5).map((c) => c.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(searchCommands([...many, { id: 'best', title: 'Treeline', group: 'Action' }], 'treeline', 5).map((c) => c.id)).toEqual(['best']);
  });
});
