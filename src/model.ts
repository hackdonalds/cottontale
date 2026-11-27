// The GM's own 3D models: the piece kind `model` (see packs.ts for what a kind is).
//
// A model reaches the table as one small GLB that ingest.ts made of whatever the GM chose:
// one mesh, one material, at most one texture, Meshopt-compressed, inside a budget
// (a figure or thing: 15,000 triangles and 1.5 MB; a set piece: 50,000 and 4 MB).
//
//   Entry = { kind: 'model', ref (model/gltf-binary), h, cells, tris, set?, yaw?, up?, tex?, pic? }
//
//   h      how tall it stands, in cells (0.3–4)
//   cells  the square of cells it must fit in (1–4): it is made smaller than `h` if it would not
//   tris   its triangles, as the importer counted them (checked again when the file is read)
//   set    a set piece: the larger budget
//   yaw    quarter turns to make it face front (0–3)
//   up     stand it up: it was modelled with z upwards
//   tex    it has a texture (else its colours are in its vertices, and it shares ONE material
//          with every other imported model)
//   pic    a small picture of it for the library (any kind may have one, see packs.ts)
//
// This file is all the app loads up front. Reading the file (modelBuild.ts, with the same lazy
// GLTFLoader and Meshopt decoder the kit uses) comes with the first model drawn; making one
// (ui/modelPage.ts, ingest.worker.ts) with the first one imported.
import { GLB_MIME, PIECE, SET, type ModelBudget } from './modelBudget';
import { listPacks, registerPieceKind } from './packs';
import type { Store } from './store';

export interface ModelFields { h: number; cells: number; tris: number; set?: true; yaw?: number; up?: true; tex?: true }

export const budgetOf = (set: unknown): ModelBudget => (set === true ? SET : PIECE);
/** How far a figure's model is lifted: onto the top of its base (see BASE in board.ts). */
export const BASE_LIFT = 0.08;
/** Imported triangles on one board past which the Packs page says so. */
export const BOARD_TRIS = 150_000;

/** The `model` fields of an entry somebody else wrote: all there and in range, or null. Nothing is guessed. */
export function parseModel(raw: unknown): ModelFields | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  const set = r.set === true, { h, cells, tris } = r, yaw = r.yaw ?? 0;
  if (typeof h !== 'number' || !(h >= 0.3 && h <= 4)) return null;
  if (!int(cells, 1, 4) || !int(tris, 1, budgetOf(set).tris) || !int(yaw, 0, 3)) return null;
  if ((r.ref as { m?: unknown } | undefined)?.m !== GLB_MIME) return null;
  return { h: Math.round(h * 100) / 100, cells, tris, ...(set ? { set } : {}), ...(yaw ? { yaw } : {}), ...(r.up === true ? { up: true } : {}), ...(r.tex === true ? { tex: true } : {}) };
}

/**
 * How much to scale a model of `size` so it stands `h` cells tall, or as tall as it can and
 * still fit a square of `cells` cells (with a little air around it).
 */
export function fitScale(size: readonly [number, number, number], h: number, cells: number): number {
  const wide = Math.max(size[0], size[2], 1e-6), tall = Math.max(size[1], 1e-6);
  return Math.min(h / tall, (cells * 0.96) / wide);
}
/** The fewest cells (1–4) a model of `size` needs to stand `h` tall. */
export function cellsFor(size: readonly [number, number, number], h: number): number {
  const wide = (Math.max(size[0], size[2]) * h) / Math.max(size[1], 1e-6);
  return Math.min(4, Math.max(1, Math.ceil(wide / 0.96 - 1e-6)));
}
/** A model's size once it is stood up (`up`) and turned (`yaw` quarter turns). */
export function turned(size: readonly [number, number, number], up: boolean, yaw: number): [number, number, number] {
  const [x, y, z] = up ? [size[0], size[2], size[1]] : size;
  return yaw % 2 ? [z, y, x] : [x, y, z];
}

/** The triangles of imported models standing on the board in front of us (hidden or not: they are all in memory). */
export function boardTriangles(store: Pick<Store, 'keys' | 'get'>): number {
  const tris = new Map<string, number>();
  for (const p of listPacks()) for (const x of p.pieces) if (x.entry.kind === 'model' && typeof x.entry.tris === 'number') tris.set(x.id, x.entry.tris);
  if (!tris.size) return 0;
  let n = 0;
  for (const k of store.keys('b:')) n += tris.get((store.get(k) as { i?: string } | null)?.i ?? '') ?? 0;
  for (const k of store.keys('m:')) n += tris.get((store.get(k) as { k?: string } | null)?.k ?? '') ?? 0;
  return n;
}

registerPieceKind('model', {
  budget: (f) => budgetOf((f as ModelFields).set).bytes,
  parse: parseModel,
  build: async (entry, bytes, ctx) => (await import('./modelBuild')).buildModel(entry, bytes, ctx.group),
});
