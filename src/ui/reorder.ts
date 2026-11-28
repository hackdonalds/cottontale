// Dragging a row of a list to another place by its handle. The handle is a real button, so
// a tap on it still clicks (the list offers Move up / Move down there): the drag is only ever
// the shortcut. Nothing here runs unless a finger is moving the handle.

import './fight.css';

/** How far a finger travels before a press on the handle is a drag and no longer a tap. */
const SLOP = 6;
/** Near the top or bottom edge of the list, a drag scrolls it by this much a move. */
const EDGE = 28, CREEP = 10;

export interface DragHooks {
  /** The row has left its place. Until `end`, the rows must stay the same elements (they may be taken out and put back). */
  start(): void;
  /** The finger is up: the place the row was let go at, or null when nothing is to change. */
  end(to: number | null): void;
}

/**
 * Make `handle` carry `row` among `rows()` (the rows that can trade places, `row` among them,
 * all the same height) inside the scrolling `body`. The rows are only shifted with transforms
 * while the finger is down; whoever is told at the end redraws the list.
 */
export function dragHandle(handle: HTMLElement, row: HTMLElement, rows: () => HTMLElement[], body: HTMLElement, hooks: DragHooks): void {
  let drag: { id: number; y: number; scroll: number; list: HTMLElement[]; from: number; to: number; mids: number[]; step: number } | null = null;
  let moved = false;
  const place = (e: PointerEvent) => {
    const d = drag!;
    const r = body.getBoundingClientRect();
    if (e.clientY < r.top + EDGE) body.scrollTop -= CREEP;
    else if (e.clientY > r.bottom - EDGE) body.scrollTop += CREEP;
    const dy = e.clientY - d.y + (body.scrollTop - d.scroll), mid = d.mids[d.from] + dy;
    d.to = d.mids.filter((m, i) => i !== d.from && m < mid).length;
    d.list.forEach((el, i) => {
      // The rows it has passed step aside, so the gap shows where it would land.
      const shift = i === d.from ? dy : i > d.from && i <= d.to ? -d.step : i < d.from && i >= d.to ? d.step : 0;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!moved) {
      if (Math.abs(e.clientY - drag.y) < SLOP) return;
      moved = true;
      // Measured once, before anything is shifted: where each row's middle is, and how far apart rows are.
      const rects = drag.list.map((el) => el.getBoundingClientRect());
      drag.mids = rects.map((r) => r.top + r.height / 2);
      drag.step = rects.length > 1 ? Math.abs(rects[1].top - rects[0].top) : rects[0].height;
      row.classList.add('dragging');
      body.classList.add('sorting');
      hooks.start();
    }
    place(e);
  };
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', end, true);
    removeEventListener('pointercancel', end, true);
    if (!moved) return;
    for (const el of d.list) el.style.transform = '';
    row.classList.remove('dragging');
    body.classList.remove('sorting');
    // A drawer put away under the finger, or a touch the system took back, changes nothing.
    hooks.end(e.type === 'pointerup' && row.isConnected && d.to !== d.from ? d.to : null);
  };
  handle.addEventListener('pointerdown', (e) => {
    if (drag || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const list = rows(), from = list.indexOf(row);
    if (from < 0) return;
    moved = false;
    drag = { id: e.pointerId, y: e.clientY, scroll: body.scrollTop, list, from, to: from, mids: [], step: 0 };
    // Followed on the window, not by capturing the pointer: a redraw of the list takes the rows
    // out for a moment, and a captured pointer would be let go by that.
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', end, true);
    addEventListener('pointercancel', end, true);
  });
  // The click that follows a drag is not a tap on the handle.
  handle.addEventListener('click', (e) => { if (moved) { moved = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}
