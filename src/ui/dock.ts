// The dock: the one piece of chrome that is always there. A single row of at most six slots
// (ui/dockFor.ts decides which), and beside it the Undo / Redo pair, which is only on screen
// while there is something it could do. Nothing here grows: a new state swaps the slots.

import { BLOCKS, MINIS, PROPS } from '../catalog';
import { EDGES, type CellVal, type MiniVal } from '../rules';
import { LOOSE } from '../loose';
import { kindOf } from '../pick';
import type { Session } from '../session';
import { dockFor, type DockState, type Slot } from './dockFor';
import type { Notice } from './notice';

const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
/** How long the Undo pair stays up in Play after something that can be undone. */
const UNDO_MS = 10_000;
const LAND = new Set(['raise', 'lower', 'level', 'grow']);
/** Brushes whose next piece has a facing. */
const turns = (brush: string) => !!PROPS[brush] || ['room', 'paste'].includes(brush);

export interface Dock { render(): void; el: HTMLElement }

export function mountDock(root: HTMLElement, s: Session, notice: Notice): Dock {
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
    const full = s.full(), m = s.sel();
    const b = board.brush;
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
    };
  }

  // What the slots do. A slot with nothing here belongs to a part of the redesign that is not built yet.
  let unerased = 'grass';
  const acts: Record<string, () => void> = {
    build: () => s.setMode('build'),
    play: () => s.setMode('play'),
    done: () => { if (s.armed()) s.disarm(); else s.deselect(); },
    // the selection
    move: () => s.place(),
    turn: () => s.turnSel(),
    copy: () => s.copySel(),
    remove: () => { s.removeSel(); notice.say('Removed. Undo brings it back.'); },
    hide: () => s.patch({ h: !s.sel()?.h }),
    // a brush in hand
    pieces: () => s.arm(board.brush === 'erase' ? unerased : board.brush), // the last piece, back in hand (the library is the next step)
    rot: () => { board.rot = (board.rot + 1) % 4; s.touch(); },
    size: () => { board.reach = (board.reach + 1) % 3; s.touch(); },
    sample: () => s.sample(!board.sampling),
    erase: () => {
      if (s.armed() && board.brush === 'erase') return s.arm(unerased); // tapping it again picks the last brush back up
      if (board.brush !== 'erase') unerased = board.brush;
      s.arm('erase');
    },
  };
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-slot]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const act = acts[b.dataset.slot!];
    if (act) act(); else notice.say(`${b.dataset.label} is not built yet.`);
  };
  undo.onclick = (e) => {
    const u = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.u;
    if (u) s.undo(u === 'redo');
  };

  let drawn = '', stamp = board.stamp, until = 0, hideTimer: ReturnType<typeof setTimeout> | undefined, named = '';
  function render(): void {
    const st = state(), slots: Slot[] = dockFor(st);
    const sig = JSON.stringify(slots);
    if (sig !== drawn) {
      drawn = sig;
      el.innerHTML = slots.map((x) => `<button data-slot="${x.id}" data-label="${x.label}" class="slot${x.on ? ' on' : ''}"${x.on ? ' aria-pressed="true"' : ''}${x.off ? ' aria-disabled="true"' : ''}>${ico(x.icon)}<span>${x.label}</span></button>`).join('');
      el.style.setProperty('--n', String(slots.length));
      el.dataset.state = st.sel !== 'none' ? 'sel' : st.armed ? 'armed' : st.mode;
    }
    // Undo and Redo: always there in Build; in Play, for a few seconds after something they could take back.
    if (board.stamp !== stamp) { stamp = board.stamp; until = Date.now() + UNDO_MS; }
    const live = board.canUndo || board.canRedo, show = live && (st.mode === 'build' || Date.now() < until);
    undo.hidden = !show;
    undo.querySelector<HTMLButtonElement>('[data-u="undo"]')!.disabled = !board.canUndo;
    undo.querySelector<HTMLButtonElement>('[data-u="redo"]')!.disabled = !board.canRedo;
    clearTimeout(hideTimer);
    if (show && st.mode !== 'build') hideTimer = setTimeout(render, until - Date.now() + 50);
    // Say what was just selected, once.
    const name = selName(), id = `${board.selected ?? ''}|${board.picked.join()}`;
    if (id !== named) { named = id; if (name) notice.say(name, 1600); }
    document.body.dataset.mode = st.mode;
  }
  return { render, el };
}
