// Themes: what kind of game this table is playing. A theme is plain data, never code:
// a mood (sky, season, firelight, soundscape), the pieces that belong to it (shown
// first in the library), and the scene generator that suits it. The GM picks one and
// the whole table follows.
//
// No theme is written into the app. The ones it offers are files (public/themes/*.json,
// listed in index.json), and picking one copies the whole theme into the table
// (`at:theme`, see `atmo` below), so it travels with the table and needs no file on anyone else's device.
// Either way it is somebody else's data and untrusted: `parseTheme` keeps what it understands, clamps the numbers and
// drops ids this build does not know. That is also what lets a newer app share a
// theme with an older one.
import { parsePreset, type Preset } from './gen';
import { parseSounds, type SoundBank } from './sound';

export const SKY_IDS = ['day', 'dusk', 'night'] as const;
export const SEASON_IDS = ['summer', 'spring', 'autumn', 'winter'] as const;
export const THEME_FORMAT = 1;
/** Most pieces a theme may put on one shelf: a phone shows a shelf as one scrolling row. */
export const MAX_PIECES = 24;

/**
 * The light of a sky, for a theme that wants its own instead of the named one: the dark behind
 * the table, the sun (colour, strength), the light from all around (colour, strength), how far
 * fire and magic spill into the picture, and how much of the room polished things reflect.
 * Whatever a theme leaves out is taken from its named sky (`SKIES` in board.ts).
 */
export interface Light { bg?: string; sun?: string; sunI?: number; hemi?: string; hemiI?: number; spill?: number; sheen?: number }
/** Haze over the table: where it starts and where nothing shows through, in cells from the eye. No colour = the dark behind the table. */
export interface Fog { color?: string; near: number; far: number }
/** The finished picture's grade (see look.ts). `warmth` 1 is warm lights over cool shadows, 0 neutral, below 0 the other way round. */
export interface Grade { sat?: number; warmth?: number; contrast?: number; vignette?: number }
/** The table's dice: body and number colour, and how they catch the light. What is left out stays as it was (the thrower's colour, plain plastic). */
export interface DiceLook { body?: string; ink?: string; rough?: number; metal?: number }
/** `light`, `fog` and `grade` are the theme's own look; without them the named sky is all there is. */
export interface Mood { sky: typeof SKY_IDS[number]; season: typeof SEASON_IDS[number]; glow: number; amb: string; light?: Light; fog?: Fog; grade?: Grade }
export interface Pieces { blocks: string[]; props: string[]; minis: string[] }
export interface GameTheme {
  /** The format this was written in. A reader ignores themes from a format it does not know. */
  v: number;
  /** The themes shipped as files have plain ids; others are `<author>:<name>` so two tables' themes cannot collide. */
  id: string;
  name: string;
  /** One emoji, for the picker. */
  icon: string;
  mood: Mood;
  pieces: Pieces;
  /** The scene generator that suits it (see gen.ts), or '' for none in particular. */
  gen: string;
  /** Soundscapes and effects of its own, as recipes (sound.ts): `mood.amb` may name one of the scapes, and an effect of a known name re-voices it. */
  sounds?: SoundBank;
  /** Scene generators of its own, as presets (gen.ts): `gen` may name one. */
  gens?: Preset[];
  dice?: DiceLook;
}
/** Most generator presets a theme may carry: it travels with the table. */
export const MAX_GENS = 4;

/** What this build of the app has: asked about every id a theme mentions. */
export type Known = Record<'block' | 'prop' | 'mini' | 'amb' | 'gen', (id: string) => boolean> & { /** Wall pieces, for the generators a theme brings; without it they build no walls. */ edge?: (id: string) => boolean };

/**
 * A piece that is not built in is `<namespace>:<name>` (see registry.ts); bare ids are the core's.
 * A theme may name pieces of a pack this device has not got (yet): they are kept, and shown once the pack is here.
 */
export const PIECE_ID = /^[a-z0-9][a-z0-9_-]{0,31}:[a-z0-9][a-z0-9_.-]{0,63}$/;

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pick = <T extends string>(v: unknown, from: readonly T[]): T => (from.includes(v as T) ? (v as T) : from[0]);
function ids(v: unknown, known: (id: string) => boolean): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((id): id is string => typeof id === 'string' && (known(id) || PIECE_ID.test(id))))].slice(0, MAX_PIECES);
}
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
/** Only the fields that were given and make sense: colours as `#rrggbb`, numbers clamped to [min, max]. Undefined if none did. */
function fields<T>(v: unknown, colours: (keyof T & string)[], numbers: [key: keyof T & string, min: number, max: number][]): T | undefined {
  const r = obj(v), out: Record<string, unknown> = {};
  if (!r) return undefined;
  for (const k of colours) if (typeof r[k] === 'string' && /^#[0-9a-f]{6}$/i.test(r[k] as string)) out[k] = (r[k] as string).toLowerCase();
  for (const [k, min, max] of numbers) if (typeof r[k] === 'number' && Number.isFinite(r[k])) out[k] = Math.min(max, Math.max(min, r[k] as number));
  return Object.keys(out).length ? (out as T) : undefined;
}
function fog(v: unknown): Fog | undefined {
  const f = fields<Fog>(v, ['color'], [['near', 0, 200], ['far', 1, 400]]);
  if (f?.near === undefined || f.far === undefined) return undefined; // haze needs both ends
  return { ...f, far: Math.max(f.far, f.near + 1) };
}

/** Read a theme somebody else wrote. Null if it is not one; otherwise only what this app understands. */
export function parseTheme(raw: unknown, known: Known): GameTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>, id = text(r.id, 48), name = text(r.name, 32);
  if (r.v !== THEME_FORMAT || !/^[a-z0-9][a-z0-9:_-]*$/.test(id) || !name) return null;
  const m = (r.mood && typeof r.mood === 'object' ? r.mood : {}) as Record<string, unknown>;
  const p = (r.pieces && typeof r.pieces === 'object' ? r.pieces : {}) as Record<string, unknown>;
  const glow = typeof m.glow === 'number' && Number.isFinite(m.glow) ? Math.min(2, Math.max(0, Math.round(m.glow * 4) / 4)) : 1;
  const amb = text(m.amb, 24), gen = text(r.gen, 24);
  const light = fields<Light>(m.light, ['bg', 'sun', 'hemi'], [['sunI', 0, 8], ['hemiI', 0, 3], ['spill', 0, 1], ['sheen', 0, 1]]);
  const haze = fog(m.fog);
  const grade = fields<Grade>(m.grade, [], [['sat', 0, 1.5], ['warmth', -1, 2], ['contrast', 0, 1], ['vignette', 0, 1.5]]);
  const dice = fields<DiceLook>(r.dice, ['body', 'ink'], [['rough', 0, 1], ['metal', 0, 1]]);
  const t: GameTheme = {
    v: THEME_FORMAT, id, name,
    icon: [...text(r.icon, 16)].slice(0, 4).join('') || '🎲',
    mood: { sky: pick(m.sky, SKY_IDS), season: pick(m.season, SEASON_IDS), glow, amb: known.amb(amb) ? amb : 'off', ...(light && { light }), ...(haze && { fog: haze }), ...(grade && { grade }) },
    pieces: { blocks: ids(p.blocks, known.block), props: ids(p.props, known.prop), minis: ids(p.minis, known.mini) },
    gen: known.gen(gen) ? gen : '',
    ...(dice && { dice }),
  };
  // ---- what the theme brings with it: sound recipes and generator presets (sound.ts, gen.ts) ----
  const sounds = parseSounds(r.sounds), piece = (kind: 'block' | 'prop' | 'edge', i: string) => known[kind]?.(i) ?? false;
  const gens = (Array.isArray(r.gens) ? r.gens.slice(0, MAX_GENS) : []).map((g) => parsePreset(g, piece)).filter((g): g is Preset => !!g);
  if (sounds) t.sounds = sounds;
  if (gens.length) t.gens = gens;
  if (sounds?.scapes?.[amb]) t.mood.amb = amb; // its own soundscape
  if (gens.some((g) => g.id === gen)) t.gen = gen; // its own generator
  // ---- end of what the theme brings ----
  return t;
}

/** A board's theme, read from the table (see `atmo`): with the pieces this device has, the rest left out until their pack arrives. */
export function activeTheme(raw: unknown, known: Known): GameTheme | null {
  const t = parseTheme(raw, known);
  if (!t) return null;
  const { blocks, props, minis } = t.pieces;
  return { ...t, pieces: { blocks: blocks.filter(known.block), props: props.filter(known.prop), minis: minis.filter(known.mini) } };
}

/**
 * What a theme makes of the picture under a given sky. Its light and haze were made for its own
 * sky, so they step aside when the GM picks another; its grade and its dice stay.
 */
export function themeLook(t: GameTheme | null, sky: string): { light?: Light; fog?: Fog; grade?: Grade; dice?: DiceLook } {
  if (!t) return {};
  const own = sky === t.mood.sky;
  return { light: own ? t.mood.light : undefined, fog: own ? t.mood.fog : undefined, grade: t.mood.grade, dice: t.dice };
}

// ---- atmosphere ---------------------------------------------------------------------
// Theme and mood belong to a board (`at:<name>`, scoped by the store like the board's
// pieces), so the crypt and the meadow above it can each have their own. A board that has
// never been given one shows the table's (`set:<name>`): what older tables wrote, and the default.

export const ATMO = ['theme', 'sky', 'season', 'glow', 'amb'] as const;
export type AtmoKey = typeof ATMO[number];
/** As much of the Store as the atmosphere needs. */
interface Table { get<T = unknown>(key: string): T | null; set(key: string, value: unknown): void }

/** A setting of the current board's atmosphere, else the table's, else `fallback`. */
export const atmo = <T>(store: Table, name: AtmoKey, fallback: T): T => store.get<T>(`at:${name}`) ?? store.get<T>(`set:${name}`) ?? fallback;
/** Set it for the current board. Letting go of a theme writes '' rather than nothing, so the table's does not show through. */
export function setAtmo(store: Table, name: AtmoKey, value: unknown): void { store.set(`at:${name}`, value ?? (name === 'theme' ? '' : null)); }

/** The themes on offer: `<dir>/index.json` lists them, one file each. A missing or broken one is skipped. */
export async function loadThemes(dir: string, known: Known, get: (url: string) => Promise<unknown> = async (url) => (await fetch(url)).json()): Promise<GameTheme[]> {
  const list = await get(`${dir}/index.json`).catch(() => null);
  if (!Array.isArray(list)) return [];
  const names = list.filter((n): n is string => typeof n === 'string' && /^[a-z0-9_-]+$/.test(n)).slice(0, 64);
  const all = await Promise.all(names.map((n) => get(`${dir}/${n}.json`).then((raw) => parseTheme(raw, known), () => null)));
  return all.filter((t): t is GameTheme => !!t);
}

/** The settings a theme's mood stands for: what picking it writes to the table, in one go. */
export function moodEdits(t: GameTheme): [name: AtmoKey, value: unknown][] {
  return [['sky', t.mood.sky], ['season', t.mood.season], ['glow', t.mood.glow], ['amb', t.mood.amb]];
}
