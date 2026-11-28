// Make your own theme, on a phone: start from a theme, then tweak it by touch with the table
// itself as the preview.
//
// Three Prep pages (ui/prep.ts) live here:
//   theme      the gallery: the themes on offer and this device's own ("Mine"), each with Customise
//   themeedit  the editor: ONE panel over the lower half of the table (beside it in landscape),
//              with a row of tabs — Look · Sound · Pieces · Dice · Generator · About. The page is
//              see-through (`see`), so the board stays in view and takes one- and two-finger gestures.
//   themepick  a full page of the library with search, to add pieces to one of the theme's shelves
//
// Customising a theme copies it under an id of this player's (`<player>:<name>`, see themeEdit.ts)
// and puts the copy on the board at once. From then on every change is shown on this device
// straight away and written to the board's `at:theme` as one whole theme at most every 300 ms,
// so everyone at the table watches it change. Every edit goes through `parseTheme` (themeEdit.ts):
// what is written is what is read.
//
// No theme is written in here. The swatches and emoji below are only suggestions to tap.
import './themeEditor.css';
import { HAZE, SKIES, type Board, type Sky } from '../board';
import { BLOCKS, BLOCK_SHELVES, MINIS, MINI_SHELVES, PROPS, PROP_SHELVES } from '../catalog';
import { simulate } from '../dice';
import { PRESETS } from '../gen';
import type { Season } from '../kit';
import { GRADE_DEFAULT } from '../look';
import { onRegistry } from '../registry';
import { SOUNDSCAPES } from '../sound';
import type { Store } from '../store';
import { MAX_PIECES, atmo, moodEdits, parseTheme, setAtmo, themeLook, type GameTheme, type Known } from '../theme';
import {
  BOUNDS, History, KIND, SHELVES, THEME_MAX, THEME_WARN, addPiece, captureTheme, copyTheme, forgetTheme, hexToHsl, hslToHex, isOwn, kB, movePiece, ownId,
  parseSaved, readThemeCode, removePiece, saveTheme, setGroup, setInfo, setMood, settled, themeCode, themeSize, tooBig, type Shelf,
} from '../themeEdit';
import { searchPieces } from './library';
import { registerPrepPage } from './prep';

/** What the app lends the editor. */
export interface ThemeHost {
  /** The table's own soundscapes (sounds.ts), by id: offered beside the app's and the theme's. */
  scapes?: () => Record<string, string>;
  store: Store;
  board: Board;
  known: Known;
  /** This player's id: the first half of the ids of their themes. */
  me: string;
  /** This player's colour (the sample die wears it where the theme has no dice of its own). */
  color(): string;
  full(): boolean;
  /** This device's own storage (`cottontale:<key>`). */
  ls: { get(key: string): string | null; set(key: string, value: string): void };
  /** The themes on offer (the files, and the one the board carries). */
  themes(): GameTheme[];
  /** Tapping a theme: take it up, or let go of it if the board has it (see main.ts). */
  pickTheme(t: GameTheme): void;
  /** The CSS that shows a piece's picture (`b_grass`, `p_barrel`, `m_knight`), or null if it has none. */
  thumb(key: string): string | null;
  /** Put the board in the hands of the camera: one finger looks around, as in Play. */
  lookAround(): void;
  /** Open a Prep page, on top of the one showing (see ui/prep.ts). */
  open(page: string): void;
}

export interface ThemeEditor {
  /** This device's saved themes ("Mine"), newest first. */
  saved(): GameTheme[];
  /** Start customising a theme (a copy, unless it is this player's own) and open the editor. */
  customise(t: GameTheme): void;
  /** Write what is waiting to be written, now. */
  flush(): void;
}

const EDIT = 'themeedit', PICK = 'themepick', SAVED = 'themes';
/** How often, at most, a theme being edited is written to the table. */
const WRITE_MS = 300;
const TABS = [['look', 'Look'], ['sound', 'Sound'], ['pieces', 'Pieces'], ['dice', 'Dice'], ['gen', 'Generator'], ['about', 'About']] as const;
type Tab = typeof TABS[number][0];
/** Colours to tap: lights from candle to moon, then deep tones for backdrops, haze and dice. */
const SWATCHES = ['#ffffff', '#ffe9c4', '#ffc46b', '#ff8a4c', '#e5484d', '#d6409f', '#8e4ec6', '#5b7cff', '#7fd4ff', '#3dd68c', '#9bbf3b', '#8a6a45', '#5c0f1a', '#1b2a4a', '#0b1020', '#000000'];
const EMOJI = ['🎲', '🏰', '🐉', '🧙', '⚔️', '🛡️', '🏹', '👑', '💀', '🦇', '🧛', '👻', '🕯️', '🔥', '🌙', '⭐', '☀️', '❄️', '🌲', '🍄', '🌊', '⚓', '🏴‍☠️', '🏜️', '🌋', '🕸️', '🐺', '🤖', '🚀', '👽', '🔮', '🍺'];
const SHELF_NAMES: Record<Shelf, string> = { blocks: 'Ground & building blocks', props: 'Things', minis: 'Figures' };
const TABLES = { blocks: BLOCKS, props: PROPS, minis: MINIS } as Record<Shelf, Record<string, { name: string; color?: string; icon?: string }>>;
const LIBRARY: Record<Shelf, Record<string, string[]>> = { blocks: BLOCK_SHELVES, props: PROP_SHELVES, minis: MINI_SHELVES };
const SKY_LABELS = { day: 'Day', dusk: 'Dusk', night: 'Night' } as const;
const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** As much of a Prep page's context as the pages here use. */
interface Back { back(): void }

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function button(label: string, click: () => void, cls = '', title = ''): HTMLButtonElement {
  const b = h('button', cls, label);
  b.type = 'button';
  if (title) { b.title = title; b.setAttribute('aria-label', title); }
  b.onclick = click;
  return b;
}
const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;

/** One editing session: the theme as it stands, how it got there, and where in the panel we are. */
interface Session {
  hist: History<GameTheme>;
  tab: Tab;
  /** The piece picked on the Pieces tab. */
  sel: { shelf: Shelf; id: string } | null;
  /** The colour whose sliders are open. */
  colour: string | null;
  /** The shelf the picker page adds to. */
  shelf: Shelf;
  /** What the About tab has unfolded. */
  box: 'share' | 'import' | null;
  /** A line about the last thing that happened (About). */
  note: string;
  /** Running while a change waits to be written to the table. */
  timer?: ReturnType<typeof setTimeout>;
  /** Where each tab was scrolled to. */
  tops: Partial<Record<Tab, number>>;
}

export function initThemeEditor(host: ThemeHost): ThemeEditor {
  const { store, board, known } = host;
  let ed: Session | null = null;
  /** The gallery: a card being renamed or removed, and whether the import box is open. */
  let ask: { id: string; kind: 'rename' | 'remove' } | null = null, importing = false, galleryNote = '';
  const body = () => document.getElementById('prepBody');
  const showing = (id: string) => !document.getElementById('prepPages')?.hidden && body()?.dataset.page === id;

  /** The board's theme as the table carries it: every piece it names, whether or not this device has them yet. */
  const tableTheme = (): GameTheme | null => parseTheme(atmo(store, 'theme', null), known);
  const saved = (): GameTheme[] => parseSaved(host.ls.get(SAVED), known);
  const keep = (list: GameTheme[]) => host.ls.set(SAVED, JSON.stringify(list));
  const taken = (): string[] => [...host.themes().map((t) => t.id), ...saved().map((t) => t.id)];

  // ---- the table ----

  /** The whole theme to the board, and the settings its mood stands for where they differ. */
  function write(t: GameTheme): void {
    if (!host.full()) return;
    if (!same(store.get('at:theme'), t)) setAtmo(store, 'theme', t);
    for (const [k, v] of moodEdits(t)) if (atmo<unknown>(store, k, null) !== v) setAtmo(store, k, v);
    if (saved().some((s) => s.id === t.id)) keep(saveTheme(saved(), t)); // a kept theme stays in step with its edits
  }
  /** Put a theme on the board: as a tap on its card would, unless it is the one already there. */
  function activate(t: GameTheme): void {
    if (tableTheme()?.id !== t.id) host.pickTheme(t);
    write(t);
  }
  function flush(): void {
    if (!ed?.timer) return;
    clearTimeout(ed.timer);
    ed.timer = undefined;
    write(ed.hist.now);
  }
  /** Show a theme on this device now, without waiting for the table. */
  function preview(t: GameTheme): void {
    const look = themeLook(t, t.mood.sky);
    board.setSky(t.mood.sky as Sky, look.light, look.fog);
    board.setGrade(look.grade);
    board.setDice(look.dice);
    board.setGlow(t.mood.glow);
    board.setSeason(t.mood.season as Season);
  }

  /** An edit: shown at once, undoable, and on its way to the table. */
  function apply(next: GameTheme, tag = '', redraw = true): void {
    if (!ed || !host.full()) return;
    if (tooBig(next)) { ed.note = `That would make the theme ${kB(themeSize(next))}: more than a table can carry (${kB(THEME_MAX)}).`; ed.tab = 'about'; draw(); return; }
    if (!ed.hist.push(next, tag)) return;
    moved(redraw);
  }
  /** The theme in hand changed (an edit, undo or redo). */
  function moved(redraw = true): void {
    if (!ed) return;
    preview(ed.hist.now);
    ed.timer ??= setTimeout(() => { if (ed) { ed.timer = undefined; write(ed.hist.now); } }, WRITE_MS);
    marks();
    if (redraw) draw();
  }
  const now = (): GameTheme => ed!.hist.now;

  function start(t: GameTheme, tab: Tab = 'look'): Session {
    return { hist: new History(settled(t, known), 30), tab, sel: null, colour: null, shelf: 'props', box: null, note: '', tops: {} };
  }
  function begin(t: GameTheme, tab: Tab = 'look'): void {
    if (!host.full()) return;
    flush();
    activate(t);
    ed = start(t, tab);
    host.open(EDIT);
  }
  /** Customise: a copy under this player's id, unless it is theirs already. */
  function customise(t: GameTheme): void {
    begin(isOwn(t.id, host.me) ? t : copyTheme(t, host.me, taken(), known));
  }

  // ---- the gallery (Prep → Theme) ----

  const moodLine = (t: GameTheme) => [cap(t.mood.sky), cap(t.mood.season), t.mood.amb !== 'off' ? cap(t.mood.amb) : ''].filter(Boolean).join(' · ');

  function gallery(el: HTMLElement): void {
    const at = el.scrollTop, cur = tableTheme(), mine = saved(), f = host.full();
    const held = el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset : undefined;
    el.innerHTML = '';
    const mineIds = new Set(mine.map((t) => t.id));
    // The board's own theme is shown as the table carries it (the app's list leaves out pieces this device lacks).
    const offered = host.themes().map((t) => (t.id === cur?.id ? cur : t)).filter((t) => !mineIds.has(t.id));

    const card = (t: GameTheme, own: boolean): HTMLElement => {
      const box = h('div', 'cardBox'), on = t.id === cur?.id, n = t.pieces.blocks.length + t.pieces.props.length + t.pieces.minis.length;
      const b = h('button', `card sky-${t.mood.sky}`);
      b.dataset.theme = t.id;
      b.innerHTML = '<big></big><b></b><small></small><small></small>';
      const [icon, name, line, count] = b.children;
      icon.textContent = t.icon;
      name.textContent = t.name;
      line.textContent = moodLine(t);
      count.textContent = on ? 'On the table — tap to let go' : `${n} piece${n === 1 ? '' : 's'} to the front`;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !f;
      b.onclick = () => host.pickTheme(on && cur ? cur : t);
      box.append(b);
      if (t.id === held?.theme) setTimeout(() => b.focus({ preventScroll: true })); // drawn again under the finger that tapped it
      if (!f) return box;
      const row = h('div', 'row');
      if (ask?.id === t.id && ask.kind === 'remove') {
        // Asked in the page itself: nothing pops up over the table.
        const q = h('p', 'hint grow', `Remove “${t.name}” from this device?`);
        const yes = button('Remove', () => { keep(forgetTheme(saved(), t.id)); ask = null; gallery(el); }, 'danger');
        yes.dataset.yes = t.id;
        row.append(q, yes, button('Keep', () => { ask = null; gallery(el); }));
        row.classList.add('wrap');
      } else if (ask?.id === t.id && ask.kind === 'rename') {
        const input = h('input');
        input.value = t.name;
        input.maxLength = 32;
        input.setAttribute('aria-label', 'Theme name');
        input.enterKeyHint = 'done';
        const done = () => {
          const renamed = setInfo(t, { name: input.value }, known);
          keep(saveTheme(saved(), renamed));
          if (cur?.id === t.id) write(setInfo(cur, { name: input.value }, known));
          ask = null;
          gallery(el);
        };
        input.onkeydown = (e) => { if (e.key === 'Enter') done(); };
        const ok = button('Save', done, 'primary');
        ok.dataset.yes = t.id;
        row.append(input, ok);
        row.classList.add('wrap');
        setTimeout(() => input.focus({ preventScroll: true }));
      } else {
        const edit = button(isOwn(t.id, host.me) ? 'Edit' : 'Customise', () => customise(on && cur ? cur : t), 'grow');
        edit.dataset.edit = t.id;
        row.append(edit);
        if (own) {
          const re = button('Aa', () => { ask = { id: t.id, kind: 'rename' }; gallery(el); }, '', `Rename “${t.name}”`);
          re.dataset.rename = t.id;
          const rm = button('', () => { ask = { id: t.id, kind: 'remove' }; gallery(el); }, '', `Remove “${t.name}”`);
          rm.innerHTML = ico('trash');
          rm.dataset.remove = t.id;
          row.append(re, rm);
        }
      }
      box.append(row);
      return box;
    };
    const section = (title: string, list: GameTheme[], own: boolean) => {
      if (!list.length) return;
      if (title) el.append(h('h3', 'tedHead', title));
      const cards = h('div', 'cards');
      cards.dataset.group = own ? 'mine' : 'offered';
      for (const t of list) cards.append(card(t, own));
      el.append(cards);
    };
    section('', offered, false);
    section('Mine', mine, true);

    if (f) {
      const row = h('div', 'row tedActs');
      const fresh = button('New from this board’s look', () => {
        const base = tableTheme(), name = base ? `My ${base.name}`.slice(0, 32) : 'My theme';
        const t = captureTheme({ sky: atmo(store, 'sky', 'day'), season: atmo(store, 'season', 'summer'), glow: atmo(store, 'glow', 1), amb: atmo(store, 'amb', 'off') }, base, ownId(host.me, base?.name ?? 'theme', taken()), name, known);
        if (t) begin(t, 'about');
      }, 'grow');
      fresh.dataset.act = 'new';
      const imp = button('Import a theme code', () => { importing = !importing; galleryNote = ''; gallery(el); }, 'grow');
      imp.dataset.act = 'import';
      imp.classList.toggle('on', importing);
      row.append(fresh, imp);
      el.append(row);
      if (importing) el.append(importBox((t) => { importing = false; galleryNote = `“${t.name}” is this board’s theme now.`; if (tableTheme()?.id !== t.id) host.pickTheme(t); else write(t); gallery(el); }));
      if (galleryNote) el.append(h('p', 'hint tedNote', galleryNote));
    }
    el.append(h('p', 'hint', offered.length || mine.length
      ? 'A theme sets the sky, season, firelight and soundscape in one tap, and brings its pieces to the front of the library. Customise makes a copy that is yours to change, with the table as the preview.'
      : 'No themes on offer here.'));
    el.scrollTop = at;
  }
  /** The gallery follows the table, but not while a name is being typed or a code pasted into it. */
  function galleryUpdate(el: HTMLElement): void {
    if (el.contains(document.activeElement) && document.activeElement!.matches('input, textarea')) return;
    gallery(el);
  }

  /** Paste a code, get a theme. Shared by the gallery and the About tab. */
  function importBox(use: (t: GameTheme) => void): HTMLElement {
    const box = h('div', 'tedBox'), area = h('textarea'), msg = h('p', 'hint');
    area.rows = 3;
    area.placeholder = 'Paste a theme code here';
    area.setAttribute('aria-label', 'Theme code');
    area.autocapitalize = 'off';
    area.spellcheck = false;
    area.dataset.field = 'code';
    const go = button('Use this theme', async () => {
      const t = await readThemeCode(area.value, known);
      if (t) use(t);
      else msg.textContent = area.value.trim() ? 'That is not a theme code this table can read.' : 'Paste a code first.';
    }, 'primary');
    go.dataset.act = 'use';
    area.onfocus = () => setTimeout(() => area.scrollIntoView({ block: 'nearest' }), 250); // once the keyboard is up
    box.append(area, go, msg);
    return box;
  }

  // ---- the editor (a see-through page: the panel, and the table above or beside it) ----

  function editor(el: HTMLElement, ctx: Back): void {
    const t = tableTheme();
    // Come back to by the phone's own buttons after the session ended: pick it up if the board still has a theme of ours.
    if (ed && !ed.timer && t?.id !== now().id) ed = null;
    if (!ed && t && isOwn(t.id, host.me) && host.full()) ed = start(t);
    el.innerHTML = '';
    if (!ed) { setTimeout(() => { if (showing(EDIT)) ctx.back(); }); return; }
    host.lookAround();
    const tools = h('div');
    tools.id = 'tedDo';
    const undo = button('', () => { if (ed?.hist.undo()) moved(); }, '', 'Undo the last change to the theme');
    undo.id = 'tedUndo';
    undo.innerHTML = ico('undo');
    const redo = button('', () => { if (ed?.hist.redo()) moved(); }, '', 'Redo');
    redo.id = 'tedRedo';
    redo.innerHTML = ico('redo');
    tools.append(undo, redo);
    const panel = h('div', 'panel');
    panel.id = 'ted';
    const tabs = h('div');
    tabs.id = 'tedTabs';
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of TABS) {
      const b = button(label, () => { if (!ed) return; ed.tab = id; ed.colour = null; draw(); });
      b.dataset.tab = id;
      b.setAttribute('role', 'tab');
      tabs.append(b);
    }
    const pane = h('div');
    pane.id = 'tedBody';
    pane.setAttribute('role', 'tabpanel');
    pane.onscroll = () => { if (ed) ed.tops[ed.tab] = pane.scrollTop; };
    panel.append(tabs, pane);
    el.append(tools, panel);
    preview(now());
    draw();
    fit();
  }
  /** The table changed under the editor: another device's edit of this theme is taken up; another theme ends the session. */
  function editorUpdate(_el: HTMLElement, ctx: Back): void {
    if (!ed || ed.timer) return; // our own change is still on its way
    const t = tableTheme();
    if (!t || t.id !== now().id || !host.full()) { ed = null; ctx.back(); return; }
    if (same(t, now())) return;
    ed.hist.push(t);
    marks();
    if (!body()?.contains(document.activeElement) || !document.activeElement!.matches('input, textarea')) draw();
  }

  /** Undo, redo and the tabs, as the session stands. */
  function marks(): void {
    if (!ed) return;
    const undo = document.getElementById('tedUndo') as HTMLButtonElement | null, redo = document.getElementById('tedRedo') as HTMLButtonElement | null;
    if (undo) undo.disabled = !ed.hist.canUndo;
    if (redo) redo.disabled = !ed.hist.canRedo;
    const size = document.getElementById('tedSize');
    if (size) sizeLine(size);
  }
  function sizeLine(el: HTMLElement): void {
    const n = themeSize(now());
    el.textContent = n > THEME_WARN
      ? `Size ${kB(n)} — heavy. A theme travels with the table; over ${kB(THEME_WARN)} it slows everyone’s joining, and ${kB(THEME_MAX)} is the most a table carries.`
      : `Size ${kB(n)} — it travels with the table, so small is good (under ${kB(THEME_WARN)}).`;
    el.classList.toggle('warn', n > THEME_WARN);
    el.dataset.bytes = String(n);
  }

  /** Tell the board what the panel covers, so the table sits in the middle of what is left. */
  function fit(): void {
    const panel = document.getElementById('ted'), tools = document.getElementById('tedDo'), bar = document.getElementById('prepBar');
    if (!panel || !tools || !bar || !showing(EDIT)) { board.setInset(0, 0); return; }
    const r = panel.getBoundingClientRect(), top = Math.round(bar.getBoundingClientRect().bottom);
    if (r.left > innerWidth * 0.2) board.setInset(-top, Math.round(innerWidth - r.left)); // beside the table
    else board.setInset(Math.round(innerHeight - r.top) - top, 0); // under it
  }

  // ---- controls ----

  const head = (title: string, action?: HTMLElement): HTMLElement => {
    const row = h('div', 'tedHead');
    row.append(h('b', '', title));
    if (action) row.append(action);
    return row;
  };
  /** One of a few: a row of equal buttons. */
  function choice(label: string, items: readonly (readonly [id: string, label: string])[], cur: string, pick: (id: string) => void, key: string): HTMLElement {
    const row = h('div', 'tedSeg');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    row.dataset.choice = key;
    for (const [id, text] of items) {
      const b = button(text, () => pick(id));
      b.dataset.id = id;
      b.classList.toggle('on', id === cur);
      b.setAttribute('aria-pressed', String(id === cur));
      row.append(b);
    }
    return row;
  }
  /** A dial, with its number. `set` is called as it moves. */
  function slider(label: string, key: keyof typeof BOUNDS, value: number, set: (v: number) => void, cls = ''): HTMLLabelElement {
    const [min, max, step] = BOUNDS[key], row = h('label', `slider ${cls}`), input = h('input'), out = h('output');
    const show = (v: number) => { out.textContent = String(Math.round(v * 100) / 100); };
    Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    input.dataset.dial = key;
    input.setAttribute('aria-label', label);
    input.oninput = () => { show(+input.value); set(+input.value); };
    show(value);
    row.append(h('span', '', label), input, out);
    return row;
  }

  interface Colour { key: string; label: string; value: string; set(hex: string | undefined, redraw: boolean): void; fallback: string }
  /** A row of colours to tap; the one tapped unfolds its swatches and sliders underneath. */
  function colours(list: Colour[]): HTMLElement {
    const wrap = h('div', 'tedColours'), row = h('div', 'tedSeg');
    wrap.append(row);
    for (const c of list) {
      const b = button('', () => { if (!ed) return; ed.colour = ed.colour === c.key ? null : c.key; draw(); }, 'tedDot');
      b.dataset.colour = c.key;
      const dot = h('i');
      dot.style.background = c.value;
      b.append(dot, h('span', '', c.label));
      b.classList.toggle('on', ed?.colour === c.key);
      b.setAttribute('aria-expanded', String(ed?.colour === c.key));
      row.append(b);
      if (ed?.colour === c.key) wrap.append(colourBox(c, dot));
    }
    return wrap;
  }
  function colourBox(c: Colour, dot: HTMLElement): HTMLElement {
    const box = h('div', 'tedCol');
    let [hu, sa, li] = hexToHsl(c.value);
    const paint = (hex: string) => {
      dot.style.background = hex;
      box.style.setProperty('--h', String(hu));
      box.style.setProperty('--s', `${sa}%`);
      box.style.setProperty('--l', `${li}%`);
    };
    const pal = h('div', 'tedPal');
    const back = button('↺', () => c.set(undefined, true), '', c.fallback);
    back.dataset.swatch = 'default';
    pal.append(back);
    for (const hex of SWATCHES) {
      const b = button('', () => c.set(hex, true), 'tedSw', `Colour ${hex}`);
      b.style.setProperty('--c', hex);
      b.dataset.swatch = hex;
      b.classList.toggle('on', hex === c.value);
      pal.append(b);
    }
    // The device's own colour picker, for whoever likes it: an extra, never the only way.
    const native = h('input', 'tedNative');
    native.type = 'color';
    native.value = c.value;
    native.setAttribute('aria-label', `${c.label}: any colour`);
    native.oninput = () => { [hu, sa, li] = hexToHsl(native.value); c.set(native.value, false); paint(native.value); sync(); };
    pal.append(native);
    const ranges: HTMLInputElement[] = [];
    const sync = () => { [hu, sa, li].forEach((v, i) => { ranges[i].value = String(v); }); };
    const range = (label: string, cls: string, max: number, get: () => number, put: (v: number) => void) => {
      const row = h('label', `slider ${cls}`), input = h('input');
      Object.assign(input, { type: 'range', min: '0', max: String(max), step: '1', value: String(get()) });
      input.setAttribute('aria-label', `${c.label}: ${label.toLowerCase()}`);
      input.dataset.hsl = cls;
      input.oninput = () => {
        put(+input.value);
        if (cls === 'hue' && sa < 8) { sa = 60; sync(); } // turning the hue of a grey would do nothing
        const hex = hslToHex(hu, sa, li);
        c.set(hex, false);
        native.value = hex;
        paint(hex);
      };
      ranges.push(input);
      row.append(h('span', '', label), input);
      return row;
    };
    box.append(pal,
      range('Hue', 'hue', 359, () => hu, (v) => { hu = v; }),
      range('Vivid', 'sat', 100, () => sa, (v) => { sa = v; }),
      range('Light', 'lig', 100, () => li, (v) => { li = v; }));
    paint(c.value);
    return box;
  }

  // ---- the tabs ----

  function draw(): void {
    const pane = document.getElementById('tedBody');
    if (!ed || !pane) return;
    for (const b of document.querySelectorAll<HTMLElement>('#tedTabs button')) {
      b.classList.toggle('on', b.dataset.tab === ed.tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === ed.tab));
      if (b.dataset.tab === ed.tab && pane.dataset.tab !== ed.tab) b.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    pane.innerHTML = '';
    pane.dataset.tab = ed.tab;
    ({ look: lookTab, sound: soundTab, pieces: piecesTab, dice: diceTab, gen: genTab, about: aboutTab })[ed.tab](pane, now());
    pane.scrollTop = ed.tops[ed.tab] ?? 0;
    marks();
  }

  function lookTab(el: HTMLElement, t: GameTheme): void {
    const sky = SKIES[t.mood.sky as Sky], light = t.mood.light ?? {}, fog = t.mood.fog, grade = t.mood.grade ?? {};
    el.append(
      choice('Sky', Object.entries(SKY_LABELS), t.mood.sky, (id) => apply(setMood(t, { sky: id as GameTheme['mood']['sky'] }, known)), 'sky'),
      choice('Season', SEASON_ORDER.map((s) => [s, cap(s)] as const), t.mood.season, (id) => apply(setMood(t, { season: id as GameTheme['mood']['season'] }, known)), 'season'),
      slider('Firelight', 'glow', t.mood.glow, (v) => apply(setMood(now(), { glow: v }, known), 'glow', false)),
    );
    const reset = (group: 'light' | 'fog' | 'grade', label: string) => {
      const b = button('Reset', () => { if (ed) ed.colour = null; apply(setGroup(now(), group, null, known)); }, '', label);
      b.dataset.reset = group;
      return b;
    };
    // Light: what the theme does not say is its sky's.
    const lit = (key: 'sun' | 'hemi' | 'bg', label: string): Colour => ({
      key, label, value: light[key] ?? sky[key], fallback: `As the ${SKY_LABELS[t.mood.sky].toLowerCase()} sky has it`,
      set: (hex, redraw) => apply(setGroup(now(), 'light', { [key]: hex }, known), key, redraw),
    });
    el.append(
      head('Light', reset('light', `The light of the ${SKY_LABELS[t.mood.sky].toLowerCase()} sky`)),
      colours([lit('sun', 'Sun'), lit('hemi', 'Sky'), lit('bg', 'Backdrop')]),
      slider('Sun', 'sunI', light.sunI ?? sky.sunI, (v) => apply(setGroup(now(), 'light', { sunI: v }, known), 'sunI', false)),
      slider('Sky', 'hemiI', light.hemiI ?? sky.hemiI, (v) => apply(setGroup(now(), 'light', { hemiI: v }, known), 'hemiI', false)),
    );
    // Haze: on is a haze of the theme's own; off is the far, faint one every table has.
    const hazy = button(fog ? 'On' : 'Off', () => { if (ed) ed.colour = null; apply(setGroup(now(), 'fog', fog ? null : { near: 20, far: 100 }, known)); }, fog ? 'on' : '', 'Haze of its own');
    hazy.dataset.haze = fog ? 'on' : 'off';
    hazy.setAttribute('aria-pressed', String(!!fog));
    el.append(head('Haze', hazy));
    if (fog) {
      el.append(
        colours([{
          key: 'fog', label: 'Haze colour', value: fog.color ?? light.bg ?? sky.bg, fallback: 'The colour of the backdrop',
          set: (hex, redraw) => apply(setGroup(now(), 'fog', { color: hex }, known), 'fog', redraw),
        }]),
        slider('Starts', 'near', fog.near, (v) => { apply(setGroup(now(), 'fog', { near: v }, known), 'near', false); ends(); }),
        slider('Solid', 'far', fog.far, (v) => { apply(setGroup(now(), 'fog', { far: v }, known), 'far', false); ends(); }),
      );
    } else el.append(h('p', 'hint', `None of its own: the table’s edge fades out far away (from ${HAZE.near} to ${HAZE.far} squares).`));
    // The two ends push each other along (themeEdit.ts): show where they ended up.
    const ends = () => {
      const f = now().mood.fog;
      for (const key of ['near', 'far'] as const) {
        const input = el.querySelector<HTMLInputElement>(`[data-dial="${key}"]`);
        if (f && input && +input.value !== f[key]) { input.value = String(f[key]); input.nextElementSibling!.textContent = String(f[key]); }
      }
    };
    const g = { ...GRADE_DEFAULT, ...grade };
    el.append(head('Picture', reset('grade', 'The usual picture')));
    for (const [key, label] of [['sat', 'Colour'], ['warmth', 'Warmth'], ['contrast', 'Contrast'], ['vignette', 'Vignette']] as const) {
      el.append(slider(label, key, g[key], (v) => apply(setGroup(now(), 'grade', { [key]: v }, known), key, false)));
    }
  }

  function soundTab(el: HTMLElement, t: GameTheme): void {
    const own = t.sounds?.scapes ?? {}, effects = Object.keys(t.sounds?.effects ?? {}).length;
    // What this device knows, and what the theme brings: each by its own name.
    const all = { ...SOUNDSCAPES, ...Object.fromEntries(Object.entries(own).map(([id, r]) => [id, r.name])), ...host.scapes?.() };
    el.append(head('Soundscape'));
    const grid = h('div', 'choices');
    grid.dataset.choice = 'amb';
    for (const [id, name] of Object.entries(all)) {
      const b = button(name, () => apply(setMood(t, { amb: id }, known)));
      b.dataset.id = id;
      b.classList.toggle('on', id === t.mood.amb);
      b.setAttribute('aria-pressed', String(id === t.mood.amb));
      grid.append(b);
    }
    el.append(grid);
    const n = Object.keys(own).length;
    el.append(h('p', 'hint', n || effects
      ? `This theme carries ${n} soundscape${n === 1 ? '' : 's'} and ${effects} effect${effects === 1 ? '' : 's'} of its own. They stay with it, and with every copy.`
      : 'The soundscape plays for everyone when the theme is picked. Each device can still switch its sound off.'));
  }

  /** The picture of a piece: its thumbnail, or a cube of its colour, or its emoji; a piece this device lacks is a question mark. */
  function tile(shelf: Shelf, id: string): HTMLButtonElement {
    const def = host.known[KIND[shelf]](id) ? TABLES[shelf][id] : null, b = h('button', 'tile'), at = def ? host.thumb(`${shelf[0]}_${id}`) : null;
    b.type = 'button';
    b.dataset.piece = id;
    const face = h('i');
    if (at) face.style.cssText = at;
    else if (def?.color) face.innerHTML = `<svg class="cube" viewBox="0 0 24 24"><path fill="${def.color}" d="M12 3 20.500 7.500 12 12 3.500 7.500z"/><path fill="${def.color}" style="filter:brightness(.78)" d="M3.500 7.500 12 12v9.500L3.500 17z"/><path fill="${def.color}" style="filter:brightness(.6)" d="M20.500 7.500 12 12v9.500l8.500-4.500z"/></svg>`;
    else face.textContent = def?.icon ?? '?';
    const name = def?.name ?? id.slice(id.indexOf(':') + 1);
    b.title = def ? name : `${id} — from a pack this device does not have`;
    b.classList.toggle('lacking', !def);
    b.append(face, h('span', '', name));
    return b;
  }

  function piecesTab(el: HTMLElement, t: GameTheme): void {
    for (const shelf of SHELVES) {
      const ids = t.pieces[shelf];
      const add = button('Add', () => { if (!ed) return; ed.shelf = shelf; host.open(PICK); }, '', `Add ${SHELF_NAMES[shelf].toLowerCase()}`);
      add.dataset.add = shelf;
      const title = head(SHELF_NAMES[shelf], add);
      title.querySelector('b')!.append(h('small', '', ` ${ids.length} of ${MAX_PIECES}`));
      el.append(title);
      const strip = h('div', 'tedStrip');
      strip.dataset.shelf = shelf;
      for (const id of ids) {
        const b = tile(shelf, id), on = ed?.sel?.shelf === shelf && ed.sel.id === id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        b.onclick = () => { if (!ed) return; ed.sel = on ? null : { shelf, id }; keepStrips(el); draw(); };
        strip.append(b);
      }
      if (!ids.length) strip.append(h('p', 'hint', 'None yet: the library’s own shelves are all there is.'));
      el.append(strip);
      strip.scrollLeft = strips[shelf] ?? 0;
      if (ed?.sel?.shelf === shelf && ids.includes(ed.sel.id)) {
        const id = ed.sel.id, i = ids.indexOf(id), row = h('div', 'row tedMove');
        const step = (by: number, label: string, title: string) => {
          const b = button(label, () => { keepStrips(el); apply(movePiece(now(), shelf, id, by, known)); }, 'grow', title);
          b.dataset.move = String(by);
          b.disabled = by < 0 ? i === 0 : i === ids.length - 1;
          return b;
        };
        const rm = button('Remove', () => { if (ed) ed.sel = null; keepStrips(el); apply(removePiece(now(), shelf, id, known)); }, 'grow', `Take ${TABLES[shelf][id]?.name ?? id} off this shelf`);
        rm.dataset.remove = id;
        row.append(step(-1, '◀ Earlier', 'Move it one place earlier'), step(1, 'Later ▶', 'Move it one place later'), rm);
        el.append(row);
        setTimeout(() => { strip.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); row.scrollIntoView({ block: 'nearest' }); });
      }
    }
    el.append(h('p', 'hint', 'These lead the library while the theme is on the board. Tap one to move it along its shelf or take it off.'));
  }
  /** Where each strip of pieces was scrolled to, so a tap does not send it back to its start. */
  const strips: Partial<Record<Shelf, number>> = {};
  const keepStrips = (el: HTMLElement) => { for (const s of el.querySelectorAll<HTMLElement>('.tedStrip')) strips[s.dataset.shelf as Shelf] = s.scrollLeft; };

  function diceTab(el: HTMLElement, t: GameTheme): void {
    const d = t.dice ?? {};
    const reset = button('Reset', () => { if (ed) ed.colour = null; apply(setGroup(now(), 'dice', null, known)); }, '', 'Each player’s own colour, plain dice');
    reset.dataset.reset = 'dice';
    const die = h('span', 'tedDie', '20');
    const paint = () => {
      const n = now().dice ?? {};
      die.style.background = n.body ?? host.color();
      die.style.color = n.ink ?? '#ffffff';
      die.style.filter = `saturate(${1 - (n.metal ?? 0.05) * 0.35}) brightness(${1 + (1 - (n.rough ?? 0.35)) * 0.12})`;
    };
    const col = (key: 'body' | 'ink', label: string, fallback: string, hint: string): Colour => ({
      key, label, value: d[key] ?? fallback, fallback: hint,
      set: (hex, redraw) => { apply(setGroup(now(), 'dice', { [key]: hex }, known), key, redraw); paint(); },
    });
    const roll = button('Roll a sample', () => void sample(), 'primary grow');
    roll.dataset.act = 'sample';
    const row = h('div', 'row tedSample');
    row.append(die, roll);
    el.append(
      head('Dice', reset),
      colours([col('body', 'Body', host.color(), 'Each player’s own colour'), col('ink', 'Numbers', '#ffffff', 'The usual numbers')]),
      slider('Rough', 'rough', d.rough ?? 0.35, (v) => { apply(setGroup(now(), 'dice', { rough: v }, known), 'rough', false); paint(); }),
      slider('Metal', 'metal', d.metal ?? 0.05, (v) => { apply(setGroup(now(), 'dice', { metal: v }, known), 'metal', false); paint(); }),
      row,
      h('p', 'hint', t.dice ? 'Everyone at the table throws these dice. The sample is only shown here.' : 'No dice of its own: everyone throws dice in their own colour.'),
    );
    paint();
  }
  /** One die on the table, for this device only: what the theme's dice look like in its light. */
  async function sample(): Promise<void> {
    const { target, tray } = board.throwSpot();
    const start = { p: [target[0] - 0.6, target[1] + 3.2, target[2] + 0.4] as [number, number, number], q: [0.18, 0.37, 0.08, 0.9] as [number, number, number, number] };
    const t = await simulate(['d20'], [start], [1.4, 0, -0.9], target, store, tray);
    board.invalidate();
    void board.dice.play(t, host.color(), 'theme-sample');
  }

  function genTab(el: HTMLElement, t: GameTheme): void {
    // The presets this device has loaded, and the ones the theme brings.
    const all: [string, string][] = [['', 'None in particular'], ...[...Object.values(PRESETS), ...(t.gens ?? [])].map((p): [string, string] => [p.id, p.name])];
    const seen = new Set<string>();
    el.append(head('Scene generator'));
    const grid = h('div', 'choices');
    grid.dataset.choice = 'gen';
    for (const [id, name] of all) {
      if (seen.has(id)) continue;
      seen.add(id);
      const b = button(name, () => apply(setInfo(t, { gen: id }, known)));
      b.dataset.id = id;
      b.classList.toggle('on', id === t.gen);
      b.setAttribute('aria-pressed', String(id === t.gen));
      grid.append(b);
    }
    el.append(grid, h('p', 'hint', 'Picking the theme sets Scenes → Generate to this, ready to build.'));
  }

  function aboutTab(el: HTMLElement, t: GameTheme): void {
    const name = h('input');
    name.value = t.name;
    name.maxLength = 32;
    name.placeholder = 'Name';
    name.setAttribute('aria-label', 'Theme name');
    name.dataset.field = 'name';
    name.enterKeyHint = 'done';
    name.oninput = () => apply(setInfo(now(), { name: name.value }, known), 'name', false);
    name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
    name.onblur = () => { name.value = now().name; };
    const icon = h('input');
    icon.value = t.icon;
    icon.maxLength = 16;
    icon.setAttribute('aria-label', 'Icon: one emoji');
    icon.dataset.field = 'icon';
    icon.oninput = () => { apply(setInfo(now(), { icon: icon.value }, known), 'icon', false); for (const b of grid.children) b.classList.toggle('on', b.textContent === now().icon); };
    icon.onblur = () => { icon.value = now().icon; };
    const top = h('div', 'row tedName');
    top.append(icon, name);
    const grid = h('div', 'tedEmoji');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Icon');
    for (const e of EMOJI) {
      const b = button(e, () => apply(setInfo(now(), { icon: e }, known)));
      b.classList.toggle('on', e === t.icon);
      grid.append(b);
    }
    const size = h('p', 'hint');
    size.id = 'tedSize';
    sizeLine(size);

    const acts = h('div', 'tedActs2');
    const act = (id: string, label: string, click: () => void, on = false) => {
      const b = button(label, click);
      b.dataset.act = id;
      b.classList.toggle('on', on);
      acts.append(b);
      return b;
    };
    const kept = saved().some((s) => s.id === t.id);
    act('share', 'Share', () => { if (!ed) return; ed.box = ed.box === 'share' ? null : 'share'; ed.note = ''; draw(); }, ed?.box === 'share');
    act('import', 'Import a theme code', () => { if (!ed) return; ed.box = ed.box === 'import' ? null : 'import'; ed.note = ''; draw(); }, ed?.box === 'import');
    act('save', kept ? 'Saved to my themes ✓' : 'Save to my themes', () => {
      if (!ed) return;
      keep(saveTheme(saved(), now()));
      ed.note = 'Saved on this device: it is under “Mine” in the gallery, and keeps up with your changes.';
      draw();
    }, kept);
    const everywhere = same(store.get('set:theme'), t);
    act('default', everywhere ? 'On every board ✓' : 'Use on every board', () => {
      if (!ed || !host.full()) return;
      flush();
      // The table's own theme and mood: what a board shows until it is given one of its own (see `atmo`).
      store.set('set:theme', now());
      for (const [k, v] of moodEdits(now())) store.set(`set:${k}`, v);
      ed.note = 'This is the table’s theme now: every board that has not been given one of its own shows it.';
      draw();
    }, everywhere);

    el.append(top, grid, acts);
    if (ed?.box === 'share') el.append(shareBox());
    if (ed?.box === 'import') {
      el.append(importBox((got) => {
        if (!ed) return;
        // Somebody else's theme becomes a copy of ours, like a customised one; our own comes back as it is.
        const mine = isOwn(got.id, host.me) ? got : copyTheme(got, host.me, taken().filter((id) => id !== now().id), known, got.name);
        ed.box = null;
        ed.note = `“${mine.name}” is this board’s theme now. Undo brings the last one back.`;
        ed.sel = null;
        flush();
        ed.hist.push(mine);
        activate(mine);
        moved();
      }));
    }
    if (ed?.note) el.append(h('p', 'hint tedNote', ed.note));
    el.append(size);
  }
  /** The theme as a code: shown, so it can be copied by hand where the clipboard is out of reach. */
  function shareBox(): HTMLElement {
    const box = h('div', 'tedBox'), area = h('textarea'), msg = h('p', 'hint', 'Paste it to a friend: Prep → Theme → Import a theme code.');
    area.rows = 3;
    area.readOnly = true;
    area.setAttribute('aria-label', 'This theme as a code');
    area.dataset.field = 'share';
    area.onfocus = () => area.select();
    const copy = button('Copy the code', async () => {
      try { await navigator.clipboard.writeText(area.value); msg.textContent = 'Copied. Paste it to a friend, or into Import a theme code on another table.'; }
      catch { area.focus(); area.select(); msg.textContent = 'Could not reach the clipboard: the code is selected above — copy it from there.'; }
    }, 'primary grow');
    copy.dataset.act = 'copy';
    copy.disabled = true;
    const row = h('div', 'row');
    row.append(copy);
    if (navigator.share) {
      const send = button('Send…', () => void navigator.share({ text: area.value }).catch(() => {}), 'grow');
      send.dataset.act = 'send';
      row.append(send);
    }
    void themeCode(now()).then((code) => { area.value = code; copy.disabled = false; });
    box.append(area, row, msg);
    return box;
  }

  // ---- adding pieces: a page of the whole library, with search ----

  let query = '';
  function picker(el: HTMLElement, ctx: Back): void {
    el.innerHTML = '';
    if (!ed) { setTimeout(() => { if (showing(PICK)) ctx.back(); }); return; }
    const shelf = ed.shelf, table = TABLES[shelf];
    const top = h('div', 'tedPickTop'), q = h('input'), count = h('p', 'hint');
    q.type = 'search';
    q.id = 'tedQ';
    q.maxLength = 40;
    q.value = query;
    q.placeholder = `Search ${SHELF_NAMES[shelf].toLowerCase()}`;
    q.setAttribute('aria-label', q.placeholder);
    q.autocomplete = 'off';
    q.autocapitalize = 'off';
    q.spellcheck = false;
    q.enterKeyHint = 'search';
    count.id = 'tedCount';
    top.append(q, count);
    const grid = h('div');
    grid.id = 'tedGrid';
    el.append(top, grid);
    const counted = () => {
      const n = now().pieces[shelf].length;
      count.textContent = `${n} of ${MAX_PIECES} on the theme’s shelf${n >= MAX_PIECES ? ' — full: take one off to add another' : ' — tap to add or take off'}`;
      count.classList.toggle('warn', n >= MAX_PIECES);
    };
    const fill = () => {
      grid.innerHTML = '';
      const inTheme = now().pieces[shelf];
      const put = (id: string) => {
        const b = tile(shelf, id), on = inTheme.includes(id);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        b.onclick = () => {
          const had = now().pieces[shelf].includes(id);
          apply(had ? removePiece(now(), shelf, id, known) : addPiece(now(), shelf, id, known), '', false);
          const has = now().pieces[shelf].includes(id);
          b.classList.toggle('on', has);
          b.setAttribute('aria-pressed', String(has));
          counted();
        };
        grid.append(b);
      };
      // Everything of this kind: the library's shelves in their order (a pack's among them), then pieces on no shelf, then what the theme names from packs not here.
      const groups: [string, string[]][] = Object.entries(LIBRARY[shelf]).map(([name, ids]) => [name, ids.filter((id) => id in table)]);
      const shelved = new Set(groups.flatMap(([, ids]) => ids));
      groups.push(['More', Object.keys(table).filter((id) => !shelved.has(id))], ['From packs not on this device', inTheme.filter((id) => !(id in table))]);
      if (query.trim()) {
        const seen = new Set<string>();
        const all = groups.flatMap(([, ids]) => ids).filter((id) => !seen.has(id) && !!seen.add(id)).map((id) => ({ id, name: `${table[id]?.name ?? ''} ${id.replace(/[:_.-]/g, ' ')}` }));
        const found = searchPieces(all, query);
        grid.append(h('h3', '', found.length ? `${found.length} found` : `Nothing called “${query.trim()}”`));
        for (const p of found) put(p.id);
      } else {
        for (const [name, ids] of groups) {
          if (!ids.length) continue;
          grid.append(h('h3', '', name));
          for (const id of ids) put(id);
        }
      }
      counted();
    };
    q.oninput = () => { query = q.value; fill(); grid.scrollTop = 0; };
    fill();
  }

  // ---- wiring ----

  registerPrepPage({ id: 'theme', title: 'Theme', icon: 'moon', order: 10, hint: 'The mood, and the pieces up front', now: (app) => { const t = app.theme(); return t ? `${t.icon} ${t.name}` : ''; }, render: gallery, update: galleryUpdate });
  registerPrepPage({
    id: EDIT, title: 'Customise theme', icon: 'moon', listed: false, see: true,
    render: editor, update: editorUpdate,
  });
  registerPrepPage({ id: PICK, title: 'Add pieces', icon: 'search', listed: false, render: picker });

  // Leaving the editor (Back, the phone's own back, Prep closing): write what is waiting and give the board its whole screen back.
  const shell = document.getElementById('prepPages'), pageBody = body();
  const left = () => {
    if (showing(EDIT)) { query = ''; fit(); return; }
    flush();
    board.setInset(0, 0);
    if (!showing(PICK)) query = '';
  };
  if (shell && pageBody) {
    const watch = new MutationObserver(left);
    watch.observe(shell, { attributes: true, attributeFilter: ['hidden'] });
    watch.observe(pageBody, { attributes: true, attributeFilter: ['data-page'] });
  }
  addEventListener('resize', () => { if (showing(EDIT)) fit(); });
  window.visualViewport?.addEventListener('resize', () => { if (showing(EDIT)) setTimeout(fit, 50); });
  addEventListener('pagehide', flush);
  // A pack arriving or leaving changes what the pieces look like, and what there is to add.
  onRegistry(() => {
    if (showing(EDIT) && ed?.tab === 'pieces') draw();
    const el = body();
    if (showing(PICK) && el) picker(el, { back: () => history.back() });
  });

  return {
    saved,
    customise,
    flush,
  };
}
