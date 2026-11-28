import { describe, expect, it } from 'vitest';
import { MAX_SLOTS, dockFor, type DockState, type Mode, type Role, type Sel } from './dockFor';

const ARMED = { name: 'Barrel', turns: true, sized: false, erasing: false, sampling: false, size: 1 };
const ids = (s: DockState) => dockFor(s).map((x) => x.id);

describe('the dock', () => {
  it('never holds more than six slots, never repeats one, and always has something for a seated player', () => {
    for (const role of ['gm', 'player', 'display'] as Role[]) for (const mode of ['play', 'build'] as Mode[]) for (const sel of ['none', 'mini', 'theirs', 'piece'] as Sel[]) {
      for (const armed of [undefined, ARMED]) for (const sheets of [false, true]) for (const placing of [false, true]) for (const build of [false, true]) {
        const slots = dockFor({ role, build, mode, sel, armed, sheets, placing, hidden: placing });
        expect(slots.length).toBeLessThanOrEqual(MAX_SLOTS);
        expect(new Set(slots.map((s) => s.id)).size).toBe(slots.length);
        expect(slots.length > 0).toBe(role !== 'display');
        for (const s of slots) expect(s.label.length).toBeLessThanOrEqual(10); // a slot is 60px wide on a small phone
      }
    }
  });

  it('switches between Play and Build from the same place', () => {
    expect(ids({ role: 'gm', mode: 'play', sel: 'none' })[0]).toBe('build');
    expect(ids({ role: 'gm', mode: 'build', sel: 'none' })[0]).toBe('play');
    expect(ids({ role: 'player', mode: 'play', sel: 'none' })).not.toContain('build');
  });

  it('gives a player who may build the Build slot and Build\'s docks, and nothing of the GM\'s', () => {
    expect(ids({ role: 'player', build: true, mode: 'play', sel: 'none', sheets: true })).toEqual(['build', 'dice', 'sheet', 'ruler', 'chat', 'table']);
    expect(ids({ role: 'player', build: true, mode: 'build', sel: 'none' })).toEqual(ids({ role: 'gm', mode: 'build', sel: 'none' }));
    expect(ids({ role: 'player', build: true, mode: 'build', sel: 'none', armed: ARMED })).toEqual(ids({ role: 'gm', mode: 'build', sel: 'none', armed: ARMED }));
    expect(ids({ role: 'player', build: true, mode: 'build', sel: 'piece' })).toEqual(['move', 'turn', 'copy', 'remove', 'more', 'done']);
    expect(ids({ role: 'player', build: true, mode: 'build', sel: 'theirs' })).toEqual(['details', 'done']); // the GM's figures stay put
    expect(ids({ role: 'player', build: true, mode: 'play', sel: 'mini' })).not.toContain('hide');
    expect(ids({ role: 'player', build: true, mode: 'play', sel: 'none', tool: { fog: 'hide' } })).not.toContain('fogHide');
  });

  it('lets the selected thing decide', () => {
    expect(ids({ role: 'gm', mode: 'build', sel: 'piece' })).toEqual(['move', 'turn', 'copy', 'remove', 'more', 'done']);
    expect(ids({ role: 'gm', mode: 'build', sel: 'mini' })).toEqual(['move', 'turn', 'copy', 'remove', 'more', 'done']); // a mini is finished where it is placed
    expect(ids({ role: 'gm', mode: 'play', sel: 'mini', sheets: true })).toEqual(['hp', 'conditions', 'hide', 'sheet', 'more', 'done']);
    expect(ids({ role: 'player', mode: 'play', sel: 'mini' })).toEqual(['hp', 'more', 'done']);
    expect(ids({ role: 'gm', mode: 'play', sel: 'mini' })).toEqual(['hp', 'hide', 'more', 'done']);
    expect(ids({ role: 'player', mode: 'play', sel: 'theirs' })).toEqual(['details', 'done']);
  });

  it('keeps a brush in hand until Done, with its tools in fixed places', () => {
    const block = dockFor({ role: 'gm', mode: 'build', sel: 'none', armed: { ...ARMED, name: 'Grass', turns: false } });
    expect(block.map((s) => s.id)).toEqual(['hand', 'rot', 'size', 'sample', 'erase', 'done']);
    expect(block[0].label).toBe('Grass');
    expect(block[1].off).toBe(true); // a block has no facing, but Turn keeps its place
    const eraser = dockFor({ role: 'gm', mode: 'build', sel: 'none', armed: { ...ARMED, erasing: true } });
    expect(eraser.find((s) => s.id === 'erase')!.on).toBe(true);
  });

  it('gives a tool of Play its own dock, with a way out', () => {
    expect(ids({ role: 'gm', mode: 'play', sel: 'none', tool: { ruler: 'circle', blast: true } })).toEqual(['line', 'circle', 'cone', 'blast', 'done']);
    expect(ids({ role: 'player', mode: 'play', sel: 'none', tool: { ruler: 'line' } })).toEqual(['line', 'circle', 'cone', 'done']);
    expect(ids({ role: 'gm', mode: 'play', sel: 'none', tool: { fog: 'hide' } })).toEqual(['fogHide', 'fogShow', 'revealAll', 'asPlayers', 'done']);
    const look = dockFor({ role: 'gm', mode: 'play', sel: 'none', tool: { fog: 'hide', asPlayers: true } });
    expect(look.map((s) => [s.id, !!s.on, !!s.off])).toEqual([['fogHide', false, true], ['fogShow', false, true], ['revealAll', false, true], ['asPlayers', true, false], ['done', false, false]]); // only a view: the brushes wait
    expect(ids({ role: 'player', mode: 'play', sel: 'none', tool: { fog: 'hide' } })).not.toContain('fogHide'); // fog is the GM's
  });

  it('shows what state the table is in', () => {
    expect(dockFor({ role: 'gm', mode: 'build', sel: 'piece', placing: true })[0].on).toBe(true);
    expect(ids({ role: 'gm', mode: 'build', sel: 'none', area: true })).toEqual(['area', 'done']); // dragging out an area: only a way out
    expect(ids({ role: 'player', mode: 'play', sel: 'none', area: true })).not.toContain('area');
    const hide = dockFor({ role: 'gm', mode: 'play', sel: 'mini', hidden: true }).find((s) => s.id === 'hide')!;
    expect([hide.on, hide.label]).toEqual([true, 'Hidden']);
  });
});
