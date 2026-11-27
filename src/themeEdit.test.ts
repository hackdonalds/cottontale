import { describe, expect, it } from 'vitest';
import { PROPS } from './catalog';
import { PRESETS, addPresets, loadPresets } from './gen';
import { pack } from './net';
import { known as has } from './registry';
import { EDGES } from './rules';
import { SOUNDSCAPES, addSounds, loadSounds } from './sound';
import { Store } from './store';
import { MAX_PIECES, atmo, loadThemes, parseTheme, setAtmo, themeLook, type GameTheme, type Known } from './theme';
import {
  BOUNDS, History, MAX_SAVED, SHELVES, THEME_MAX, THEME_TAG, THEME_WARN, addPiece, captureTheme, copyTheme, forgetTheme, hexToHsl, hslToHex, isOwn, kB,
  movePiece, ownId, parseSaved, readThemeCode, removePiece, saveTheme, setGroup, setInfo, setMood, settled, slug, themeCode, themeSize, tooBig,
} from './themeEdit';

const { readFile } = await import('node:fs/promises' as string) as { readFile: (path: string, enc: string) => Promise<string> };
const file = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

describe('making a theme of your own (themeEdit.ts)', async () => {
  const known: Known = { ...has, amb: (id) => id in SOUNDSCAPES, gen: (id) => id in PRESETS, edge: (id) => id in EDGES };
  addSounds(await loadSounds('public/sounds', file));
  addPresets(await loadPresets('public/gens', (kind, id) => known[kind]!(id), file));
  const shipped = await loadThemes('public/themes', known, file);
  const ME = 'ab12cd34ef';
  /** What every edit must hold: the theme reads back exactly as it was written, through JSON as the table carries it. */
  const sound = (t: GameTheme) => { expect(parseTheme(JSON.parse(JSON.stringify(t)), known), t.id).toEqual(t); return t; };

  it('has themes to start from', () => expect(shipped.length).toBeGreaterThan(2));

  it('a copy has an id of its author that collides with nothing, and everything else the theme had', () => {
    for (const t of shipped) {
      const c = sound(copyTheme(t, ME, shipped.map((s) => s.id), known));
      expect(c.id).toBe(`ab12cd34ef:${slug(t.name)}`);
      expect(isOwn(c.id, ME) && !isOwn(t.id, ME) && !isOwn(c.id, 'ab12cd34ff')).toBe(true);
      expect({ ...c, id: '', name: '' }).toEqual({ ...t, id: '', name: '' });
      expect(c.name).toBe(`My ${t.name}`);
      expect(c.pieces).not.toBe(t.pieces); // a copy, not the same lists
      const again = copyTheme(t, ME, [c.id], known);
      expect(again.id).toBe(`${c.id}-2`);
      expect(copyTheme(t, ME, [c.id, again.id], known).id).toBe(`${c.id}-3`);
    }
    expect(slug('  Über—Crypt!! of the 9 Lords and more and more ')).toBe('uber-crypt-of-the-9-lord');
    expect(slug('🎲')).toBe('theme');
    expect(ownId('Zz_-!', 'A b', [])).toBe('zz:a-b');
    expect(parseTheme({ v: 1, id: ownId(ME, 'x'.repeat(40)), name: 'x' }, known)).not.toBeNull();
  });

  it('every dial is kept within what a reader accepts, and reads back unchanged', () => {
    let t = shipped[0];
    t = sound(setGroup(t, 'light', { sunI: 99, hemiI: -4, sun: '#ABCDEF' }, known));
    expect(t.mood.light).toMatchObject({ sunI: BOUNDS.sunI[1], hemiI: 0, sun: '#abcdef' });
    t = sound(setGroup(t, 'light', { sunI: 0.30000000000000004, bg: 'red' }, known));
    expect(t.mood.light!.sunI).toBe(0.3);
    expect(t.mood.light!.bg).toBeUndefined(); // not a colour: back to the sky's
    t = sound(setGroup(t, 'grade', { sat: 7, warmth: -7, contrast: 0.333, vignette: undefined }, known));
    expect(t.mood.grade).toEqual({ sat: 1.5, warmth: -1, contrast: 0.33 });
    t = sound(setGroup(t, 'dice', { body: '#102030', rough: 2, metal: 0.5 }, known));
    expect(t.dice).toMatchObject({ body: '#102030', rough: 1, metal: 0.5 });
    t = sound(setMood(t, { glow: 1.1, sky: 'dusk', season: 'autumn' }, known));
    expect(t.mood).toMatchObject({ glow: 1, sky: 'dusk', season: 'autumn' });
    expect(setMood(t, { sky: 'noon' as never }, known).mood.sky).toBe('dusk');
    expect(sound(setMood(t, { amb: 'no-such-sound' }, known)).mood.amb).toBe('off');
    expect(sound(setInfo(t, { gen: 'no-such-generator' }, known)).gen).toBe('');
    for (const [k, [min, max, step]] of Object.entries(BOUNDS)) expect(min < max && step > 0 && step <= max - min, k).toBe(true);
  });

  it('haze has two ends, the right way round, and a group can be given back whole', () => {
    let t = sound(setGroup(shipped[0], 'fog', null, known));
    expect(t.mood.fog).toBeUndefined();
    t = sound(setGroup(t, 'fog', { near: 20, far: 90 }, known));
    expect(t.mood.fog).toEqual({ near: 20, far: 90 });
    t = sound(setGroup(t, 'fog', { near: 120 }, known));
    expect(t.mood.fog).toEqual({ near: 120, far: 121 }); // the start pushes the end along
    t = sound(setGroup(t, 'fog', { far: 40 }, known));
    expect(t.mood.fog).toEqual({ near: 39, far: 40 }); // and the end the start
    t = sound(setGroup(t, 'fog', { near: 900, far: 900, color: '#112233' }, known));
    expect(t.mood.fog).toEqual({ color: '#112233', near: 200, far: 400 });
    t = sound(setGroup(t, 'fog', { color: undefined }, known));
    expect(t.mood.fog).toEqual({ near: 200, far: 400 });
    for (const g of ['light', 'fog', 'grade', 'dice'] as const) t = sound(setGroup(t, g, null, known));
    expect(t.mood.light ?? t.mood.fog ?? t.mood.grade ?? t.dice).toBeUndefined();
    expect(themeLook(t, t.mood.sky)).toEqual({ light: undefined, fog: undefined, grade: undefined, dice: undefined });
    expect(sound(setGroup(t, 'light', { sunI: undefined }, known)).mood.light).toBeUndefined(); // an empty group is no group
  });

  it('pieces are added once, up to a shelf full, removed and moved along', () => {
    const base = sound(setGroup(shipped[0], 'dice', null, known)), had = base.pieces.props;
    const extra = Object.keys(PROPS).filter((id) => !had.includes(id));
    let t = sound(addPiece(base, 'props', extra[0], known));
    expect(t.pieces.props).toEqual([...had, extra[0]]);
    expect(addPiece(t, 'props', extra[0], known)).toBe(t); // there already
    expect(addPiece(t, 'props', 'no such piece', known)).toEqual(t);
    expect(sound(addPiece(t, 'props', 'ada:lamp', known)).pieces.props.at(-1)).toBe('ada:lamp'); // a pack's piece, here or not
    for (const id of extra) t = sound(addPiece(t, 'props', id, known));
    expect(t.pieces.props.length).toBe(MAX_PIECES);
    expect(addPiece(t, 'props', 'ada:lamp', known)).toBe(t); // full
    t = sound(removePiece(t, 'props', had[0], known));
    expect(t.pieces.props.includes(had[0])).toBe(false);
    expect(removePiece(t, 'props', had[0], known)).toBe(t);
    const [a, b, c] = t.pieces.props;
    t = sound(movePiece(t, 'props', a, 1, known));
    expect(t.pieces.props.slice(0, 3)).toEqual([b, a, c]);
    t = sound(movePiece(t, 'props', c, -99, known));
    expect(t.pieces.props.slice(0, 3)).toEqual([c, b, a]);
    expect(movePiece(t, 'props', c, -1, known)).toBe(t); // at the end already
    expect(movePiece(t, 'props', 'nothing', 1, known)).toBe(t);
    expect(sound(movePiece(t, 'props', c, 999, known)).pieces.props.at(-1)).toBe(c);
    expect(t.pieces.blocks).toEqual(base.pieces.blocks);
    for (const s of SHELVES) expect(sound(removePiece(t, s, t.pieces[s][0], known)).pieces[s].length).toBe(t.pieces[s].length - 1);
  });

  it('name and icon: an empty name is no change, and nothing odd survives', () => {
    const t = shipped[0];
    expect(setInfo(t, { name: '   ' }, known)).toEqual(t);
    expect(sound(setInfo(t, { name: `  ${'long name '.repeat(6)}` }, known)).name).toBe('long name long name long name lo');
    expect(sound(setInfo(t, { name: `${'x'.repeat(31)} y` }, known)).name).toBe('x'.repeat(31)); // cut at a space: trimmed for good
    expect(sound(setInfo(t, { icon: 'a   bcd' }, known)).icon).toBe('a');
    expect([...sound(setInfo(t, { icon: '🧛‍♂️🧛‍♂️' }, known)).icon].length).toBeLessThanOrEqual(4);
    expect(sound(setInfo(t, { icon: '' }, known)).icon).toBe('🎲');
  });

  it('a board\'s look becomes a theme: its atmosphere, and what its theme adds while it shows', () => {
    const v = shipped.find((t) => t.mood.fog && t.sounds)!;
    const own = sound(captureTheme({ sky: v.mood.sky, season: 'spring', glow: 0.5, amb: 'off' }, v, ownId(ME, 'Mine'), 'Mine', known)!);
    expect(own).toMatchObject({ id: 'ab12cd34ef:mine', name: 'Mine', icon: v.icon, gen: v.gen, pieces: v.pieces, dice: v.dice, sounds: v.sounds });
    expect(own.mood).toEqual({ ...v.mood, season: 'spring', glow: 0.5, amb: 'off' });
    const other = sound(captureTheme({ sky: v.mood.sky === 'day' ? 'dusk' : 'day', season: 'summer', glow: 1, amb: v.mood.amb }, v, 'x:y', 'Y', known)!);
    expect(other.mood.light ?? other.mood.fog).toBeUndefined(); // they had stepped aside under the other sky
    expect(other.mood.grade).toEqual(v.mood.grade);
    expect(other.mood.amb).toBe(v.mood.amb); // its own soundscape comes along
    const bare = sound(captureTheme({ sky: 'night', season: 'winter', glow: 2, amb: 'no-such' }, null, 'x:z', 'Bare', known)!);
    expect(bare).toEqual({ v: 1, id: 'x:z', name: 'Bare', icon: '🎲', mood: { sky: 'night', season: 'winter', glow: 2, amb: 'off' }, pieces: { blocks: [], props: [], minis: [] }, gen: '' });
    expect(captureTheme({ sky: 'day', season: 'summer', glow: 1, amb: 'off' }, null, 'x:z', '', known)).toBeNull();
  });

  it('travels as a code and comes back the same', async () => {
    for (const t of shipped) {
      const code = await themeCode(t);
      expect(code.startsWith(THEME_TAG)).toBe(true);
      expect(await readThemeCode(code, known)).toEqual(t);
      expect(await readThemeCode(`Try this one!\n${code}\n`, known)).toEqual(t);
      expect(await readThemeCode(code.slice(THEME_TAG.length), known)).toEqual(t);
    }
    for (const bad of ['', 'hello', THEME_TAG, `${THEME_TAG}AAAA`, (await themeCode(shipped[0])).slice(0, -12)]) expect(await readThemeCode(bad, known), bad).toBeNull();
    expect(await readThemeCode(THEME_TAG + await pack({ cells: [] }), known)).toBeNull(); // a slab is not a theme
  });

  it('knows its size, and what is too big for a table', () => {
    for (const t of shipped) {
      expect(themeSize(t)).toBe(new Blob([JSON.stringify(t)]).size);
      expect(themeSize(t), t.id).toBeLessThan(THEME_WARN);
      expect(tooBig(t)).toBe(false);
    }
    expect(THEME_WARN).toBeLessThan(THEME_MAX);
    expect(kB(2048)).toBe('2.0 kB');
    expect(kB(20000)).toBe('20 kB');
    expect(tooBig({ ...shipped[0], pad: 'x'.repeat(THEME_MAX) } as GameTheme)).toBe(true);
    expect(parseSaved(JSON.stringify([{ ...shipped[0], name: 'é'.repeat(32) }]), known).length).toBe(1);
  });

  it('keeps themes on a device: saved once per id, renamed in place, forgotten', () => {
    const a = copyTheme(shipped[0], ME, [], known), b = copyTheme(shipped[1], ME, [], known);
    let list = saveTheme(saveTheme([], a), b);
    expect(list.map((t) => t.id)).toEqual([b.id, a.id]);
    list = saveTheme(list, setInfo(a, { name: 'Renamed' }, known));
    expect(list.map((t) => t.name)).toEqual([b.name, 'Renamed']);
    expect(parseSaved(JSON.stringify(list), known)).toEqual(list);
    expect(parseSaved(JSON.stringify([...list, list[0], { v: 1 }, 7, null]), known)).toEqual(list);
    for (const bad of [null, '', 'nope', '{}', '7']) expect(parseSaved(bad, known)).toEqual([]);
    expect(forgetTheme(list, a.id)).toEqual([b]);
    let many: GameTheme[] = [];
    for (let i = 0; i < MAX_SAVED + 5; i++) many = saveTheme(many, { ...a, id: `${a.id}-${i}` });
    expect(many.length).toBe(MAX_SAVED);
    expect(many[0].id).toBe(`${a.id}-${MAX_SAVED + 4}`);
  });

  it('undo and redo walk the last thirty states; a dragged slider is one step', () => {
    const h = new History(0, 30);
    expect(h.canUndo || h.canRedo || h.undo() || h.redo()).toBe(false);
    expect(h.push(0)).toBe(false);
    for (let i = 1; i <= 40; i++) h.push(i, '', i * 5000);
    let n = 0;
    while (h.undo()) n++;
    expect([n, h.now]).toEqual([30, 10]);
    expect(h.redo() && h.redo() && h.now).toBe(12);
    h.push(99, '', 1e9);
    expect(h.canRedo).toBe(false);
    for (let i = 0; i < 20; i++) h.push(100 + i, 'sun', 1e9 + 2000 + i * 50); // one drag
    h.push(500, 'haze', 1e9 + 3100);
    h.push(501, 'haze', 1e9 + 9000); // the same dial, later: a step of its own
    expect([h.undo(), h.now, h.undo(), h.now, h.undo(), h.now, h.undo(), h.now]).toEqual([true, 500, true, 119, true, 99, true, 12]);
    h.redo();
    h.push(7, 'sun', 1e9 + 9100); // straight after an undo is never folded into what came before
    expect(h.undo() && h.now).toBe(99);
  });

  it('a session of edits through a table: what the editor writes is what the other side reads', () => {
    const store = new Store('gm'), other = new Store('player');
    store.onLocal = (row) => other.merge(JSON.parse(JSON.stringify(row)));
    let t = copyTheme(shipped[0], ME, shipped.map((s) => s.id), known);
    const steps: ((t: GameTheme) => GameTheme)[] = [
      (x) => setGroup(x, 'light', { sunI: 2.35, sun: hslToHex(30, 80, 70) }, known),
      (x) => setGroup(x, 'fog', { near: 12, far: 64, color: '#203040' }, known),
      (x) => setGroup(x, 'dice', { body: '#00aa55', ink: '#ffffff', metal: 0.85 }, known),
      (x) => removePiece(x, 'props', x.pieces.props[0], known),
      (x) => addPiece(x, 'minis', 'ada:robot', known),
      (x) => movePiece(x, 'blocks', x.pieces.blocks[0], 2, known),
      (x) => setMood(x, { sky: x.mood.sky === 'dusk' ? 'night' : 'dusk', glow: 1.75, amb: 'off' }, known),
      (x) => setInfo(x, { name: 'Brine & Bone', icon: '🦴', gen: Object.keys(PRESETS).find((g) => g !== x.gen) }, known),
      (x) => setGroup(x, 'grade', { sat: 0.4, warmth: 1.6, contrast: 0.2, vignette: 1.2 }, known),
    ];
    for (const step of steps) {
      const next = sound(step(t));
      expect(next).not.toEqual(t);
      expect(settled(next, known)).toEqual(next);
      t = next;
      setAtmo(store, 'theme', t);
      expect(parseTheme(atmo(other, 'theme', null), known)).toEqual(t);
    }
    expect(themeSize(t)).toBeLessThan(THEME_WARN);
  });

  it('colours go to hue, vividness and lightness and back', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080', '#5c0f1a', '#a9c4ff', '#ffdcae']) {
      const back = hslToHex(...hexToHsl(hex));
      // Whole numbers of hue and percent lose a little: within a few steps of 255 on each channel.
      for (let i = 1; i < 7; i += 2) expect(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)), `${hex} → ${back}`).toBeLessThanOrEqual(4);
    }
    expect(hexToHsl('#ff0000')).toEqual([0, 100, 50]);
    expect(hexToHsl('#0000ff')).toEqual([240, 100, 50]);
    expect(hexToHsl('nope')).toEqual([0, 0, 0]);
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(-240, 100, 50)).toBe('#00ff00');
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    for (let h = 0; h < 360; h += 7) expect(hslToHex(h, 63, 41)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
