// The drawer: the one sheet of the new chrome. It sits on the dock (beside the rail on a
// phone held sideways), holds one thing at a time, and never stacks: opening another swaps
// what it shows. Half height by default, so the table keeps most of the screen; `full` is for
// lists and forms. A touch on the table puts it away, unless what it shows is meant to stay
// up during play (`stay`).

import { h, ico } from './dom';

export interface DrawerOpts {
  title: string;
  /** Draw the content. Called again by `redraw()`; never while someone is typing in it. */
  render(body: HTMLElement): void;
  height?: 'half' | 'full';
  /** Keep it up when the table is touched (a fight tracker, the quick board). */
  stay?: boolean;
  closed?(): void;
}
export interface Drawer { open(id: string, opts: DrawerOpts): void; close(): void; toggle(id: string, opts: DrawerOpts): void; redraw(): void; readonly id: string | null; el: HTMLElement }

export function mountDrawer(root: HTMLElement, changed: () => void): Drawer {
  const title = h('b', { class: 'grow' }), body = h('div', { class: 'body' });
  const el = h('section', { class: 'drawer', hidden: true }, h('header', {}, title, h('button', { type: 'button', title: 'Close', 'aria-label': 'Close', html: ico('x'), onclick: () => api.close() })), body);
  root.append(el);
  let cur: (DrawerOpts & { id: string }) | null = null;
  const draw = () => { if (cur) { body.replaceChildren(); cur.render(body); } };
  const api: Drawer = {
    el,
    get id() { return cur?.id ?? null; },
    open(id, opts) {
      const was = cur;
      cur = { ...opts, id };
      if (was && was.id !== id) was.closed?.();
      title.textContent = opts.title;
      el.dataset.h = opts.height ?? 'half';
      el.dataset.id = id;
      el.hidden = false;
      body.scrollTop = 0;
      draw();
      changed();
    },
    close() {
      if (!cur) return;
      const was = cur;
      cur = null;
      el.hidden = true;
      body.replaceChildren();
      if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      was.closed?.();
      changed();
    },
    toggle(id, opts) { if (cur?.id === id) api.close(); else api.open(id, opts); },
    // What is being typed is never drawn over.
    redraw() { if (cur && !(document.activeElement instanceof HTMLInputElement && el.contains(document.activeElement))) { const top = body.scrollTop; draw(); body.scrollTop = top; } },
  };
  document.getElementById('c')?.addEventListener('pointerdown', () => { if (cur && !cur.stay) api.close(); }, { capture: true, passive: true });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) api.close(); });
  return api;
}
