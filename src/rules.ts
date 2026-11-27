// Table rules that are pure functions of the shared Store: who is the GM, what
// a player may see and move, and whose turn it is. No rendering in here, so it
// is all unit-testable.
//
// Trust model: everyone at the table holds the same room key, so these rules
// decide what each player's *app* shows and allows. They keep honest players
// from spoiling surprises; they are not a defence against someone who edits
// the code.
import { BLOCKS } from './catalog';
import type { Store } from './store';

export interface CellVal { i: string; r?: number }
export interface MiniVal {
  x: number; y: number; z: number;
  k: string; c: string; n: string; r: number; s: number;
  /** Hit points and their maximum (absent = not tracked). */
  hp?: number; mhp?: number;
  /** Initiative score; minis that have one are in the turn order. */
  ini?: number;
  /** Hidden by the GM: players do not see it at all. */
  h?: boolean;
  /** Flying height above the surface it stands over, in cells. */
  e?: number;
  /** Who may move it besides the GM: a player id, '*' for everyone, absent for nobody. */
  o?: string;
  /** Knocked down: drawn lying on its side. */
  d?: boolean;
  /** Up to four free-form stat lines, e.g. "AC 15". */
  st?: string[];
}
export interface Turn { id: string; round: number }

/** Short player id used inside the store (prefix of the Nostr public key). */
export const pid = (pubkey: string) => pubkey.slice(0, 10);

export function gms(store: Store): string[] {
  return [...store.keys('gm:')].map((k) => k.slice(3));
}
/** With no GM the table is free play: everyone can do everything. */
export function fullPowers(store: Store, me: string): boolean {
  const g = gms(store);
  return !g.length || g.includes(me);
}
export const fogged = (store: Store, x: number, z: number) => store.get(`f:${x},${z}`) === true;
export const setting = <T>(store: Store, name: string, fallback: T) => store.get<T>(`set:${name}`) ?? fallback;

export function canControl(store: Store, me: string, v: MiniVal): boolean {
  return fullPowers(store, me) || v.o === me || v.o === '*';
}

/** Does this cell block sight? Solid blocks do; water and other see-through blocks do not. */
function opaque(store: Store, x: number, y: number, z: number): boolean {
  const v = store.get<CellVal>(`b:${x},${y},${z}`);
  const d = v && BLOCKS[v.i];
  return !!d && d.opacity === undefined;
}

const eye = (v: MiniVal): [number, number, number] => [v.x + 0.5, v.y + (v.e ?? 0) + 0.75 * (v.s || 1), v.z + 0.5];
const SIGHT = 60;

function clear(store: Store, a: [number, number, number], b: [number, number, number]): boolean {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len > SIGHT) return false;
  const steps = Math.ceil(len / 0.2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (opaque(store, Math.floor(a[0] + d[0] * t), Math.floor(a[1] + d[1] * t), Math.floor(a[2] + d[2] * t))) return false;
  }
  return true;
}

/** Line of sight between two minis: from the looker's eyes to the other's head or feet. */
export function sees(store: Store, from: MiniVal, to: MiniVal): boolean {
  const e = eye(from), head = eye(to);
  return clear(store, e, head) || clear(store, e, [head[0], to.y + (to.e ?? 0) + 0.2, head[2]]);
}

export type Shown = 'yes' | 'ghost' | 'no';

/**
 * How a mini appears to player `me`. The GM (and everyone in free play) sees
 * all, with hidden minis ghosted. Players never see hidden minis or ones under
 * fog, and with line of sight on they see others only through the eyes of the
 * minis they control.
 */
export function miniShown(store: Store, me: string, v: MiniVal, eyes: MiniVal[] | null): Shown {
  if (fullPowers(store, me)) return v.h ? 'ghost' : 'yes';
  if (v.h) return 'no';
  if (v.o === me || v.o === '*') return 'yes';
  if (fogged(store, v.x, v.z)) return 'no';
  if (!eyes || !eyes.length) return 'yes'; // line of sight off, or a spectator with no mini
  return eyes.some((e) => sees(store, e, v)) ? 'yes' : 'no';
}

/** The minis a player sees through, or null when line of sight is switched off. */
export function eyesOf(store: Store, me: string): MiniVal[] | null {
  if (!setting(store, 'los', false)) return null;
  const out: MiniVal[] = [];
  for (const k of store.keys('m:')) {
    const v = store.get<MiniVal>(k)!;
    if (!v.h && (v.o === me || v.o === '*')) out.push(v);
  }
  return out;
}

/** Everyone with an initiative score, highest first. */
export function turnOrder(store: Store): { id: string; v: MiniVal }[] {
  const out: { id: string; v: MiniVal }[] = [];
  for (const k of store.keys('m:')) {
    const v = store.get<MiniVal>(k)!;
    if (typeof v.ini === 'number') out.push({ id: k.slice(2), v });
  }
  return out.sort((a, b) => b.v.ini! - a.v.ini! || (a.id < b.id ? -1 : 1));
}

export function nextTurn(store: Store): Turn | null {
  const order = turnOrder(store);
  if (!order.length) return null;
  const cur = store.get<Turn>('turn');
  const i = cur ? order.findIndex((o) => o.id === cur.id) : -1;
  if (i < 0) return { id: order[0].id, round: cur?.round ?? 1 };
  const last = i === order.length - 1;
  return { id: order[last ? 0 : i + 1].id, round: (cur!.round || 1) + (last ? 1 : 0) };
}

/** Straight-line distance between two points in cells, and in feet at 5 ft per cell. */
export function measure(a: number[], b: number[]): { cells: number; feet: number } {
  const cells = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return { cells, feet: Math.round(cells) * 5 };
}
