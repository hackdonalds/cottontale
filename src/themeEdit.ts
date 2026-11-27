// Making a theme of your own: the pure part (the panel is ui/themeEditor.ts).
//
// A theme is plain data (theme.ts), and every edit here is "the theme, with one thing
// changed, read back through `parseTheme`". So whatever the editor writes to the table is
// exactly what every other device will read: nothing is clamped or dropped on the way.
// Nothing here knows any particular theme, the DOM or the board.
import { pack, unpack } from './net';
import { MAX_PIECES, SEASON_IDS, SKY_IDS, THEME_FORMAT, parseTheme, type DiceLook, type Fog, type GameTheme, type Grade, type Known, type Light, type Mood } from './theme';

/** Themes travel as text too, like slabs: this is how a code says what it is. */
export const THEME_TAG = 'cottontale-theme:';
/**
 * A theme travels inside the table's state: in one live message when it changes, and in a
 * snapshot chunk beside up to a thousand other rows (net.ts), on relays that turn away large
 * events. So: a warning above 16 kB, and nothing above 32 kB is written at all.
 */
export const THEME_WARN = 16 * 1024, THEME_MAX = 32 * 1024;
/** How many themes a device keeps under "Mine". */
export const MAX_SAVED = 24;

export type Shelf = keyof GameTheme['pieces'];
export const SHELVES: readonly Shelf[] = ['blocks', 'props', 'minis'];
/** Which of `Known` answers for the pieces of a shelf. */
export const KIND = { blocks: 'block', props: 'prop', minis: 'mini' } as const;

/** What each dial may be set to: [least, most, step]. The ends are `parseTheme`'s clamps. */
export const BOUNDS = {
  glow: [0, 2, 0.25],
  sunI: [0, 8, 0.1], hemiI: [0, 3, 0.05], spill: [0, 1, 0.05], sheen: [0, 1, 0.05],
  near: [0, 200, 1], far: [1, 400, 1],
  sat: [0, 1.5, 0.05], warmth: [-1, 2, 0.05], contrast: [0, 1, 0.05], vignette: [0, 1.5, 0.05],
  rough: [0, 1, 0.05], metal: [0, 1, 0.05],
} as const satisfies Record<string, readonly [number, number, number]>;

/** The groups of a theme's own look, each of which can be given back to the sky it was made for. */
export interface Groups { light: Light; fog: Fog; grade: Grade; dice: DiceLook }
export type Group = keyof Groups;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Two decimals are plenty for a dial, and keep the theme short. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * `next` as every device will read it, or `t` unchanged if it is no theme at all (an empty name, say).
 * Read until it reads the same again: cutting a name short can leave a space at its end for the next reader to trim.
 */
function settle(t: GameTheme, next: unknown, known: Known): GameTheme {
  let out = parseTheme(next, known);
  for (let i = 0; out && i < 3; i++) {
    const again = parseTheme(out, known);
    if (!again || same(again, out)) break;
    out = again;
  }
  return out ?? t;
}
/** The theme as it would be read back: what the editor starts from. */
export const settled = (t: GameTheme, known: Known): GameTheme => settle(t, t, known);

// ---- identity ----

/** A name as the second half of an id: lower case, digits and dashes. */
export function slug(name: string): string {
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  return s || 'theme';
}
/** The author's half of an id: the start of their player id, in the letters an id may have. */
export const authorOf = (player: string): string => player.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'me';
/** Is this one of `player`'s own themes (so editing it needs no copy)? */
export const isOwn = (id: string, player: string): boolean => id.startsWith(`${authorOf(player)}:`);

/**
 * An id for a theme of `player`'s: `<author>:<slug>`. The themes that ship have plain ids
 * and another GM has another prefix, so it can collide with neither; among this player's
 * own (`taken`) a number is added.
 */
export function ownId(player: string, name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken), base = `${authorOf(player)}:${slug(name)}`;
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** A copy to make your own: everything the theme has, under a new id and (unless told otherwise) "My …". */
export function copyTheme(t: GameTheme, player: string, taken: Iterable<string>, known: Known, name = `My ${t.name}`): GameTheme {
  const named = name.trim().slice(0, 32).trim() || t.name;
  return settle(t, { ...structuredClone(t), id: ownId(player, t.name, taken), name: named }, known);
}

// ---- edits: each returns a new theme, already read back ----

/** Name, icon and the generator that suits it. An empty name is no change. */
export function setInfo(t: GameTheme, info: Partial<Pick<GameTheme, 'name' | 'icon' | 'gen'>>, known: Known): GameTheme {
  return settle(t, { ...t, ...info }, known);
}

/** Sky, season, firelight, soundscape. */
export function setMood(t: GameTheme, mood: Partial<Pick<Mood, 'sky' | 'season' | 'glow' | 'amb'>>, known: Known): GameTheme {
  const m = { ...t.mood, ...mood };
  if (!SKY_IDS.includes(m.sky)) m.sky = t.mood.sky;
  if (!SEASON_IDS.includes(m.season)) m.season = t.mood.season;
  return settle(t, { ...t, mood: m }, known);
}

/**
 * Change part of the theme's own light, haze, grade or dice. A field set to `undefined` goes
 * back to the default, and `null` for the whole group gives all of it back (its sky's light,
 * the plain haze and grade, each player's own dice). Haze needs both ends, and ends the right way round.
 */
export function setGroup<G extends Group>(t: GameTheme, group: G, values: Partial<Groups[G]> | null, known: Known): GameTheme {
  const had = (group === 'dice' ? t.dice : t.mood[group as Exclude<Group, 'dice'>]) as Record<string, unknown> | undefined;
  let now: Record<string, unknown> | undefined;
  if (values) {
    now = { ...had };
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete now[k];
      else now[k] = typeof v === 'number' ? round(v) : v;
    }
    if (group === 'fog') {
      const near = Number(now.near ?? 0), far = Number(now.far ?? near + 1);
      now.near = near;
      // Whichever end was moved pushes the other along.
      if (far <= near) { if ('near' in values && !('far' in values)) now.far = Math.min(BOUNDS.far[1], near + 1); else now.near = Math.max(BOUNDS.near[0], Math.min(near, far - 1)); }
      now.far ??= far;
    }
  }
  const { light, fog, grade, ...mood } = t.mood, { dice, ...rest } = t;
  const groups: Record<string, unknown> = { light, fog, grade, dice, [group]: now };
  return settle(t, { ...rest, mood: { ...mood, light: groups.light, fog: groups.fog, grade: groups.grade }, dice: groups.dice }, known);
}

const withShelf = (t: GameTheme, shelf: Shelf, ids: string[], known: Known): GameTheme => settle(t, { ...t, pieces: { ...t.pieces, [shelf]: ids } }, known);

/** Put a piece at the end of a shelf. No change if it is there already, the shelf is full, or it is no piece at all. */
export function addPiece(t: GameTheme, shelf: Shelf, id: string, known: Known): GameTheme {
  const ids = t.pieces[shelf];
  if (ids.includes(id) || ids.length >= MAX_PIECES) return t;
  return withShelf(t, shelf, [...ids, id], known);
}
export function removePiece(t: GameTheme, shelf: Shelf, id: string, known: Known): GameTheme {
  return t.pieces[shelf].includes(id) ? withShelf(t, shelf, t.pieces[shelf].filter((i) => i !== id), known) : t;
}
/** Move a piece `by` places along its shelf (negative is earlier); it stops at the ends. */
export function movePiece(t: GameTheme, shelf: Shelf, id: string, by: number, known: Known): GameTheme {
  const ids = [...t.pieces[shelf]], from = ids.indexOf(id);
  if (from < 0) return t;
  const to = Math.max(0, Math.min(ids.length - 1, from + Math.trunc(by)));
  if (to === from) return t;
  ids.splice(to, 0, ...ids.splice(from, 1));
  return withShelf(t, shelf, ids, known);
}

/** A board's atmosphere as its settings stand (see `atmo` in theme.ts). */
export interface Atmosphere { sky: string; season: string; glow: number; amb: string }

/**
 * A new theme from how a board looks right now: its sky, season, firelight and soundscape,
 * and what its present theme (if it has one) adds. A theme's light and haze belong to its own
 * sky and step aside under another (`themeLook`), so they are only taken if they are showing.
 */
export function captureTheme(at: Atmosphere, base: GameTheme | null, id: string, name: string, known: Known): GameTheme | null {
  const showing = !!base && base.mood.sky === at.sky;
  return parseTheme({
    v: THEME_FORMAT, id, name, icon: base?.icon ?? '🎲',
    mood: { sky: at.sky, season: at.season, glow: at.glow, amb: at.amb, light: showing ? base.mood.light : undefined, fog: showing ? base.mood.fog : undefined, grade: base?.mood.grade },
    pieces: structuredClone(base?.pieces ?? { blocks: [], props: [], minis: [] }),
    gen: base?.gen ?? '', dice: base?.dice, sounds: base?.sounds, gens: base?.gens,
  }, known);
}

// ---- size, and travelling as text ----

/** How much of the table's state a theme takes, in bytes. */
export const themeSize = (t: GameTheme): number => new TextEncoder().encode(JSON.stringify(t)).length;
export const tooBig = (t: GameTheme): boolean => themeSize(t) > THEME_MAX;
/** "2.4 kB" */
export const kB = (bytes: number): string => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} kB`;

/** A theme as a code to paste to somebody: the same packing as a shared slab. */
export async function themeCode(t: GameTheme): Promise<string> {
  return THEME_TAG + await pack(t);
}
/** Read a pasted code. Null if it is not a theme this app can read, or one too big to put on a table. */
export async function readThemeCode(text: string, known: Known): Promise<GameTheme | null> {
  const at = text.indexOf(THEME_TAG), code = (at < 0 ? text : text.slice(at + THEME_TAG.length)).trim().split(/\s/)[0];
  if (!code || code.length > THEME_MAX * 2) return null;
  try {
    const t = parseTheme(await unpack(code), known);
    return t && !tooBig(t) ? settle(t, t, known) : null;
  } catch { return null; }
}

// ---- the themes a device keeps ("Mine") ----

/** Read the saved list. Anything that is not a theme is dropped. */
export function parseSaved(json: string | null | undefined, known: Known): GameTheme[] {
  let raw: unknown;
  try { raw = JSON.parse(json ?? '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, GameTheme>();
  for (const r of raw) {
    const t = parseTheme(r, known);
    if (t && !tooBig(t) && !out.has(t.id)) out.set(t.id, t);
  }
  return [...out.values()].slice(0, MAX_SAVED);
}
/** Keep a theme: in place of the one with its id, else in front. The oldest fall off the end. */
export function saveTheme(list: readonly GameTheme[], t: GameTheme): GameTheme[] {
  return (list.some((s) => s.id === t.id) ? list.map((s) => (s.id === t.id ? t : s)) : [t, ...list]).slice(0, MAX_SAVED);
}
export const forgetTheme = (list: readonly GameTheme[], id: string): GameTheme[] => list.filter((t) => t.id !== id);

// ---- undo ----

/** The states an editing session went through: the last `max`, with redo until the next change. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private tag = '';
  private at = -Infinity;
  constructor(public now: T, private max = 30) {}
  /**
   * A new state. Changes with the same `tag` in quick succession (a slider being dragged, a
   * name being typed) are one step. Returns false if nothing changed.
   */
  push(next: T, tag = '', time = Date.now()): boolean {
    if (same(next, this.now)) return false;
    if (!(tag && tag === this.tag && time - this.at < 1000)) {
      this.past.push(this.now);
      if (this.past.length > this.max) this.past.shift();
    }
    this.now = next;
    this.future = [];
    this.tag = tag;
    this.at = time;
    return true;
  }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  undo(): boolean { return this.step(this.past, this.future); }
  redo(): boolean { return this.step(this.future, this.past); }
  private step(from: T[], to: T[]): boolean {
    if (!from.length) return false;
    to.push(this.now);
    this.now = from.pop()!;
    this.tag = '';
    return true;
  }
}

// ---- colour: the editor's hue / vividness / lightness sliders ----

/** `#rrggbb` as hue 0–360, saturation and lightness 0–100. */
export function hexToHsl(hex: string): [h: number, s: number, l: number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60) % 360, Math.round(s * 100), Math.round(l * 100)];
}
export function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.min(100, Math.max(0, s)) / 100, lig = Math.min(100, Math.max(0, l)) / 100, hue = (((h % 360) + 360) % 360) / 30;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + hue) % 12;
    return Math.round((lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
