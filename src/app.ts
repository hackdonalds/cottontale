// The new chrome (the redesign, behind `?ui=2` until it takes over from main.ts): a session
// (src/session.ts) with the dock, drawers, notices and pages of src/ui on top. This file only
// wires them together; what each part does lives in its own module.

import './ui/shell.css';
import { EMOTES } from './board';
import * as registry from './registry';
import { ls, startSession, type Session } from './session';
import { armKey, watchLibrary, type Ctx } from './ui/buildSheets';
import { showDisplay } from './ui/display';
import { mountDock, type Dock } from './ui/dock';
import { mountDrawer } from './ui/drawer';
import { thumb } from './ui/face';
import { mountHotbar, type Hotbar } from './ui/hotbar2';
import { registerImportPage } from './ui/importPage';
import { mountNotice } from './ui/notice';
import { registerPacksPage } from './ui/packsPage';
import { Log, mountTurn } from './ui/playSheets';
import { initPrep, registerPrepPage, type Prep } from './ui/prep';
import { registerBuiltinPrepPages } from './ui/prepPages';
import { mountSystem, renderSystemPicker, setPickerNote, setScriptRunner } from './ui/sheet';
import { initSheets } from './ui/sheets';
import { registerSoundPage } from './ui/soundPage';
import { initThemeEditor } from './ui/themeEditor';

export async function play(name: string, code: string, relays: string[], color: string, display = false): Promise<void> {
  if (display) return showDisplay(code, relays); // a table screen has no chrome to wire up (src/ui/display.ts)
  // Of the old chrome only the parts that are reused stay: the Prep pages, the character sheet, the rules picker and the roll toast.
  const hud = document.getElementById('hud')!;
  for (const kid of [...hud.children]) if (!['prepPages', 'sheet', 'rules', 'toast'].includes(kid.id)) kid.remove();
  hud.hidden = false;
  hud.style.setProperty('--dock', '52px');
  const root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  const notice = mountNotice(root);
  const log = new Log();
  let dock: Dock | undefined, hotbar: Hotbar | undefined, prep: Prep | undefined, turn: ReturnType<typeof mountTurn> | undefined;
  const plain = (html: string) => html.replace(/<[^>]+>/g, '');
  // The session starts telling us things before the chrome below exists: until then there is nothing to draw.
  let ready = false;
  const redraw = () => { if (!ready) return; dock?.render(); hotbar?.render(); turn?.render(); drawer.redraw(); inset(); };
  let toastTimer: ReturnType<typeof setTimeout>;
  const session: Session = await startSession({
    canvas: document.getElementById('c') as HTMLCanvasElement, name, code, relays, color,
    hooks: {
      notice: (text) => notice.say(text),
      log: (html, mine) => log.add(html, mine),
      rolled: (shown, by) => {
        const t = document.getElementById('toast')!;
        t.innerHTML = `<big>${shown}</big>${by}`;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
      },
      changed: () => {
        if (!ready) return;
        document.body.classList.toggle('player', !session.full());
        document.body.classList.toggle('gm', session.amGM());
        prep?.refresh();
        syncScripts();
        redraw();
      },
      grabbed: () => { if (ready) { drawer.close(); openLegacy(null); } },
    },
  });
  const s = session;
  document.getElementById('lobby')!.hidden = true;
  const drawer = mountDrawer(root, () => { if (drawer.id) openLegacy(null, false); dock?.render(); hotbar?.render(); inset(); });
  const ctx: Ctx = { s, drawer, notice };
  log.onChange = () => { if (drawer.id === 'dice') drawer.redraw(); dock?.render(); };

  /** The sheets kept from the old chrome (the character sheet, the rules picker): one at a time, and never with a drawer. */
  function openLegacy(id: string | null, closeDrawer = true): void {
    if (id && closeDrawer) drawer.close();
    for (const el of document.querySelectorAll<HTMLElement>('#hud .sheet')) el.classList.toggle('closed', el.id !== id);
  }
  for (const b of document.querySelectorAll<HTMLElement>('#hud [data-close]')) b.onclick = () => openLegacy(null);
  s.attachRules(mountSystem({
    store: s.store, net: s.net, board: s.board, me: s.meId, pk: s.me, here: s.here, say: (html, mine) => log.add(html, mine), send: s.send, openSheet: (id) => openLegacy(id),
    hold: s.hold, secret: s.secretRoll,
  }));
  // Scripts a game system brings (src/script.ts): fetched only where the table's system has some and this device would referee.
  let scripts: Promise<typeof import('./script')> | undefined;
  function syncScripts(): void {
    if (!scripts && !(s.system()?.scripts && s.referee())) return;
    void (scripts ??= import('./script')).then((m) => m.syncScripts({ system: () => s.system(), referee: s.referee, say: (html) => log.add(html), setRunner: setScriptRunner, setNote: setPickerNote, redraw: () => { prep?.refresh(); s.touch(); } }));
  }

  // Prep's pages are the Table slot's "Prepare" list: theme, sound, the GM's own pieces, rules.
  registerBuiltinPrepPages();
  registerPrepPage({ id: 'rules', title: 'Rules', icon: 'list', order: 40, hint: 'The game system and its character sheets', now: () => s.system()?.name ?? '', render: renderSystemPicker, update: renderSystemPicker });
  prep = initPrep({
    store: s.store, full: s.full, say: (html) => notice.say(plain(html)), themes: s.themesOffered, theme: s.gameTheme, pickTheme: s.pickTheme, blobs: s.blobs, me: s.meId, playerName: name,
    // Straight from an import to the table: the page closes, and the new piece is in hand.
    place: (group, id) => {
      if (!s.full() || !registry.known[group === 'minis' ? 'mini' : 'prop'](id)) return;
      prep!.close();
      s.setMode('build');
      armKey(s, `${group === 'minis' ? 'm' : 'p'}_${id}`);
    },
  });
  registerSoundPage(s.tableSounds, { store: s.store, full: s.full, emotes: Object.keys(EMOTES), soundOn: () => s.setSound(true) });
  const themeEd = initThemeEditor({ scapes: () => s.tableSounds.scapeNames(), store: s.store, board: s.board, known: s.known, me: s.meId, color: () => color, full: s.full, ls, themes: s.themesOffered, pickTheme: s.pickTheme, thumb, lookAround: () => s.setTool('move'), open: (page) => prep!.open(page) });
  registerImportPage(); registerPacksPage();
  s.packs.onPacks(() => { if (drawer.id === 'pieces') drawer.redraw(); }); // a piece's picture arrived
  watchLibrary(drawer);
  void s.loaded.then(() => prep?.refresh());
  initSheets();

  turn = mountTurn(root, ctx);
  dock = mountDock(root, ctx, log, () => prep);
  hotbar = mountHotbar(root, ctx);
  /** Tell the board how much of the canvas the chrome covers, so "the middle of the table" is the middle of what can be seen. */
  let was = '';
  function inset(): void {
    if (!dock) return;
    const r = dock.el.getBoundingClientRect(), side = r.height > r.width, d = drawer.id ? drawer.el.getBoundingClientRect() : null;
    const now = side ? `0,${Math.round(innerWidth - (d ? Math.min(d.left, r.left) : r.left))}` : `${Math.round(innerHeight - (d && drawer.el.dataset.h !== 'full' ? d.top : r.top))},0`;
    if (now === was) return;
    was = now;
    const [bottom, right] = now.split(',').map(Number);
    s.board.setInset(bottom, right);
  }
  addEventListener('resize', () => setTimeout(inset));
  ready = true;
  s.touch();
  redraw();
  Object.assign(window, { __ct: { store: s.store, net: s.net, board: s.board, sound: s.sound, session: s, blobs: s.blobs, packs: s.packs, sounds: s.tableSounds, registry, ui: { prep, drawer }, themeEd } });
}
