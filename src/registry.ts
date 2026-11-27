// The registry: pieces that are not built in. The core's blocks, props and minis have bare
// ids ('tree', 'knight'), so every saved board keeps working; anything else arrives at run
// time in a pack and is `<namespace>:<name>` ('ada:lamp'), so two packs can never collide
// with each other or with a later core. A pack's pieces go into the same run-time records
// the core's live in (`BLOCKS`, `PROPS`, `MINIS` and their shelves in catalog.ts), which is
// what the palette and the board read; `onRegistry` tells them when to look again.
//
// A board may name a piece whose pack is not here (yet): it is drawn as a neutral stand-in
// (see `makeProp`/`makeMini`) and stood up properly when its pack registers.
//
// A prop or mini supplies either `make()` (primitives, merged once and shared by every copy,
// like the core's) or `mesh` (ready geometry and material: one of each for the whole pack
// piece, shared by every copy on the table). Never per-instance geometry or materials.
import { BLOCKS, BLOCK_SHELVES, MINIS, MINI_SHELVES, PROPS, PROP_SHELVES, forget, type BlockDef, type MiniDef, type PropDef } from './catalog';
import { PIECE_ID } from './theme';

export type PieceKind = 'block' | 'prop' | 'mini';
/** What a pack brings, keyed by name within the pack (the registry adds the namespace). */
export interface Pack {
  blocks?: Record<string, BlockDef>;
  props?: Record<string, PropDef>;
  minis?: Record<string, MiniDef>;
  /**
   * Where its pieces go in the library: shelf name → names within the pack. A name the library
   * already has ('Nature', 'Heroes') gets them appended; a new one becomes a shelf of its own.
   * (Blocks are only shown on 'Terrain' and 'Building'.) Pieces on no shelf can still be placed by id.
   */
  shelves?: { blocks?: Record<string, string[]>; props?: Record<string, string[]>; minis?: Record<string, string[]> };
}

const NAMESPACE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const TABLES = { block: BLOCKS, prop: PROPS, mini: MINIS } as Record<PieceKind, Record<string, unknown>>;
const SHELVES: Record<PieceKind, Record<string, string[]>> = { block: BLOCK_SHELVES, prop: PROP_SHELVES, mini: MINI_SHELVES };
const PLURAL = { block: 'blocks', prop: 'props', mini: 'minis' } as const;
const KINDS = Object.keys(PLURAL) as PieceKind[];
interface Held { ids: [PieceKind, string][]; shelved: [kind: PieceKind, shelf: string, id: string, made: boolean][] }
/** What each registered pack put where, so it can be taken out again exactly. */
const packs = new Map<string, Held>();
const listeners = new Set<(ns: string) => void>();

/** The full id of a pack's piece. */
export const pieceId = (ns: string, name: string): string => `${ns}:${name}`;
/** The pack a piece id belongs to; '' for the built-in core. */
export const namespaceOf = (id: string): string => (id.includes(':') ? id.slice(0, id.indexOf(':')) : '');

/** Does this device have the piece (built in, or registered)? Asked about every id that comes from somebody else. */
export const known: Record<PieceKind, (id: string) => boolean> = {
  block: (id) => Object.hasOwn(BLOCKS, id),
  prop: (id) => Object.hasOwn(PROPS, id),
  mini: (id) => Object.hasOwn(MINIS, id),
};
/** Which kind of piece an id is here, or null if this device does not have it. */
export const kindOf = (id: string): PieceKind | null => KINDS.find((k) => known[k](id)) ?? null;
/** The namespaces registered right now. */
export const registered = (): string[] => [...packs.keys()];

/** Hear about packs arriving and leaving (with their namespace). Returns how to stop listening. */
export function onRegistry(fn: (ns: string) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const changed = (ns: string): void => { for (const fn of [...listeners]) fn(ns); };

function remove(ns: string): boolean {
  const p = packs.get(ns);
  if (!p) return false;
  for (const [kind, shelf, id, made] of p.shelved) {
    const s = SHELVES[kind][shelf];
    if (!s) continue;
    const i = s.indexOf(id);
    if (i >= 0) s.splice(i, 1);
    if (made && !s.length) delete SHELVES[kind][shelf];
  }
  for (const [kind, id] of p.ids) { delete TABLES[kind][id]; forget(id); }
  packs.delete(ns);
  return true;
}

/**
 * Put a pack's pieces and shelves into the library under `ns`, replacing what that namespace
 * held before. Names that do not make a valid id, and props or minis with nothing to draw,
 * are left out. Returns the ids now registered.
 */
export function registerPack(ns: string, pack: Pack): string[] {
  if (!NAMESPACE.test(ns)) return [];
  remove(ns);
  const mine: Held = { ids: [], shelved: [] }, taken = new Set<string>();
  for (const kind of KINDS) {
    for (const [name, def] of Object.entries(pack[PLURAL[kind]] ?? {})) {
      const id = pieceId(ns, name);
      // One id is one piece: a pack cannot have a block and a prop of the same name.
      if (!PIECE_ID.test(id) || taken.has(id) || !def || typeof def !== 'object') continue;
      if (kind !== 'block' && typeof (def as PropDef).make !== 'function' && !(def as PropDef).mesh) continue;
      TABLES[kind][id] = def;
      taken.add(id);
      mine.ids.push([kind, id]);
    }
  }
  for (const kind of KINDS) {
    for (const [shelf, names] of Object.entries(pack.shelves?.[PLURAL[kind]] ?? {})) {
      for (const name of Array.isArray(names) ? names : []) {
        // A shelf is this pack's own (and goes when the pack does) if the pack was what started it.
        const id = pieceId(ns, name), made = !SHELVES[kind][shelf] || mine.shelved.some((e) => e[0] === kind && e[1] === shelf && e[3]);
        if (!shelf || !known[kind](id) || SHELVES[kind][shelf]?.includes(id)) continue;
        (SHELVES[kind][shelf] ??= []).push(id);
        mine.shelved.push([kind, shelf, id, made]);
      }
    }
  }
  packs.set(ns, mine);
  changed(ns);
  return mine.ids.map(([, id]) => id);
}

/** Take a pack out again. Its pieces on a board stay in the table's data and are drawn as stand-ins. */
export function unregisterPack(ns: string): void {
  if (remove(ns)) changed(ns);
}
