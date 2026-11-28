// Hints: a line of help at the moment it is of use, once per device, one at a time. There is
// no tour: a hint is offered when its moment comes, waits its turn behind whatever notice the
// action itself caused, and is never shown again. What is waiting and what has been seen is
// pure (below), so the order can be checked without a screen.

import type { Notice } from './notice';

export interface Hint { id: string; text: string }
export interface Hints {
  /** The hints this device has been shown, oldest first. */
  seen: string[];
  /** Offered and not shown yet, in the order they were offered. */
  queue: Hint[];
  /** The one on screen. */
  showing: string | null;
}
/** Most hints remembered (the list lives in local storage) and most waiting at once: a queue of hints is a tour. */
export const MAX_SEEN = 64, MAX_WAITING = 2;

/** What local storage held: anything else than a list of ids is no list. */
export function readSeen(raw: string | null): string[] {
  try { const v: unknown = JSON.parse(raw ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-MAX_SEEN) : []; } catch { return []; }
}
export const start = (seen: string[] = []): Hints => ({ seen, queue: [], showing: null });
/** A hint's moment has come. Nothing changes if it was seen, is on screen, is waiting already, or too many are. */
export function offer(st: Hints, hint: Hint): Hints {
  if (st.seen.includes(hint.id) || st.showing === hint.id || st.queue.some((q) => q.id === hint.id) || st.queue.length >= MAX_WAITING) return st;
  return { ...st, queue: [...st.queue, hint] };
}
/** Its moment passed before its turn came (the brush was put down, the dice thrown): it waits for the next time. */
export function withdraw(st: Hints, id: string): Hints {
  return st.queue.some((q) => q.id === id) ? { ...st, queue: st.queue.filter((q) => q.id !== id) } : st;
}
/** The screen is free: the next hint to show, if any. It counts as seen from the moment it is shown. */
export function next(st: Hints): [Hints, Hint | null] {
  if (st.showing !== null || !st.queue.length) return [st, null];
  const [hint, ...queue] = st.queue;
  return [{ seen: [...st.seen, hint.id].slice(-MAX_SEEN), queue, showing: hint.id }, hint];
}
/** The hint on screen has had its time. */
export const done = (st: Hints): Hints => (st.showing === null ? st : { ...st, showing: null });

/** How long a hint waits behind the notice of what was just done, and the pause between two hints. */
const WAIT = 1900, GAP = 700;

export interface HintBox { hint(id: string, text: string): void; withdraw(id: string): void }
/** Hints shown through the table's one notice line, remembered in local storage (`cottontale:hints`). */
export function mountHints(notice: Notice, store: { get(k: string): string | null; set(k: string, v: string): void }): HintBox {
  let st = start(readSeen(store.get('hints'))), timer: ReturnType<typeof setTimeout> | undefined;
  function step(): void {
    timer = undefined;
    st = done(st);
    const [now, hint] = next(st);
    st = now;
    if (!hint) return;
    store.set('hints', JSON.stringify(st.seen));
    const ms = Math.min(7000, 2600 + hint.text.length * 50);
    notice.say(hint.text, ms);
    timer = setTimeout(step, ms + GAP);
  }
  return {
    hint(id, text) {
      st = offer(st, { id, text });
      if (st.queue.length && timer === undefined) timer = setTimeout(step, WAIT);
    },
    withdraw(id) { st = withdraw(st, id); },
  };
}
