import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { Board, EMOTES, type MiniVal, type RulerMode, type Sky, type Slab, type Tool, type Vec } from './board';
import { BLOCKS, BLOCK_SHELVES, MINIS, MINI_SHELVES, PLAYER_COLORS, PROPS, PROP_SHELVES } from './catalog';
import { loadKit, type Season } from './kit';
import { THEMES, generate, type GenOpts, type Theme } from './gen';
import { MAX_DICE, kindsFor, results, rollValues, simulate, type Kind, type Start } from './dice';
import { DEFAULT_RELAYS, Net, deriveRoom, hex, pack, unhex, unpack, type Msg } from './net';
import { SOUNDSCAPES, Sound } from './sound';
import { canControl, fullPowers, gms, nextTurn, pid, setting, turnOrder, type Turn, parseEdge, roomEdges } from './rules';
import { Store, type Row } from './store';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ls = {
  get: (k: string) => { try { return localStorage.getItem(`cottontale:${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`cottontale:${k}`, v); } catch { /* storage full or blocked */ } },
};
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
    ? 'One finger: look around — or use the selected tool (🧱 tap or drag to paint, 📏 drag to measure).<br />Two fingers: pan, pinch to zoom, twist to turn.<br />Press and hold the table to ping. ▲▼ on the right hides upper floors.<br />🎲 Pick dice up, then drag on the table and let go to throw.'
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
    $('players').innerHTML = all.map((p) => `<span style="border-color:${p.color}">${g.includes(p.id) ? '🎩 ' : ''}${esc(p.name)}</span>`).join('');
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

  function setTool(t: Tool): void {
    board.setTool(t);
    for (const b of $('tools').querySelectorAll<HTMLButtonElement>('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    renderPalette();
  }
  for (const b of $('tools').querySelectorAll<HTMLButtonElement>('[data-tool]')) b.onclick = () => setTool(b.dataset.tool as Tool);

  let buildShelf = 'Terrain', miniShelf = 'Heroes';
  const SLABS = 'Copy & paste';

  function renderPalette(): void {
    const el = $('palette');
    el.innerHTML = '';
    const add = (title: string, inner: string, on: boolean, click: () => void) => {
      const b = document.createElement('button');
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = inner;
      b.classList.toggle('on', on);
      b.onclick = () => {
        click();
        if (board.tool === 'build') board.setTool('build'); // the copy brush changes what a mouse drag does
        renderPalette();
      };
      el.append(b);
      return b;
    };
    const sep = () => el.insertAdjacentHTML('beforeend', '<span class="sep"></span>');
    // A long library is shelved: pick a shelf with the phone's own picker, then scroll just that shelf.
    const shelves = (names: string[], current: string, pick: (name: string) => void) => {
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Shelf');
      sel.innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join('');
      sel.value = current;
      sel.onchange = () => { pick(sel.value); renderPalette(); };
      el.append(sel);
    };
    const v = sel();
    if (board.tool === 'move') {
      // Emotes for the selected mini sit where the palette is: right above the thumb.
      if (v && canControl(store, meId, v)) {
        for (const [kind, icon] of Object.entries(EMOTES)) add(kind, icon, false, () => emote(kind));
        sep();
        add(v.d ? 'Stand up' : 'Knock down', '💀', !!v.d, () => patch({ d: !v.d }));
      }
    } else if (board.tool === 'build') {
      add('Eraser', '⛏️', board.brush === 'erase', () => { board.brush = 'erase'; });
      shelves([...Object.keys(BLOCK_SHELVES), ...Object.keys(PROP_SHELVES), SLABS], buildShelf, (n) => { buildShelf = n; });
      if (buildShelf === 'Terrain') {
        // Shaping the land: each is a brush you tap or drag over the ground.
        const land: [string, string, string][] = [['raise', '⛰️', 'Raise the ground'], ['lower', '🕳️', 'Lower the ground'], ['level', '🟰', 'Level to where you start'], ['grow', '🌱', 'Grow what suits the ground']];
        for (const [id, icon, title] of land) add(title, icon, board.brush === id, () => { board.brush = id; });
        add(`Brush size: ${board.reach * 2 + 1} across`, ['•', '●', '⬤'][board.reach], false, () => { board.reach = (board.reach + 1) % 3; });
        add('Repaint the surface instead of stacking', '🖌️', board.surface, () => { board.surface = !board.surface; });
        sep();
      }
      for (const id of BLOCK_SHELVES[buildShelf] ?? []) add(BLOCKS[id].name, `<i style="background:${BLOCKS[id].color}"></i>`, board.brush === id, () => { board.brush = id; });
      for (const id of PROP_SHELVES[buildShelf] ?? []) add(PROPS[id].name, PROPS[id].icon, board.brush === id, () => { board.brush = id; });
      const turn = () => add('Turn (R)', ['⬆️', '➡️', '⬇️', '⬅️'][board.rot], false, () => { board.rot = (board.rot + 1) % 4; });
      if (buildShelf === 'Structures') {
        // A whole room in one drag: floor, walls, windows and a doorway.
        const room = (timber: boolean) => add(`${timber ? 'Timber' : 'Stone'} room: drag out its floor`, timber ? '🛖' : '🏠', board.brush === 'room' && board.roomTimber === timber,
          () => { board.brush = 'room'; board.roomTimber = timber; });
        sep(); room(false); room(true);
      }
      if (PROP_SHELVES[buildShelf]) { sep(); turn(); }
      if (buildShelf === SLABS) {
        add('Copy: drag over an area', '✂️', board.brush === 'copy', () => { board.brush = 'copy'; });
        add('Paste: tap where it goes', '📋', board.brush === 'paste', () => { board.brush = 'paste'; }).disabled = !board.slab;
        turn();
        sep();
        add('Share what you copied', '📤', false, () => void shareSlab()).disabled = !board.slab;
        add('Paste a shared code', '📥', false, () => void importSlab());
      }
    } else if (board.tool === 'mini') {
      shelves(Object.keys(MINI_SHELVES), miniShelf, (n) => { miniShelf = n; });
      for (const id of MINI_SHELVES[miniShelf]) add(MINIS[id].name, MINIS[id].icon, miniKind === id, () => { miniKind = id; });
      sep();
      add('Base colour', `<i style="background:${miniColor};border-radius:50%"></i>`, false, () => {
        miniColor = PLAYER_COLORS[(PLAYER_COLORS.indexOf(miniColor) + 1) % PLAYER_COLORS.length];
      });
    } else if (board.tool === 'ruler') {
      const modes: [RulerMode, string, string][] = [['line', '📏', 'Distance'], ['circle', '⭕', 'Radius'], ['cone', '🔺', 'Cone']];
      for (const [m, icon, title] of modes) add(title, icon, board.rulerMode === m, () => { board.rulerMode = m; });
      sep();
      add('Put the ruler away', '✕', false, () => { board.showRuler('me', null, ''); void send({ y: 'ruler', r: null }); });
    } else if (board.tool === 'fog') {
      add('Hide: drag to cover an area', '🌫️', board.fogHide, () => { board.fogHide = true; });
      add('Reveal: drag to uncover', '👁️', !board.fogHide, () => { board.fogHide = false; });
      sep();
      add('Reveal everything', '☀️', false, () => { for (const k of [...store.keys('f:')]) store.set(k, null); });
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
    if (list.contains(document.activeElement)) return; // someone is typing a name
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
        x.textContent = label;
        x.title = title;
        x.setAttribute('aria-label', title);
        x.onclick = click;
        row.append(x);
      };
      if (f) {
        if (b.id !== here) btn('👁️', 'Look at it yourself (players stay where they are)', () => { peek = b.id === active ? null : b.id; sync(); });
        if (b.id !== active) btn('▶', 'Bring everyone here', () => { peek = null; store.set('set:board', b.id); });
        if (b.id) btn('🗑️', 'Delete this board', () => {
          if (!confirm(`Delete “${b.n}” and everything on it?`)) return;
          for (const [k, e] of [...store.entries]) if (e.v !== null && k.startsWith(`@${b.id}/`)) store.setRaw(k, null);
          store.set(`bd:${b.id}`, null);
        });
      }
      list.append(row);
    }
    const prepping = f && here !== active;
    $('prep').hidden = !prepping;
    $('prepText').textContent = prepping ? `👁️ Preparing “${boardName(here)}” — players are on “${boardName(active)}”` : '';
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
      b.textContent = label;
      b.classList.toggle('on', id === cur);
      b.disabled = !f;
      b.onclick = () => store.set(`set:${key}`, id);
      el.append(b);
    }
  }
  function renderAtmo(): void {
    choices($('skies'), SKY_NAMES, 'sky', 'day');
    choices($('seasons'), SEASON_NAMES, 'season', 'summer');
    choices($('scapes'), SOUNDSCAPES, 'amb', 'off');
    $('soundOn').textContent = sound.enabled ? '🔊 Sound on this device: on' : '🔈 Sound on this device: off';
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
    const sky = setting<Sky>(store, 'sky', 'day');
    board.setSky(sky);
    board.setSeason(setting<Season>(store, 'season', 'summer'));
    const act = (a: string) => $('menu').querySelector<HTMLElement>(`[data-act="${a}"]`)!;
    act('gm').textContent = amGM ? '🎩 Stop being the GM' : '🎩 Become the GM';
    act('los').textContent = `👁️ Line of sight: ${l ? 'on' : 'off'}`;
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
    $('nextTurn').textContent = current ? '⏭️' : '▶️';
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

  function showMiniPanel(id: string | null): void {
    $('minipanel').hidden = !id;
    const v = sel();
    if (cutAuto) autoCut();
    if (board.tool === 'move') renderPalette(); // the emote row follows the selection
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
    $('miniFly').textContent = `🕊️ ${v.e || 0}`;
    $('miniHide').textContent = v.h ? '🙈 Hidden' : '👁️ Visible';
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
  /** What the last scene built here put on the table, so the next one can take its place. */
  let genLast = new Set<string>();
  function renderGen(): void {
    const themes = $('genThemes'), sliders = $('genSliders'), recent = $('genRecent');
    themes.innerHTML = sliders.innerHTML = recent.innerHTML = '';
    for (const [id, t] of Object.entries(THEMES) as [Theme, (typeof THEMES)[Theme]][]) {
      const b = document.createElement('button');
      b.textContent = `${t.icon} ${t.name}`;
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
    for (const o of genRecent) {
      const b = document.createElement('button');
      b.textContent = `${THEMES[o.theme].icon} #${o.seed}`;
      b.title = `${THEMES[o.theme].name}, seed ${o.seed}`;
      b.onclick = () => { genOpts = { ...o }; buildScene(); };
      recent.append(b);
    }
  }
  function buildScene(): void {
    if (!full()) return;
    const scene = generate(genOpts);
    board.applyScene(scene.edits, scene.bounds, genLast);
    genLast = new Set(scene.edits.map(([k]) => k));
    const same = (o: GenOpts) => JSON.stringify(o) === JSON.stringify(genOpts);
    genRecent = [{ ...genOpts }, ...genRecent.filter((o) => !same(o))].slice(0, 6);
    ls.set('genRecent', JSON.stringify(genRecent));
    renderGen();
  }
  $('genGo').onclick = buildScene;
  $('genAgain').onclick = () => { genOpts = { ...genOpts, seed: newSeed() }; buildScene(); };

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
