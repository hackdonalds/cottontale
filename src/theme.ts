// Themes: what kind of game this table is playing. A theme is plain data, never code:
// a mood (sky, season, firelight, soundscape), the pieces that belong to it (shown
// first in the library), and the scene generator that suits it. The GM picks one and
// the whole table follows.
//
// No theme is written into the app. The ones it offers are files (public/themes/*.json,
// listed in index.json), and picking one copies the whole theme into the table
// (`set:theme`), so it travels with the table and needs no file on anyone else's device.
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

export interface Mood { sky: typeof SKY_IDS[number]; season: typeof SEASON_IDS[number]; glow: number; amb: string }
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
}
/** Most generator presets a theme may carry: it travels with the table. */
export const MAX_GENS = 4;

/** What this build of the app has: asked about every id a theme mentions. */
export type Known = Record<'block' | 'prop' | 'mini' | 'amb' | 'gen', (id: string) => boolean> & { /** Wall pieces, for the generators a theme brings; without it they build no walls. */ edge?: (id: string) => boolean };

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pick = <T extends string>(v: unknown, from: readonly T[]): T => (from.includes(v as T) ? (v as T) : from[0]);
function ids(v: unknown, known: (id: string) => boolean): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((id): id is string => typeof id === 'string' && known(id)))].slice(0, MAX_PIECES);
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
  const t: GameTheme = {
    v: THEME_FORMAT, id, name,
    icon: [...text(r.icon, 16)].slice(0, 4).join('') || '🎲',
    mood: { sky: pick(m.sky, SKY_IDS), season: pick(m.season, SEASON_IDS), glow, amb: known.amb(amb) ? amb : 'off' },
    pieces: { blocks: ids(p.blocks, known.block), props: ids(p.props, known.prop), minis: ids(p.minis, known.mini) },
    gen: known.gen(gen) ? gen : '',
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

/** The table's theme, read from `set:theme`. */
export const activeTheme = parseTheme;

/** The themes on offer: `<dir>/index.json` lists them, one file each. A missing or broken one is skipped. */
export async function loadThemes(dir: string, known: Known, get: (url: string) => Promise<unknown> = async (url) => (await fetch(url)).json()): Promise<GameTheme[]> {
  const list = await get(`${dir}/index.json`).catch(() => null);
  if (!Array.isArray(list)) return [];
  const names = list.filter((n): n is string => typeof n === 'string' && /^[a-z0-9_-]+$/.test(n)).slice(0, 64);
  const all = await Promise.all(names.map((n) => get(`${dir}/${n}.json`).then((raw) => parseTheme(raw, known), () => null)));
  return all.filter((t): t is GameTheme => !!t);
}

/** The settings a theme's mood stands for: what picking it writes to the table, in one go. */
export function moodEdits(t: GameTheme): [key: string, value: unknown][] {
  return [['set:sky', t.mood.sky], ['set:season', t.mood.season], ['set:glow', t.mood.glow], ['set:amb', t.mood.amb]];
}
