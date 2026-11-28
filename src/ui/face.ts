// The picture of a piece, by its key (`b_grass`, `p_barrel`, `m_knight`): its thumbnail from
// the sheet of pictures, the picture a pack brought, or failing both a cube of its colour or its emoji.

import { BLOCKS, MINIS, PROPS } from '../catalog';
import * as packs from '../packs';
import THUMBS from '../thumbs.json';

/** The CSS that shows a piece's picture, or null if it has none. */
export function thumb(key: string): string | null {
  const i = (THUMBS.at as Record<string, number>)[key];
  if (i === undefined) return packs.packThumb(key.slice(2)); // a piece of the table's own packs shows its picture
  const x = i % THUMBS.cols, y = Math.floor(i / THUMBS.cols);
  return `background-image:url(./ui/thumbs.webp);background-size:${THUMBS.cols * 100}% ${THUMBS.rows * 100}%;background-position:${(x / (THUMBS.cols - 1)) * 100}% ${(y / (THUMBS.rows - 1)) * 100}%`;
}
/** A piece by its key: its name, or null if this table does not have it. */
export const nameOf = (key: string): string | null => ({ b: BLOCKS, p: PROPS, m: MINIS } as Record<string, Record<string, { name: string }>>)[key[0]]?.[key.slice(2)]?.name ?? null;
/** The `<i>` that shows a piece. */
export function face(key: string): string {
  const at = thumb(key), id = key.slice(2);
  if (at) return `<i style="${at}"></i>`;
  const flat = key[0] === 'b' ? BLOCKS[id]?.color : undefined;
  if (flat) return `<i><svg class="cube" viewBox="0 0 24 24"><path fill="${flat}" d="M12 3 20.500 7.500 12 12 3.500 7.500z"/><path fill="${flat}" style="filter:brightness(.78)" d="M3.500 7.500 12 12v9.500L3.500 17z"/><path fill="${flat}" style="filter:brightness(.6)" d="M20.500 7.500 12 12v9.500l8.500-4.500z"/></svg></i>`;
  return `<i>${(key[0] === 'm' ? MINIS[id]?.icon : PROPS[id]?.icon) ?? ''}</i>`;
}
