// Touch feedback: short buzzes from the phone's vibration motor.
//
// Everything that vibrates goes through `buzz`, so the one on/off switch (a
// local preference, like sound) covers all of it. Browsers without a motor or
// without the API (iOS Safari) simply do nothing.

const KEY = 'cottontale:haptics';
let on = true;
try { on = localStorage.getItem(KEY) !== 'off'; } catch { /* no storage (or blocked): stay on */ }

export const hapticsOn = (): boolean => on;
/** Whether this browser can vibrate at all (no point offering the switch otherwise). */
export const canBuzz = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export function setHaptics(v: boolean): void {
  on = v;
  try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* storage full or blocked */ }
  if (!v && canBuzz()) navigator.vibrate(0); // cut short whatever is still buzzing
}

/** Vibrate: milliseconds, or a pattern of buzz, pause, buzz… */
export function buzz(pattern: number | number[]): void {
  if (!on || !canBuzz()) return;
  try { navigator.vibrate(pattern); } catch { /* not allowed before the first touch */ }
}

/** How long a tick a bounce of this strength (0–1) deserves: a tap for a rattle, a thud for a drop. */
export const tickFor = (strength: number): number => Math.round(4 + 14 * Math.min(1, Math.max(0, strength)));

/**
 * Thins a stream of impacts down to what a motor can render: at most one tick per `gap` ms,
 * and nothing for the faintest touches. Returns the tick length, or 0 for "skip this one".
 */
export function ticker(gap = 60, floor = 0.08): (strength: number, now: number) => number {
  let last = -Infinity;
  return (strength, now) => {
    if (!(strength >= floor) || now - last < gap) return 0;
    last = now;
    return tickFor(strength);
  };
}

/** What a finished roll feels like: a long buzz for a die showing its highest face, a double tick for a 1 on a d20. */
export function rollBuzz(kinds: string[], values: number[]): number[] | null {
  // A percentile pair gives one value for two dice: line the values up with the die that leads each.
  const lead = kinds.filter((k, i) => !(k === 'd10' && kinds[i - 1] === 'd100'));
  if (lead.some((k, i) => k !== 'd2' && values[i] === +k.slice(1))) return [70, 40, 110];
  if (lead.some((k, i) => k === 'd20' && values[i] === 1)) return [18, 70, 18];
  return null;
}
