// The hotbar and the library, for Build mode. The tray above the dock is the hotbar: the piece
// in hand, recents and favourites one tap away. The library is a sheet (#lib) with a search
// box and every piece of the current category in a grid, for when the catalogue is too big for
// one row. Tap to arm, then tap the table to place: nothing is ever dragged out of the sheet.
//
// Recents and favourites belong to the device (localStorage), per category, as piece keys
// (see library.ts). What pieces exist is asked afresh at every draw: packs may add or remove
// them while the table is up.

import { MAX_FAVS, MAX_RECENT, parseLists, pushRecent, searchPieces, toggleFav } from './library';
import { setSheetHeight, sheetHeight } from './sheets';

/** Shelves that are not in the catalogue: what this device used last, and what it pinned. */
export const RECENT = '~recent', FAVS = '~favs';

/** A shelf of the current category: its id, the name it shows, and the keys of its pieces. */
export type Shelf = [id: string, label: string, keys: string[]];

export interface HotbarHooks {
  /** Saved per device. */
  load(k: string): string | null;
  save(k: string, v: string): void;
  /** Show the library sheet, or put it away. */
  open(on: boolean): void;
  /** Draw the tray (and with it the library) again. */
  redraw(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const HOLD_MS = 480, HOLD_SLOP = 10;

export class Hotbar {
  private recents: Record<string, readonly string[]>;
  private favs: Record<string, readonly string[]>;
  /** Tapping a tile in the library pins it instead of picking it up. */
  private pinning = false;
  private cat = '';

  constructor(private hooks: HotbarHooks) {
    this.recents = parseLists(hooks.load('recent'), MAX_RECENT);
    this.favs = parseLists(hooks.load('favs'), MAX_FAVS);
    const q = $<HTMLInputElement>('libQ'), grid = $('libGrid');
    q.oninput = () => hooks.redraw();
    // Typing needs room for the results above the keyboard.
    q.onfocus = () => { if (sheetHeight('lib') === 'peek') setSheetHeight('lib', 'half'); };
    q.onkeydown = (e) => { if (e.key === 'Enter') q.blur(); };
    $('libPin').onclick = () => { this.pinning = !this.pinning; hooks.redraw(); };
    // In the library a tap on a tile is either a pin (the star is on) or a pick; a picked piece
    // is for the table, so the sheet folds down out of its way.
    grid.addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile');
      if (!tile || !this.pinning) return;
      e.stopPropagation();
      this.toggle(tile.dataset.key ?? '');
    }, true);
    grid.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tile') && !this.pinning) setSheetHeight('lib', 'peek');
    });
    for (const el of [grid, $('palette')]) this.holdToPin(el);
    // Put away by its own close button (or by another sheet opening): the tray's search button follows, and the next search starts empty.
    new MutationObserver(() => { if (!this.isOpen) { q.value = ''; this.pinning = false; } hooks.redraw(); }).observe($('lib'), { attributes: true, attributeFilter: ['class'] });
  }

  get isOpen(): boolean { return !$('lib').classList.contains('closed'); }

  /** Open the library at half height (or put it away). A mouse may start typing at once; a thumb chooses to. */
  show(on: boolean): void {
    this.hooks.open(on);
    if (!on) return;
    setSheetHeight('lib', 'half');
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) $('libQ').focus();
  }

  recent(cat: string): readonly string[] { return this.recents[cat] ?? []; }
  pinned(cat: string): readonly string[] { return this.favs[cat] ?? []; }

  /** A piece was put on the table: it leads the recents of its category. True if that changed them. */
  used(cat: string, key: string): boolean {
    const now = pushRecent(this.recent(cat), key);
    if (now === this.recent(cat)) return false;
    this.recents[cat] = now;
    this.hooks.save('recent', JSON.stringify(this.recents));
    return true;
  }

  /** Pin or unpin a piece of the category showing. */
  toggle(key: string): void {
    if (!key || !this.cat) return;
    this.favs[this.cat] = toggleFav(this.pinned(this.cat), key);
    this.hooks.save('favs', JSON.stringify(this.favs));
    navigator.vibrate?.(8);
    this.hooks.redraw();
  }

  /** Every tile says which piece it is, and whether it is pinned. */
  mark(tile: HTMLElement, cat: string, key: string | null): void {
    if (!key) return;
    tile.dataset.key = key;
    tile.classList.toggle('fav', this.pinned(cat).includes(key));
  }

  /** Long-press a tile to pin it: a shortcut for the star in the library, never the only way. */
  private holdToPin(el: HTMLElement): void {
    let timer: ReturnType<typeof setTimeout> | undefined, at = [0, 0], held = false;
    const stop = () => { clearTimeout(timer); timer = undefined; };
    el.addEventListener('pointerdown', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile[data-key]');
      stop();
      held = false;
      if (!tile || !e.isPrimary) return;
      at = [e.clientX, e.clientY];
      timer = setTimeout(() => { held = true; this.toggle(tile.dataset.key!); }, HOLD_MS);
    });
    el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - at[0], e.clientY - at[1]) > HOLD_SLOP) stop(); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(type, stop);
    el.addEventListener('scroll', stop, true);
    // The finger coming up after a long press is not also a tap.
    el.addEventListener('click', (e) => { if (held) { held = false; e.stopPropagation(); e.preventDefault(); } }, true);
    el.addEventListener('contextmenu', (e) => { if ((e.target as HTMLElement).closest('.tile')) e.preventDefault(); });
  }

  /**
   * Draw the library for a category: recents and favourites first, then shelf by shelf, or
   * what the search finds across all of them. `make` builds the tile of a piece (and may
   * decline: a key this table does not know).
   */
  draw(cat: string, title: string, shelves: Shelf[], nameOf: (key: string) => string | null, make: (key: string) => Element | null): void {
    this.cat = cat;
    if (!this.isOpen) return;
    const grid = $('libGrid'), q = $<HTMLInputElement>('libQ'), pin = $('libPin');
    const scroll = grid.scrollTop;
    grid.innerHTML = '';
    q.placeholder = `Search ${title.toLowerCase()}`;
    pin.classList.toggle('on', this.pinning);
    pin.setAttribute('aria-pressed', String(this.pinning));
    $('lib').classList.toggle('pinning', this.pinning);
    const head = (text: string) => { const h = document.createElement('h3'); h.textContent = text; grid.append(h); };
    const put = (keys: readonly string[]) => { let n = 0; for (const k of keys) { const t = make(k); if (t) { grid.append(t); n++; } } return n; };
    const section = (text: string, keys: readonly string[]) => {
      const known = keys.filter((k) => nameOf(k) !== null);
      if (known.length) { head(text); put(known); }
    };
    if (this.pinning) head('Tap a piece to pin it to your favourites, or to let it go');
    if (q.value.trim()) {
      const seen = new Set<string>();
      const all = shelves.flatMap(([, , keys]) => keys).filter((k) => !seen.has(k) && !!seen.add(k)).map((key) => ({ key, name: nameOf(key) ?? '' })).filter((p) => p.name);
      const found = searchPieces(all, q.value);
      head(found.length ? `${found.length} found in ${title}` : `Nothing called “${q.value.trim()}” in ${title}`);
      put(found.map((p) => p.key));
    } else {
      section('Recent', this.recent(cat));
      section('Favourites', this.pinned(cat));
      for (const [, label, keys] of shelves) section(label, keys);
    }
    grid.scrollTop = scroll;
  }
}
