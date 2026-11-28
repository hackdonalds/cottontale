// The library's small lists and its search: pure, so they can be unit-tested (src/core.test.ts).
// Pieces are named by key — `b_grass`, `p_barrel`, `m_knight`, the same names their pictures
// have — because a block, a prop and a mini may share an id. Ids are never assumed to be known:
// packs come and go, so a list may name pieces this table does not have (callers skip those).

/** How many recent pieces a shelf remembers: one row on a phone. */
export const MAX_RECENT = 8;
/** Favourites are a shelf too; this keeps it one that can still be scrolled with a thumb. */
export const MAX_FAVS = 48;

/** How many pieces the hotbar holds: a row a thumb can run along. */
export const MAX_HOTBAR = 10;
/** Of those, how many are kept for recent pieces however many are pinned: what was just used must not fall off the row. */
const HOTBAR_RECENT = 2;

/**
 * What the hotbar shows: pinned pieces first, in their order, then the recent ones that are not pinned,
 * each once. Pieces this table does not have (`has`) are left out.
 */
export function hotbarKeys(favs: readonly string[], recents: readonly string[], has: (key: string) => boolean, max = MAX_HOTBAR): string[] {
  const seen = new Set<string>(), once = (k: string) => has(k) && !seen.has(k) && !!seen.add(k);
  const pinned = favs.filter(once), rest = recents.filter(once);
  return [...pinned.slice(0, Math.max(0, max - Math.min(rest.length, HOTBAR_RECENT))), ...rest].slice(0, max);
}

/** A row under a thumb must not shuffle: while it holds the same pieces it keeps the order it had (`prev`, returned as it is). */
export function steady(prev: readonly string[], next: readonly string[]): readonly string[] {
  return prev.length === next.length && next.every((k) => prev.includes(k)) ? prev : next;
}

/** The list with `key` moved (or added) to the front. Returns the same array if nothing changed. */
export function pushRecent(list: readonly string[], key: string, max = MAX_RECENT): readonly string[] {
  if (!key || list[0] === key) return list;
  return [key, ...list.filter((k) => k !== key)].slice(0, max);
}

/** Pin or unpin. A new favourite goes to the end, so the shelf keeps its order. */
export function toggleFav(list: readonly string[], key: string, max = MAX_FAVS): readonly string[] {
  if (!key) return list;
  if (list.includes(key)) return list.filter((k) => k !== key);
  return [...list, key].slice(-max);
}

/** Read lists saved on this device (`{ category: keys }`). Anything that is not one is dropped. */
export function parseLists(json: string | null | undefined, max: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let raw: unknown;
  try { raw = JSON.parse(json ?? 'null'); } catch { return out; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [cat, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const keys = [...new Set(list.filter((k): k is string => typeof k === 'string' && k.length > 2 && k.length <= 80))].slice(0, max);
    if (keys.length) out[cat] = keys;
  }
  return out;
}

/** Lower case, accents off, punctuation to spaces: "Dead-Tree" and "dead tree" are the same words. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * How well a name answers a search, 0 for not at all. Every word typed must be in the name;
 * a name that starts with what was typed beats one where a word starts with it, which beats
 * one that merely contains it.
 */
export function matchScore(name: string, query: string): number {
  const n = fold(name), q = fold(query);
  if (!q) return 1;
  if (!n) return 0;
  const words = n.split(' ');
  let score = 3;
  for (const term of q.split(' ')) {
    if (!n.includes(term)) return 0;
    score = Math.min(score, n.startsWith(term) ? 3 : words.some((w) => w.startsWith(term)) ? 2 : 1);
  }
  return score;
}

/** The items a search finds, best first; ties keep the order they came in (the order of the shelves). */
export function searchPieces<T extends { name: string }>(items: readonly T[], query: string): T[] {
  if (!fold(query)) return [...items];
  return items.map((item, i) => ({ item, i, s: matchScore(item.name, query) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.item);
}
