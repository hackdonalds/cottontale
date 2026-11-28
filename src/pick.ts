// Editing what is already on the table: a selection of pieces is moved, turned, copied or
// removed. Pure: each function reads the store and returns ordinary edits (or null when the
// table has no room), which the board writes as one step of undo.
//
// A selection is a list of store keys: `b:x,y,z` (a block or a prop in a cell), `w:x,y,z,s`
// (a wall on a cell edge), `l:<id>` (a loose piece) and `m:<id>` (a mini).

import { BLOCKS, PROPS } from './catalog';
import { restY } from './forces';
import { ek, parseEdge, type CellVal, type MiniVal, type Side } from './rules';
import type { LooseVal } from './loose';
import type { Store } from './store';

export type Edit = [key: string, value: unknown];
export interface Picked { edits: Edit[]; keys: string[] }
type Cell = [x: number, y: number, z: number];

const LIMIT = 96, MAX_Y = 40;
const ck = (x: number, y: number, z: number) => `b:${x},${y},${z}`;
const cellOf = (key: string) => key.slice(2).split(',').map(Number) as Cell;
const inside = (x: number, y: number, z: number) => Math.abs(x) < LIMIT && Math.abs(z) < LIMIT && y >= 0 && y < MAX_Y;
const isBlock = (store: Store, x: number, y: number, z: number) => !!BLOCKS[store.get<CellVal>(ck(x, y, z))?.i ?? ''];

/** What kind of piece a key names (null: nothing a selection can hold). */
export function kindOf(key: string): 'cell' | 'wall' | 'loose' | 'mini' | null {
  return ({ 'b:': 'cell', 'w:': 'wall', 'l:': 'loose', 'm:': 'mini' } as const)[key.slice(0, 2)] ?? null;
}

/** The keys of a selection that are still on the table. */
export const present = (store: Store, keys: string[]): string[] => keys.filter((k) => kindOf(k) && store.get(k) !== null);

/** Where a piece is, in cells: its cell, the cell its wall is a side of, or the cell it lies or stands in. */
export function whereIs(store: Store, key: string): Cell | null {
  const kind = kindOf(key), v = store.get<unknown>(key);
  if (!kind || v === null) return null;
  if (kind === 'cell') return cellOf(key);
  if (kind === 'wall') { const [x, y, z] = parseEdge(key); return [x, y, z]; }
  if (kind === 'mini') { const m = v as MiniVal; return [m.x, m.y, m.z]; }
  const p = (v as LooseVal).p;
  return Array.isArray(p) ? [Math.floor(p[0] / 100), Math.floor(p[1] / 100), Math.floor(p[2] / 100)] : null;
}

/** The same piece, `d` cells away: its new key and value, or null if that is off the table. */
function shifted(store: Store, key: string, [dx, dy, dz]: Cell): Edit | null {
  const v = store.get<unknown>(key);
  switch (kindOf(key)) {
    case 'cell': {
      const [x, y, z] = cellOf(key);
      return inside(x + dx, y + dy, z + dz) ? [ck(x + dx, y + dy, z + dz), v] : null;
    }
    case 'wall': {
      const [x, y, z, s] = parseEdge(key);
      return inside(x + dx, y + dy, z + dz) ? [ek(x + dx, y + dy, z + dz, s), v] : null;
    }
    case 'loose': {
      const l = v as LooseVal, p: Cell = [l.p[0] + dx * 100, l.p[1] + dy * 100, l.p[2] + dz * 100];
      return inside(p[0] / 100, p[1] / 100, p[2] / 100) ? [key, { ...l, p }] : null;
    }
    case 'mini': {
      const m = v as MiniVal;
      return inside(m.x + dx, m.y + dy, m.z + dz) ? [key, { ...m, x: m.x + dx, y: m.y + dy, z: m.z + dz }] : null;
    }
    default: return null;
  }
}

/** May this piece come to be here, once everything in `leaving` has gone? */
function free(store: Store, [key, v]: Edit, leaving: Set<string>): boolean {
  const kind = kindOf(key);
  if (kind === 'cell' || kind === 'wall') return leaving.has(key) || store.get(key) === null;
  if (kind === 'mini') { // a figure cannot stand inside the ground
    const m = v as MiniVal;
    return leaving.has(ck(m.x, m.y, m.z)) || !isBlock(store, m.x, m.y, m.z);
  }
  return true;
}

/**
 * Move a selection `d` cells. Every piece keeps its place among the others; null if any of
 * them would leave the table or land on something that is not part of the selection.
 */
export function moveEdits(store: Store, keys: string[], d: Cell): Picked | null {
  const from = present(store, keys);
  if (!from.length) return null;
  if (!d[0] && !d[1] && !d[2]) return { edits: [], keys: from };
  const leaving = new Set(from), to: Edit[] = [];
  for (const key of from) {
    const next = shifted(store, key, d);
    if (!next || !free(store, next, leaving)) return null;
    to.push(next);
  }
  const arriving = new Set(to.map(([k]) => k));
  return { edits: [...from.filter((k) => !arriving.has(k)).map((k): Edit => [k, null]), ...to], keys: to.map(([k]) => k) };
}

/** Turn each piece a step where it stands: a prop a quarter, a mini an eighth, a wall onto the cell's other low side. */
export function turnEdits(store: Store, keys: string[]): Picked | null {
  const from = present(store, keys), leaving = new Set(from), edits: Edit[] = [], out: string[] = [];
  for (const key of from) {
    const v = store.get<unknown>(key), kind = kindOf(key);
    if (kind === 'mini') edits.push([key, { ...(v as MiniVal), r: (((v as MiniVal).r || 0) + 1) % 8 }]);
    else if (kind === 'cell' && PROPS[(v as CellVal).i]) {
      const { r, ...rest } = v as CellVal, next = ((r ?? 0) + 1) % 4;
      edits.push([key, next ? { ...rest, r: next } : rest]);
    } else if (kind === 'wall') {
      const [x, y, z, s] = parseEdge(key), other = ek(x, y, z, (s === 'n' ? 'w' : 'n') as Side);
      if (store.get(other) !== null && !leaving.has(other)) return null;
      edits.push([key, null], [other, v]);
      out.push(other);
      continue;
    }
    out.push(key);
  }
  return edits.length ? { edits, keys: out } : null;
}

// Where a copy is tried: beside the original first, then further out.
const NEAR: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]];

/**
 * Copy a selection onto the nearest free spot beside it. Minis and loose pieces get new ids
 * from `id` (a mini's copy starts outside any fight). The result's keys are the copies.
 */
export function copyEdits(store: Store, keys: string[], id: () => string): Picked | null {
  const from = present(store, keys);
  if (!from.length) return null;
  const none = new Set<string>();
  for (const [dx, dz] of NEAR) {
    const edits: Edit[] = [];
    for (const key of from) {
      const next = shifted(store, key, [dx, 0, dz]);
      if (!next || !free(store, next, none)) { edits.length = 0; break; }
      const kind = kindOf(key);
      if (kind === 'mini') {
        const { ini: _, fx: __, ...m } = next[1] as MiniVal & { fx?: unknown };
        edits.push([`m:${id()}`, { ...m, y: restY(store, m.x, m.y, m.z) }]);
      } else if (kind === 'loose') edits.push([`l:${id()}`, next[1]]);
      else edits.push(next);
    }
    if (edits.length) return { edits, keys: edits.map(([k]) => k) };
  }
  return null;
}

/** Take a selection off the table. */
export function removeEdits(store: Store, keys: string[]): Picked | null {
  const from = present(store, keys);
  return from.length ? { edits: from.map((k): Edit => [k, null]), keys: [] } : null;
}

/** The box around a selection, in cells (walls and loose pieces count as the cell they belong to). */
export function boundsOf(store: Store, keys: string[]): { min: Cell; max: Cell } | null {
  let min: Cell | null = null, max: Cell | null = null;
  for (const key of keys) {
    const c = whereIs(store, key);
    if (!c) continue;
    min = min ? [Math.min(min[0], c[0]), Math.min(min[1], c[1]), Math.min(min[2], c[2])] : [...c];
    max = max ? [Math.max(max[0], c[0]), Math.max(max[1], c[1]), Math.max(max[2], c[2])] : [...c];
  }
  return min && max ? { min, max } : null;
}
