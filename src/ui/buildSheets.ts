// What Build's slots open: the library of pieces (one search over everything), Make (rooms,
// scenes, scatter, copy and paste) and Shape (the land brushes). Each is a drawer that arms a
// brush and gets out of the way: the dock then shows what is in hand, until Done.

import { BLOCK_SHELVES, MINI_SHELVES, PROP_SHELVES } from '../catalog';
import { roomName } from '../gen';
import { LOOSE, POUR_COUNTS } from '../loose';
import * as registry from '../registry';
import { ls, type Session } from '../session';
import { btn, esc, h } from './dom';
import type { Drawer, DrawerOpts } from './drawer';
import { face, nameOf } from './face';
import { pushRecent, searchPieces } from './library';
import type { Notice } from './notice';

export interface Ctx { s: Session; drawer: Drawer; notice: Notice }
type Cat = 'all' | 'ground' | 'walls' | 'things' | 'figures';
type Shelf = { name: string; cat: Cat; keys: string[] };

const RECENT = 'recent2';
const readRecent = (): string[] => { try { const v = JSON.parse(ls.get(RECENT) ?? '[]'); return Array.isArray(v) ? v.filter((k) => typeof k === 'string').slice(0, 12) : []; } catch { return []; } };
/** A piece went into the hand: it leads the recents. */
export function usedPiece(key: string): void { ls.set(RECENT, JSON.stringify(pushRecent(readRecent(), key, 12))); }
/** The piece used last, if this table still has it. */
export const lastPiece = (): string | null => readRecent().find((k) => nameOf(k) !== null) ?? null;

/** Take a piece in hand by its key (`b_grass`, `p_barrel`, `m_knight`). */
export function armKey(s: Session, key: string): void {
  if (nameOf(key) === null) return;
  usedPiece(key);
  if (key[0] === 'm') s.armMini(key.slice(2)); else s.arm(key.slice(2));
}

/** The library: every piece this table has, by shelf, with one search across all of it. */
export function piecesSheet({ s, drawer }: Ctx): DrawerOpts {
  let q = '', cat: Cat = 'all';
  const shelves = (): Shelf[] => {
    const keys = (kind: string, ids: string[] = []) => ids.map((id) => `${kind}_${id}`).filter((k) => nameOf(k) !== null);
    const t = s.gameTheme(), own = (sh: Record<string, string[]>) => { const n = Object.keys(sh), mine = (x: string) => sh[x].length > 0 && sh[x].every((id) => id.includes(':')); return [...n.filter(mine), ...n.filter((x) => !mine(x))]; };
    const list: Shelf[] = [
      { name: 'Recent', cat: 'all', keys: readRecent().filter((k) => nameOf(k) !== null) },
      ...(t ? [{ name: `${t.icon} ${t.name}`, cat: 'all' as Cat, keys: [...keys('b', t.pieces.blocks), ...keys('p', t.pieces.props), ...keys('m', t.pieces.minis)] }] : []),
      { name: 'Ground', cat: 'ground', keys: keys('b', BLOCK_SHELVES.Terrain) },
      { name: 'Walls and doors', cat: 'walls', keys: [...keys('p', PROP_SHELVES.Structures), ...keys('b', BLOCK_SHELVES.Building)] },
      ...own(PROP_SHELVES).filter((n) => n !== 'Structures').map((n): Shelf => ({ name: n, cat: 'things', keys: keys('p', PROP_SHELVES[n]) })),
      ...own(MINI_SHELVES).map((n): Shelf => ({ name: n, cat: 'figures', keys: keys('m', MINI_SHELVES[n]) })),
    ];
    return list.filter((x) => x.keys.length);
  };
  return {
    title: 'Pieces', height: 'full',
    render(body) {
      const grid = h('div', { class: 'tiles' }), chips = h('div', { class: 'chips' });
      const tile = (key: string) => h('button', { type: 'button', class: 'tile', title: nameOf(key)!, html: `${face(key)}<span>${esc(nameOf(key)!)}</span>`, onclick: () => { armKey(s, key); drawer.close(); } });
      const fill = () => {
        grid.replaceChildren();
        const all = shelves();
        if (q.trim()) {
          const seen = new Set<string>(), items = all.filter((x) => x.cat !== 'all').flatMap((x) => x.keys).filter((k) => !seen.has(k) && seen.add(k)).map((key) => ({ key, name: nameOf(key)! }));
          const found = searchPieces(items, q);
          if (!found.length) grid.append(h('p', { class: 'hint', text: `Nothing called “${q.trim()}”.` }));
          for (const f of found) grid.append(tile(f.key));
        } else {
          for (const sh of all) if (cat === 'all' || sh.cat === cat) { grid.append(h('h3', { text: sh.name })); for (const k of sh.keys) grid.append(tile(k)); }
        }
        chips.replaceChildren(...(['all', 'ground', 'walls', 'things', 'figures'] as Cat[]).map((c) => btn({ all: 'All', ground: 'Ground', walls: 'Walls', things: 'Things', figures: 'Figures' }[c], () => { cat = c; q = ''; search.value = ''; fill(); }, { on: !q.trim() && cat === c, cls: 'chip' })));
      };
      const search = h('input', { type: 'search', maxlength: 40, placeholder: 'Search every piece', 'aria-label': 'Search every piece', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', value: q, oninput: () => { q = search.value; fill(); }, onkeydown: (e) => { if ((e as KeyboardEvent).key === 'Enter') search.blur(); } });
      body.append(search, chips, grid);
      fill();
    },
  };
}
// Pieces that arrive in a pack show up while the library is open.
export function watchLibrary(drawer: Drawer): void { registry.onRegistry(() => { if (drawer.id === 'pieces') drawer.redraw(); }); }

/** Make: the things that build more than one piece at a time. */
export function makeSheet({ s, drawer, notice }: Ctx): DrawerOpts {
  const { board } = s;
  const go = (f: () => void) => () => { f(); drawer.close(); };
  return {
    title: 'Make',
    render(body) {
      const row = (...kids: Node[]) => h('div', { class: 'chips' }, ...kids);
      body.append(
        h('p', { class: 'hint', text: 'A room in one drag: floor, walls, windows and a doorway' }),
        row(btn('Stone room', go(() => { board.roomTimber = false; s.arm('room'); notice.say('Drag out the floor of the room.'); }), { icon: 'house' }), btn('Timber room', go(() => { board.roomTimber = true; s.arm('room'); notice.say('Drag out the floor of the room.'); }), { icon: 'house' })),
      );
      // A whole scene: pick a kind, build it, and roll again until it suits.
      const g = s.gen, presets = g.presets(), cur = g.presetOf(g.opts.theme) ?? presets[0];
      if (cur) {
        body.append(h('p', { class: 'hint', text: 'A whole scene — building one replaces the last; Undo brings it back' }));
        body.append(row(...presets.map((p) => btn(p.name, () => { g.opts = { ...g.opts, theme: p.id }; drawer.redraw(); }, { on: p.id === cur.id, cls: 'chip' }))));
        (['size', 'density', 'detail'] as const).forEach((key, i) => {
          const input = h('input', { type: 'range', min: 0, max: 4, step: 1, value: g.opts[key], 'aria-label': cur.sliders[i], oninput: () => { g.opts = { ...g.opts, [key]: +input.value }; } });
          body.append(h('label', { class: 'slider' }, h('span', { text: cur.sliders[i] ?? '' }), input));
        });
        const scene = g.scene();
        body.append(row(
          btn(scene ? 'Build' : 'Build it', () => { g.build({ ...g.opts, theme: cur.id }, g.scene()?.rooms.filter((r) => r.lock) ?? []); drawer.redraw(); }, { cls: 'primary', icon: 'spark' }),
          btn('Another', () => { g.reroll(); drawer.redraw(); }, { icon: 'dice', title: 'Roll the scene again, keeping locked rooms' }),
        ));
        if (scene?.rooms.length) {
          body.append(h('p', { class: 'hint', text: 'Rooms — the dice refurnish one; the lock keeps it when you build another' }));
          scene.rooms.forEach((r, i) => body.append(h('div', { class: 'line' },
            btn(roomName(g.presetFor(scene), r.kind), () => board.lookAt((r.x0 + r.x1 + 1) / 2, 1, (r.z0 + r.z1 + 1) / 2), { cls: 'grow' }),
            btn('', () => { g.refurnish(i); drawer.redraw(); }, { icon: 'dice', title: 'Refurnish this room', disabled: !!r.lock }),
            btn('', () => { g.lockRoom(i, !r.lock); }, { icon: r.lock ? 'lock' : 'unlock', on: !!r.lock, title: r.lock ? 'Locked: unlock this room' : 'Lock this room' }),
          )));
        }
      }
      body.append(row(btn('Starter scene', go(() => { s.starterScene(); notice.say('A cottage in a clearing. Undo takes it away.'); }), { icon: 'tree' })));
      body.append(h('p', { class: 'hint', text: 'Scatter loose pieces: tap to pour, drag to strew' }));
      body.append(row(...Object.entries(LOOSE).map(([id, k]) => btn(k.name, go(() => { s.scatter.kind = id; s.arm('pour'); }), { cls: 'chip' })),
        btn(`× ${s.scatter.count}`, () => { s.scatter.count = POUR_COUNTS[(POUR_COUNTS.indexOf(s.scatter.count) + 1) % POUR_COUNTS.length]; drawer.redraw(); }, { cls: 'chip', title: 'How many pieces a pour drops' })));
      body.append(h('p', { class: 'hint', text: 'Copy an area, then stamp it wherever you tap' }));
      body.append(row(
        btn('Copy area', go(() => { s.arm('copy'); notice.say('Drag over the area to copy.'); }), { icon: 'copy' }),
        btn('Paste', go(() => s.arm('paste')), { icon: 'open', disabled: !board.slab }),
        btn('Share', () => void s.slabCode().then(async (code) => { if (!code) return; try { if (navigator.share) await navigator.share({ text: code }); else { await navigator.clipboard.writeText(code); notice.say('Slab code copied.'); } } catch { /* dismissed */ } }), { icon: 'link', disabled: !board.slab }),
      ));
      const code = h('input', { placeholder: 'Paste a slab code here', 'aria-label': 'Paste a slab code', autocomplete: 'off', onchange: () => { if (code.value.trim()) void s.loadSlab(code.value).then((ok) => { if (ok) drawer.close(); }); } });
      body.append(code);
      body.append(row(btn('Light', go(() => { s.arm('light'); notice.say('Tap a torch, fire or crystal to step its light.'); }), { icon: 'sun' })));
    },
  };
}

/** Shape: brushes that work the land itself. */
export function shapeSheet({ s, drawer }: Ctx): DrawerOpts {
  const { board } = s;
  return {
    title: 'Shape the land',
    render(body) {
      const brushes: [string, string, string][] = [['raise', 'Raise', 'up'], ['lower', 'Lower', 'down'], ['level', 'Level', 'line'], ['grow', 'Grow', 'tree']];
      body.append(
        h('p', { class: 'hint', text: 'Tap or drag over the ground. Size in the dock sets how wide.' }),
        h('div', { class: 'chips' }, ...brushes.map(([id, label, icon]) => btn(label, () => { s.arm(id); drawer.close(); }, { icon, on: s.armed() && board.brush === id }))),
        h('div', { class: 'chips' }, btn(`Repaint: ${board.surface ? 'on' : 'off'}`, () => { board.surface = !board.surface; drawer.redraw(); }, { on: board.surface, title: 'A ground piece repaints the surface instead of stacking' })),
      );
    },
  };
}

/** More, for selected pieces of the scene. */
export function pieceMoreSheet({ s, drawer, notice }: Ctx): DrawerOpts {
  const { board } = s;
  const lift = (dy: number) => () => { if (!board.movePicked([0, dy, 0])) notice.say(dy > 0 ? 'No room above it.' : 'Something is under it.'); };
  return {
    title: 'More', stay: true,
    render(body) {
      body.append(h('div', { class: 'chips' },
        btn('Up a level', lift(1), { icon: 'up' }), btn('Down a level', lift(-1), { icon: 'down' }),
        btn('Use as brush', () => { const k = board.picked[0]; drawer.close(); if (k) board.onSample(k); }, { icon: 'pick', title: 'Take this piece in hand to place more of it' }),
      ));
    },
  };
}
