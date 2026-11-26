import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { Board, type MiniVal, type Tool, type Vec } from './board';
import { BLOCKS, MINIS, PLAYER_COLORS, PROPS } from './catalog';
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
      b.style.background = c;
      b.classList.toggle('on', c === current());
      b.onclick = () => { pick(c); paint(); };
      el.append(b);
    }
  };
  paint();
  return paint;
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
  say(`<span class="sys">Welcome, ${esc(name)}! Share the invite link to bring others to the table.</span>`);

  function handle(msg: Msg, from: string): void {
    const who = `<b style="color:${net.colorOf(from)}">${esc(net.nameOf(from))}</b>`;
    switch (msg.y) {
      case 'chat': say(`${who}: ${esc(String(msg.m).slice(0, 300))}`); break;
      case 'roll': showRoll(who, msg, false); break;
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

  function say(html: string): void {
    const d = document.createElement('div');
    d.innerHTML = html;
    const box = $('msgs');
    box.append(d);
    while (box.children.length > 200) box.firstChild!.remove();
    box.scrollTop = box.scrollHeight;
  }

  let toastTimer: ReturnType<typeof setTimeout>;
  function showRoll(who: string, m: { d: string; r: number[]; mod: number }, mine: boolean): void {
    const r = (Array.isArray(m.r) ? m.r : []).slice(0, 20).map(Number);
    const total = r.reduce((a, b) => a + b, 0) + (Number(m.mod) || 0);
    const detail = r.length > 1 || m.mod ? ` <span class="sys">(${r.join(' + ')}${m.mod ? ` ${m.mod > 0 ? '+' : '−'} ${Math.abs(m.mod)}` : ''})</span>` : '';
    say(`🎲 ${who} rolled ${esc(String(m.d))}: <span class="tot">${total}</span>${detail}`);
    const t = $('toast');
    t.innerHTML = `<big>${total}</big>${mine ? 'You' : who} · ${esc(String(m.d))}`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  function roll(n: number, sides: number, mod = 0): void {
    n = Math.min(Math.max(n, 1), 20);
    const r = [...crypto.getRandomValues(new Uint32Array(n))].map((x) => (x % sides) + 1);
    const msg = { y: 'roll' as const, d: `${n}d${sides}${mod ? (mod > 0 ? '+' : '') + mod : ''}`, r, mod };
    showRoll(`<b style="color:${myColor}">${esc(name)}</b>`, msg, true);
    void net.send(msg);
  }

  let diceN = 1;
  $('diceN').onclick = () => { diceN = (diceN % 6) + 1; $('diceN').textContent = `${diceN}×`; };
  for (const b of $('dice').querySelectorAll<HTMLButtonElement>('[data-d]')) b.onclick = () => roll(diceN, +b.dataset.d!);

  $<HTMLFormElement>('chat').onsubmit = (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('chatIn');
    const text = input.value.trim();
    input.value = '';
    if (!text) return;
    const r = /^\/r(?:oll)?\s+(\d*)d(\d+)\s*([+-]\s*\d+)?$/i.exec(text);
    if (r && +r[2] >= 2 && +r[2] <= 1000) return roll(+(r[1] || 1), +r[2], r[3] ? +r[3].replace(/\s/g, '') : 0);
    say(`<b style="color:${myColor}">${esc(name)}</b>: ${esc(text)}`);
    void net.send({ y: 'chat', m: text });
  };
  $('logToggle').onclick = () => $('log').classList.toggle('closed');
  if (matchMedia('(max-width: 720px)').matches) $('log').classList.add('closed');

  // ---- tools & palette ----

  function setTool(t: Tool): void {
    board.setTool(t);
    for (const b of $('tools').querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.tool === t);
    renderPalette();
  }
  for (const b of $('tools').querySelectorAll<HTMLButtonElement>('button')) b.onclick = () => setTool(b.dataset.tool as Tool);

  function renderPalette(): void {
    const el = $('palette');
    el.innerHTML = '';
    el.hidden = board.tool !== 'build' && board.tool !== 'mini';
    const add = (title: string, inner: string, on: boolean, click: () => void) => {
      const b = document.createElement('button');
      b.title = title;
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
  addEventListener('pagehide', () => {
    ls.set(`room:${tag}`, JSON.stringify(store.dump()));
    void net.stop();
  });

  setTool('move');
}
