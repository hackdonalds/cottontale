// Which first-run step a seat is due, if any. Pure, so the order can be checked
// (firstStep.test.ts) before anything is drawn; ui/firstRun.ts draws the steps.

/** `start`: the GM of an empty board picks what to begin with. `character`: a player with no figure picks one. `ask`: there is none to pick. */
export type Step = 'start' | 'character' | 'ask';

export interface Seat {
  /** The relays have answered: before that an empty board may only be one that has not arrived yet. */
  synced: boolean;
  /** This device is the GM / has the GM's powers (also true of everyone at a table without a GM). */
  gm: boolean; full: boolean;
  /** Nothing stands on the board in view. */
  empty: boolean;
  /** A figure on this board is this player's own. */
  owns: boolean;
  /** How many figures are free for a player to take. */
  free: number;
  /** A drawer is up: a step never takes the place of what somebody opened. */
  busy: boolean;
  /** The steps already offered since sitting down: each is offered once, and closing it is an answer. */
  offered: Step[];
}

export function stepFor(s: Seat): Step | null {
  if (!s.synced) return null;
  const due = (step: Step) => !s.offered.includes(step);
  if (s.gm) return s.empty && !s.busy && due('start') ? 'start' : null;
  // A table without a GM is free play, as it always was: nobody is asked anything.
  if (s.full || s.owns) return null;
  if (s.free > 0) return !s.busy && due('character') ? 'character' : null;
  return due('ask') && due('character') ? 'ask' : null;
}
