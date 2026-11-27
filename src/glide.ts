// Camera moves and ambient life: the decisions and the arithmetic, kept free of the
// renderer so they can be tested. The board (board.ts) does the moving and drawing.
//
// Neither is shared: every device decides for itself whether to follow a turn or let the
// leaves stir, so nothing here touches the store.

/** Slow out, slow in: 0 → 0, 1 → 1, and at rest at both ends. */
export function ease(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** The part of a screen things should sit in to count as "in view": clear of the bars along its edges. */
export function safeArea(w: number, h: number): Box {
  const m = Math.max(48, Math.min(w, h) * 0.14);
  return { x0: m, y0: m, x1: w - m, y1: h - m };
}

/** Is a point on the screen (null: not on it at all) outside the area, so the camera should go to it? */
export function outOfView(spot: { x: number; y: number } | null, area: Box): boolean {
  return !spot || spot.x < area.x0 || spot.x > area.x1 || spot.y < area.y0 || spot.y > area.y1;
}

/**
 * How far the picture has to slide, in pixels, to bring a box of things into the area: the
 * least that does it, and nothing at all if they are already there. Something too big to fit
 * is centred instead.
 */
export function nudge(box: Box, area: Box): [number, number] {
  const one = (a0: number, a1: number, lo: number, hi: number) => {
    if (a1 - a0 > hi - lo) return (lo + hi) / 2 - (a0 + a1) / 2;
    return a0 < lo ? lo - a0 : a1 > hi ? hi - a1 : 0;
  };
  return [one(box.x0, box.x1, area.x0, area.x1), one(box.y0, box.y1, area.y0, area.y1)];
}

/**
 * A camera move in progress: a fixed slide of the whole view, handed out a frame at a time.
 * It works in steps (not "be here by then") so that anything else moving the camera meanwhile
 * is added to, never fought, and dropping it part-way leaves the view wherever it had got to.
 */
export class Glide {
  private t = 0;
  constructor(private by: [number, number, number], private seconds = 0.5) {}
  /** This frame's share of the slide, or null once it is over. */
  step(dt: number): [number, number, number] | null {
    if (this.t >= 1) return null;
    const was = ease(this.t);
    this.t = this.seconds > 0 ? this.t + dt / this.seconds : 1;
    if (this.t > 1 - 1e-6) this.t = 1;
    const k = ease(this.t) - was;
    return [this.by[0] * k, this.by[1] * k, this.by[2] * k];
  }
  get done(): boolean { return this.t >= 1; }
}

// ---- ambient life ---------------------------------------------------------------

/** Ambient frames are this far apart (about 14 a second): enough for leaves in a breeze, a quarter of the cost. */
export const AMBIENT_MS = 70;

export interface Ambience {
  /** The player's own switch. */
  on: boolean;
  /** The page is in the background. */
  hidden: boolean;
  /** This device has already had to give up quality to keep up (see Board.adapt). */
  slowed: boolean;
  /** Something on the table can actually move: a leaf, a flame, a lit lamp. */
  alive: boolean;
}

/** May the table stir at all right now? */
export function ambientLive(a: Ambience): boolean {
  return a.on && !a.hidden && !a.slowed && a.alive;
}

/** Is it time for an idle table to draw another ambient frame? */
export function ambientDue(a: Ambience, now: number, lastDrawn: number, every = AMBIENT_MS): boolean {
  return ambientLive(a) && now - lastDrawn >= every;
}

/**
 * How bright a fire burns at a moment, around 1: a slow breathing with a quicker tremble on
 * top, each lamp (`i`) out of step with the others. Never more than a tenth either way.
 */
export function flicker(seconds: number, i = 0): number {
  const t = seconds + i * 7.3;
  return 1 + 0.045 * Math.sin(t * 2.3) + 0.03 * Math.sin(t * 7.1 + 1.3) + 0.02 * Math.sin(t * 13.7 + i);
}
