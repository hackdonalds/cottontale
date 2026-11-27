// Prep: the third mode, beside Play and Build, for whoever has full powers. Getting a table
// ready (its theme, packs, imports, rules, sound) is done on full-screen pages, not sheets:
// a title bar with Back, and one page at a time. This is the shell — the list of pages, the
// stack, Back (the button, Escape and the phone's own back button all walk the same history)
// and where focus and scroll go. The pages themselves register here:
//
//   registerPrepPage({ id: 'packs', title: 'Packs', icon: 'cube', order: 20, render(el, ctx) { … } });
//
// A page draws into `el` and may be drawn again from nothing at any time, so it keeps its
// state in the store or on `ctx.app`, not in the page.

import type { Store } from '../store';
import type { GameTheme } from '../theme';

/** What the app lends to the pages. Other modules add what their pages need by declaration merging. */
export interface PrepApp {
  store: Store;
  /** May this device change the table? (The GM, or anyone in free play.) Prep closes when this stops being true. */
  full(): boolean;
  /** A line in the chat log, for this device only. */
  say(html: string): void;
  /** The themes on offer, the one the table has, and what tapping one does (see renderThemes in main.ts). */
  themes(): GameTheme[];
  theme(): GameTheme | null;
  pickTheme(t: GameTheme): void;
}

export interface PrepCtx {
  app: PrepApp;
  /** Go to another page, on top of this one. */
  open(id: string): void;
  /** Back one page (from the list: back to the table). */
  back(): void;
  /** Back to the table. */
  close(): void;
}

export interface PrepPage {
  id: string;
  title: string;
  /** A drawing from the icon set in index.html, without the `i-`. */
  icon: string;
  /** Where it comes in the list, low first (the built-in pages are 10, 20, 30…). */
  order?: number;
  /** One line under the title in the list. */
  hint?: string;
  /** False for a page that is only reached from another page. */
  listed?: boolean;
  /** Draw the page into an empty element. */
  render(el: HTMLElement, ctx: PrepCtx): void;
  /** The table changed while the page is showing. Without it the page is left as it is. */
  update?(el: HTMLElement, ctx: PrepCtx): void;
}

export interface Prep {
  /** Open Prep at its list, or straight at a page. */
  open(id?: string): void;
  close(): void;
  readonly isOpen: boolean;
  /** The table changed: let the page showing catch up (and leave Prep if this device lost its powers). */
  refresh(): void;
}

const pages = new Map<string, PrepPage>();
let redraw: () => void = () => {};

/** Add a page to Prep (or replace the one with the same id). Works before and after the table is up. */
export function registerPrepPage(page: PrepPage): void {
  pages.set(page.id, page);
  redraw();
}

/** The pages in the order the list shows them. */
export function prepPages(): PrepPage[] {
  return [...pages.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
}

const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
const ROOT = '';
interface State { prep: string; d: number }
const state = (): State | null => {
  const s = history.state as Partial<State> | null;
  return s && typeof s.prep === 'string' && typeof s.d === 'number' ? (s as State) : null;
};

export function initPrep(app: PrepApp): Prep {
  const $ = (id: string) => document.getElementById(id)!;
  const shell = $('prepPages'), title = $('prepTitle'), body = $('prepBody'), back = $('prepPageBack'), hud = $('hud');
  /** The page showing: null when Prep is closed, '' for the list. */
  let cur: string | null = null;
  let from: HTMLElement | null = null; // where focus was when Prep opened
  const scrolls = new Map<string, number>();
  const ctx: PrepCtx = { app, open, back: () => history.back(), close };

  function list(el: HTMLElement): void {
    const all = prepPages().filter((p) => p.listed !== false);
    for (const p of all) {
      const b = document.createElement('button');
      b.className = 'prepRow';
      b.dataset.page = p.id;
      b.innerHTML = `<i>${ico(p.icon)}</i><span><b></b><small></small></span>${ico('fwd')}`;
      b.querySelector('b')!.textContent = p.title;
      b.querySelector('small')!.textContent = p.hint ?? '';
      b.onclick = () => open(p.id);
      el.append(b);
    }
    if (!all.length) el.insertAdjacentHTML('beforeend', '<p class="hint">Nothing to prepare yet.</p>');
  }

  /** Put a page on screen. `fresh` pages start at the top; ones come back to are where they were left. */
  function show(id: string, fresh: boolean): void {
    const page = id === ROOT ? null : pages.get(id);
    if (id !== ROOT && !page) { show(ROOT, fresh); return; } // a page that is gone (its module was not loaded)
    if (cur === null) from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    else scrolls.set(cur, body.scrollTop);
    cur = id;
    shell.hidden = false;
    hud.classList.add('prepping');
    title.textContent = page ? page.title : 'Prep';
    back.title = id === ROOT ? 'Back to the table' : 'Back';
    back.setAttribute('aria-label', back.title);
    body.innerHTML = '';
    body.className = fresh ? 'in' : '';
    body.dataset.page = id;
    if (page) page.render(body, ctx); else list(body);
    body.scrollTop = fresh ? 0 : scrolls.get(id) ?? 0;
    // Screen readers and keyboards start at the title of the new page; nothing scrolls to get there.
    title.focus({ preventScroll: true });
  }

  function hide(): void {
    if (cur === null) return;
    cur = null;
    scrolls.clear();
    shell.hidden = true;
    hud.classList.remove('prepping');
    body.innerHTML = '';
    if (from?.isConnected) from.focus({ preventScroll: true });
    from = null;
  }

  function open(id: string = ROOT): void {
    if (!app.full()) return;
    const d = state()?.d ?? 0;
    // Always through the list, so Back from a page opened directly still lands on it.
    if (cur === null) { history.pushState({ prep: ROOT, d: d + 1 } satisfies State, ''); show(ROOT, true); }
    if (id !== ROOT && id !== cur && pages.has(id)) { history.pushState({ prep: id, d: (state()?.d ?? 0) + 1 } satisfies State, ''); show(id, true); }
  }

  function close(): void {
    if (cur === null) return;
    const d = state()?.d ?? 0;
    hide();
    if (d > 0) history.go(-d);
  }

  // Back, by the button here or the phone's own: history decides what shows.
  addEventListener('popstate', () => {
    const s = state();
    if (s && app.full()) show(s.prep, false);
    else hide();
  });
  back.onclick = () => history.back();
  addEventListener('keydown', (e) => {
    if (cur === null || e.key !== 'Escape') return;
    if (e.target instanceof HTMLElement && e.target.matches('input, textarea, select')) e.target.blur();
    else history.back();
  });

  redraw = () => { if (cur !== null) show(cur, false); };
  return {
    open, close,
    get isOpen() { return cur !== null; },
    refresh() {
      if (cur === null) return;
      if (!app.full()) { close(); return; }
      pages.get(cur)?.update?.(body, ctx);
    },
  };
}
