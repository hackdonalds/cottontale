import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { Board, EMOTES, type MiniVal, type RulerMode, type Sky, type Slab, type Tool, type Vec } from './board';
import { BLOCKS, BLOCK_SHELVES, MINIS, MINI_SHELVES, PLAYER_COLORS, PROPS, PROP_SHELVES } from './catalog';
import { loadKit, type Season } from './kit';
import THUMBS from './thumbs.json';
import { EDGES } from './rules';
import { ROOM_NAMES, THEMES, generate, type GenOpts, type GenRoom, type Theme } from './gen';
import { MAX_DICE, kindsFor, results, rollValues, simulate, type Kind, type Start } from './dice';
import { DEFAULT_RELAYS, Net, deriveRoom, hex, pack, unhex, unpack, type Msg } from './net';
import { SOUNDSCAPES, Sound } from './sound';
import { canControl, fullPowers, gms, nextTurn, pid, setting, turnOrder, type Turn, parseEdge, roomEdges } from './rules';
import { Store, type Row } from './store';
import { activeTheme, loadThemes, moodEdits, type GameTheme, type Known } from './theme';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ls = {
  get: (k: string) => { try { return localStorage.getItem(`cottontale:${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`cottontale:${k}`, v); } catch { /* storage full or blocked */ } },
};
/** A drawing from the icon set in index.html. */
const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function randomCode(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  return [...r].map((b, i) => (i && i % 4 === 0 ? '-' : '') + abc[b % abc.length]).join('');
}

function swatches(el: HTMLElement, current: () => string, pick: (c: string) => void): () => void {
  const paint = () => {
    el.innerHTML = '';
    for (const c of PLAYER_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.setProperty('--c', c);
      b.setAttribute('aria-label', `Colour ${c}`);
      b.classList.toggle('on', c === current());
      b.onclick = () => { pick(c); paint(); };
      el.append(b);
    }
  };
  paint();
  return paint;
}

// ---- device plumbing ----

const coarse = matchMedia('(pointer: coarse)').matches;

// Keep bottom-anchored UI above the on-screen keyboard (iOS overlays it instead of resizing the page).
const vv = window.visualViewport;
if (vv) {
  // (Only when the page is not zoomed: a zoomed viewport is smaller too, but that is not a keyboard.)
  const fit = () => { if (Math.abs(vv.scale - 1) < 0.01) document.documentElement.style.setProperty('--kb', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`); };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

// iOS ignores CSS that forbids pinch-zooming the page; a pinch that starts on a
// panel would zoom the whole app instead of the table. Refuse it.
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

// Installable, and opens offline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js').catch(() => {});

// A phone that dims mid-encounter is no fun.
function stayAwake(): void {
  if (document.visibilityState === 'visible') void navigator.wakeLock?.request('screen').catch(() => {});
}

// ---- lobby -------------------------------------------------------------------

const hash = new URLSearchParams(location.hash.slice(1));
let myColor = ls.get('color') ?? PLAYER_COLORS[Math.floor(Math.random() * 8)];
$<HTMLInputElement>('name').value = ls.get('name') ?? '';
$<HTMLInputElement>('code').value = hash.get('room') ?? ls.get('lastRoom') ?? randomCode();
$<HTMLTextAreaElement>('relays').value = (hash.get('relays')?.split(',') ?? JSON.parse(ls.get('relays') ?? 'null') ?? DEFAULT_RELAYS).join('\n');
swatches($('colors'), () => myColor, (c) => { myColor = c; });
$('newcode').onclick = () => { $<HTMLInputElement>('code').value = randomCode(); };

$<HTMLFormElement>('lobby').onsubmit = (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>('name').value.trim();
  const code = $<HTMLInputElement>('code').value.trim();
  const relays = $<HTMLTextAreaElement>('relays').value.split(/[\s,]+/).filter((r) => /^wss?:\/\//.test(r));
  if (!name || code.length < 6 || !relays.length) return;
  ls.set('name', name);
  ls.set('color', myColor);
  ls.set('lastRoom', code);
  ls.set('relays', JSON.stringify(relays));
  ($('join') as HTMLButtonElement).disabled = true;
  void play(name, code, relays);
};

// ---- game ----------------------------------------------------------------------

async function play(name: string, code: string, relays: string[]): Promise<void> {
  let skHex = ls.get('sk');
  if (!skHex) ls.set('sk', (skHex = hex(generateSecretKey())));
  const sk = unhex(skHex);
  const me = getPublicKey(sk);
  const meId = pid(me);
  const store = new Store(meId);
  const full = () => fullPowers(store, meId);
  // The modelled pieces; without them (offline, first visit) the table falls back to plain shapes.
  const [{ tag }] = await Promise.all([deriveRoom(code), loadKit('./kit').catch(() => {})]);

  const customRelays = relays.join() !== DEFAULT_RELAYS.join();
  const invite = `${location.origin}${location.pathname}#room=${encodeURIComponent(code)}${customRelays ? `&relays=${relays.join(',')}` : ''}`;
  history.replaceState(null, '', invite);

  const sound = new Sound();
  sound.enabled = ls.get('sound') !== 'off';
  // Browsers only let a page make sound after a tap.
  addEventListener('pointerdown', () => sound.unlock(), true);

  /** The board this device is showing ('' is the main one). Live actions are tagged with it. */
  let here = '';
  const send = (m: Msg) => net.send({ ...m, bd: here });

  // The store starts changing (restored from disk, then the relays) before the UI below is wired up.
  const ui = { ready: false, syncing: false };

  // Minis placed with the mini tool use these.
  let miniKind = 'knight';
  let miniColor = myColor;

  const board = new Board($<HTMLCanvasElement>('c'), store, {
    onSelect: showMiniPanel,
    onLiveMove: (id, p) => void send({ y: 'mv', id, p }),
    onPing: (p) => { board.ping(p, myColor); sound.ping(); void send({ y: 'ping', p }); },
    newMini: () => ({ k: miniKind, c: miniColor, n: '', r: 0, s: 1 }),
    canMove: (id) => {
      const v = store.get<MiniVal>(`m:${id}`);
      if (!v || !canControl(store, meId, v)) return false;
      // In a fight, players move on their own turn (the GM always can).
      const turn = store.get<Turn>('turn');
      return full() || !turn || !turnOrder(store).some((o) => o.id === turn.id) || turn.id === id;
    },
    onRuler: (r) => void send({ y: 'ruler', r }),
    onView: () => placeRing(),
    onLight: (name) => say(`<span class="sys">Light: ${name}.</span>`),
    onSlab: (slab) => {
      board.brush = 'paste';
      board.setTool('build');
      renderPalette();
      say(`<span class="sys">Copied ${slab.cells.length} pieces. Tap where to put them; ↻ turns them.</span>`);
    },
    onGrab: () => { if (phoneSheet()) closeSheet(); },
    onThrow: (starts, vel) => void throwHand(starts, vel),
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  store.onChange = (k, v, prev) => {
    board.apply(k, v, prev);
    if (k === 'gen' && !$('gen').classList.contains('closed')) renderGen();
    if (k === 'set:theme') renderPalette(); // its pieces come to the front of the library
    later(); // role, turn order and panels follow the store
    saveTimer ??= setTimeout(() => { saveTimer = undefined; ls.set(`room:${tag}`, JSON.stringify(store.dump())); }, 1500);
  };

  // Restore our local copy of this table, then let the relays fill in the rest.
  const unconfirmed = new Set<string>();
  try {
    for (const row of JSON.parse(ls.get(`room:${tag}`) ?? '[]') as Row[]) if (store.merge(row)) unconfirmed.add(row[0]);
  } catch { /* corrupt cache: relays will restore */ }

  const net = new Net({
    code, relays, sk, name, color: myColor, store, unconfirmed,
    onMsg: handle,
    onPeers: renderPlayers,
    onStatus: (open, total) => {
      const s = $('status');
      s.className = open === total ? 'ok' : open ? 'part' : '';
      s.title = `${open}/${total} relays connected`;
    },
  });
  await net.start();
  board.dice.onHit = (strength) => sound.clack(strength);
  Object.assign(window, { __ct: { store, net, board, sound, catalog: { BLOCKS, PROPS, MINIS } } });

  $('lobby').hidden = true;
  $('hud').hidden = false;
  stayAwake();
  $('help').innerHTML = coarse
    ? 'One finger: look around — or use the selected tool (in Build, tap or drag to place; Measure, drag to measure).<br />Two fingers: pan, pinch to zoom, twist to turn.<br />Press and hold the table to ping. The arrows on the right hide upper floors.<br />Dice: pick them up, then drag on the table and let go to throw.'
    : 'Left-drag orbit · right-drag pan · wheel zoom<br />1–5 tools · R rotate · Ctrl+Z / Ctrl+Y · Del remove<br />Hold the mouse on the table to ping<br />Dice: pick them up, drag on the table, let go to throw';
  say(`<span class="sys">Welcome, ${esc(name)}! Share the invite link to bring others to the table.</span>`);

  function handle(msg: Msg, from: string): void {
    const who = `<b style="color:${net.colorOf(from)}">${esc(net.nameOf(from))}</b>`;
    const elsewhere = (msg.bd ?? '') !== here; // it happened on a board this device is not showing
    switch (msg.y) {
      case 'emote':
        if (!elsewhere && typeof msg.id === 'string') { board.emote(msg.id, String(msg.e)); sound.emote(String(msg.e)); }
        break;
      case 'chat':
        if (msg.to && msg.to !== meId) break; // a whisper for someone else
        say(`${who}${msg.to ? ' <span class="sys">whispers</span>' : ''}: ${esc(String(msg.m).slice(0, 300))}`);
        break;
      case 'ruler': {
        const r = elsewhere ? null : msg.r;
        const ok = r && Array.isArray(r.a) && Array.isArray(r.b) && r.a.length === 3 && r.b.length === 3 && ['line', 'circle', 'cone'].includes(r.m);
        board.showRuler(from, ok ? r : null, net.colorOf(from));
        break;
      }
      case 'roll': {
        if (msg.s && !full()) {
          // The GM rolled in secret: players see blank dice tumble, and no result.
          if (msg.t && !elsewhere) void board.dice.play(msg.t, net.colorOf(from), from, true);
          say(`🎲 ${who} rolled in secret`);
          break;
        }
        // With a recorded throw, watch the dice land first; what they show is the result.
        const labels = msg.t ? results(msg.t) : null;
        if (!msg.t || !labels || elsewhere) { showRoll(who, msg, false); break; }
        const shown = { ...msg, r: rollValues(msg.t.k, labels) };
        void board.dice.play(msg.t, net.colorOf(from), from).then(() => showRoll(who, shown, false));
        break;
      }
      case 'ping': if (!elsewhere && Array.isArray(msg.p) && msg.p.every(Number.isFinite)) { board.ping(msg.p, net.colorOf(from)); sound.ping(); } break;
      case 'mv': if (!elsewhere && Array.isArray(msg.p)) board.liveMove(String(msg.id), msg.p as Vec); break;
    }
  }

  // ---- players, chat, dice ----

  function renderPlayers(): void {
    const g = gms(store);
    const all = [{ id: meId, name, color: myColor }, ...[...net.peers].map(([pk, p]) => ({ id: pid(pk), ...p }))];
    $('players').innerHTML = all.map((p) => `<span style="border-color:${p.color}">${g.includes(p.id) ? ico('crown') : ''}${esc(p.name)}</span>`).join('');
  }
  renderPlayers();

  function say(html: string, mine = false): void {
    const d = document.createElement('div');
    d.innerHTML = html;
    const box = $('msgs');
    box.append(d);
    while (box.children.length > 200) box.firstChild!.remove();
    box.scrollTop = box.scrollHeight;
    // The log is a closed sheet on phones: flag what was missed.
    if ($('log').classList.contains('closed') && !d.querySelector('.sys') && !mine) $('logToggle').classList.add('unread');
  }

  let toastTimer: ReturnType<typeof setTimeout>;
  function showRoll(who: string, m: { d: string; r: number[]; mod: number }, mine: boolean): void {
    const r = (Array.isArray(m.r) ? m.r : []).slice(0, 20).map(Number);
    const total = r.reduce((a, b) => a + b, 0) + (Number(m.mod) || 0);
    const detail = r.length > 1 || m.mod ? ` <span class="sys">(${r.join(' + ')}${m.mod ? ` ${m.mod > 0 ? '+' : '−'} ${Math.abs(m.mod)}` : ''})</span>` : '';
    say(`🎲 ${who} rolled ${esc(String(m.d))}: <span class="tot">${total}</span>${detail}`, mine);
    const t = $('toast');
    t.innerHTML = `<big>${total}</big>${mine ? 'You' : who} · ${esc(String(m.d))}`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  // Dice work like at a real table: pick some up, hold them over the board, let go.
  const meTag = `<b style="color:${myColor}">${esc(name)}</b>`;
  const hand = new Map<number, number>(); // sides → how many
  let handMod = 0;
  const handKinds = (): Kind[] => [...hand].flatMap(([sides, n]) => kindsFor(n, sides) ?? []);
  const handText = () => [...hand].map(([sides, n]) => `${n}d${sides}`).join('+') + (handMod ? (handMod > 0 ? '+' : '') + handMod : '');
  const phoneSheet = () => getComputedStyle($('logToggle')).display !== 'none';

  function renderHand(): void {
    const kinds = handKinds();
    board.hand = kinds;
    board.diceColor = myColor;
    for (const b of $('dice').querySelectorAll<HTMLButtonElement>('[data-d]')) {
      const n = hand.get(+b.dataset.d!);
      if (n) b.dataset.n = String(n); else delete b.dataset.n;
    }
    const total = [...hand.values()].reduce((a, b) => a + b, 0);
    if (total) $('logToggle').dataset.n = String(total); else delete $('logToggle').dataset.n;
    $('hand').textContent = total ? `${handText()} in hand — drag on the table and let go to throw` : 'Tap dice to pick them up';
    $('hand').classList.toggle('full', total > 0);
    $<HTMLCanvasElement>('c').style.cursor = total ? 'grabbing' : '';
    if (total) void import('cannon-es'); // warm up the physics engine before the throw
  }
  function pickUp(sides: number, n = 1): boolean {
    const next = new Map(hand).set(sides, (hand.get(sides) ?? 0) + n);
    const kinds = [...next].map(([s, c]) => kindsFor(c, s));
    if (kinds.some((k) => !k) || kinds.flat().length > MAX_DICE) return false;
    hand.set(sides, next.get(sides)!);
    return true;
  }
  function emptyHand(): void {
    hand.clear();
    handMod = 0;
    renderHand();
  }

  async function throwHand(starts: Start[], vel: Vec): Promise<void> {
    const kinds = handKinds(), d = handText(), mod = handMod;
    emptyHand();
    const { target, tray } = board.throwSpot();
    // Simulate the throw, share the recording, and let everyone watch it land.
    const t = await simulate(kinds, starts, vel, target, store, tray);
    board.dice.endHold();
    const r = rollValues(kinds, results(t)!);
    void send({ y: 'roll', d, r, mod, t, ...(secret ? { s: true } : {}) });
    navigator.vibrate?.(12);
    await board.dice.play(t, myColor, me);
    showRoll(meTag, { d, r, mod }, true);
  }
  function closeSheet(): void { openSheet(null); }

  let secret = false;
  $('secret').onclick = () => {
    secret = !secret;
    $('secret').classList.toggle('on', secret);
    say(`<span class="sys">${secret ? 'Your rolls are now secret: players see blank dice.' : 'Your rolls are public again.'}</span>`);
  };
  for (const b of $('dice').querySelectorAll<HTMLButtonElement>('[data-d]')) b.onclick = () => { pickUp(+b.dataset.d!); renderHand(); };
  $('diceClear').onclick = emptyHand;

  /** `/r 2d6+1d20+3`: standard dice go into the hand; anything else (d7, 30 dice) is just rolled as numbers. */
  function rollCommand(expr: string): boolean {
    const dice: [number, number][] = [];
    let mod = 0;
    for (const term of expr.replace(/\s/g, '').match(/[+-]?[^+-]+/g) ?? []) {
      const d = /^\+?(\d*)d(\d+)$/i.exec(term);
      if (d && +d[2] >= 2 && +d[2] <= 1000) dice.push([Math.min(Math.max(+(d[1] || 1), 1), 20), +d[2]]);
      else if (/^[+-]\d+$/.test(term)) mod += +term;
      else return false;
    }
    if (!dice.length) return false;
    hand.clear();
    if (dice.every(([n, sides]) => pickUp(sides, n))) {
      handMod = mod;
      renderHand();
      if (phoneSheet()) closeSheet();
      say('<span class="sys">Dice in hand — drag on the table and let go to throw.</span>');
      return true;
    }
    emptyHand();
    const r = dice.flatMap(([n, sides]) => [...crypto.getRandomValues(new Uint32Array(n))].map((x) => (x % sides) + 1));
    const d = dice.map(([n, sides]) => `${n}d${sides}`).join('+') + (mod ? (mod > 0 ? '+' : '') + mod : '');
    showRoll(meTag, { d, r, mod }, true);
    void net.send({ y: 'roll', d, r, mod });
    return true;
  }

  $<HTMLFormElement>('chat').onsubmit = (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('chatIn');
    const text = input.value.trim();
    input.value = '';
    if (!text) return;
    const r = /^\/r(?:oll)?\s+(.+)$/i.exec(text);
    if (r && rollCommand(r[1])) return;
    const w = /^\/w\s+(\S+)\s+(.+)$/i.exec(text);
    if (w) {
      const to = [...net.peers].find(([, p]) => p.name.toLowerCase().startsWith(w[1].toLowerCase()));
      if (!to) return say(`<span class="sys">Nobody here is called “${esc(w[1])}”.</span>`);
      say(`${meTag} <span class="sys">to ${esc(to[1].name)}</span>: ${esc(w[2])}`, true);
      return void net.send({ y: 'chat', m: w[2], to: pid(to[0]) });
    }
    say(`${meTag}: ${esc(text)}`);
    void net.send({ y: 'chat', m: text });
  };
  /** Show one sheet (or none). On a phone they share the same spot, so only one is open at a time. */
  function openSheet(id: string | null): void {
    for (const el of document.querySelectorAll<HTMLElement>('.sheet')) el.classList.toggle('closed', el.id !== id);
    $('logToggle').classList.toggle('on', id === 'log');
    if (id === 'log') {
      $('logToggle').classList.remove('unread');
      $('msgs').scrollTop = $('msgs').scrollHeight;
    }
  }
  $('logToggle').onclick = () => openSheet($('log').classList.contains('closed') ? 'log' : null);
  for (const b of document.querySelectorAll<HTMLElement>('[data-close]')) b.onclick = () => openSheet(null);
  $('undo').onclick = () => board.undo();

  // ---- tools & palette ----

  // Two modes. Play: move, measure, fog, dice. Build: the dock is the categories of the
  // library, and the tray above it holds the current category's pieces and actions.
  type Cat = 'land' | 'walls' | 'things' | 'figures' | 'scenes';
  let cat: Cat = 'land';
  /** On small screens: is the shelf of pieces showing, or folded down to the piece in hand? */
  let trayOpen = true;
  const building = () => board.tool === 'build' || board.tool === 'mini';
  function setTool(t: Tool): void {
    // Arriving by keyboard shortcut: the tray shows what the tool is for.
    if (t === 'mini') cat = 'figures';
    else if (t === 'build' && cat === 'figures') cat = 'land';
    board.setTool(t);
    const build = building();
    for (const b of $('tools').querySelectorAll<HTMLButtonElement>('button')) {
      b.hidden = (b.dataset.in === 'build') !== build;
      if (b.dataset.tool) b.classList.toggle('on', b.dataset.tool === t);
      if (b.dataset.cat) b.classList.toggle('on', b.dataset.cat === cat);
    }
    for (const b of $('modes').querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', (b.dataset.mode === 'build') === build);
    if (build) openSheet(null);
    renderPalette();
    renderRing();
  }
  /** Open a category of the library, with a brush that belongs to it in hand. */
  function setCat(c: Cat): void {
    cat = c;
    trayOpen = true; // arriving at a shelf: show it
    const fits: Record<Cat, (id: string) => boolean> = {
      land: (id) => BLOCK_SHELVES.Terrain.includes(id) || ['raise', 'lower', 'level', 'grow', 'erase'].includes(id),
      walls: (id) => !!EDGES[id] || PROP_SHELVES.Structures.includes(id) || BLOCK_SHELVES.Building.includes(id) || id === 'room' || id === 'erase',
      things: (id) => thingIds().includes(id) || id === 'erase' || id === 'light',
      figures: () => true,
      scenes: (id) => id === 'copy' || id === 'paste',
    };
    if (!fits[c](board.brush)) board.brush = { land: 'raise', walls: 'wall', things: thingIds()[0] ?? PROP_SHELVES.Nature[0], figures: board.brush, scenes: 'copy' }[c];
    setTool(c === 'figures' ? 'mini' : 'build');
  }
  for (const b of $('tools').querySelectorAll<HTMLButtonElement>('[data-tool]')) b.onclick = () => setTool(b.dataset.tool as Tool);
  for (const b of $('tools').querySelectorAll<HTMLButtonElement>('[data-cat]')) b.onclick = () => setCat(b.dataset.cat as Cat);
  for (const b of $('modes').querySelectorAll<HTMLButtonElement>('button')) b.onclick = () => (b.dataset.mode === 'build' ? setCat(cat) : setTool('move'));

  let thingShelf = 'Nature', miniShelf = 'Heroes';
  // The table's theme (see theme.ts) puts a shelf of its own in front of the others and its
  // ground and building blocks first on theirs: more to choose from, and no more chrome.
  const MINE = '★';
  const known: Known = { block: (id) => id in BLOCKS, prop: (id) => id in PROPS, mini: (id) => id in MINIS, amb: (id) => id in SOUNDSCAPES, gen: (id) => id in THEMES };
  const gameTheme = (): GameTheme | null => activeTheme(store.get('set:theme'), known);
  /** The themes on offer (public/themes): data that arrives after the table is up, never part of the app. */
  let gameThemes: GameTheme[] = [];
  void loadThemes('./themes', known).then((list) => { gameThemes = list; renderThemes(); });
  const thingIds = (): string[] => (thingShelf === MINE ? gameTheme()?.pieces.props : PROP_SHELVES[thingShelf]) ?? [];
  const miniIds = (): string[] => (miniShelf === MINE ? gameTheme()?.pieces.minis : MINI_SHELVES[miniShelf]) ?? [];
  const themed = (shelf: string[]): string[] => {
    const first = (gameTheme()?.pieces.blocks ?? []).filter((id) => shelf.includes(id));
    return [...first, ...shelf.filter((id) => !first.includes(id))];
  };
  /** Where a piece's picture is on the sheet of thumbnails (see assets/blender/thumbs.py). */
  const thumb = (family: string): string | null => {
    const i = (THUMBS.at as Record<string, number>)[family];
    if (i === undefined) return null;
    const x = i % THUMBS.cols, y = Math.floor(i / THUMBS.cols);
    return `background-image:url(./ui/thumbs.webp);background-size:${THUMBS.cols * 100}% ${THUMBS.rows * 100}%;background-position:${(x / (THUMBS.cols - 1)) * 100}% ${(y / (THUMBS.rows - 1)) * 100}%`;
  };

  function renderPalette(): void {
    const el = $('palette');
    el.innerHTML = '';
    el.classList.toggle('tray', building());
    // In Play with the Move tool there is no palette: what you can do with the selected mini
    // sits around the mini itself (see renderRing).
    if (building()) {
      const chips = document.createElement('div'), tiles = document.createElement('div');
      el.append(chips, tiles);
      const press = (b: HTMLButtonElement, click: () => void) => {
        b.onclick = () => {
          click();
          if (board.tool === 'build') board.setTool('build'); // some brushes change what a mouse drag does
          renderPalette();
        };
        return b;
      };
      /** An action or a choice for the current category. */
      const chip = (label: string, on: boolean, click: () => void, icon = '', title = label) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = `${icon}${esc(label)}`;
        b.classList.toggle('on', on);
        chips.append(b);
        return press(b, click);
      };
      /** A piece of the library, shown as its picture (or its colour, or failing both its emoji). */
      /** The picture of a piece: its thumbnail, or a cube of its colour lit like the thumbnails, or failing both its emoji. */
      const face = (family: string | null, flat?: string, emoji = '') => {
        const at = family && thumb(family);
        const cube = flat && !at ? `<svg class="cube" viewBox="0 0 24 24"><path fill="${flat}" d="M12 3 20.500 7.500 12 12 3.500 7.500z"/><path fill="${flat}" style="filter:brightness(.78)" d="M3.500 7.500 12 12v9.500L3.500 17z"/><path fill="${flat}" style="filter:brightness(.6)" d="M20.500 7.500 12 12v9.500l8.500-4.500z"/></svg>` : '';
        return `<i${at ? ` style="${at}"` : ''}>${at ? '' : cube || emoji}</i>`;
      };
      // On a small screen the tray is a single row once a piece is in hand: the piece, and the
      // actions that go with it. Its picture opens the shelf again to choose another.
      const small = innerWidth < 900 || innerHeight < 700;
      const tile = (name: string, on: boolean, click: () => void, family: string | null, flat?: string, emoji = '') => {
        const b = document.createElement('button');
        b.className = 'tile';
        b.title = name;
        b.innerHTML = `${face(family, flat, emoji)}<span>${esc(name)}</span>`;
        b.classList.toggle('on', on);
        tiles.append(b);
        if (on && small) {
          const cur = document.createElement('button');
          cur.className = 'cur';
          cur.title = trayOpen ? 'Fold the shelf away' : 'Choose another piece';
          cur.setAttribute('aria-label', cur.title);
          cur.innerHTML = `${face(family, flat, emoji)}<span>${esc(name)}</span>${ico(trayOpen ? 'down' : 'up')}`;
          cur.onclick = () => { trayOpen = !trayOpen; renderPalette(); };
          chips.prepend(cur);
        }
        return press(b, () => { click(); trayOpen = false; });
      };
      const svg = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
      const brush = (id: string) => () => { board.brush = id; trayOpen = false; }; // a brush in hand: fold the shelf
      const eraser = () => chip('Erase', board.brush === 'erase', brush('erase'), svg('erase'));
      const turn = () => chip('Turn', false, () => { board.rot = (board.rot + 1) % 4; }, svg('turn'), 'Turn the next piece (R)');
      const blocks = (ids: string[]) => { for (const id of ids) tile(BLOCKS[id].name, board.brush === id, brush(id), `b_${id}`, BLOCKS[id].color); };
      const props = (ids: string[]) => { for (const id of ids) tile(PROPS[id].name, board.brush === id, brush(id), `p_${id}`, undefined, PROPS[id].icon); };
      if (cat === 'land') {
        // Shaping the land: each is a brush you tap or drag over the ground.
        for (const [id, label, title] of [['raise', 'Raise', 'Raise the ground'], ['lower', 'Lower', 'Lower the ground'], ['level', 'Level', 'Level to where you start'], ['grow', 'Grow', 'Grow what suits the ground']]) {
          chip(label, board.brush === id, brush(id), '', title);
        }
        chip(`Size ${board.reach * 2 + 1}`, false, () => { board.reach = (board.reach + 1) % 3; }, '', `Brush size: ${board.reach * 2 + 1} across`);
        chip('Repaint', board.surface, () => { board.surface = !board.surface; }, '', 'Repaint the surface instead of stacking');
        eraser();
        blocks(themed(BLOCK_SHELVES.Terrain));
      } else if (cat === 'walls') {
        // A whole room in one drag: floor, walls, windows and a doorway.
        for (const timber of [false, true]) {
          chip(timber ? 'Timber room' : 'Stone room', board.brush === 'room' && board.roomTimber === timber, () => { board.brush = 'room'; board.roomTimber = timber; }, '', 'Drag out its floor');
        }
        turn();
        eraser();
        props(PROP_SHELVES.Structures);
        blocks(themed(BLOCK_SHELVES.Building));
      } else if (cat === 'things') {
        const mine = gameTheme();
        if (mine?.pieces.props.length) chip(`${mine.icon} ${mine.name}`, thingShelf === MINE, () => { thingShelf = MINE; board.brush = mine.pieces.props[0]; });
        else if (thingShelf === MINE) thingShelf = 'Nature';
        for (const name of Object.keys(PROP_SHELVES)) {
          if (name !== 'Structures') chip(name, thingShelf === name, () => { thingShelf = name; board.brush = PROP_SHELVES[name][0]; });
        }
        turn();
        chip('Light', board.brush === 'light', brush('light'), svg('sun'), 'Tap a torch, fire or crystal to step its light: normal, bright, dim, out');
        eraser();
        props(thingIds());
      } else if (cat === 'figures') {
        const mine = gameTheme();
        if (mine?.pieces.minis.length) chip(`${mine.icon} ${mine.name}`, miniShelf === MINE, () => { miniShelf = MINE; miniKind = mine.pieces.minis[0]; });
        else if (miniShelf === MINE) miniShelf = 'Heroes';
        for (const name of Object.keys(MINI_SHELVES)) chip(name, miniShelf === name, () => { miniShelf = name; miniKind = MINI_SHELVES[name][0]; });
        chip('Base', false, () => { miniColor = PLAYER_COLORS[(PLAYER_COLORS.indexOf(miniColor) + 1) % PLAYER_COLORS.length]; }, `<i style="background:${miniColor}"></i>`, 'Base colour');
        for (const id of miniIds()) tile(MINIS[id].name, miniKind === id, () => { miniKind = id; }, `m_${id}`, undefined, MINIS[id].icon);
      } else {
        chip('Generate…', false, () => { renderGen(); openSheet('gen'); }, svg('spark'), 'Generate a scene');
        chip('Starter scene', false, meadow);
        chip('Copy', board.brush === 'copy', brush('copy'), '', 'Copy: drag over an area');
        chip('Paste', board.brush === 'paste', brush('paste'), '', 'Paste: tap where it goes').disabled = !board.slab;
        turn();
        chip('Share', false, () => void shareSlab(), '', 'Share what you copied').disabled = !board.slab;
        chip('Import', false, () => void importSlab(), '', 'Paste a shared code');
        tiles.remove();
      }
      if (small && tiles.isConnected) {
        // With a brush in hand that is not one of the pictures, the row still needs a way back to the shelf.
        if (!chips.querySelector('.cur')) {
          const cur = document.createElement('button');
          cur.className = 'cur';
          cur.style.paddingLeft = '12px';
          cur.title = trayOpen ? 'Fold the shelf away' : 'Show the shelf';
          cur.setAttribute('aria-label', cur.title);
          cur.innerHTML = `<span>${{ land: 'Ground', walls: 'Pieces', things: 'Pieces', figures: 'Figures', scenes: '' }[cat]}</span>${ico(trayOpen ? 'down' : 'up')}`;
          cur.onclick = () => { trayOpen = !trayOpen; renderPalette(); };
          chips.prepend(cur);
        }
        if (!trayOpen) tiles.remove();
      }
    } else if (board.tool === 'ruler' || board.tool === 'fog') {
      el.classList.add('tray');
      const row = document.createElement('div');
      el.append(row);
      const chip = (label: string, icon: string, on: boolean, click: () => void, title = label) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.title = title;
        b.innerHTML = `${ico(icon)}${label}`;
        b.classList.toggle('on', on);
        b.onclick = () => { click(); renderPalette(); };
        row.append(b);
      };
      if (board.tool === 'ruler') {
        const modes: [RulerMode, string, string][] = [['line', 'line', 'Distance'], ['circle', 'circle', 'Radius'], ['cone', 'cone', 'Cone']];
        for (const [m, icon, title] of modes) chip(title, icon, board.rulerMode === m, () => { board.rulerMode = m; });
        chip('Put away', 'x', false, () => { board.showRuler('me', null, ''); void send({ y: 'ruler', r: null }); }, 'Put the ruler away');
      } else {
        chip('Hide', 'fog', board.fogHide, () => { board.fogHide = true; }, 'Hide: drag to cover an area');
        chip('Reveal', 'eye', !board.fogHide, () => { board.fogHide = false; }, 'Reveal: drag to uncover');
        chip('Reveal all', 'sun', false, () => { for (const k of [...store.keys('f:')]) store.set(k, null); }, 'Reveal everything');
      }
    }
    el.hidden = !el.childElementCount;
  }

  function emote(kind: string): void {
    if (!board.selected) return;
    board.emote(board.selected, kind);
    sound.emote(kind);
    void send({ y: 'emote', id: board.selected, e: kind });
  }

  // Slabs travel as text, so they can be sent over any chat app.
  const SLAB_TAG = 'cottontale-slab:';
  async function shareSlab(): Promise<void> {
    if (!board.slab) return;
    const text = SLAB_TAG + await pack(board.slab);
    if (coarse && navigator.share) { try { await navigator.share({ text }); } catch { /* dismissed */ } return; }
    try { await navigator.clipboard.writeText(text); say('<span class="sys">Slab code copied. Paste it to a friend, or into 📥 on another table.</span>'); }
    catch { prompt('Copy this slab code:', text); }
  }
  async function importSlab(): Promise<void> {
    const text = prompt('Paste a slab code:')?.trim();
    if (!text) return;
    try {
      const s = await unpack<Slab>(text.replace(SLAB_TAG, ''));
      const ok = Array.isArray(s.cells) && s.cells.length > 0 && s.cells.length <= 4000 && [s.w, s.h, s.d].every((n) => Number.isInteger(n) && n > 0 && n <= 200)
        && s.cells.every((c) => Array.isArray(c) && c.slice(0, 3).every(Number.isInteger) && (BLOCKS[c[3]?.i] || PROPS[c[3]?.i]));
      if (!ok) throw new Error('bad slab');
      board.slab = s;
      board.brush = 'paste';
      board.setTool('build');
      renderPalette();
      say(`<span class="sys">Slab loaded (${s.cells.length} pieces). Tap where to put it.</span>`);
    } catch { alert('That is not a Cottontale slab code.'); }
  }

  // ---- boards: one table, several maps ----

  let peek: string | null = null; // a board the GM is preparing while the players are elsewhere
  const boardList = () => [{ id: '', n: 'Main' }, ...[...store.keys('bd:')].map((k) => ({ id: k.slice(3), n: String(store.get<{ n: string }>(k)?.n ?? 'Board') }))];
  const boardName = (id: string) => boardList().find((b) => b.id === id)?.n ?? 'Main';

  /** Point this device at another board and redraw the table from it. */
  function enter(id: string): void {
    here = id;
    store.setBoard(id);
    board.clear();
    for (const p of ['b:', 'f:', 'm:', 'w:']) for (const k of [...store.keys(p)]) board.apply(k, store.get(k), null);
    cutAuto = true;
    setCut(Infinity);
    emptyHand();
  }
  function renderBoards(active: string): void {
    const f = full(), list = $('boardList');
    // Someone is typing a name: leave the list alone. (A button in it having focus, as after
    // tapping Delete, must not stop it redrawing.)
    if (document.activeElement instanceof HTMLInputElement && list.contains(document.activeElement)) return;
    list.innerHTML = '';
    for (const b of boardList()) {
      const row = document.createElement('span');
      row.className = `row${b.id === here ? ' here' : ''}`;
      const name = document.createElement('input');
      name.value = b.n;
      name.maxLength = 24;
      name.disabled = !f || !b.id;
      name.setAttribute('aria-label', 'Board name');
      name.onchange = () => store.set(`bd:${b.id}`, { n: name.value.trim().slice(0, 24) || 'Board' });
      row.append(name);
      if (b.id === active) row.insertAdjacentHTML('beforeend', '<span class="tag">players<br />here</span>');
      const btn = (label: string, title: string, click: () => void) => {
        const x = document.createElement('button');
        x.innerHTML = label;
        x.title = title;
        x.setAttribute('aria-label', title);
        x.onclick = click;
        row.append(x);
      };
      if (f) {
        if (b.id !== here) btn(ico('eye'), 'Look at it yourself (players stay where they are)', () => { peek = b.id === active ? null : b.id; sync(); });
        if (b.id !== active) btn(ico('play'), 'Bring everyone here', () => { peek = null; store.set('set:board', b.id); });
        if (b.id) btn(ico('trash'), 'Delete this board', () => {
          if (!confirm(`Delete “${b.n}” and everything on it?`)) return;
          // Nobody may be left standing on a board that is gone: the players, or the GM preparing it.
          if (peek === b.id) peek = null;
          if (active === b.id) store.set('set:board', '');
          for (const [k, e] of [...store.entries]) if (e.v !== null && k.startsWith(`@${b.id}/`)) store.setRaw(k, null);
          store.set(`bd:${b.id}`, null);
          sync();
        });
      }
      list.append(row);
    }
    const prepping = f && here !== active;
    $('prep').hidden = !prepping;
    $('prepText').textContent = prepping ? `Preparing “${boardName(here)}” — players are on “${boardName(active)}”` : '';
  }
  function newBoard(copy: boolean): void {
    if (!full()) return;
    const id = crypto.randomUUID().slice(0, 6);
    if (copy) for (const p of ['b:', 'f:', 'm:', 'w:']) for (const k of [...store.keys(p)]) store.setRaw(`@${id}/${k}`, store.get(k));
    store.set(`bd:${id}`, { n: copy ? `${boardName(here)} copy`.slice(0, 24) : `Board ${boardList().length + 1}` });
    peek = id; // start on it alone; bring the players over when it is ready
    sync();
  }
  $('boardNew').onclick = () => newBoard(false);
  $('boardCopy').onclick = () => newBoard(true);
  $('prepGo').onclick = () => { const id = here; peek = null; store.set('set:board', id); };
  $('prepBack').onclick = () => { peek = null; sync(); };

  // ---- atmosphere: sky and sound ----

  const SKY_NAMES: Record<Sky, string> = { day: '☀️ Day', dusk: '🌇 Dusk', night: '🌙 Night' };
  const SEASON_NAMES: Record<Season, string> = { spring: '🌸 Spring', summer: '🌿 Summer', autumn: '🍂 Autumn', winter: '❄️ Winter' };
  function choices(el: HTMLElement, items: Record<string, string>, key: string, fallback: string): void {
    const f = full(), cur = setting(store, key, fallback);
    el.innerHTML = '';
    for (const [id, label] of Object.entries(items)) {
      const b = document.createElement('button');
      b.textContent = label.replace(/^[^\p{L}]+/u, ''); // the names carry an emoji for the chat log; the buttons do without
      b.classList.toggle('on', id === cur);
      b.disabled = !f;
      b.onclick = () => store.set(`set:${key}`, id);
      el.append(b);
    }
  }
  /** The themes: one tap sets the whole mood and brings the theme's pieces to the front. Tapping it again lets go of it. */
  function renderThemes(): void {
    const el = $('themes'), f = full(), cur = gameTheme()?.id;
    el.innerHTML = '';
    const offered = [...gameThemes], mine = gameTheme();
    if (mine && !offered.some((t) => t.id === mine.id)) offered.push(mine); // a theme the table brought with it
    $('themeHint').hidden = el.hidden = !offered.length;
    for (const t of offered) {
      const b = document.createElement('button');
      b.textContent = `${t.icon} ${t.name}`;
      b.classList.toggle('on', t.id === cur);
      b.setAttribute('aria-pressed', String(t.id === cur));
      b.disabled = !f;
      b.onclick = () => {
        if (t.id === cur) { store.set('set:theme', null); return; }
        store.set('set:theme', t); // the whole theme, so the table carries it
        for (const [k, v] of moodEdits(t)) store.set(k, v);
        if (t.gen) genOpts = { ...genOpts, theme: t.gen as Theme };
        if (t.pieces.props.length) thingShelf = MINE;
        if (t.pieces.minis.length) miniShelf = MINE;
      };
      el.append(b);
    }
  }
  function renderAtmo(): void {
    renderThemes();
    choices($('skies'), SKY_NAMES, 'sky', 'day');
    choices($('seasons'), SEASON_NAMES, 'season', 'summer');
    choices($('scapes'), SOUNDSCAPES, 'amb', 'off');
    const glow = $<HTMLInputElement>('glow');
    if (document.activeElement !== glow) glow.value = String(setting(store, 'glow', 1));
    glow.disabled = !full();
    $('soundOn').innerHTML = sound.enabled ? `${ico('sound')}Sound on this device: on` : `${ico('mute')}Sound on this device: off`;
  }
  $('soundOn').onclick = () => {
    sound.setEnabled(!sound.enabled);
    ls.set('sound', sound.enabled ? 'on' : 'off');
    renderAtmo();
  };

  // ---- role, settings, turn order: all derived from the store ----

  function later(): void {
    if (ui.syncing || !ui.ready) return;
    ui.syncing = true;
    setTimeout(() => { ui.syncing = false; sync(); });
  }
  let role = '', los = false;
  function sync(): void {
    const amGM = gms(store).includes(meId), f = full();
    const now = `${amGM}|${f}`;
    if (now !== role) {
      role = now;
      document.body.classList.toggle('player', !f);
      document.body.classList.toggle('gm', amGM);
      board.setRole(meId, f);
      if (!f && board.tool !== 'move' && board.tool !== 'ruler') setTool('move');
      if (!f) { secret = false; $('secret').classList.remove('on'); }
    }
    // Follow the table to its active board, unless the GM is off preparing another one.
    const ids = boardList().map((b) => b.id);
    const active = ids.includes(setting(store, 'board', '')) ? setting(store, 'board', '') : '';
    if (!f || (peek !== null && !ids.includes(peek))) peek = null;
    if ((peek ?? active) !== here) enter(peek ?? active);
    renderBoards(active);
    const l = setting(store, 'los', false);
    if (l !== los) { los = l; board.refresh(); }
    board.setGlow(setting(store, 'glow', 1));
    const sky = setting<Sky>(store, 'sky', 'day');
    board.setSky(sky);
    board.setSeason(setting<Season>(store, 'season', 'summer'));
    const act = (a: string) => $('menu').querySelector<HTMLElement>(`[data-act="${a}"]`)!;
    act('gm').innerHTML = `${ico('crown')}${amGM ? 'Stop being the GM' : 'Become the GM'}`;
    act('los').innerHTML = `${ico(l ? 'eye' : 'eyeoff')}Line of sight: ${l ? 'on' : 'off'}`;
    sound.scape(setting(store, 'amb', 'off'));
    renderAtmo();
    renderPlayers();
    renderInit();
    if (board.selected) showMiniPanel(board.selected);
    if (cutAuto) autoCut();
  }

  function renderInit(): void {
    const f = full();
    const order = turnOrder(store).filter((o) => f || !o.v.h);
    const turn = store.get<Turn>('turn');
    const current = order.find((o) => o.id === turn?.id);
    $('init').hidden = !order.length;
    board.setTurn(current?.id ?? null);
    $('round').textContent = current ? `Round ${turn!.round}` : 'Ready';
    $('order').innerHTML = '';
    for (const o of order) {
      const b = document.createElement('button');
      b.textContent = `${o.v.ini} · ${o.v.n || MINIS[o.v.k]?.name || '?'}`;
      b.style.setProperty('--c', o.v.c);
      b.classList.toggle('on', o === current);
      b.onclick = () => { board.focusMini(o.id); if (board.tool === 'move') board.select(o.id); };
      $('order').append(b);
      if (o === current) setTimeout(() => b.scrollIntoView({ inline: 'center', block: 'nearest' }));
    }
    // The GM advances turns; the player whose mini is up may end their own.
    const mine = !!current && canControl(store, meId, current.v);
    $('nextTurn').hidden = !(f || mine);
    $('nextTurn').innerHTML = ico(current ? 'next' : 'play');
  }
  $('nextTurn').onclick = () => { const t = nextTurn(store); if (t) store.set('turn', t); };
  $('endFight').onclick = () => {
    for (const o of turnOrder(store)) { const { ini: _, ...rest } = o.v; store.set(`m:${o.id}`, rest); }
    store.set('turn', null);
  };

  // ---- cutaway ----

  let cutAuto = true;
  function setCut(level: number): void {
    if (level !== board.cut) board.setCut(level);
    $('floorAuto').textContent = `${cutAuto ? 'Auto\n' : ''}${level === Infinity ? 'All' : `≤ ${level}`}`;
    $('floorAuto').classList.toggle('on', cutAuto);
  }
  /** Auto: lift the roof off whatever the selected mini is standing under. */
  function autoCut(): void {
    const v = board.selected ? store.get<MiniVal>(`m:${board.selected}`) : null;
    let level = Infinity;
    if (v) for (let y = v.y + 2, top = board.maxHeight(); y < top; y++) {
      const c = store.get<{ i: string }>(`b:${v.x},${y},${v.z}`);
      if (c && BLOCKS[c.i]) { level = y; break; }
    }
    setCut(level);
  }
  $('floorAuto').onclick = () => { cutAuto = !cutAuto; if (cutAuto) autoCut(); else setCut(board.cut); };
  $('floorDown').onclick = () => { cutAuto = false; setCut(Math.max(1, (board.cut === Infinity ? board.maxHeight() : board.cut) - 1)); };
  $('floorUp').onclick = () => { cutAuto = false; setCut(board.cut + 1 >= board.maxHeight() ? Infinity : board.cut + 1); };
  setCut(Infinity);

  // ---- selected mini ----

  const sel = () => (board.selected ? store.get<MiniVal>(`m:${board.selected}`) : null);
  const patch = (p: Partial<MiniVal>) => { const v = sel(); if (v && canControl(store, meId, v)) store.set(`m:${board.selected}`, { ...v, ...p }); };
  const repaintMiniColors = swatches($('miniColors'), () => sel()?.c ?? '', (c) => patch({ c }));
  const field = (id: string) => $<HTMLInputElement>(id);
  const FLY = [0, 1, 2, 3, 5, 8];

  // What you do to a piece in play sits in a ring around it; the full editor only opens on request.
  let ringMode: 'main' | 'emote' | 'hp' = 'main', moreOpen = false, ringFor: string | null = null, shownFor: string | null = null;
  function renderRing(): void {
    const el = $('ring'), v = sel();
    el.innerHTML = '';
    el.hidden = !v || board.tool !== 'move';
    if (!v || el.hidden) return;
    const mine = canControl(store, meId, v);
    const button = (title: string, inner: string, click: () => void, on = false) => {
      const b = document.createElement('button');
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = inner;
      b.classList.toggle('on', on);
      b.onclick = click;
      return b;
    };
    const to = (mode: typeof ringMode) => () => { ringMode = mode; renderRing(); };
    const more = button(mine ? 'More' : 'Details', ico('list'), () => { moreOpen = !moreOpen; showMiniPanel(board.selected); }, moreOpen);
    if (!mine || ringMode === 'main') {
      const items = mine ? [
        button('Turn', ico('turn'), () => patch({ r: ((sel()?.r ?? 0) + 1) % 8 })),
        button('Emote', '👋', to('emote')),
        button('Hit points', `<span style="color:#ff6b7a;display:grid">${ico('heart')}</span>`, to('hp')),
        more,
      ] : [more];
      // Two to each side of the piece: its name and hit points float above it and must stay readable.
      const at = items.length === 1 ? [-25] : [-155, 155, -25, 25];
      items.forEach((b, i) => { b.dataset.a = String(at[i]); el.append(b); });
    } else {
      const pop = document.createElement('div');
      pop.className = 'pop';
      if (ringMode === 'emote') {
        pop.style.gridTemplateColumns = 'repeat(5, 46px)';
        for (const [kind, icon] of Object.entries(EMOTES)) pop.append(button(kind, icon, () => emote(kind)));
        pop.append(button(v.d ? 'Stand up' : 'Knock down', '💀', () => patch({ d: !v.d }), !!v.d));
      } else {
        pop.style.gridTemplateColumns = '46px auto 46px 46px';
        const count = document.createElement('b');
        count.innerHTML = `<span style="color:#ff6b7a">${v.hp ?? v.mhp ?? '–'}</span>${v.mhp === undefined ? '' : `<span style="opacity:.6">/${v.mhp}</span>`}`;
        pop.append(button('Lose a hit point', '−', () => bump(-1)), count, button('Gain a hit point', '+', () => bump(1)));
      }
      pop.append(button('Back', ico('x'), to('main')));
      el.append(pop);
    }
    placeRing();
  }
  /** Keep the ring on its piece as the camera or the piece moves. */
  function placeRing(): void {
    const el = $('ring');
    if (el.hidden || !board.selected) return;
    const spot = board.spotOf(board.selected);
    el.style.visibility = spot ? '' : 'hidden';
    if (!spot) return;
    const pop = el.querySelector<HTMLElement>('.pop'), r = Math.max(60, Math.min(104, spot.size * 0.7 + 40));
    // Never let it slide under the top bar or off an edge: the ring shifts, the piece stays put.
    const roof = $('top').getBoundingClientRect().bottom + 12, half = pop ? pop.offsetWidth / 2 + 8 : r + 26;
    const x = Math.max(half, Math.min(innerWidth - half, spot.x));
    const lift = pop ? spot.size * 0.55 + 14 : 0, reach = pop ? pop.offsetHeight + lift : r + 26;
    const y = Math.max(roof + reach, spot.y);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (pop) pop.style.top = `${-Math.round(lift)}px`;
    for (const b of el.querySelectorAll<HTMLElement>(':scope > button')) {
      const a = (+b.dataset.a! * Math.PI) / 180;
      b.style.left = `${Math.round(Math.cos(a) * r)}px`;
      b.style.top = `${Math.round(Math.sin(a) * r)}px`;
    }
  }

  function showMiniPanel(id: string | null): void {
    if (id !== ringFor) { ringFor = id; ringMode = 'main'; moreOpen = false; } // another piece: start from the ring
    const wasOpen = !$('minipanel').hidden;
    $('minipanel').hidden = !id || !moreOpen;
    renderRing();
    // A piece is never left behind the panel it is being edited in: the view slides to keep it clear.
    if (id && (id !== shownFor || wasOpen !== moreOpen)) {
      const roof = $('top').getBoundingClientRect().bottom + 110;
      const floor = (moreOpen && !$('minipanel').hidden ? $('minipanel') : $('tools')).getBoundingClientRect().top - 70;
      // On wide screens the panel sits beside the table, not under it: only the bars at top and bottom matter.
      board.keepInView(id, roof, Math.max(roof + 40, innerWidth >= 700 ? innerHeight - 150 : floor));
    }
    shownFor = id;
    const v = sel();
    if (cutAuto) autoCut();
    if (!v) return;
    const mine = canControl(store, meId, v);
    $('minipanel').classList.toggle('readonly', !mine);
    // Never overwrite what someone is in the middle of typing.
    const put = (id: string, val: string) => { const f = field(id); if (document.activeElement !== f) f.value = val; f.disabled = !mine; };
    put('miniName', v.n);
    put('hp', v.hp === undefined ? '' : String(v.hp));
    put('mhp', v.mhp === undefined ? '' : String(v.mhp));
    put('ini', v.ini === undefined ? '' : String(v.ini));
    const stats = [...document.querySelectorAll<HTMLInputElement>('#stats .st')];
    stats.forEach((f, i) => { if (document.activeElement !== f) f.value = v.st?.[i] ?? ''; f.disabled = !mine; });
    // Other people's minis show their stats if they have any; your own on request.
    $('stats').hidden = mine ? !statsOpen : !v.st?.some(Boolean);
    $('miniMore').classList.toggle('on', statsOpen);
    $('miniFly').innerHTML = `${ico('wing')}${v.e || 0}`;
    $('miniHide').innerHTML = v.h ? `${ico('eyeoff')}Hidden` : `${ico('eye')}Visible`;
    $('miniHide').classList.toggle('on', !!v.h);
    const owner = $<HTMLSelectElement>('miniOwner');
    if (document.activeElement !== owner) {
      const opts: [string, string][] = [['', '🎮 GM only'], ['*', '🎮 Everyone'], ...[...net.peers].map(([pk, p]) => [pid(pk), `🎮 ${p.name}`] as [string, string]), [meId, `🎮 ${name} (me)`]];
      if (v.o && !opts.some(([k]) => k === v.o)) opts.push([v.o, '🎮 (someone away)']);
      owner.innerHTML = opts.map(([k, label]) => `<option value="${esc(k)}">${esc(label)}</option>`).join('');
      owner.value = v.o ?? '';
    }
    repaintMiniColors();
  }
  const num = (id: string, lo: number, hi: number): number | undefined => {
    const t = field(id).value.trim(), n = Math.round(+t);
    return t === '' || !Number.isFinite(n) ? undefined : Math.min(hi, Math.max(lo, n));
  };
  /** Write a field that may be cleared: `undefined` removes it from the mini. */
  function setOpt(key: 'hp' | 'mhp' | 'ini' | 'o', value: number | string | undefined): void {
    const v = sel();
    if (!v || !canControl(store, meId, v)) return;
    const { [key]: _, ...rest } = v;
    store.set(`m:${board.selected}`, value === undefined || value === '' ? rest : { ...rest, [key]: value });
  }
  let statsOpen = false;
  $('miniMore').onclick = () => { statsOpen = !statsOpen; showMiniPanel(board.selected); };
  for (const f of document.querySelectorAll<HTMLInputElement>('#stats .st')) {
    f.onchange = () => {
      const v = sel();
      if (!v || !canControl(store, meId, v)) return;
      const st = [...document.querySelectorAll<HTMLInputElement>('#stats .st')].map((x) => x.value.trim().slice(0, 14));
      const { st: _, ...rest } = v;
      store.set(`m:${board.selected}`, st.some(Boolean) ? { ...rest, st } : rest);
    };
  }
  field('miniName').onchange = () => patch({ n: field('miniName').value.trim().slice(0, 20) });
  field('hp').onchange = () => setOpt('hp', num('hp', -999, 9999));
  field('mhp').onchange = () => {
    const m = num('mhp', 1, 9999);
    setOpt('mhp', m);
    if (m !== undefined && sel()?.hp === undefined) patch({ hp: m }); // new bars start full
  };
  field('ini').onchange = () => setOpt('ini', num('ini', -99, 999));
  const bump = (d: number) => { const v = sel(); if (v) patch({ hp: Math.max(0, Math.min(v.mhp ?? 9999, (v.hp ?? v.mhp ?? 0) + d)) }); };
  $('hpDown').onclick = () => bump(-1);
  $('hpUp').onclick = () => bump(1);
  $('miniRot').onclick = () => patch({ r: ((sel()?.r ?? 0) + 1) % 8 });
  $('miniSize').onclick = () => patch({ s: ({ 1: 1.5, 1.5: 2, 2: 0.7 } as Record<number, number>)[sel()?.s ?? 1] ?? 1 });
  $('miniFly').onclick = () => patch({ e: FLY[(FLY.indexOf(sel()?.e ?? 0) + 1) % FLY.length] });
  $('miniHide').onclick = () => patch({ h: !sel()?.h });
  $<HTMLSelectElement>('miniOwner').onchange = (e) => setOpt('o', (e.target as HTMLSelectElement).value);
  $('miniDel').onclick = () => { if (board.selected && full()) store.set(`m:${board.selected}`, null); };

  // ---- menu ----

  $('invite').onclick = async () => {
    if (coarse && navigator.share) {
      // Phones: hand the link straight to Messages / WhatsApp / ...
      try { await navigator.share({ title: 'Cottontale', text: 'Join my table!', url: invite }); } catch { /* dismissed */ }
      return;
    }
    try { await navigator.clipboard.writeText(invite); say('<span class="sys">Invite link copied. Anyone with it can join this table.</span>'); }
    catch { prompt('Copy this invite link:', invite); }
  };
  $('menuBtn').onclick = () => { $('menu').hidden = !$('menu').hidden; };
  $('menu').onclick = (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (!act) return;
    $('menu').hidden = true;
    if (act === 'gm') {
      const g = gms(store), here = [meId, ...[...net.peers.keys()].map(pid)];
      if (g.includes(meId)) store.set(`gm:${meId}`, null);
      else if (g.some((id) => here.includes(id))) alert('This table already has a GM. They can step down from this menu.');
      else {
        // Take over from GMs who are away, so a table can never get stuck without one.
        for (const id of g) store.set(`gm:${id}`, null);
        store.set(`gm:${meId}`, true);
        say('<span class="sys">You are the GM: only you can build, hide things and move every mini. Give players a mini with 🎮 in its panel.</span>');
      }
    }
    if (act === 'los' && full()) store.set('set:los', !setting(store, 'los', false));
    if (act === 'boards' || act === 'atmo') openSheet(act);
    if (act === 'gen' && full()) { renderGen(); openSheet('gen'); }
    if (act === 'redo') board.redo();
    if (act === 'meadow') meadow();
    if (act === 'export') {
      const rows = store.dump().filter((r) => r[1] !== null).map(([k, v]) => [k, v]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ cottontale: 1, rows })], { type: 'application/json' }));
      a.download = 'cottontale-table.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    if (act === 'import') $('file').click();
    if (act === 'clear' && confirm('Remove everything from the table, for everyone?')) {
      for (const k of [...store.keys('b:'), ...store.keys('m:'), ...store.keys('f:'), ...store.keys('w:')]) store.set(k, null);
      store.set('gen', null);
      store.set('turn', null);
    }
    if (act === 'leave') void net.stop().then(() => { location.hash = ''; location.reload(); });
  };
  $<HTMLInputElement>('file').onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    try {
      const data = JSON.parse(await input.files![0].text());
      for (const [k, v] of data.rows as [string, unknown][]) if (/^[bmfw]:/.test(k)) store.set(k, v);
        else if (/^(@[\w-]+\/[bmfw]:|bd:)/.test(k)) store.setRaw(k, v);
    } catch { alert('That file is not a Cottontale table.'); }
    input.value = '';
  };

  // ---- scene generator ----
  const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
  let genOpts: GenOpts = { theme: 'forest', seed: newSeed(), size: 2, density: 2, detail: 2 };
  let genRecent: GenOpts[] = [];
  try { genRecent = JSON.parse(ls.get('genRecent') ?? '[]'); } catch { /* start with none */ }
  /** The scene on this board, remembered with the table so its rooms can be redone or locked later. */
  interface SceneRec { o: GenOpts; rooms: GenRoom[] }
  const sceneRec = () => store.get<SceneRec>('gen');
  function renderGen(): void {
    const themes = $('genThemes'), sliders = $('genSliders'), recent = $('genRecent'), list = $('genRooms');
    themes.innerHTML = sliders.innerHTML = recent.innerHTML = list.innerHTML = '';
    for (const [id, t] of Object.entries(THEMES) as [Theme, (typeof THEMES)[Theme]][]) {
      const b = document.createElement('button');
      b.innerHTML = `${ico(t.icon)}${t.name}`;
      b.classList.toggle('on', id === genOpts.theme);
      b.onclick = () => { genOpts = { ...genOpts, theme: id }; renderGen(); };
      themes.append(b);
    }
    (['size', 'density', 'detail'] as const).forEach((key, i) => {
      const row = document.createElement('label'), name = document.createElement('span'), input = document.createElement('input');
      row.className = 'slider';
      name.textContent = THEMES[genOpts.theme].sliders[i];
      Object.assign(input, { type: 'range', min: '0', max: '4', step: '1', value: String(genOpts[key]) });
      input.oninput = () => { genOpts = { ...genOpts, [key]: +input.value }; };
      row.append(name, input);
      sliders.append(row);
    });
    // The rooms of the scene on the table: look at one, redo its furnishing, or lock it so a new layout keeps it.
    const rec = sceneRec();
    if (rec?.rooms.length) {
      list.insertAdjacentHTML('beforeend', '<p class="hint">Rooms — the dice refurnish one; the lock keeps it when you build another</p>');
      rec.rooms.forEach((q, i) => {
        const row = document.createElement('span'), name = document.createElement('button'), dice = document.createElement('button'), lock = document.createElement('button');
        row.className = 'row';
        name.className = 'grow';
        name.textContent = ROOM_NAMES[q.kind] ?? q.kind;
        name.onclick = () => board.lookAt((q.x0 + q.x1 + 1) / 2, 1, (q.z0 + q.z1 + 1) / 2);
        dice.innerHTML = ico('dice');
        dice.title = dice.ariaLabel = 'Refurnish this room';
        dice.disabled = !!q.lock;
        dice.onclick = () => buildScene(rec.o, rec.rooms.map((r, j) => (j === i ? { ...r, seed: newSeed() } : r)), true);
        lock.innerHTML = ico(q.lock ? 'lock' : 'unlock');
        lock.title = lock.ariaLabel = q.lock ? 'Locked: unlock this room' : 'Lock this room';
        lock.classList.toggle('on', !!q.lock);
        lock.onclick = () => store.set('gen', { o: rec.o, rooms: rec.rooms.map((r, j) => (j === i ? { ...r, lock: !r.lock } : r)) });
        row.append(name, dice, lock);
        list.append(row);
      });
    }
    for (const o of genRecent) {
      const b = document.createElement('button');
      b.innerHTML = `${ico(THEMES[o.theme].icon)}#${o.seed}`;
      b.title = `${THEMES[o.theme].name}, seed ${o.seed}`;
      b.onclick = () => { genOpts = { ...o }; buildScene(genOpts); };
      recent.append(b);
    }
  }
  /**
   * Build a scene in place of the one on the table. `prior` rooms that are locked are kept;
   * with `fixed` every room stays where it is and only what changed in them is rebuilt.
   */
  function buildScene(o: GenOpts, prior: GenRoom[] = [], fixed = false): void {
    if (!full()) return;
    const old = sceneRec();
    // What the old scene put on the table follows from its numbers, so it can be cleared exactly.
    const gone = new Set(old ? generate(old.o, old.rooms, true).edits.map(([k]) => k) : []);
    const scene = generate(o, prior, fixed);
    board.applyScene([...scene.edits, ['gen', { o, rooms: scene.rooms }]], scene.bounds, gone, !fixed);
    const same = (p: GenOpts) => JSON.stringify(p) === JSON.stringify(o);
    genRecent = [{ ...o }, ...genRecent.filter((p) => !same(p))].slice(0, 6);
    ls.set('genRecent', JSON.stringify(genRecent));
    renderGen();
  }
  $<HTMLInputElement>('glow').oninput = (e) => { if (full()) store.set('set:glow', +(e.target as HTMLInputElement).value); };
  $('genGo').onclick = () => buildScene(genOpts, sceneRec()?.rooms.filter((q) => q.lock) ?? []);
  $('genAgain').onclick = () => {
    const rec = sceneRec(), locked = rec?.o.theme === genOpts.theme ? rec.rooms.filter((q) => q.lock) : [];
    if (genOpts.theme === 'tavern' && rec && locked.length) {
      // A tavern is one building: with a room locked it stays standing and the other rooms are refurnished.
      buildScene(rec.o, rec.rooms.map((q) => (q.lock ? q : { ...q, seed: newSeed() })), true);
      return;
    }
    genOpts = { ...genOpts, seed: newSeed() };
    buildScene(genOpts, locked);
  };

  /** A starter scene: a cottage in a clearing, with something to fight. */
  function meadow(): void {
    const put = (x: number, y: number, z: number, i: string, r = 0) => store.set(`b:${x},${y},${z}`, r ? { i, r } : { i });
    const rnd = (x: number, z: number) => (Math.imul(x * 73856093 ^ z * 19349663, 0x9e3779b1) >>> 8) / 0x1000000;
    /** Smooth hills of chance, the same on every device. */
    const roll = (x: number, z: number) => {
      const u = x / 6, v = z / 6, x0 = Math.floor(u), z0 = Math.floor(v), fx = u - x0, fz = v - z0;
      return (rnd(x0, z0) * (1 - fx) + rnd(x0 + 1, z0) * fx) * (1 - fz) + (rnd(x0, z0 + 1) * (1 - fx) + rnd(x0 + 1, z0 + 1) * fx) * fz;
    };
    const X0 = -4, X1 = 0, Z0 = -4, Z1 = -1, DOOR = -2; // the room, and the column its door is in
    const inRoom = (x: number, z: number, pad = 0) => x >= X0 - pad && x <= X1 + pad && z >= Z0 - pad && z <= Z1 + pad;
    for (let x = -10; x < 10; x++) {
      for (let z = -10; z < 10; z++) {
        const path = x === DOOR && z > Z1 && z < 7;
        put(x, 0, z, inRoom(x, z) ? 'wood' : path ? 'stone' : 'grass');
        if (inRoom(x, z, 2) || Math.abs(x - DOOR) < 2 && z > Z1) continue;
        // The clearing is level; the land rolls up toward its rim, a level at a time.
        const out = Math.max(0, Math.max(Math.abs(x + 0.5), Math.abs(z + 0.5)) - 5.5) / 4;
        const high = Math.min(3, Math.round(out * (0.3 + roll(x, z) * 2.6)));
        for (let y = 1; y <= high; y++) put(x, y, z, 'grass');
        const edge = out > 0.4, r = rnd(x, z), wood = roll(x + 40, z - 17); // woods gather by kind
        const tree = wood < 0.38 ? 'pine' : wood < 0.5 ? 'birch' : wood > 0.72 ? 'poplar' : 'tree';
        const prop = r < (edge ? 0.3 : 0.07) ? tree : r < (edge ? 0.34 : 0.09) ? 'tree' : r < 0.13 ? 'rock' : r < 0.15 ? 'bush' : null;
        if (prop) put(x, high + 1, z, prop);
      }
    }
    // Thin walls on the edges of the room. The two sides away from the default camera are a
    // storey taller and half-timbered, like an opened doll's house.
    for (const [k, piece] of roomEdges(X0, X1, Z0, Z1, 1, false)) store.set(k, { i: piece });
    for (const [k, piece] of roomEdges(X0, X1, Z0, Z1, 2, true)) {
      const [x, , z, side] = parseEdge(k);
      if (side === 'n' ? z === Z0 : x === X0) store.set(k, { i: piece });
    }
    put(-3, 1, -3, 'table'); put(-4, 1, -4, 'barrel'); put(-3, 1, -4, 'barrel'); put(0, 1, -4, 'crate'); put(0, 1, -2, 'chair', 1);
    put(2, 1, 1, 'campfire'); put(3, 1, 0, 'crate'); put(1, 1, 3, 'rock');
    const mini = (id: string, k: string, x: number, z: number, c: string, r: number) => store.set(`m:${id}`, { x, y: 1, z, k, c, n: '', r, s: 1 });
    mini('start-knight', 'knight', DOOR, 2, '#3e63dd', 1);
    mini('start-wolf', 'wolf', 3, 2, '#8b8d98', 6);
    mini('start-ogre', 'ogre', 4, 4, '#e5484d', 7);
  }

  // ---- keyboard ----

  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input, textarea')) return;
    const tools: Tool[] = ['move', 'build', 'mini', 'ruler', 'fog'];
    const allowed = (t: Tool) => t === 'move' || t === 'ruler' || (full() && (t !== 'fog' || gms(store).includes(meId)));
    if (e.key >= '1' && e.key <= '5') { if (allowed(tools[+e.key - 1])) setTool(tools[+e.key - 1]); }
    else if ((e.key === 'z' && e.shiftKey || e.key === 'y') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); board.redo(); }
    else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); board.undo(); }
    else if (e.key === 'r' || e.key === 'R') {
      if (board.selected) patch({ r: ((sel()?.r ?? 0) + 1) % 8 });
      else { board.rot = (board.rot + 1) % 4; renderPalette(); }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && board.selected && full()) store.set(`m:${board.selected}`, null);
    else if (e.key === 'Escape') setTool('move');
    else if (e.key === 'Enter') $('chatIn').focus();
  });
  // Phones suspend background tabs and kill their sockets. Save on the way
  // out, and reconnect (re-fetching snapshots) the moment we are back.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      ls.set(`room:${tag}`, JSON.stringify(store.dump()));
      return;
    }
    net.wake(Date.now() - hiddenAt > 20_000);
    stayAwake();
    board.invalidate();
    sound.suspend(false);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) sound.suspend(true); });
  addEventListener('online', () => net.wake(false));
  addEventListener('pageshow', (e) => { if (e.persisted) net.wake(true); });
  addEventListener('pagehide', () => {
    ls.set(`room:${tag}`, JSON.stringify(store.dump()));
    void net.pause();
  });

  setTool('move');
  renderHand();
  ui.ready = true;
  sync();
}
