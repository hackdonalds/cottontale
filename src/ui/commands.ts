// The one search of the Table drawer: what can be found, and how well it answers what was
// typed. Pure, so it can be unit-tested (commands.test.ts): the entries themselves are made
// from the session at draw time (ui/tableSearch.ts), this only ranks them.

import { fold, matchScore } from './library';

export type CommandGroup = 'Action' | 'Setting' | 'Page' | 'Piece';

export interface Command {
  /** Stable, and unique in a list (`act:ruler`, `set:sound`, `page:theme`, `piece:p_barrel`). */
  id: string;
  /** What the row says, and what a search reads first. */
  title: string;
  /** Other words someone might type for it ("fog" for Reveal all, "mute" for Sound). */
  keywords?: string[];
  group: CommandGroup;
  /** A line under the title: where it lives, or why it cannot be used ("GM only"). */
  hint?: string;
  /** False: shown, but not for this seat. */
  available?: boolean;
}

/** How many results a search shows: more than that and the answer is to type another letter. */
export const MAX_RESULTS = 30;

/**
 * How well an entry answers a search, 0 for not at all. A hit in the title beats the same
 * kind of hit in a keyword, and a search whose words are spread over the title and the
 * keywords ("sound off") still finds the entry, last.
 */
export function commandScore(c: Command, query: string): number {
  const q = fold(query);
  if (!q) return 0;
  const title = matchScore(c.title, q), words = c.keywords ?? [];
  const word = Math.max(0, ...words.map((k) => matchScore(k, q)));
  if (title || word) return Math.max(title ? title * 2 + 1 : 0, word * 2);
  return words.length && matchScore([c.title, ...words].join(' '), q) ? 1 : 0;
}

/**
 * The entries a search finds, best first; ties keep the order they came in. Nothing typed
 * finds nothing: the drawer's own sections are what there is to browse.
 */
export function searchCommands<T extends Command>(entries: readonly T[], query: string, max = MAX_RESULTS): T[] {
  if (!fold(query)) return [];
  return entries.map((item, i) => ({ item, i, s: commandScore(item, query) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map((x) => x.item);
}
