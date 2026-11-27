// Sheets have three heights. Peek is a single row, half leaves the table in view and usable
// above it, full is for forms. Every sheet gets a grab handle: a real button that steps the
// height when tapped (never swipe-only) and can also be dragged. A sheet that is over the
// table drops to peek when a finger lands on the table.
//
// Which sheet is open stays the business of whoever opens it (`.closed`, see openSheet in
// main.ts): this module only watches. The heights themselves are CSS (`.sheet[data-h]` in
// style.css), which is also where landscape phones and large screens dock sheets to the side.

export type Detent = 'peek' | 'half' | 'full';
const ORDER: Detent[] = ['peek', 'half', 'full'];
const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
const el = (sheet: HTMLElement | string): HTMLElement | null => (typeof sheet === 'string' ? document.getElementById(sheet) : sheet);
/** Large screens have room for a sheet beside the table: nothing there needs to get out of the way. */
const roomy = () => matchMedia('(min-width: 900px) and (min-height: 521px)').matches;

/** The height a sheet is at (half unless it was changed since it opened). */
export function sheetHeight(sheet: HTMLElement | string): Detent {
  const h = el(sheet)?.dataset.h;
  return h === 'peek' || h === 'full' ? h : 'half';
}

/** Set a sheet's height. Opening a sheet is separate (and a closed one goes back to half). */
export function setSheetHeight(sheet: HTMLElement | string, h: Detent): void {
  const s = el(sheet);
  if (!s) return;
  if (h === 'half') delete s.dataset.h; else s.dataset.h = h;
  // A sheet folded down to one row has no use for the keyboard.
  if (h === 'peek' && s.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  sync();
}

/** The sheet that is open, if any. (On large screens the dice log is always there and does not count.) */
export function openSheetEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.sheet:not(.closed)');
}

/**
 * The height a tap on the handle goes to: the next one up, and from the top back down to peek.
 * Heights that look the same here are skipped (a sheet docked to the side of a phone held
 * sideways is as tall at half as at full; a short sheet does not grow), so every tap is seen.
 */
function next(s: HTMLElement): Detent {
  const now = sheetHeight(s), tall = s.offsetHeight;
  let to = now;
  for (let i = 1; i < ORDER.length; i++) {
    const h = ORDER[(ORDER.indexOf(now) + i) % ORDER.length];
    if (h === 'half') delete s.dataset.h; else s.dataset.h = h;
    if (Math.abs(s.offsetHeight - tall) > 2) { to = h; break; }
  }
  if (now === 'half') delete s.dataset.h; else s.dataset.h = now;
  return to;
}

/** Step a sheet's height as a tap on its handle does. */
export function cycleSheetHeight(sheet: HTMLElement | string): void {
  const s = el(sheet);
  if (s) setSheetHeight(s, next(s));
}

/** Fold the open sheet down to its one row (a finger is on the table). */
export function dropSheet(): void {
  const s = openSheetEl();
  if (s && sheetHeight(s) !== 'peek') setSheetHeight(s, 'peek');
}

function label(s: HTMLElement): void {
  const now = sheetHeight(s), to = s.classList.contains('closed') ? now : next(s);
  for (const g of s.querySelectorAll<HTMLElement>('.grab')) {
    g.innerHTML = `<i></i>${ico(ORDER.indexOf(to) > ORDER.indexOf(now) ? 'up' : 'down')}`;
    g.title = to === now ? `Sheet height: ${now}` : `Sheet height: ${now}. Tap for ${to}, or drag`;
    g.setAttribute('aria-label', g.title);
  }
}

/** Closed sheets forget their height and their pages; the HUD knows what is open (`#hud[data-sheet]`). */
function sync(): void {
  for (const s of document.querySelectorAll<HTMLElement>('.sheet.closed')) {
    delete s.dataset.h;
    for (const p of s.querySelectorAll(':scope > .page')) p.remove();
    delete s.dataset.page;
  }
  const open = openSheetEl(), hud = document.getElementById('hud');
  if (hud) { if (open) hud.dataset.sheet = sheetHeight(open); else delete hud.dataset.sheet; }
  if (open) label(open);
}

function grab(s: HTMLElement): HTMLButtonElement {
  const g = document.createElement('button');
  g.type = 'button';
  g.className = 'grab';
  // Tap steps the height. Dragging is a shortcut for the same thing: up for taller, down for lower.
  let from: number | null = null, dragged = false;
  g.onpointerdown = (e) => { from = e.clientY; dragged = false; g.setPointerCapture?.(e.pointerId); };
  g.onpointerup = g.onpointercancel = (e) => {
    const dy = from === null || e.type === 'pointercancel' ? 0 : e.clientY - from;
    from = null;
    if (Math.abs(dy) < 24) return;
    dragged = true;
    const i = ORDER.indexOf(sheetHeight(s)), far = Math.abs(dy) > 220 ? 2 : 1;
    setSheetHeight(s, ORDER[Math.max(0, Math.min(2, i + (dy < 0 ? far : -far)))]);
  };
  g.onclick = () => { if (dragged) dragged = false; else cycleSheetHeight(s); };
  return g;
}

/** Give a sheet its handle: in its title row if it has one, else on a bar of its own. */
export function addSheetHandle(s: HTMLElement): void {
  if (s.querySelector(':scope > .grab, :scope > .row:first-child > .grab')) return;
  const row = s.firstElementChild;
  const g = grab(s);
  if (row?.classList.contains('row')) row.prepend(g);
  else { g.classList.add('bar'); s.prepend(g); }
  label(s);
}

/**
 * Drill down inside a sheet: its content gives way to a page with a Back button, in the same
 * sheet at the same height. Sheets never stack; pages do, and Back (or closing) unwinds them.
 */
export function pushSheetPage(sheet: HTMLElement | string, title: string, render: (body: HTMLElement, back: () => void) => void): void {
  const s = el(sheet);
  if (!s) return;
  const page = document.createElement('div'), head = document.createElement('span'), back = document.createElement('button'), name = document.createElement('b'), body = document.createElement('div');
  page.className = 'page';
  head.className = 'row';
  back.type = 'button';
  back.title = 'Back';
  back.setAttribute('aria-label', 'Back');
  back.innerHTML = ico('back');
  back.onclick = () => popSheetPage(s);
  name.className = 'grow';
  name.textContent = title;
  head.append(grab(s), back, name);
  const close = s.querySelector<HTMLElement>(':scope > .row [data-close]');
  if (close) {
    const x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = ico('x');
    x.onclick = () => close.click();
    head.append(x);
  }
  page.append(head, body);
  s.append(page);
  s.dataset.page = String(s.querySelectorAll(':scope > .page').length);
  render(body, () => popSheetPage(s));
  s.scrollTop = 0;
  label(s);
  back.focus({ preventScroll: true });
}

/** Leave the page a sheet is showing. False if it was showing none. */
export function popSheetPage(sheet: HTMLElement | string): boolean {
  const s = el(sheet), pages = s ? [...s.querySelectorAll(':scope > .page')] : [];
  if (!s || !pages.length) return false;
  pages[pages.length - 1].remove();
  if (pages.length > 1) s.dataset.page = String(pages.length - 1); else delete s.dataset.page;
  return true;
}

/** Wire up every sheet in the document. Sheets added later call `addSheetHandle` themselves. */
export function initSheets(): void {
  const hud = document.getElementById('hud');
  const watch = new MutationObserver(sync);
  for (const s of document.querySelectorAll<HTMLElement>('.sheet')) {
    addSheetHandle(s);
    watch.observe(s, { attributes: true, attributeFilter: ['class'] });
  }
  // Sheets sit on top of the dock, whatever it holds at the moment (`--dock`, see style.css).
  const dock = document.getElementById('dock');
  if (dock && hud && 'ResizeObserver' in window) new ResizeObserver(() => hud.style.setProperty('--dock', `${dock.offsetHeight}px`)).observe(dock);
  // A finger on the table: the sheet gets out of the way, but stays one tap from coming back.
  document.getElementById('c')?.addEventListener('pointerdown', () => { if (!roomy()) dropSheet(); }, { capture: true, passive: true });
  addEventListener('resize', () => { const s = openSheetEl(); if (s) label(s); });
  sync();
}
