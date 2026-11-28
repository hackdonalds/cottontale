// End-to-end check of fog by the room and "See as players" in the redesigned chrome (`?ui=2`), on phone viewports.
//   npm run build && node scripts/e2e2-fog.mjs
// A companion of e2e2.mjs (same start-up, same touch helpers), kept apart so it can run by itself.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw, channel;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); channel = 'chrome'; }
const { chromium, devices } = pw;

const PORT = Number(process.env.E2E_PORT ?? 4410), RELAY = PORT + 1;
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

// The room of the starter scene (session.ts): x -4..0, z -4..-1, its walls on level 1, a doorway in its high-z side.
const ROOM = [];
for (let x = -4; x <= 0; x++) for (let z = -4; z <= -1; z++) ROOM.push(`f:${x},${z}`);
ROOM.sort();

for (const [label, viewport] of [['portrait', { width: 360, height: 640 }], ['landscape', { width: 640, height: 360 }]]) {
  console.log(`fog by the room, phone ${label} ${viewport.width}x${viewport.height}`);
  const p = await join('Mo', `fog-${label}-1234`, viewport);
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
  const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/fog-${label}-${name}.png` }); };
  /**
   * Points of the screen a finger can reach (clear of the chrome) that land on the floor of a cell: those of the room when
   * `inside`, else bare table beyond the scene. Each with the column it is in.
   */
  const spots = (inside) => p.evaluate(([inside, w, h]) => {
    const { board } = window.__ct, c = document.querySelector('#c'), out = [];
    const chrome = [...document.querySelectorAll('#app .dock, #app .undo:not([hidden]), #app .notice')].map((e) => e.getBoundingClientRect());
    const cells = [];
    if (inside) { for (let x = -4; x <= 0; x++) for (let z = -1; z >= -4; z--) cells.push([x, 1, z]); }
    else for (let d = 11; d <= 24; d++) for (let i = -8; i <= 8; i++) cells.push([d, 0, i], [i, 0, d], [-d - 1, 0, i], [i, 0, -d - 1]);
    for (const [x, y, z] of cells) {
      const s = board.ground.position.clone().set(x + 0.5, y, z + 0.5).project(board.camera);
      const pt = [((s.x + 1) / 2) * c.clientWidth, ((1 - s.y) / 2) * c.clientHeight];
      if (pt[0] < 12 || pt[0] > w - 12 || pt[1] < 12 || pt[1] > h - 12) continue;
      if (chrome.some((r) => pt[0] > r.left - 8 && pt[0] < r.right + 8 && pt[1] > r.top - 8 && pt[1] < r.bottom + 8)) continue;
      board.aim({ clientX: pt[0], clientY: pt[1] });
      const hit = board.pickSurface();
      if (hit?.place.join() === `${x},${y},${z}` && (inside || !hit.cell)) out.push({ pt, col: `f:${x},${z}` });
    }
    return out;
  }, [inside, viewport.width, viewport.height]);
  const fog = () => p.evaluate(() => [...window.__ct.store.keys('f:')].filter((k) => window.__ct.store.get(k) === true).sort());
  const steps = () => p.evaluate(() => window.__ct.board.undoStack.filter((g) => g.length).length);
  const said = () => p.evaluate(() => document.querySelector('#app .notice')?.textContent ?? '');
  /** Nothing overlaps or leaves the screen, every target is big enough, no label is cut off, and the dock holds at most six. */
  const layout = () => p.evaluate(() => {
    const bad = [];
    const boxes = [...document.querySelectorAll('#app .dock, #app .undo:not([hidden]), #app .drawer:not([hidden])')].map((e) => ({ id: e.className, r: e.getBoundingClientRect() }));
    let covered = 0;
    for (const a of boxes) {
      covered += a.r.width * a.r.height;
      if (a.r.left < 0 || a.r.top < 0 || a.r.right > innerWidth + 0.5 || a.r.bottom > innerHeight + 0.5) bad.push(`${a.id} off-screen`);
      for (const b of boxes) if (a.id < b.id && a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) bad.push(`${a.id} overlaps ${b.id}`);
    }
    const n = document.querySelectorAll('#app .dock .slot').length;
    if (n > 6) bad.push(`${n} slots in the dock`);
    for (const b of document.querySelectorAll('#app button')) {
      const r = b.getBoundingClientRect();
      if (b.offsetParent && (r.width < 43.5 || r.height < 43.5)) bad.push(`small target ${b.dataset.slot || b.title} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const s of document.querySelectorAll('#app .dock .slot span')) if (s.scrollWidth > s.clientWidth + 1 || s.textContent.length > 10) bad.push(`label cut off: ${s.textContent}`);
    if (document.documentElement.scrollWidth > innerWidth) bad.push('the page scrolls sideways');
    const table = 1 - covered / (innerWidth * innerHeight);
    if (table < 0.8) bad.push(`the table keeps ${(table * 100).toFixed(1)}% of the screen, under 80%`);
    return bad;
  });
  const fits = async (what) => { const bad = await layout(); assert(!bad.length, `${what}: layout holds${bad.length ? ` — ${bad.join('; ')}` : ''}`); await shot(what.replace(/\W+/g, '-')); };

  // A scene with a walled room in it, a GM (fog is the GM's), and something the players must not see.
  await p.evaluate(() => { const { session, store } = window.__ct; session.starterScene(); session.setGM(true); store.set('m:start-wolf', { ...store.get('m:start-wolf'), h: true }); });
  await p.waitForFunction(() => window.__ct.session.amGM() && [...window.__ct.store.keys('m:')].length === 3);
  await settle(600);

  // ---- the fog tool brings its own dock ----
  await slot('tools');
  await p.tap('.drawer button:has-text("Fog")');
  await settle();
  assert(await p.evaluate(() => window.__ct.board.tool === 'fog') && await slots() === 'fogHide,fogShow,revealAll,asPlayers,done', `fog brings its own dock, with As players in it (${await slots()})`);
  assert(/room/i.test(await said()), `and a line says a tap takes a room (${await said()})`);
  await fits('fog tool');

  // ---- a tap hides the whole room, as one step ----
  const room = await spots(true);
  assert(room.length >= 2, `the floor of the room can be reached by a finger (${room.length} cells)`);
  const before = await steps();
  await tapAt(room[0].pt);
  let f = await fog();
  assert(f.join() === ROOM.join(), `a tap in the room hides the room, all of it and no more (${f.length} columns)`);
  assert(await steps() === before + 1, 'as one step of undo');
  assert(/Room hidden — 20 cells/.test(await said()), `and a line says what happened (${await said()})`);
  await fits('fog, a room hidden');
  await tapAt(room[1].pt);
  assert((await fog()).length === 20 && await steps() === before + 1 && /Already/.test(await said()), `tapping it again changes nothing (${await said()})`);
  await p.tap('#app .undo [data-u="undo"]');
  await settle();
  assert((await fog()).length === 0, 'Undo reveals the room again');
  await p.tap('#app .undo [data-u="redo"]');
  await settle();
  assert((await fog()).join() === ROOM.join(), 'and Redo hides it');
  await settle(3600);
  assert(await p.evaluate(() => !document.querySelector('#app .undo').hidden), 'Undo stays in reach for as long as the fog is out');

  // ---- Reveal works the same way round ----
  await slot('fogShow');
  await tapAt(room[1].pt);
  assert((await fog()).length === 0 && /Room revealed — 20 cells/.test(await said()), `with Reveal, a tap uncovers the room (${await said()})`);
  await slot('fogHide');

  // ---- the brush is still there: a drag paints columns ----
  const [from, to] = [room[0], room.find((r) => r.col !== room[0].col && Math.hypot(r.pt[0] - room[0].pt[0], r.pt[1] - room[0].pt[1]) > 24) ?? room[room.length - 1]];
  const strokes = await steps();
  await dragTo(from.pt, to.pt);
  f = await fog();
  assert(f.length >= 1 && f.length < 20 && f.includes(to.col) && await steps() === strokes + 1, `a drag paints columns, not the room (${f.length} columns, one step)`);
  // A second finger is the camera: it never edits.
  await touch('touchStart', [room[0].pt]);
  await touch('touchStart', [room[0].pt, [room[0].pt[0] + 60, room[0].pt[1] + 40]]);
  await touch('touchEnd', []);
  await settle();
  assert((await fog()).join() === f.join(), 'a second finger on the table hides nothing');
  await slot('revealAll');
  assert((await fog()).length === 0, 'Reveal all clears it');

  // ---- open ground has no room: a tap is one column, as it always was ----
  let open = await spots(false);
  if (!open.length) { await p.evaluate(() => window.__ct.board.lookAt(13, 0, 6)); await settle(900); open = await spots(false); }
  assert(open.length >= 1, 'bare table beyond the scene can be reached');
  await tapAt(open[0].pt);
  assert((await fog()).join() === open[0].col && /Open ground/.test(await said()), `a tap on open ground hides one column (${(await fog()).join(' ')}: ${await said()})`);
  await slot('revealAll');
  if (!(await spots(true)).length) { await p.evaluate(() => window.__ct.board.lookAt(-2, 0, -2)); await settle(900); }
  const inside = (await spots(true))[0];
  assert(!!inside, 'the room is in reach again');
  await tapAt(inside.pt);
  assert((await fog()).join() === ROOM.join(), 'the room is hidden again');

  // ---- See as players: only a view ----
  const view = () => p.evaluate(() => {
    const { board, session } = window.__ct;
    return {
      on: board.previewing, said: session.seeingAsPlayers(), wolf: board.minis.get('start-wolf').group.visible, knight: board.minis.get('start-knight').group.visible,
      floor: board.cellHidden(-2, 0, -2), solid: board.fog ? !board.fog.material.transparent : null,
      off: [...document.querySelectorAll('#app .dock .slot[aria-disabled="true"]')].map((b) => b.dataset.slot).join(), lit: document.querySelector('#app .dock [data-slot="asPlayers"]').getAttribute('aria-pressed'),
    };
  });
  const rows = () => p.evaluate(() => JSON.stringify([...window.__ct.store.keys('')].filter((k) => /^(f|m|b|w|gm|set):/.test(k)).sort().map((k) => [k, window.__ct.store.get(k)])));
  let v = await view();
  assert(!v.on && v.wolf && !v.floor && v.solid === false && v.off === '', `the GM sees through the fog, and the hidden wolf as a ghost ${JSON.stringify(v)}`);
  const shared = await rows(), stepsBefore = await steps();
  await slot('asPlayers');
  await settle(300);
  v = await view();
  assert(v.on && v.said && v.lit === 'true', 'As players is on, and its slot is lit');
  assert(!v.wolf && v.knight && v.floor && v.solid === true, `the table is drawn as the players have it: fog solid, the room gone, the hidden wolf gone ${JSON.stringify(v)}`);
  assert(v.off === 'fogHide,fogShow,revealAll' && await p.evaluate(() => document.querySelector('#app .undo').hidden) && await slots() === 'fogHide,fogShow,revealAll,asPlayers,done', `the brushes wait in their places, and Undo is put away (${v.off})`);
  await fits('fog, as players');
  await tapAt(inside.pt);
  await dragTo(from.pt, to.pt);
  await p.tap('#app .dock [data-slot="revealAll"]', { force: true });
  await settle();
  assert(await rows() === shared && await steps() === stepsBefore, 'nothing shared changed, and nothing can be edited while looking');
  await slot('asPlayers');
  await settle(300);
  v = await view();
  assert(!v.on && v.wolf && !v.floor && v.solid === false && v.off === '' && v.lit === null, `tapping it again gives the GM's view back ${JSON.stringify(v)}`);
  await slot('asPlayers');
  await slot('done');
  await settle(300);
  v = await p.evaluate(() => ({ on: window.__ct.board.previewing, tool: window.__ct.board.tool, wolf: window.__ct.board.minis.get('start-wolf').group.visible }));
  assert(!v.on && v.tool === 'move' && v.wolf && await slots() === 'build,fight,dice,quick,tools,table', `putting the tool away ends it (${JSON.stringify(v)})`);
  assert(await rows() === shared, 'and the table is as it was');
  await p.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all good');
done(failed ? 1 : 0);
