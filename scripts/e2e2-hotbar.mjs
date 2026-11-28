// End-to-end check of the hotbar and of pinning in the library (`?ui=2`, src/ui/hotbar2.ts and
// src/ui/buildSheets.ts), on phone viewports. Its start-up, touch helpers and `layout()` are
// those of e2e2.mjs, with the hotbar among the boxes that are measured.
//   npm run build && node scripts/e2e2-hotbar.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw, channel;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); channel = 'chrome'; }
const { chromium, devices } = pw;

const PORT = Number(process.env.E2E_PORT ?? 4440), RELAY = PORT + 1;
const SLOW = +(process.env.E2E_SLOW ?? 1);
const procs = [
  spawn('node', ['scripts/relay.mjs'], { env: { ...process.env, PORT: String(RELAY) }, stdio: 'ignore' }),
  spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' }),
];
const done = (code) => { procs.forEach((p) => p.kill()); process.exit(code); };
let failed = 0;
const assert = (ok, what) => { console.log(ok ? '  ok  ' : ' FAIL ', what); if (!ok) { failed++; if (!process.env.E2E_KEEP) done(1); } };
process.on('uncaughtException', (e) => { console.error(e); done(1); });
for (let i = 0; i < 120; i++) {
  if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 1000));

const browser = await chromium.launch({ channel, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const SHOTS = process.env.E2E_SHOTS; // a folder: keep a picture of each state

async function join(name, room, viewport) {
  const page = await (await browser.newContext({ ...devices['iPhone 13'], viewport })).newPage();
  page.setDefaultTimeout(30000 * SLOW);
  page.on('pageerror', (e) => { console.log('pageerror', name, e.stack ?? e.message); done(1); });
  await page.goto(`http://localhost:${PORT}/?ui=2#room=${room}&relays=ws://localhost:${RELAY}`);
  await enter(page, name);
  return page;
}
/** Through the lobby to the table (again after a reload). */
async function enter(page, name) {
  await page.fill('#name', name);
  await page.tap('#join');
  await page.waitForSelector('#app .dock .slot');
}

// The screen budget (CLAUDE.md, "Screen real estate drives the design"): how much of the smallest phone the table keeps.
const BUDGET = { rest: 0.85, swapped: 0.8, half: 0.45 };
for (const [label, viewport] of [['portrait', { width: 360, height: 640 }], ['landscape', { width: 640, height: 360 }]]) {
  console.log(`hotbar, phone ${label} ${viewport.width}x${viewport.height}`);
  const p = await join('Mo', `hb-${label}-1234`, viewport);
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const settle = (ms = 150) => p.waitForTimeout(ms * SLOW);
  const tapAt = async ([x, y]) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); await settle(); };
  const dragTo = async ([x0, y0], [x1, y1], steps = 10) => {
    await touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]); await p.waitForTimeout(16); }
    await touch('touchEnd', []);
    await settle();
  };
  const slots = () => p.evaluate(() => [...document.querySelectorAll('#app .dock .slot')].map((b) => b.dataset.slot).join());
  const slot = async (id) => { await p.tap(`#app .dock [data-slot="${id}"]`); await settle(); };
  const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-${name}.png` }); };
  /** Where a point of the table is on screen. */
  const at = (x, y, z) => p.evaluate(([x, y, z]) => {
    const { board } = window.__ct, c = document.querySelector('#c');
    const s = board.ground.position.clone().set(x, y, z).project(board.camera);
    return [((s.x + 1) / 2) * c.clientWidth, ((1 - s.y) / 2) * c.clientHeight];
  }, [x, y, z]);
  /** A free cell of the ground that a finger can reach right now (clear of the chrome, nothing in front of it), other than `not`: its key and where it is on screen. */
  const freeSpot = (not = []) => p.evaluate(([not, w, h]) => {
    const { board, store } = window.__ct, c = document.querySelector('#c');
    for (let x = -3; x <= 8; x++) for (let z = 0; z <= 8; z++) {
      const key = `b:${x},1,${z}`;
      if (not.includes(key) || store.get(key) !== null) continue;
      const s = board.ground.position.clone().set(x + 0.5, 1, z + 0.5).project(board.camera);
      const pt = [((s.x + 1) / 2) * c.clientWidth, ((1 - s.y) / 2) * c.clientHeight];
      if (pt[0] < 40 || pt[0] > w - 110 || pt[1] < 90 || pt[1] > h - 150) continue;
      board.aim({ clientX: pt[0], clientY: pt[1] });
      if (board.pickSurface()?.place.join() === `${x},1,${z}` && !board.pickMini() && !board.pickProp()) return { key, pt };
    }
    return null;
  }, [not, viewport.width, viewport.height]);
  /** Bring a mini into view and find a point on it that a finger would hit. */
  const miniPt = async (id) => {
    await p.evaluate((id) => window.__ct.board.focusMini(id), id);
    await settle(900);
    return p.evaluate(([id, w, h]) => {
      const { board, store } = window.__ct, c = document.querySelector('#c'), v = store.get(`m:${id}`);
      const s = board.ground.position.clone().set(v.x + 0.5, v.y + 0.3, v.z + 0.5).project(board.camera);
      const cx = ((s.x + 1) / 2) * c.clientWidth, cy = ((1 - s.y) / 2) * c.clientHeight;
      for (const dy of [0, -10, 10, -20, 20, -30]) for (const dx of [0, -10, 10, -20, 20]) {
        const pt = [cx + dx, cy + dy];
        if (pt[0] < 10 || pt[0] > w - 10 || pt[1] < 10 || pt[1] > h - 10) continue;
        board.aim({ clientX: pt[0], clientY: pt[1] });
        if (board.pickMini() === id) return pt;
      }
      return null;
    }, [id, viewport.width, viewport.height]);
  };
  const st = () => p.evaluate(() => {
    const { board, store } = window.__ct;
    return { picked: board.picked, selected: board.selected, tool: board.tool, brush: board.brush, box: board.pickBox.visible, undo: !document.querySelector('#app .undo').hidden, n: [...store.keys('b:')].length, minis: [...store.keys('m:')].length };
  });
  const get = (k) => p.evaluate((k) => window.__ct.store.get(k), k);

  /** Nothing overlaps or leaves the screen, every target is big enough, the dock holds at most six, and the table keeps its share. */
  const layout = (share) => p.evaluate((share) => {
    const bad = [];
    const boxes = [...document.querySelectorAll('#app .dock, #app .undo:not([hidden]), #app .drawer:not([hidden]), #app .turn:not([hidden]), #app .hotbar:not([hidden])')].map((e) => ({ id: e.className, r: e.getBoundingClientRect() }));
    let covered = 0;
    for (const a of boxes) {
      if (share !== null) covered += a.r.width * a.r.height;
      if (a.r.left < 0 || a.r.top < 0 || a.r.right > innerWidth + 0.5 || a.r.bottom > innerHeight + 0.5) bad.push(`${a.id} off-screen`);
      for (const b of boxes) if (a.id < b.id && a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) bad.push(`${a.id} overlaps ${b.id}`);
    }
    const n = document.querySelectorAll('#app .dock .slot').length;
    if (n > 6) bad.push(`${n} slots in the dock`);
    for (const b of document.querySelectorAll('#app button')) {
      const r = b.getBoundingClientRect();
      if (b.offsetParent && (r.width < 43.5 || r.height < 43.5)) bad.push(`small target ${b.dataset.slot || b.title} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const b of document.querySelectorAll('#app .drawer:not([hidden]) :is(button, input, select)')) { const r = b.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) bad.push(`${b.textContent || b.placeholder} sticks out sideways`); }
    for (const s of document.querySelectorAll('#app .dock .slot span')) if (s.scrollWidth > s.clientWidth + 1) bad.push(`label cut off: ${s.textContent}`);
    for (const i of document.querySelectorAll('input, textarea')) if (i.offsetParent && parseFloat(getComputedStyle(i).fontSize) < 16) bad.push(`input ${i.id} under 16px`);
    if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) bad.push('the page scrolls sideways');
    const table = 1 - covered / (innerWidth * innerHeight);
    if (share !== null && table < share) bad.push(`the table keeps ${(table * 100).toFixed(1)}% of the screen, under ${share * 100}%`);
    return bad;
  }, share);
  const fits = async (what, share = BUDGET.swapped) => { const bad = await layout(share); assert(!bad.length, `${what}: layout holds${bad.length ? ` — ${bad.join('; ')}` : ''}`); await shot(what.replace(/\W+/g, '-')); };

  /** The hotbar: whether it is up, the pieces on it in order, the one marked as in hand, and its box. */
  const bar = () => p.evaluate(() => {
    const el = document.querySelector('#app .hotbar'), r = el.getBoundingClientRect(), kids = [...el.querySelectorAll('button')];
    return {
      up: !el.hidden && r.width > 0, keys: kids.map((b) => b.dataset.key), on: kids.filter((b) => b.classList.contains('on')).map((b) => b.dataset.key).join(), favs: kids.filter((b) => b.classList.contains('fav')).length,
      w: r.width, h: r.height, labels: kids.filter((b) => b.textContent.trim()).length, pictures: kids.every((b) => b.querySelector('i')), named: kids.every((b) => b.getAttribute('aria-label')),
      scrolls: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1, at: el.scrollLeft + el.scrollTop,
    };
  });
  /** The pieces under a heading of the library, by name. */
  const shelf = (name) => p.evaluate((name) => {
    const out = [];
    let on = false;
    for (const e of document.querySelectorAll('.drawer .tiles > *')) { if (e.tagName === 'H3') on = e.textContent === name; else if (on && e.classList.contains('tile')) out.push(e.title); }
    return out;
  }, name);
  const saved = (k) => p.evaluate((k) => localStorage.getItem(`cottontale:${k}`), k);
  const find = async (q) => { await p.fill('.drawer input[type=search]', q); await settle(); };
  const closeDrawer = async () => { await p.tap('.drawer header button'); await settle(); };
  const drawerId = () => p.evaluate(() => window.__ct.ui.drawer.id);

  await p.evaluate(() => window.__ct.session.starterScene());
  await settle(400);
  // A fight is on all through: the turn strip has to share the edge with the row.
  await slot('fight');
  await p.tap('.drawer button:has-text("Start")');
  await settle(300);
  await closeDrawer();
  assert(await p.evaluate(() => !document.querySelector('#app .turn').hidden), 'a fight is on, with its turn strip');
  const n0 = (await st()).n;
  await slot('build');
  assert(!(await bar()).up, 'no hotbar in Build with nothing in hand');

  // ---- pinning in the library, by tap ----
  await slot('pieces');
  assert(await drawerId() === 'pieces' && (await st()).tool === 'pick' && !(await bar()).up, 'on a new device Pieces opens the library with nothing in hand, and no hotbar under it');
  assert(!(await shelf('Favourites')).length && !(await shelf('Recent')).length, 'nothing is pinned or recent yet');
  assert(await p.evaluate(() => document.querySelector('.drawer .pin').getAttribute('aria-pressed') === 'false'), 'the library has a star beside its search');
  await p.tap('.drawer .pin');
  await settle();
  assert(await p.evaluate(() => document.querySelector('.drawer .pin').getAttribute('aria-pressed') === 'true' && document.querySelector('.drawer .tiles').classList.contains('pinning')), 'tapping it turns pinning on');
  await fits('library, pinning', null);
  await find('barr');
  await p.tap('.drawer .tile');
  await settle();
  assert(await drawerId() === 'pieces' && (await st()).tool === 'pick' && await p.evaluate(() => document.querySelector('.drawer .tile').classList.contains('fav')), 'with the star on, a tap pins the piece: the library stays and nothing is taken in hand');
  await find('crate');
  await p.tap('.drawer .tile');
  await find('knight');
  await p.tap('.drawer .tile');
  await settle();
  assert(await saved('favs2') === '["p_barrel","p_crate","m_knight"]', `pins are kept on this device, by key (${await saved('favs2')})`);
  await p.tap('.drawer .tile');
  await settle();
  assert(await saved('favs2') === '["p_barrel","p_crate"]' && await p.evaluate(() => !document.querySelector('.drawer .tile').classList.contains('fav')), 'a second tap takes the pin off');
  await find('');
  assert((await shelf('Favourites')).join() === 'Barrel,Crate', `pinned pieces have their own shelf (${await shelf('Favourites')})`);
  assert(await p.evaluate(() => document.querySelector('.drawer .tiles h3').textContent === 'Favourites'), 'and it leads the library');
  // Pinning a piece from further down keeps it under the finger.
  const far = await p.evaluate(() => { const t = [...document.querySelectorAll('.drawer .tile')].find((t) => t.title === 'Campfire'); t.scrollIntoView({ block: 'center' }); return t.getBoundingClientRect().top; });
  await p.tap('.drawer .tile[title="Campfire"]:not(.fav)');
  await settle();
  assert((await shelf('Favourites')).join() === 'Barrel,Crate,Campfire', 'a tile on its own shelf pins too');
  const kept = await p.evaluate(() => [...document.querySelectorAll('.drawer .tile')].filter((t) => t.title === 'Campfire').pop().getBoundingClientRect().top);
  assert(Math.abs(kept - far) < 8, `and the list does not jump away from the finger (${Math.round(far)} to ${Math.round(kept)})`);
  await p.tap('.drawer .tile.fav[title="Campfire"] >> nth=-1');
  await settle();
  assert((await shelf('Favourites')).join() === 'Barrel,Crate', 'tapped again where it stands, it is unpinned');
  await p.evaluate(() => { document.querySelector('.drawer .body').scrollTop = 0; });
  await p.tap('.drawer .pin');
  await settle();
  assert(await p.evaluate(() => document.querySelector('.drawer .pin').getAttribute('aria-pressed') === 'false'), 'the star goes off again');

  // ---- the hotbar: there while a brush is in hand ----
  await p.tap('.drawer .tile[title="Barrel"]');
  await settle();
  let s = await st(), b = await bar();
  assert(s.brush === 'barrel' && s.tool === 'build' && await drawerId() === null, 'with the star off a tap takes the piece in hand, as before');
  assert(b.up && b.keys.join() === 'p_barrel,p_crate' && b.on === 'p_barrel' && b.favs === 2, `the hotbar is up with the pinned pieces, the one in hand marked (${b.keys}; on ${b.on})`);
  assert(b.pictures && !b.labels && b.named && Math.min(b.w, b.h) <= 48, `it is one slim row of pictures, not a second dock row (${Math.round(b.w)}x${Math.round(b.h)})`);
  assert((await st()).undo && await p.evaluate(() => !document.querySelector('#app .turn').hidden), 'the Undo pair and the turn strip are on screen with it');
  await fits('hotbar, pinned pieces');
  await p.tap('#app .hotbar [data-key="p_crate"]');
  await settle();
  s = await st(); b = await bar();
  assert(s.brush === 'crate' && s.tool === 'build' && b.on === 'p_crate' && b.keys.join() === 'p_barrel,p_crate', `a tap on the hotbar takes that piece in hand, and the row keeps its order (${s.brush}; ${b.keys})`);
  assert(await p.evaluate(() => document.querySelector('[data-slot="hand"] span').textContent) === 'Crate' && await slots() === 'hand,rot,size,sample,erase,done', 'the dock says so too, and is still six slots');
  const spot = await freeSpot();
  await tapAt(spot.pt);
  assert((await st()).n === n0 + 1 && (await get(spot.key)).i === 'crate', 'and the next tap on the table places it');

  // A drawer takes the hotbar's place.
  await slot('hand');
  assert(await drawerId() === 'pieces' && !(await bar()).up, 'the library opens over it: the hotbar steps aside');
  assert((await shelf('Recent')).join() === 'Crate,Barrel', `what was used is under Recent (${await shelf('Recent')})`);
  await find('pine');
  await p.tap('.drawer .tile');
  await settle();
  b = await bar();
  const third = b.keys[2];
  assert(b.up && b.keys.length === 3 && b.keys.slice(0, 2).join() === 'p_barrel,p_crate' && b.on === third && b.favs === 2, `back with a new piece in hand: pins first, then what was used, each once (${b.keys})`);
  await fits('hotbar, pins and recents');
  await slot('hand');
  await closeDrawer();
  assert((await bar()).up, 'the library opened and closed again: the hotbar is back');
  // A mini in hand is marked like any piece.
  await slot('hand');
  await find('wolf');
  await p.tap('.drawer .tile');
  await settle();
  b = await bar();
  assert((await st()).tool === 'mini' && b.on === 'm_wolf' && b.keys.includes('m_wolf'), `a figure in hand is on the row too (${b.keys})`);
  // Erase is a brush without a picture: the row stays, with nothing marked.
  await slot('erase');
  b = await bar();
  assert((await st()).brush === 'erase' && b.up && b.on === '', 'with Erase in hand the row stays for getting back to a piece, nothing marked');
  await p.tap('#app .hotbar [data-key="p_barrel"]');
  await settle();
  assert((await st()).brush === 'barrel', 'one tap and the barrel is back in hand');

  // A full row: ten at most, scrolling; pieces this table does not have are skipped.
  await p.evaluate(() => {
    const { registry } = window.__ct;
    const blocks = ['grass', 'dirt', 'stone', 'sand', 'water', 'snow', 'wood', 'cobble'].filter((id) => registry.known.block(id)).map((id) => `b_${id}`);
    const props = ['tree', 'rock', 'bush', 'chair', 'table', 'campfire', 'bed', 'chest', 'torch', 'pine'].filter((id) => registry.known.prop(id)).map((id) => `p_${id}`);
    localStorage.setItem('cottontale:recent2', JSON.stringify(['p_nope:gone', ...blocks, ...props].slice(0, 12)));
    localStorage.setItem('cottontale:favs2', JSON.stringify(['p_barrel', 'm_gone:ghost', 'p_crate']));
    window.__ct.session.touch();
  });
  await settle(300);
  b = await bar();
  assert(b.keys.length === 10 && new Set(b.keys).size === 10 && b.keys.slice(0, 2).join() === 'p_barrel,p_crate' && !b.keys.some((k) => k.includes(':')), `a full hotbar holds ten, each once, without what the table does not have (${b.keys})`);
  assert(b.scrolls && b.on === 'p_barrel', 'it scrolls rather than grows');
  await fits('hotbar, full');
  const box = await p.evaluate(() => { const r = document.querySelector('#app .hotbar').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const tall = box[3] > box[2], before = await st();
  await dragTo(tall ? [box[0] + box[2] / 2, box[1] + box[3] - 30] : [box[0] + box[2] - 30, box[1] + box[3] / 2], tall ? [box[0] + box[2] / 2, box[1] + 20] : [box[0] + 20, box[1] + box[3] / 2], 12);
  await settle(300);
  s = await st(); b = await bar();
  assert(b.at > 0 && s.n === before.n && s.brush === 'barrel', `a finger along it scrolls it, and edits nothing (scrolled ${Math.round(b.at)})`);

  // ---- put down, and it is gone ----
  await slot('done');
  assert((await st()).tool === 'pick' && !(await bar()).up && await slots() === 'play,pieces,make,shape,erase,table', 'Done puts the brush down and the hotbar away');
  await fits('build, nothing in hand', BUDGET.swapped);
  await slot('play');
  assert(!(await bar()).up, 'and Play never has it');

  // ---- favourites are this device's: they survive a reload ----
  await p.evaluate(() => localStorage.setItem('cottontale:recent2', JSON.stringify(['p_chair', 'p_crate'])));
  await p.reload();
  await enter(p, 'Mo');
  await p.waitForFunction(() => [...window.__ct.store.keys('b:')].length > 400);
  await settle(300);
  await slot('build');
  assert(!(await bar()).up, 'after a reload: Build, nothing in hand, no hotbar');
  await slot('pieces');
  s = await st();
  assert(s.brush === 'chair' && s.tool === 'build' && await drawerId() === 'pieces' && !(await bar()).up, `Pieces has the last piece in hand at once and opens the library (${s.brush})`);
  assert((await shelf('Favourites')).join() === 'Barrel,Crate' && (await shelf('Recent')).join() === 'Chair,Crate', `the pins are still there, on their shelf above Recent (${await shelf('Favourites')} / ${await shelf('Recent')})`);
  await closeDrawer();
  b = await bar();
  assert(b.up && b.keys.join() === 'p_barrel,p_crate,p_chair' && b.on === 'p_chair', `and on the hotbar, ahead of what was used (${b.keys})`);
  await fits('hotbar, after a reload');
  await slot('done');
  await p.evaluate(() => window.__ct.session.endFight());
  await p.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all good');
done(failed ? 1 : 0);
