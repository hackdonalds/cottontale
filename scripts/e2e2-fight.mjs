// End-to-end check of rearranging the turn order by hand in the Fight drawer of the new
// chrome (`?ui=2`), on phone viewports: by dragging a row's grip, and by tapping it.
//   npm run build && node scripts/e2e2-fight.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw, channel;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); channel = 'chrome'; }
const { chromium, devices } = pw;

const PORT = Number(process.env.E2E_PORT ?? 4400), RELAY = PORT + 1;
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
  await page.fill('#name', name);
  await page.tap('#join');
  await page.waitForSelector('#app .dock .slot');
  return page;
}

for (const [label, viewport] of [['portrait', { width: 360, height: 640 }], ['landscape', { width: 640, height: 360 }]]) {
  console.log(`fight order, phone ${label} ${viewport.width}x${viewport.height}`);
  const p = await join('Mo', `v2-fight-${label}-1234`, viewport);
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const settle = (ms = 150) => p.waitForTimeout(ms * SLOW);
  /** A finger down at `a`, moved to `b` in steps; `mid` runs while it is still down. */
  const dragTo = async ([x0, y0], [x1, y1], mid, steps = 12) => {
    await touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]); await p.waitForTimeout(16); }
    const seen = mid ? await mid() : undefined;
    await touch('touchEnd', []);
    await settle();
    return seen;
  };
  const slot = async (id) => { await p.tap(`#app .dock [data-slot="${id}"]`); await settle(); };
  const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/fight-${label}-${name}.png` }); };
  /** The turn order as the table has it, and as the drawer shows it. */
  const order = () => p.evaluate(() => ({
    table: window.__ct.session.fight().order.map((o) => o.id).join(),
    shown: [...document.querySelectorAll('.drawer .fighter:not(.out)')].map((r) => r.dataset.id).join(),
  }));
  const minis = () => p.evaluate(() => JSON.stringify([...window.__ct.store.keys('m:')].sort().map((k) => [k, window.__ct.store.get(k)])));
  /** The middle of row `i`'s grip (or of another part of the row), on screen. */
  const mid = (i, sel = '.grip') => p.evaluate(([i, sel]) => { const r = document.querySelectorAll('.drawer .fighter:not(.out)')[i].querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, [i, sel]);
  const scrollTop = () => p.evaluate(() => document.querySelector('.drawer .body').scrollTop);
  /** Scroll the list so the first rows sit clear of both edges, where a drag would creep it along. */
  const park = () => p.evaluate(() => { const b = document.querySelector('.drawer .body'), r = document.querySelector('.drawer .fighter:not(.out)'); b.scrollTop += r.getBoundingClientRect().top - b.getBoundingClientRect().top - 36; return b.scrollTop; });
  /** What must hold of the drawer on a phone: nothing sticks out sideways, targets are big enough, inputs do not make iOS zoom. */
  const layout = () => p.evaluate(() => {
    const bad = [], d = document.querySelector('#app .drawer'), body = d.querySelector('.body');
    const dr = d.getBoundingClientRect();
    if (dr.left < 0 || dr.right > innerWidth + 0.5 || dr.top < 0 || dr.bottom > innerHeight + 0.5) bad.push('the drawer leaves the screen');
    if (body.scrollWidth > body.clientWidth + 1) bad.push(`the list scrolls sideways (${body.scrollWidth} in ${body.clientWidth})`);
    if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) bad.push('the page scrolls sideways');
    for (const b of d.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (b.offsetParent && (r.width < 43.5 || r.height < 43.5)) bad.push(`small target ${b.title || b.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const b of d.querySelectorAll('button, input')) { const r = b.getBoundingClientRect(); if (r.width && (r.right > dr.right + 0.5 || r.left < dr.left - 0.5)) bad.push(`${b.title || b.textContent || b.ariaLabel} sticks out sideways`); }
    for (const i of d.querySelectorAll('input')) if (i.offsetParent && parseFloat(getComputedStyle(i).fontSize) < 16) bad.push(`input ${i.ariaLabel} under 16px`);
    for (const w of d.querySelectorAll('.fighter .who')) if (w.getBoundingClientRect().width < 60) bad.push('no room left for a name');
    return bad;
  });
  const fits = async (what) => { const bad = await layout(); assert(!bad.length, `${what}: layout holds${bad.length ? ` — ${bad.join('; ')}` : ''}`); await shot(what.replace(/\W+/g, '-')); };

  // The starter scene has three figures; four more make the list longer than the drawer. Figures
  // are modelled pieces that load a moment after the table.
  await p.evaluate(() => {
    const { session, board } = window.__ct;
    session.starterScene();
    board.commit([0, 1, 2, 3].map((i) => [`m:extra-${i}`, { x: 6 + i, y: 1, z: 7, k: 'knight', c: '#30a46c', n: `Guard ${i + 1}`, r: 0, s: 1 }]));
  });
  await settle(1500);
  await slot('fight');
  assert(await p.evaluate(() => !document.querySelector('.drawer .grip')), 'before the fight there is nothing to rearrange: no grips');
  await p.tap('.drawer button:has-text("Start")');
  await settle(300);
  const start = await order();
  assert(start.table.split(',').length === 7 && start.shown === start.table, `Start puts all seven in the fight, listed in turn order (${start.shown})`);
  const grips = await p.evaluate(() => [...document.querySelectorAll('.drawer .fighter .grip')].map((g) => { const r = g.getBoundingClientRect(); return { w: r.width, h: r.height, ta: getComputedStyle(g).touchAction, tag: g.tagName, label: g.getAttribute('aria-label') }; }));
  assert(grips.length === 7 && grips.every((g) => g.tag === 'BUTTON' && g.w >= 44 && g.h >= 44 && g.ta === 'none' && g.label), `every row in the fight has a grip: a real button, ${Math.round(grips[0]?.w)}x${Math.round(grips[0]?.h)}, that does not scroll the list`);
  await fits('fight, with grips');

  // ---- a finger anywhere else still scrolls the list ----
  assert(await p.evaluate(() => { const b = document.querySelector('.drawer .body'); return b.scrollHeight > b.clientHeight + 40; }), 'seven fighters are more than the drawer shows at once');
  await p.evaluate(() => { document.querySelector('.drawer .body').scrollTop = 0; });
  const lastVisible = await p.evaluate(() => { const b = document.querySelector('.drawer .body').getBoundingClientRect(); const rows = [...document.querySelectorAll('.drawer .fighter:not(.out)')]; return rows.findLastIndex((r) => { const q = r.getBoundingClientRect(); return q.top > b.top + 50 && q.bottom < b.bottom - 4; }); });
  const name = await mid(Math.max(lastVisible, 0), '.who');
  await dragTo(name, [name[0], name[1] - 70]);
  await settle(400);
  assert(await scrollTop() > 20, `one finger on a name scrolls the list (${Math.round(await scrollTop())}px)`);
  assert((await order()).table === start.table, 'and scrolling rearranges nothing');

  // ---- drag: the second row above the first ----
  const before = await minis();
  const ids = start.table.split(',');
  let top = await park();
  const seen = await dragTo(await mid(1), (await mid(0)).map((v, i) => v - (i ? 6 : 0)), async () => {
    // A change from elsewhere redraws the drawer while the finger is down: the row must stay in hand.
    await p.evaluate(() => { const { store, ui } = window.__ct; store.set('m:extra-3', { ...store.get('m:extra-3') }); ui.drawer.redraw(); });
    await p.waitForTimeout(60);
    return p.evaluate(() => ({ dragging: document.querySelector('.drawer .fighter.dragging')?.dataset.id, table: window.__ct.session.fight().order.map((o) => o.id).join() }));
  });
  assert(seen.dragging === ids[1] && seen.table === start.table, 'while the finger is down the row floats, a redraw from elsewhere does not drop it, and nothing is written yet');
  const want1 = [ids[1], ids[0], ...ids.slice(2)].join();
  let now = await order();
  assert(now.table === want1 && now.shown === want1, `dragging the second row above the first swaps them (${now.table})`);
  assert(Math.abs(await scrollTop() - top) < 1, 'and the drag did not scroll the list');
  assert(await p.evaluate(() => !document.querySelector('.drawer .dragging, .drawer .sorting') && ![...document.querySelectorAll('.drawer .fighter')].some((r) => r.style.transform)), 'let go, every row is back in line');
  assert(await p.evaluate(() => !document.querySelector('.drawer .grip.on')), 'a drag is not a tap: Move up / Move down did not open');
  await fits('fight, after a drag');
  await p.tap('#app .undo [data-u="undo"]');
  await settle();
  now = await order();
  assert(now.table === start.table && now.shown === start.table, 'Undo puts the order back in one step');
  assert(await minis() === before, 'and every figure is exactly as it was');

  // ---- drag down: the first row to third place ----
  top = await park();
  await dragTo(await mid(0), (await mid(2)).map((v, i) => v + (i ? 8 : 0)));
  const want2 = [ids[1], ids[2], ids[0], ...ids.slice(3)].join();
  now = await order();
  assert(now.table === want2 && now.shown === want2, `dragging the first row below the third puts it third (${now.table})`);
  const inis = await p.evaluate(() => window.__ct.session.fight().order.map((o) => o.v.ini));
  assert(inis.every((n, i) => Number.isInteger(n) && (!i || inis[i - 1] >= n)), `initiative still reads highest first (${inis.join()})`);
  await p.tap('#app .undo [data-u="undo"]');
  await settle();
  assert((await order()).table === start.table, 'one Undo takes that back too');

  // ---- a drag that comes back changes nothing ----
  const g1 = await mid(1);
  await dragTo(g1, [g1[0], g1[1] + 30], async () => { for (let i = 9; i >= 0; i--) { await touch('touchMove', [[g1[0], g1[1] + i * 3]]); await p.waitForTimeout(30); } });
  assert((await order()).table === start.table && await minis() === before, 'a row dragged out and brought back is left where it was, and nothing is written');

  // ---- the tap path: the grip opens Move up / Move down in the row ----
  await p.evaluate(() => { document.querySelector('.drawer .body').scrollTop = 0; });
  await p.tap('.drawer .fighter:not(.out) >> nth=2 >> .grip');
  await settle();
  const armed = await p.evaluate(() => { const r = document.querySelector('.drawer .fighter:has(.grip.on)'); return r && { id: r.dataset.id, steps: [...r.querySelectorAll('.step')].map((b) => b.title).join(), n: document.querySelectorAll('.drawer .grip.on').length, rows: document.querySelectorAll('.drawer .fighter').length }; });
  assert(armed && armed.id === ids[2] && armed.steps === 'Move up,Move down' && armed.n === 1 && armed.rows === 7, 'a tap on a grip swaps that row to Move up and Move down, without adding a row');
  await fits('fight, a row being moved');
  await p.tap('.drawer .fighter .step[title="Move up"]');
  await settle();
  now = await order();
  const want3 = [ids[0], ids[2], ids[1], ...ids.slice(3)].join();
  assert(now.table === want3 && now.shown === want3, `Move up takes it one place up (${now.table})`);
  await p.tap('.drawer .fighter .step[title="Move up"]');
  await settle();
  now = await order();
  const want4 = [ids[2], ids[0], ids[1], ...ids.slice(3)].join();
  assert(now.table === want4 && await p.evaluate(() => { const r = document.querySelector('.drawer .fighter:has(.grip.on)'); return r === document.querySelector('.drawer .fighter') && r.querySelector('.step[title="Move up"]').disabled && !r.querySelector('.step[title="Move down"]').disabled; }), 'again, and it is first: the row stays open, and Move up has nowhere to go');
  await p.tap('.drawer .fighter .step[title="Move down"]');
  await settle();
  assert((await order()).table === want3, 'Move down takes it back down one');
  await p.tap('#app .undo [data-u="undo"]');
  await settle();
  assert((await order()).table === want4, 'each tap is one step of Undo');
  await p.tap('.drawer .fighter .grip.on');
  await settle();
  assert(await p.evaluate(() => !document.querySelector('.drawer .grip.on, .drawer .step') && document.querySelectorAll('.drawer .fighter .ini').length === 7), 'a second tap on the grip closes it: the number and the eye are back');

  // ---- typing a number still wins, and the turn stays with whoever has it ----
  const cur = await p.evaluate(() => window.__ct.session.fight().current?.id);
  await p.tap('.drawer .fighter:not(.out) >> nth=1 >> .grip');
  await settle();
  await p.tap('.drawer .fighter .step[title="Move down"]');
  await settle();
  assert(await p.evaluate(() => window.__ct.session.fight().current?.id) === cur, 'rearranging does not pass the turn');
  await p.tap('.drawer .fighter .grip.on');
  await settle();
  const last = (await order()).table.split(',')[6];
  await p.fill('.drawer .fighter:not(.out) >> nth=6 >> .ini', '500');
  await p.evaluate(() => document.activeElement.blur());
  await settle();
  now = await order();
  assert(now.table.split(',')[0] === last && now.shown === now.table, `a typed initiative still puts a figure where its number says (${now.table})`);

  await p.evaluate(() => window.__ct.session.endFight());
  await settle();
  assert(await p.evaluate(() => !document.querySelector('.drawer .grip') && [...window.__ct.store.keys('m:')].every((k) => window.__ct.store.get(k).io === undefined && window.__ct.store.get(k).ini === undefined)), 'End fight clears the order, the hand-made part too');
  await p.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all good');
done(failed ? 1 : 0);
