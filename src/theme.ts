// Themes: what kind of game this table is playing. A theme is plain data, never code:
// a mood (sky, season, firelight, soundscape), the pieces that belong to it (shown
// first in the library), and the scene generator that suits it. The GM picks one and
// the whole table follows.
//
// A theme travels through the store like any other value, so one written by somebody
// else is untrusted: `parseTheme` keeps what it understands, clamps the numbers and
// drops ids this build does not know. That is also what lets a newer app share a
// theme with an older one.

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
  /** Built-in themes have plain ids; others are `<author>:<name>` so two tables' themes cannot collide. */
  id: string;
  name: string;
  /** One emoji, for the picker. */
  icon: string;
  mood: Mood;
  pieces: Pieces;
  /** The scene generator that suits it (see gen.ts), or '' for none in particular. */
  gen: string;
}

/** What this build of the app has: asked about every id a theme mentions. */
export type Known = Record<'block' | 'prop' | 'mini' | 'amb' | 'gen', (id: string) => boolean>;

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
  return {
    v: THEME_FORMAT, id, name,
    icon: [...text(r.icon, 16)].slice(0, 4).join('') || '🎲',
    mood: { sky: pick(m.sky, SKY_IDS), season: pick(m.season, SEASON_IDS), glow, amb: known.amb(amb) ? amb : 'off' },
    pieces: { blocks: ids(p.blocks, known.block), props: ids(p.props, known.prop), minis: ids(p.minis, known.mini) },
    gen: known.gen(gen) ? gen : '',
  };
}

/** The table's theme: `set:theme` holds the id of a built-in one, or a whole theme somebody made. */
export function activeTheme(value: unknown, known: Known): GameTheme | null {
  return parseTheme(typeof value === 'string' ? THEMES[value] : value, known);
}

/** The settings a theme's mood stands for: what picking it writes to the table, in one go. */
export function moodEdits(t: GameTheme): [key: string, value: unknown][] {
  return [['set:sky', t.mood.sky], ['set:season', t.mood.season], ['set:glow', t.mood.glow], ['set:amb', t.mood.amb]];
}

const theme = (id: string, name: string, icon: string, mood: Mood, gen: string, pieces: Pieces): GameTheme => ({ v: THEME_FORMAT, id, name, icon, mood, pieces, gen });

/** The themes that come with the app. They are written in the same format anybody else's would be. */
export const THEMES: Record<string, GameTheme> = Object.fromEntries([
  theme('cosy', 'Cosy', '🐇', { sky: 'day', season: 'spring', glow: 1, amb: 'calm' }, 'forest', {
    blocks: ['meadow', 'grass', 'dirt', 'wood', 'thatch', 'plaster', 'carpet', 'water'],
    props: ['tree', 'birch', 'flowers', 'mushroom', 'bush', 'stump', 'log', 'fence', 'well', 'tent', 'campfire', 'table', 'bench', 'bed', 'rug', 'cauldron'],
    minis: ['bunny', 'dog', 'horse', 'child', 'villager', 'merchant', 'druid', 'ranger', 'witch'],
  }),
  theme('pirate', 'Pirates', '🏴‍☠️', { sky: 'day', season: 'summer', glow: 1, amb: 'wind' }, 'tavern', {
    blocks: ['sand', 'water', 'wood', 'darkwood', 'gravel', 'stone', 'gold'],
    props: ['palm', 'rock', 'reeds', 'barrel', 'crate', 'sacks', 'chest', 'hoard', 'bridge', 'ladder', 'post', 'banner', 'tent', 'cage', 'bones', 'torch'],
    minis: ['pirate', 'merchant', 'guard', 'rogue', 'barbarian', 'rat', 'snake', 'skeleton', 'ghost', 'flag', 'cross'],
  }),
  theme('dark', 'Dark fantasy', '⚔️', { sky: 'dusk', season: 'autumn', glow: 1.5, amb: 'battle' }, 'dungeon', {
    blocks: ['cobble', 'stone', 'basalt', 'slate', 'mud', 'iron', 'obsidian', 'lava'],
    props: ['deadtree', 'rock', 'bones', 'spikes', 'cage', 'altar', 'statue', 'pillar', 'gate', 'torch', 'crystal', 'portal', 'chest', 'hoard', 'throne', 'anvil'],
    minis: ['knight', 'paladin', 'mage', 'cleric', 'rogue', 'barbarian', 'ogre', 'troll', 'skeleton', 'imp', 'mimic', 'dragon'],
  }),
  theme('vampire', 'Vampires', '🦇', { sky: 'night', season: 'winter', glow: 1.75, amb: 'rain' }, 'dungeon', {
    blocks: ['cobble', 'slate', 'darkwood', 'marble', 'carpet', 'obsidian', 'glass', 'snow'],
    props: ['coffin', 'tombstone', 'candles', 'deadtree', 'altar', 'statue', 'gate', 'fence', 'cage', 'bones', 'throne', 'bookshelf', 'bed', 'potion', 'torch'],
    minis: ['bat', 'ghost', 'skeleton', 'zombie', 'wolf', 'rat', 'spider', 'witch', 'villager', 'guard', 'cleric', 'child'],
  }),
].map((t) => [t.id, t]));
