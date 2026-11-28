// End-to-end check of the redesigned chrome (`?ui=2`, src/app.ts), on phone viewports.
//   npm run build && node scripts/e2e2.mjs
// It grows with the redesign and takes the place of the phone section of e2e.mjs when the
// new chrome takes over. Every state the dock can be in goes through `layout()`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw, channel;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); channel = 'chrome'; }
const { chromium, devices } = pw;

const PORT = Number(process.env.E2E_PORT ?? 4198), RELAY = PORT + 1;
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

// The screen budget (CLAUDE.md, "Screen real estate drives the design"): how much of the smallest phone the table keeps.
const BUDGET = { rest: 0.85, swapped: 0.8 };

for (const [label, viewport] of [['portrait', { width: 360, height: 640 }], ['landscape', { width: 640, height: 360 }]]) {
  console.log(`new chrome, phone ${label} ${viewport.width}x${viewport.height}`);
  const p = await join('Mo', `v2-${label}-1234`, viewport);
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
    const boxes = [...document.querySelectorAll('#app .dock, #app .undo:not([hidden])')].map((e) => ({ id: e.className, r: e.getBoundingClientRect() }));
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
    for (const s of document.querySelectorAll('#app .dock .slot span')) if (s.scrollWidth > s.clientWidth + 1) bad.push(`label cut off: ${s.textContent}`);
    for (const i of document.querySelectorAll('input, textarea')) if (i.offsetParent && parseFloat(getComputedStyle(i).fontSize) < 16) bad.push(`input ${i.id} under 16px`);
    if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) bad.push('the page scrolls sideways');
    const table = 1 - covered / (innerWidth * innerHeight);
    if (table < share) bad.push(`the table keeps ${(table * 100).toFixed(1)}% of the screen, under ${share * 100}%`);
    return bad;
  }, share);
  const fits = async (what, share = BUDGET.swapped) => { const bad = await layout(share); assert(!bad.length, `${what}: layout holds${bad.length ? ` — ${bad.join('; ')}` : ''}`); await shot(what.replace(/\W+/g, '-')); };

  assert(await p.evaluate(() => !document.querySelector('#hud') && document.querySelector('#lobby').hidden), 'the old chrome is gone and the table is up');
  assert(await slots() === 'build,fight,dice,quick,tools,table', `a GM in Play sees six slots (${await slots()})`);
  const rail = await p.evaluate(() => { const r = document.querySelector('#app .dock').getBoundingClientRect(); return r.height > r.width; });
  assert(rail === (label === 'landscape'), label === 'landscape' ? 'held sideways, the dock is a rail on the side' : 'held upright, the dock is one row along the bottom');
  assert(!(await st()).undo, 'no Undo pair while there is nothing to undo');
  await fits('play, nothing selected', BUDGET.rest);

  // Something to work on: the starter scene, as one step.
  await p.evaluate(() => window.__ct.session.starterScene());
  await settle(400);
  const scene = await st();
  assert(scene.n > 400 && scene.minis === 3, `a starter scene is on the table (${scene.n} pieces, ${scene.minis} minis)`);

  // ---- Play: carrying a mini shows how far, and can be taken back ----
  const knight = await get('m:start-knight');
  // The figures are modelled pieces that arrive a moment after the table: wait until a finger could find one.
  await p.waitForFunction(() => {
    const { board, store } = window.__ct, c = document.querySelector('#c'), v = store.get('m:start-knight');
    const s = board.ground.position.clone().set(v.x + 0.5, v.y + 0.4, v.z + 0.5).project(board.camera);
    board.aim({ clientX: ((s.x + 1) / 2) * c.clientWidth, clientY: ((1 - s.y) / 2) * c.clientHeight });
    return board.pickMini() === 'start-knight';
  });
  const from = await at(knight.x + 0.5, knight.y + 0.4, knight.z + 0.5), to = await at(knight.x + 3.5, knight.y, knight.z + 2.5);
  await touch('touchStart', [from]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[from[0] + ((to[0] - from[0]) * i) / 10, from[1] + ((to[1] - from[1]) * i) / 10 + 44]]); await p.waitForTimeout(16); }
  assert(await p.evaluate(() => window.__ct.board.rulers.has('drag')), 'a carried mini shows its distance while it is in the air');
  await touch('touchEnd', []);
  await settle(300);
  const moved = await get('m:start-knight'), after = await st();
  assert((moved.x !== knight.x || moved.z !== knight.z) && !(await p.evaluate(() => window.__ct.board.rulers.has('drag'))), `it lands where it was put, and the distance goes (${knight.x},${knight.z} to ${moved.x},${moved.z})`);
  assert(after.undo && after.selected === 'start-knight', 'in Play the Undo pair appears after a move, and the mini is selected');
  await p.tap('#app .undo [data-u="undo"]'); // (at once: in Play the pair only stays a few seconds)
  await settle();
  const back = await get('m:start-knight');
  assert(back.x === knight.x && back.z === knight.z, 'Undo puts the mini back');
  assert(await slots() === 'hp,conditions,hide,more,done', `the selected mini decides the dock (${await slots()})`);
  await fits('play, mini selected');
  await slot('done');
  assert((await st()).selected === null && await slots() === 'build,fight,dice,quick,tools,table', 'Done lets go of it');

  // ---- Build: select first ----
  await slot('build');
  assert(await slots() === 'play,pieces,make,shape,erase,table' && (await st()).tool === 'pick', `Build opens with nothing in hand (${await slots()})`);
  await fits('build, nothing selected', BUDGET.rest);

  await tapAt(await at(2.5, 1.15, 1.5)); // the campfire
  let s = await st();
  assert(s.picked.join() === 'b:2,1,1' && s.box, `a tap selects the piece under the finger (${s.picked})`);
  assert(await slots() === 'move,turn,copy,remove,more,done', `and the dock becomes what can be done to it (${await slots()})`);
  await fits('build, piece selected');

  // One finger away from the selection is the camera: nothing on the table changes.
  const cam = () => p.evaluate(() => window.__ct.board.camera.position.toArray().map((v) => +v.toFixed(2)).join());
  const cam0 = await cam();
  await dragTo([viewport.width * 0.25, viewport.height * 0.2], [viewport.width * 0.45, viewport.height * 0.3]);
  s = await st();
  assert(await cam() !== cam0 && s.n === scene.n && s.picked.join() === 'b:2,1,1', 'one finger on empty ground moves the camera and edits nothing');

  // Two fingers never edit, even starting on the selection.
  const fire = await at(2.5, 1.15, 1.5);
  await touch('touchStart', [fire]);
  await touch('touchStart', [fire, [fire[0] + 90, fire[1]]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[fire[0] - i * 6, fire[1]], [fire[0] + 90 + i * 6, fire[1]]]);
  await touch('touchEnd', [[fire[0] + 126, fire[1]]]);
  await touch('touchEnd', []);
  await settle();
  assert((await get('b:2,1,1'))?.i === 'campfire' && (await st()).n === scene.n, 'a second finger never moves the selection');

  await slot('copy');
  s = await st();
  assert(s.n === scene.n + 1 && s.picked.length === 1 && s.picked[0] !== 'b:2,1,1' && (await get(s.picked[0])).i === 'campfire', `Duplicate puts a copy beside it and selects the copy (${s.picked})`);
  assert(s.undo, 'in Build the Undo pair is there');
  await fits('build, after duplicate');
  await p.tap('#app .undo [data-u="undo"]');
  await settle();
  assert((await st()).n === scene.n, 'Undo takes the copy away');
  await p.tap('#app .undo [data-u="redo"]');
  await settle();
  assert((await st()).n === scene.n + 1, 'Redo brings it back');
  await p.tap('#app .undo [data-u="undo"]');
  await settle();

  // A chair has a facing.
  await tapAt(await at(0.5, 1.4, -1.5));
  s = await st();
  if (s.picked.join() === 'b:0,1,-2') {
    await slot('turn');
    assert((await get('b:0,1,-2')).r === 2, 'Turn turns the selected prop a quarter');
    await p.tap('#app .undo [data-u="undo"]');
    await settle();
  } else assert(true, `(the chair is behind something from here: ${s.picked})`);

  // Dragging the selection carries it.
  await tapAt(await at(2.5, 1.15, 1.5));
  assert((await st()).picked.join() === 'b:2,1,1', 'the campfire is selected again');
  const there = await freeSpot(['b:2,1,1']);
  await dragTo(await at(2.5, 1.15, 1.5), [there.pt[0], there.pt[1] + 44], 14); // (what is carried floats above the fingertip)
  s = await st();
  assert(s.picked.join() === there.key && (await get('b:2,1,1')) === null && (await get(there.key)).i === 'campfire' && s.n === scene.n, `a finger on the selection carries it somewhere else (to ${s.picked}, aimed at ${there.key})`);
  const carried = s.picked[0];

  // Move, then a tap: the same thing for a finger that would rather not drag.
  await slot('move');
  assert(await p.evaluate(() => window.__ct.board.placing && document.querySelector('[data-slot="move"]').classList.contains('on')), 'Move lights up and waits for a touch');
  const next = await freeSpot([carried]);
  await tapAt(next.pt);
  s = await st();
  assert(s.picked.join() === next.key && (await get(next.key)).i === 'campfire' && (await get(carried)) === null && !(await p.evaluate(() => window.__ct.board.placing)), `a tap says where it goes (${s.picked})`);

  await slot('remove');
  s = await st();
  assert(s.n === scene.n - 1 && !s.picked.length && await slots() === 'play,pieces,make,shape,erase,table', 'Delete removes it without asking, and the dock goes back');
  await p.tap('#app .undo [data-u="undo"]');
  await settle();
  assert((await st()).n === scene.n, 'because Undo brings it back');

  // A mini is finished where it is placed: the same tools, in Build.
  await tapAt(await miniPt('start-wolf'));
  assert((await st()).selected === 'start-wolf' && await slots() === 'move,turn,copy,remove,more,done', `a mini selected in Build gets the same dock (${await slots()})`);
  await slot('copy');
  s = await st();
  assert(s.minis === 4 && s.selected !== 'start-wolf' && (await get(`m:${s.selected}`)).k === 'wolf', 'Duplicate makes another wolf and selects it');
  await slot('remove');
  assert((await st()).minis === 3 && (await st()).selected === null, 'and Delete takes it off again');

  // ---- Build: a brush in hand until Done ----
  await slot('pieces');
  s = await st();
  assert(s.tool === 'build' && await slots() === 'hand,rot,size,sample,erase,done', `Pieces puts the last piece back in hand (${s.brush}; ${await slots()})`);
  await fits('build, brush in hand');
  const hand = () => p.evaluate(() => document.querySelector('[data-slot="hand"] span').textContent);
  await slot('sample');
  await tapAt(await at(3.5, 1.4, 0.5)); // the crate by the fire
  s = await st();
  assert(s.brush === 'crate' && await hand() === 'Crate' && s.n === scene.n, `Pick takes a piece from the scene as the brush (${s.brush})`);
  const before = s.n;
  await tapAt((await freeSpot()).pt);
  assert((await st()).n === before + 1, 'a tap places one');
  await touch('touchStart', [[viewport.width * 0.3, viewport.height * 0.3]]);
  await touch('touchStart', [[viewport.width * 0.3, viewport.height * 0.3], [viewport.width * 0.6, viewport.height * 0.3]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[viewport.width * 0.3 - i * 5, viewport.height * 0.3], [viewport.width * 0.6 + i * 5, viewport.height * 0.3]]);
  await touch('touchEnd', [[viewport.width * 0.6 + 30, viewport.height * 0.3]]);
  await touch('touchEnd', []);
  await settle();
  assert((await st()).n === before + 1, 'two fingers with a brush in hand are still the camera');
  await slot('erase');
  assert((await st()).brush === 'erase' && await p.evaluate(() => document.querySelector('[data-slot="erase"]').classList.contains('on')), 'Erase is a brush too, and shows it is on');
  await slot('erase');
  assert((await st()).brush === 'crate', 'tapping it again picks the last brush back up');
  await slot('done');
  assert((await st()).tool === 'pick' && await slots() === 'play,pieces,make,shape,erase,table', 'Done puts the brush down');

  // Back to Play: the selection and the camera come along.
  await tapAt(await miniPt('start-wolf'));
  const camB = await cam();
  await p.evaluate(() => window.__ct.session.setMode('play'));
  await settle();
  assert((await st()).selected === 'start-wolf' && await cam() === camB && await slots() === 'hp,conditions,hide,more,done', 'going to Play keeps the selection and the camera');
  await slot('done');

  // ---- a player: fewer slots, and no building ----
  if (label === 'portrait') {
    await p.evaluate(() => window.__ct.session.setGM(true));
    const q = await join('Pip', `v2-${label}-1234`, viewport);
    await q.waitForFunction(() => !window.__ct.session.full() && [...window.__ct.store.keys('m:')].length === 3);
    await q.waitForTimeout(200 * SLOW);
    const qs = await q.evaluate(() => [...document.querySelectorAll('#app .dock .slot')].map((b) => b.dataset.slot).join());
    assert(qs === 'dice,ruler,chat,table', `a player's dock is shorter and has no Build (${qs})`);
    assert(await q.evaluate(() => { window.__ct.session.setMode('build'); return window.__ct.board.tool; }) === 'move', 'and Build is not theirs to enter');
    await q.close();
  }
  await p.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all good');
done(failed ? 1 : 0);
