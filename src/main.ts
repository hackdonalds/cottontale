import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { Board, type MiniVal, type Tool, type Vec } from './board';
import { BLOCKS, MINIS, PLAYER_COLORS, PROPS } from './catalog';
import { MAX_DICE, kindsFor, results, rollValues, simulate, type Kind, type Start } from './dice';
import { DEFAULT_RELAYS, Net, deriveRoom, hex, unhex, type Msg } from './net';
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
  const fit = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

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
  const store = new Store(me.slice(0, 10));
  const { tag } = await deriveRoom(code);

  const customRelays = relays.join() !== DEFAULT_RELAYS.join();
  const invite = `${location.origin}${location.pathname}#room=${encodeURIComponent(code)}${customRelays ? `&relays=${relays.join(',')}` : ''}`;
  history.replaceState(null, '', invite);

  // Minis placed with the mini tool use these.
  let miniKind = 'knight';
  let miniColor = myColor;

  const board = new Board($<HTMLCanvasElement>('c'), store, {
    onSelect: showMiniPanel,
    onLiveMove: (id, p) => void net.send({ y: 'mv', id, p }),
    onPing: (p) => { board.ping(p, myColor); void net.send({ y: 'ping', p }); },
    newMini: () => ({ k: miniKind, c: miniColor, n: '', r: 0, s: 1 }),
    onGrab: () => { if (phoneSheet()) closeSheet(); },
    onThrow: (starts, vel) => void throwHand(starts, vel),
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  store.onChange = (k, v, prev) => {
    board.apply(k, v, prev);
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
  Object.assign(window, { __ct: { store, net, board } });

  $('lobby').hidden = true;
  $('hud').hidden = false;
  stayAwake();
  $('help').innerHTML = coarse
    ? 'One finger: look around — or, with 🧱 ⛏️, tap to edit and drag to paint.<br />Two fingers: pan, pinch to zoom, twist to turn.<br />🎲 Pick dice up, then drag on the table and let go to throw.'
    : 'Left-drag orbit · right-drag pan · wheel zoom<br />1–5 tools · R rotate · Ctrl+Z undo · Del remove<br />Dice: pick them up, drag on the table, let go to throw';
  say(`<span class="sys">Welcome, ${esc(name)}! Share the invite link to bring others to the table.</span>`);

  function handle(msg: Msg, from: string): void {
    const who = `<b style="color:${net.colorOf(from)}">${esc(net.nameOf(from))}</b>`;
    switch (msg.y) {
      case 'chat': say(`${who}: ${esc(String(msg.m).slice(0, 300))}`); break;
      case 'roll': {
        // With a recorded throw, watch the dice land first; what they show is the result.
        const labels = msg.t ? results(msg.t) : null;
        if (!msg.t || !labels) { showRoll(who, msg, false); break; }
        const shown = { ...msg, r: rollValues(msg.t.k, labels) };
        void board.dice.play(msg.t, net.colorOf(from), from).then(() => showRoll(who, shown, false));
        break;
      }
      case 'ping': if (Array.isArray(msg.p) && msg.p.every(Number.isFinite)) board.ping(msg.p, net.colorOf(from)); break;
      case 'mv': if (Array.isArray(msg.p)) board.liveMove(String(msg.id), msg.p as Vec); break;
    }
  }

  // ---- players, chat, dice ----

  function renderPlayers(): void {
    const all = [{ name, color: myColor }, ...net.peers.values()];
    $('players').innerHTML = all.map((p) => `<span style="border-color:${p.color}">${esc(p.name)}</span>`).join('');
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
    void net.send({ y: 'roll', d, r, mod, t });
    navigator.vibrate?.(12);
    await board.dice.play(t, myColor, me);
    showRoll(meTag, { d, r, mod }, true);
  }
  function closeSheet(): void {
    $('log').classList.add('closed');
    $('logToggle').classList.remove('on');
  }

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
    say(`${meTag}: ${esc(text)}`);
    void net.send({ y: 'chat', m: text });
  };
  $('logToggle').onclick = () => {
    const closed = $('log').classList.toggle('closed');
    $('logToggle').classList.toggle('on', !closed);
    $('logToggle').classList.remove('unread');
    if (!closed) $('msgs').scrollTop = $('msgs').scrollHeight;
  };
  $('undo').onclick = () => board.undo();

  // ---- tools & palette ----

  function setTool(t: Tool): void {
    board.setTool(t);
    for (const b of $('tools').querySelectorAll<HTMLButtonElement>('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    renderPalette();
  }
  for (const b of $('tools').querySelectorAll<HTMLButtonElement>('[data-tool]')) b.onclick = () => setTool(b.dataset.tool as Tool);

  function renderPalette(): void {
    const el = $('palette');
    el.innerHTML = '';
    el.hidden = board.tool !== 'build' && board.tool !== 'mini';
    const add = (title: string, inner: string, on: boolean, click: () => void) => {
      const b = document.createElement('button');
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = inner;
      b.classList.toggle('on', on);
      b.onclick = () => { click(); renderPalette(); };
      el.append(b);
    };
    const sep = () => el.insertAdjacentHTML('beforeend', '<span class="sep"></span>');
    if (board.tool === 'build') {
      for (const [id, d] of Object.entries(BLOCKS)) add(d.name, `<i style="background:${d.color}"></i>`, board.brush === id, () => { board.brush = id; });
      sep();
      for (const [id, d] of Object.entries(PROPS)) add(d.name, d.icon, board.brush === id, () => { board.brush = id; });
      sep();
      add('Rotate prop (R)', ['⬆️', '➡️', '⬇️', '⬅️'][board.rot], false, () => { board.rot = (board.rot + 1) % 4; });
    } else if (board.tool === 'mini') {
      for (const [id, d] of Object.entries(MINIS)) add(d.name, d.icon, miniKind === id, () => { miniKind = id; });
      sep();
      add('Base colour', `<i style="background:${miniColor};border-radius:50%"></i>`, false, () => {
        miniColor = PLAYER_COLORS[(PLAYER_COLORS.indexOf(miniColor) + 1) % PLAYER_COLORS.length];
      });
    }
  }

  // ---- selected mini ----

  const sel = () => (board.selected ? store.get<MiniVal>(`m:${board.selected}`) : null);
  const patch = (p: Partial<MiniVal>) => { const v = sel(); if (v) store.set(`m:${board.selected}`, { ...v, ...p }); };
  const repaintMiniColors = swatches($('miniColors'), () => sel()?.c ?? '', (c) => patch({ c }));

  function showMiniPanel(id: string | null): void {
    $('minipanel').hidden = !id;
    const v = sel();
    if (!v) return;
    $<HTMLInputElement>('miniName').value = v.n;
    repaintMiniColors();
  }
  $<HTMLInputElement>('miniName').onchange = (e) => patch({ n: (e.target as HTMLInputElement).value.trim().slice(0, 20) });
  $('miniRot').onclick = () => patch({ r: ((sel()?.r ?? 0) + 1) % 8 });
  $('miniSize').onclick = () => patch({ s: ({ 1: 1.5, 1.5: 2, 2: 0.7 } as Record<number, number>)[sel()?.s ?? 1] ?? 1 });
  $('miniDel').onclick = () => { if (board.selected) store.set(`m:${board.selected}`, null); };

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
      for (const k of [...store.keys('b:'), ...store.keys('m:')]) store.set(k, null);
    }
    if (act === 'leave') void net.stop().then(() => { location.hash = ''; location.reload(); });
  };
  $<HTMLInputElement>('file').onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    try {
      const data = JSON.parse(await input.files![0].text());
      for (const [k, v] of data.rows as [string, unknown][]) if (/^[bm]:/.test(k)) store.set(k, v);
    } catch { alert('That file is not a Cottontale table.'); }
    input.value = '';
  };

  function meadow(): void {
    const h = (x: number, z: number) => Math.sin(x * 0.35) * 1.1 + Math.cos(z * 0.3) * 1.1 + Math.sin((x + z) * 0.17) * 1.3;
    for (let x = -10; x < 10; x++) {
      for (let z = -10; z < 10; z++) {
        const top = Math.max(0, Math.round(h(x, z) + 0.6));
        const pond = Math.hypot(x - 4, z + 3) < 3.2;
        if (pond) { store.set(`b:${x},0,${z}`, { i: Math.hypot(x - 4, z + 3) < 2.4 ? 'water' : 'sand' }); continue; }
        for (let y = 0; y <= top; y++) store.set(`b:${x},${y},${z}`, { i: y === top ? 'grass' : y > top - 2 ? 'dirt' : 'stone' });
        const r = Math.abs(Math.sin(x * 91.7 + z * 37.3) * 1000) % 1;
        const prop = r < 0.04 ? 'tree' : r < 0.07 ? 'pine' : r < 0.09 ? 'rock' : r < 0.11 ? 'bush' : null;
        if (prop) store.set(`b:${x},${top + 1},${z}`, { i: prop });
      }
    }
    store.set('b:-2,' + (Math.max(0, Math.round(h(-2, 2) + 0.6)) + 1) + ',2', { i: 'campfire' });
  }

  // ---- keyboard ----

  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input, textarea')) return;
    const tools: Tool[] = ['move', 'build', 'erase', 'mini', 'ping'];
    if (e.key >= '1' && e.key <= '5') setTool(tools[+e.key - 1]);
    else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); board.undo(); }
    else if (e.key === 'r' || e.key === 'R') {
      if (board.selected) patch({ r: ((sel()?.r ?? 0) + 1) % 8 });
      else { board.rot = (board.rot + 1) % 4; renderPalette(); }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && board.selected) store.set(`m:${board.selected}`, null);
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
  });
  addEventListener('online', () => net.wake(false));
  addEventListener('pageshow', (e) => { if (e.persisted) net.wake(true); });
  addEventListener('pagehide', () => {
    ls.set(`room:${tag}`, JSON.stringify(store.dump()));
    void net.pause();
  });

  setTool('move');
  renderHand();
}
