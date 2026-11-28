// The dock: the one piece of chrome that is always there. A single row of at most six slots
// (ui/dockFor.ts decides which), and beside it the Undo / Redo pair, which is only on screen
// while there is something it could do. Nothing here grows: a new state swaps the slots, and
// what a slot opens is a drawer (ui/drawer.ts) that takes the place of the last one.

import { BLOCKS, MINIS, PROPS } from '../catalog';
import { EDGES, type CellVal, type MiniVal } from '../rules';
import { LOOSE } from '../loose';
import { kindOf } from '../pick';
import { armKey, lastPiece, makeSheet, pieceMoreSheet, piecesSheet, shapeSheet, type Ctx } from './buildSheets';
import { ico } from './dom';
import { dockFor, type DockState, type Slot } from './dockFor';
import { diceSheet, fightSheet, keypadSheet, miniMoreSheet, quickSheet, toolsSheet, type Log } from './playSheets';
import type { Prep } from './prep';
import { tableSheet } from './tableSheet';

/** How long the Undo pair stays up in Play after something that can be undone. */
const UNDO_MS = 10_000;
const LAND = new Set(['raise', 'lower', 'level', 'grow']);
/** Brushes whose next piece has a facing. */
const turns = (brush: string) => !!PROPS[brush] || ['room', 'paste'].includes(brush);
/** Drawers that are about the selection: they go when it does. */
const ABOUT_SEL = new Set(['more', 'hp']);

export interface Dock { render(): void; el: HTMLElement }

export function mountDock(root: HTMLElement, ctx: Ctx, log: Log, prep: () => Prep | undefined): Dock {
  const { s, drawer, notice } = ctx;
  const el = document.createElement('nav'), undo = document.createElement('div');
  el.className = 'dock';
  el.setAttribute('aria-label', 'Table');
  undo.className = 'undo';
  undo.innerHTML = `<button data-u="undo" title="Undo" aria-label="Undo">${ico('undo')}</button><button data-u="redo" title="Redo" aria-label="Redo">${ico('redo')}</button>`;
  root.append(undo, el);
  const { board, store } = s;

  /** What a tap on the table selected, in words: a fat finger wants to know what it hit. */
  function selName(): string {
    const m = s.sel();
    if (m) return m.n || MINIS[m.k]?.name || 'Figure';
    const keys = board.picked;
    if (keys.length !== 1) return keys.length ? `${keys.length} pieces` : '';
    const v = store.get<CellVal & MiniVal>(keys[0]), kind = kindOf(keys[0]);
    if (!v) return '';
    if (kind === 'loose') return LOOSE[v.i]?.name ?? 'Loose piece';
    return BLOCKS[v.i]?.name ?? PROPS[v.i]?.name ?? (EDGES[v.i] ? 'Wall' : 'Piece');
  }

  function state(): DockState {
    const full = s.full(), m = s.sel(), b = board.brush, r = s.ruler();
    return {
      role: full ? 'gm' : 'player',
      mode: s.mode(),
      sel: board.picked.length ? 'piece' : m ? (s.mine(m) ? 'mini' : 'theirs') : 'none',
      armed: s.armed() ? {
        name: s.inHand().name.slice(0, 10), turns: board.tool === 'build' && turns(b), sized: board.tool === 'build' && LAND.has(b),
        erasing: board.tool === 'build' && b === 'erase', sampling: board.sampling, size: board.reach * 2 + 1,
      } : undefined,
      placing: board.placing,
      hidden: !!m?.h,
      sheets: !!s.system(),
      tool: board.tool === 'ruler' ? { ruler: board.rulerMode, blast: r?.m === 'circle' } : board.tool === 'fog' ? { fog: board.fogHide ? 'hide' : 'reveal' } : undefined,
    };
  }

  let unerased = 'grass';
  const selected = () => (board.selected ? [board.selected] : []);
  const acts: Record<string, () => void> = {
    build: () => { drawer.close(); s.setMode('build'); },
    play: () => { drawer.close(); s.setMode('play'); },
    done: () => { drawer.close(); if (board.tool === 'ruler' || board.tool === 'fog') s.setTool('move'); else if (s.armed()) s.disarm(); else s.deselect(); },
    // the selection
    move: () => s.place(),
    turn: () => s.turnSel(),
    copy: () => s.copySel(),
    remove: () => { s.removeSel(); notice.say('Removed. Undo brings it back.'); },
    hide: () => s.patch({ h: !s.sel()?.h }),
    more: () => drawer.toggle('more', s.sel() ? miniMoreSheet(ctx) : pieceMoreSheet(ctx)),
    details: () => drawer.toggle('more', miniMoreSheet(ctx)),
    hp: () => drawer.toggle('hp', keypadSheet(ctx, selected)),
    conditions: () => s.openSheet(board.selected),
    sheet: () => s.openSheet(board.selected ?? undefined),
    // a brush in hand
    pieces: () => { const last = lastPiece(); if (last && drawer.id !== 'pieces') armKey(s, last); drawer.toggle('pieces', piecesSheet(ctx)); }, // the last piece is in hand at once; the library is there to change it
    hand: () => drawer.toggle('pieces', piecesSheet(ctx)),
    make: () => drawer.toggle('make', makeSheet(ctx)),
    shape: () => drawer.toggle('shape', shapeSheet(ctx)),
    rot: () => { board.rot = (board.rot + 1) % 4; s.touch(); },
    size: () => { board.reach = (board.reach + 1) % 3; s.touch(); },
    sample: () => s.sample(!board.sampling),
    erase: () => {
      drawer.close();
      if (s.armed() && board.brush === 'erase') return s.arm(unerased); // tapping it again picks the last brush back up
      if (board.brush !== 'erase') unerased = board.brush;
      s.arm('erase');
    },
    // play
    fight: () => drawer.toggle('fight', fightSheet(ctx)),
    dice: () => drawer.toggle('dice', diceSheet(ctx, log)),
    chat: () => drawer.toggle('dice', diceSheet(ctx, log)),
    quick: () => drawer.toggle('quick', quickSheet(ctx)),
    tools: () => drawer.toggle('tools', toolsSheet(ctx)),
    table: () => drawer.toggle('table', tableSheet(ctx, prep)),
    ruler: () => { drawer.close(); s.setTool('ruler'); notice.say('Drag on the table to measure.'); },
    line: () => { board.rulerMode = 'line'; s.touch(); },
    circle: () => { board.rulerMode = 'circle'; s.touch(); },
    cone: () => { board.rulerMode = 'cone'; s.touch(); },
    blast: () => s.blastHere(),
    fogHide: () => { board.fogHide = true; s.touch(); },
    fogShow: () => { board.fogHide = false; s.touch(); },
    revealAll: () => s.revealAll(),
  };
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-slot]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    acts[b.dataset.slot!]?.();
  };
  undo.onclick = (e) => {
    const u = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.u;
    if (u) s.undo(u === 'redo');
  };

  let drawn = '', stamp = board.stamp, until = 0, hideTimer: ReturnType<typeof setTimeout> | undefined, named = '';
  function render(): void {
    const st = state(), slots: Slot[] = dockFor(st);
    const open = drawer.id === 'more' && st.sel !== 'none' ? 'more' : drawer.id === 'dice' ? (st.role === 'gm' ? 'dice' : 'dice chat') : drawer.id ?? '';
    const sig = JSON.stringify(slots) + open;
    if (sig !== drawn) {
      drawn = sig;
      el.innerHTML = slots.map((x) => {
        const on = x.on || open.split(' ').includes(x.id) || (x.id === 'hand' && open === 'pieces');
        return `<button data-slot="${x.id}" class="slot${on ? ' on' : ''}"${on ? ' aria-pressed="true"' : ''}${x.off ? ' aria-disabled="true"' : ''}>${ico(x.icon)}<span>${x.label}</span></button>`;
      }).join('');
      el.style.setProperty('--n', String(slots.length));
      el.dataset.state = st.sel !== 'none' ? 'sel' : st.armed ? 'armed' : st.tool ? 'tool' : st.mode;
    }
    // Dice in hand, or lines not read yet, show on the Dice slot.
    const dice = el.querySelector<HTMLElement>('[data-slot="dice"]');
    if (dice) { const n = s.dice.count() || (drawer.id === 'dice' ? 0 : log.unread); if (n) dice.dataset.n = String(Math.min(99, n)); else delete dice.dataset.n; }
    // A drawer about the selection goes when the selection does.
    if (drawer.id && ABOUT_SEL.has(drawer.id) && st.sel === 'none') drawer.close();
    // Undo and Redo: always there in Build; in Play, for a few seconds after something they could take back.
    if (board.stamp !== stamp) { stamp = board.stamp; until = Date.now() + UNDO_MS; }
    const live = board.canUndo || board.canRedo, covered = drawer.id !== null && drawer.el.dataset.h === 'full';
    undo.hidden = !(live && !covered && (st.mode === 'build' || Date.now() < until));
    undo.querySelector<HTMLButtonElement>('[data-u="undo"]')!.disabled = !board.canUndo;
    undo.querySelector<HTMLButtonElement>('[data-u="redo"]')!.disabled = !board.canRedo;
    clearTimeout(hideTimer);
    if (!undo.hidden && st.mode !== 'build') hideTimer = setTimeout(render, Math.max(0, until - Date.now()) + 50);
    // Say what was just selected, once.
    const name = selName(), id = `${board.selected ?? ''}|${board.picked.join()}`;
    if (id !== named) { named = id; if (name) notice.say(name, 1600); }
    document.body.dataset.mode = st.mode;
  }
  return { render, el };
}
