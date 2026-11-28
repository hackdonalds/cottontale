import { describe, expect, it } from 'vitest';
import { stepFor, type Seat } from './firstStep';

const seat = (more: Partial<Seat> = {}): Seat => ({ synced: true, gm: false, full: false, empty: false, owns: false, free: 0, busy: false, offered: [], ...more });

describe('first-run steps', () => {
  it('waits for the table to arrive before asking anything', () => {
    expect(stepFor(seat({ synced: false, gm: true, full: true, empty: true }))).toBeNull();
    expect(stepFor(seat({ synced: false, free: 2 }))).toBeNull();
  });

  it('offers the GM of an empty board a way to start, once, and never over an open drawer', () => {
    const gm = seat({ gm: true, full: true, empty: true });
    expect(stepFor(gm)).toBe('start');
    expect(stepFor({ ...gm, busy: true })).toBeNull();
    expect(stepFor({ ...gm, offered: ['start'] })).toBeNull();
    expect(stepFor({ ...gm, empty: false })).toBeNull();
  });

  it('asks nobody anything at a table without a GM', () => {
    expect(stepFor(seat({ full: true, empty: true }))).toBeNull();
    expect(stepFor(seat({ full: true, free: 3 }))).toBeNull();
  });

  it('has a player without a figure pick one, or says whom to ask', () => {
    expect(stepFor(seat({ free: 2 }))).toBe('character');
    expect(stepFor(seat({ free: 2, busy: true }))).toBeNull();
    expect(stepFor(seat({ free: 2, offered: ['character'] }))).toBeNull();
    expect(stepFor(seat({ free: 2, owns: true }))).toBeNull();
    expect(stepFor(seat())).toBe('ask');
    expect(stepFor(seat({ offered: ['ask'] }))).toBeNull();
    // Told to ask, then the GM frees a figure: now there is one to pick.
    expect(stepFor(seat({ free: 1, offered: ['ask'] }))).toBe('character');
    expect(stepFor(seat({ offered: ['character'] }))).toBeNull(); // they closed the list: no nagging afterwards
  });
});
