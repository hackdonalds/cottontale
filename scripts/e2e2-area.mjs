// End-to-end check of selecting an area in Build (the redesigned chrome, `?ui=2`), on phone viewports.
//   npm run build && node scripts/e2e2-area.mjs
// Arm it from Make (or More), drag a rectangle with one finger, and everything standing in it is
// selected: Move, Turn, Duplicate and Delete then work on all of it, each as one step of undo.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw, channel;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); channel = 'chrome'; }
const { chromium, devices } = pw;

const PORT = Number(process.env.E2E_PORT ?? 4430), RELAY = PORT + 1;
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

// The area the checks work on: the campfire (b:2,1,1) and the crate (b:3,1,0) of the starter scene, and whatever else stands there.
const X0 = 2, X1 = 3, Z0 = 0, Z1 = 1;

for (const [label, viewport] of [['portrait', { width: 360, height: 640 }], ['landscape', { width: 640, height: 360 }]]) {
  console.log(`select an area, phone ${label} ${viewport.width}x${viewport.height}`);
  const p = await join('Mo', `area-${label}-1234`, viewport);
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
  const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/area-${label}-${name}.png` }); };
  /** Where a point of the table is on screen. */
  const at = (x, y, z) => p.evaluate(([x, y, z]) => {
    const { board } = window.__ct, c = document.querySelector('#c');
    const s = board.ground.position.clone().set(x, y, z).project(board.camera);
    return [((s.x + 1) / 2) * c.clientWidth, ((1 - s.y) / 2) * c.clientHeight];
  }, [x, y, z]);
  /** Can a finger reach this point of the screen: on it, and clear of the dock and the Undo pair? */
  const reach = ([x, y]) => x > 24 && x < viewport.width - 110 && y > 40 && y < viewport.height - 130;
  const st = () => p.evaluate(() => {
    const { board, store } = window.__ct;
    return {
      picked: board.picked, selected: board.selected, tool: board.tool, area: board.areaPick, box: board.pickBox.visible, marquee: board.marquee.visible,
      n: [...store.keys('b:')].length, minis: [...store.keys('m:')].length, drawer: window.__ct.ui.drawer.id, notice: document.querySelector('#app .notice').textContent,
    };
  });
  const get = (k) => p.evaluate((k) => window.__ct.store.get(k), k);
  /** Everything of the table that a selection can hold, as one string: Undo has to bring exactly this back. */
  const dump = () => p.evaluate(() => { const { store } = window.__ct; return JSON.stringify(['b:', 'w:', 'l:', 'm:'].flatMap((x) => [...store.keys(x)].sort().map((k) => [k, store.get(k)]))); });
  const undo = async () => { await p.tap('#app .undo [data-u="undo"]'); await settle(); };
  /** What stands in the area, from level 1 up (the ground under it stays out of an area dragged on it). */
  const standing = () => p.evaluate(([x0, x1, z0, z1]) => {
    const { store } = window.__ct, out = [];
    for (const k of store.keys('b:')) { const [x, y, z] = k.slice(2).split(',').map(Number); if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && y >= 1) out.push(k); }
    for (const k of store.keys('w:')) { const [x, y, z] = k.slice(2).split(',').map(Number); if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && y >= 1) out.push(k); }
    for (const k of store.keys('m:')) { const m = store.get(k); if (m.x >= x0 && m.x <= x1 && m.z >= z0 && m.z <= z1 && m.y >= 1) out.push(k); }
    return out.sort();
  }, [X0, X1, Z0, Z1]);
  /** How far (in cells) the picked pieces could be carried and still be reachable by a finger: nothing in the way there. */
  const roomFor = (not = []) => p.evaluate(([not, w, h]) => {
    const { board, store } = window.__ct, c = document.querySelector('#c'), own = new Set(board.picked);
    const cells = board.picked.filter((k) => k.startsWith('b:')).map((k) => k.slice(2).split(',').map(Number));
    const seen = (x, z) => { const s = board.ground.position.clone().set(x, 1, z).project(board.camera), pt = [((s.x + 1) / 2) * c.clientWidth, ((1 - s.y) / 2) * c.clientHeight]; return pt[0] > 24 && pt[0] < w - 110 && pt[1] > 40 && pt[1] < h - 130; };
    for (const d of [[0, 2], [-2, 0], [0, 3], [-3, 0], [2, 0], [0, -2], [-2, 2], [2, 2], [-3, 3], [3, 0], [0, 4], [-4, 0]]) {
      if (not.includes(d.join())) continue;
      const free = cells.every(([x, y, z]) => { const k = `b:${x + d[0]},${y},${z + d[1]}`; return own.has(k) || store.get(k) === null; });
      if (free && seen(2.5 + d[0], 1.5 + d[1]) && seen(3.5 + d[0], 1.5 + d[1])) return d;
    }
    return null;
  }, [not, viewport.width, viewport.height]);
  const moved = (keys, [dx, dz]) => keys.map((k) => { const [x, y, z] = k.slice(2).split(',').map(Number); return `b:${x + dx},${y},${z + dz}`; }).sort();
  /** Nothing overlaps or leaves the screen, every target is big enough, the dock holds at most six, and the table keeps its share. */
  const layout = (share) => p.evaluate((share) => {
    const bad = [];
    const boxes = [...document.querySelectorAll('#app .dock, #app .undo:not([hidden]), #app .drawer:not([hidden]), #app .turn:not([hidden])')].map((e) => ({ id: e.className, r: e.getBoundingClientRect() }));
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
      if (b.offsetParent && (r.width < 43.5 || r.height < 43.5)) bad.push(`small target ${b.dataset.slot || b.title || b.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const b of document.querySelectorAll('#app .drawer:not([hidden]) :is(button, input, select)')) { const r = b.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) bad.push(`${b.textContent || b.placeholder} sticks out sideways`); }
    for (const s of document.querySelectorAll('#app .dock .slot span')) if (s.scrollWidth > s.clientWidth + 1) bad.push(`label cut off: ${s.textContent}`);
    if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) bad.push('the page scrolls sideways');
    const table = 1 - covered / (innerWidth * innerHeight);
    if (share !== null && table < share) bad.push(`the table keeps ${(table * 100).toFixed(1)}% of the screen, under ${share * 100}%`);
    return bad;
  }, share);
  const fits = async (what, share = 0.8) => { const bad = await layout(share); assert(!bad.length, `${what}: layout holds${bad.length ? ` — ${bad.join('; ')}` : ''}`); await shot(what.replace(/\W+/g, '-')); };
  /** Arm Select area from Make: the way in with nothing selected. */
  const arm = async () => {
    await slot('make');
    await p.tap('#app .drawer button:has-text("Select an area")');
    await settle();
  };
  /** One finger, corner to corner of the area, on the ground. */
  const drag = async () => dragTo(await at(X0 + 0.3, 1, Z0 + 0.3), await at(X1 + 0.7, 1, Z1 + 0.7), 12);

  await p.evaluate(() => window.__ct.session.starterScene());
  await settle(400);
  await slot('build');
  // Bring the campfire to the middle of what can be seen, so every corner of the area is under a finger.
  await p.evaluate(() => window.__ct.board.lookAt(3, 1, 1));
  await settle(1200);
  const scene = await st(), table0 = await dump(), inside = await standing();
  assert(scene.n > 400 && inside.includes('b:2,1,1') && inside.includes('b:3,1,0'), `the starter scene is up, with the campfire and the crate in the area (${inside})`);
  for (const c of [await at(X0 + 0.3, 1, Z0 + 0.3), await at(X1 + 0.7, 1, Z1 + 0.7)]) assert(reach(c), `a corner of the area is within reach (${c.map(Math.round)})`);

  // ---- arming it ----
  assert(await slots() === 'play,pieces,make,shape,erase,table', `Build with nothing selected still has six slots (${await slots()})`);
  await slot('make');
  await fits('make open', 0.45);
  await p.tap('#app .drawer button:has-text("Select an area")');
  await settle();
  let s = await st();
  assert(s.area && s.tool === 'pick' && s.drawer === null && await slots() === 'area,done', `Select an area, in Make, arms it: the drawer goes and the dock says so (${await slots()})`);
  assert(/Drag over/.test(s.notice), `a notice says what to do (${s.notice})`);
  await fits('area armed');

  // ---- two fingers are the camera: nothing is selected, nothing is edited ----
  const a = await at(X0 + 0.3, 1, Z0 + 0.3), b = await at(X1 + 0.7, 1, Z1 + 0.7);
  const cam = () => p.evaluate(() => window.__ct.board.camera.position.toArray().map((v) => +v.toFixed(2)).join());
  const cam0 = await cam();
  await touch('touchStart', [a]);
  await touch('touchStart', [a, [a[0] + 80, a[1]]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[a[0] + ((b[0] - a[0]) * i) / 8, a[1] + ((b[1] - a[1]) * i) / 8], [a[0] + 80 + i * 6, a[1] + ((b[1] - a[1]) * i) / 8]]); await p.waitForTimeout(16); }
  s = await st();
  assert(!s.marquee, 'with a second finger down there is no marquee');
  await touch('touchEnd', [[a[0] + 128, b[1]]]);
  await touch('touchEnd', []);
  await settle();
  s = await st();
  assert(!s.picked.length && s.selected === null && s.area && await dump() === table0, 'a two-finger gesture selects nothing and edits nothing, and the area is still armed');
  assert(await cam() !== cam0, 'it moved the camera instead');
  await p.evaluate(() => window.__ct.board.lookAt(3, 1, 1));
  await settle(1200);

  // ---- one finger drags the rectangle ----
  const c0 = await at(X0 + 0.3, 1, Z0 + 0.3), c1 = await at(X1 + 0.7, 1, Z1 + 0.7);
  await touch('touchStart', [c0]);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', [[c0[0] + ((c1[0] - c0[0]) * i) / 12, c0[1] + ((c1[1] - c0[1]) * i) / 12]]); await p.waitForTimeout(16); }
  assert((await st()).marquee, 'while one finger drags, the marquee shows the area');
  await shot('marquee');
  await touch('touchEnd', []);
  await settle();
  s = await st();
  assert([...s.picked].sort().join() === inside.join(), `on release everything standing in it is selected (${s.picked}; expected ${inside})`);
  assert(!s.picked.some((k) => /^b:-?\d+,0,/.test(k)), 'the ground it was dragged on stays out of it');
  assert(!s.area && !s.marquee && s.box && await slots() === 'move,turn,copy,remove,more,done', `and the dock becomes what can be done to it (${await slots()})`);
  assert(s.notice === `${inside.length} pieces`, `a notice names what was selected (${s.notice})`);
  assert(await dump() === table0, 'selecting changes nothing on the table');
  await fits('area selected');

  // ---- Duplicate: a copy beside the area, clear of it; one step of undo ----
  await slot('copy');
  s = await st();
  const copies = s.picked;
  assert(s.n === scene.n + inside.length && copies.length === inside.length && !copies.some((k) => inside.includes(k)), `Duplicate copies all of it and selects the copy (${copies})`);
  const clear = copies.every((k) => { const [x, , z] = k.slice(2).split(',').map(Number); return x < X0 || x > X1 || z < Z0 || z > Z1; });
  assert(clear && (await Promise.all(inside.map(get))).every((v) => v !== null), 'the copy lands clear of the original, which is still there');
  await undo();
  s = await st();
  assert(await dump() === table0 && !s.picked.length, 'one Undo takes the whole copy away');

  // ---- Move by dragging it: one step ----
  await arm();
  await drag();
  s = await st();
  assert([...s.picked].sort().join() === inside.join(), 'the area is selected again');
  let d = await roomFor();
  assert(!!d, `there is room to carry it to (${d})`);
  // A finger anywhere on the selection holds all of it: here, a spot of it with no figure in front.
  const hold = await p.evaluate(([x0, x1, z0, z1]) => {
    const { board } = window.__ct, c = document.querySelector('#c');
    for (const x of [x0 + 0.5, x1 + 0.5, x0 + 0.25, x1 + 0.75]) for (const z of [z0 + 0.5, z1 + 0.5, z0 + 0.25]) {
      const s = board.ground.position.clone().set(x, 1, z).project(board.camera), pt = [((s.x + 1) / 2) * c.clientWidth, ((1 - s.y) / 2) * c.clientHeight];
      board.aim({ clientX: pt[0], clientY: pt[1] });
      if (!board.pickMini() && board.pickSurface()?.place.join() === `${Math.floor(x)},1,${Math.floor(z)}`) return [x, z];
    }
    return null;
  }, [X0, X1, Z0, Z1]);
  assert(!!hold, `a finger can land on the selection (${hold})`);
  await dragTo(await at(hold[0], 1, hold[1]), await at(hold[0] + d[0], 1, hold[1] + d[1]), 14);
  s = await st();
  assert([...s.picked].sort().join() === moved(inside, d).join() && s.n === scene.n && (await get('b:2,1,1')) === null && (await get(`b:${2 + d[0]},1,${1 + d[1]}`))?.i === 'campfire',
    `a finger on the selection carries all of it (by ${d}: ${s.picked})`);
  await undo();
  s = await st();
  assert(await dump() === table0, 'one Undo puts all of it back');
  assert([...s.picked].sort().join() === inside.join() && s.box, 'and it is still what is selected');

  // ---- Move, then a tap: the middle of the area goes where the finger says ----
  await slot('move');
  assert(await p.evaluate(() => window.__ct.board.placing), 'Move waits for a touch');
  d = await roomFor();
  await tapAt(await at(3.5 + d[0], 1, 1.5 + d[1])); // (the middle cell of a 2 × 2 area is its far one)
  s = await st();
  assert([...s.picked].sort().join() === moved(inside, d).join() && s.n === scene.n && (await get(`b:${3 + d[0]},1,${d[1]}`))?.i === 'crate', `a tap says where all of it goes (by ${d}: ${s.picked})`);
  await undo();
  assert(await dump() === table0, 'and one Undo takes that back');

  // ---- Turn: the whole area, a quarter about its middle ----
  await slot('turn');
  s = await st();
  const fire = await get('b:3,1,1'), crate = await get('b:2,1,0');
  assert(fire?.i === 'campfire' && crate?.i === 'crate' && crate.r === 1 && s.n === scene.n && s.picked.length === inside.length, `Turn takes the area round as one: the campfire and the crate change corners, and the crate faces the new way (${JSON.stringify([fire, crate])})`);
  await undo();
  assert(await dump() === table0, 'one Undo turns it back');

  // ---- More: the ground under it, and another area ----
  await slot('more');
  await fits('more open', 0.45);
  await p.tap('#app .drawer button:has-text("With the ground")');
  await settle();
  s = await st();
  assert(s.picked.length === inside.length + 4 && s.picked.includes('b:2,0,1'), `With the ground, in More, takes the ground under the pieces as well (${s.picked.length})`);
  await p.tap('#app .drawer button:has-text("Select area")');
  await settle();
  s = await st();
  assert(s.area && !s.picked.length && s.drawer === null && await slots() === 'area,done', 'Select area, in More, starts another');
  await drag();
  assert([...(await st()).picked].sort().join() === inside.join(), 'and the same drag selects the same pieces');

  // ---- Delete: all of it, one step ----
  await slot('remove');
  s = await st();
  assert(s.n === scene.n - inside.filter((k) => k.startsWith('b:')).length && !s.picked.length && (await get('b:2,1,1')) === null && (await get('b:3,1,0')) === null && await slots() === 'play,pieces,make,shape,erase,table', 'Delete removes all of it without asking, and the dock goes back');
  await undo();
  assert(await dump() === table0, 'because one Undo brings all of it back');

  // ---- figures and pieces together: a wider area takes the wolf (3,1,2) with it ----
  await arm();
  await dragTo(await at(X0 + 0.3, 1, Z0 + 0.3), await at(X1 + 0.7, 1, Z1 + 1.7), 12);
  s = await st();
  assert(s.picked.includes('m:start-wolf') && s.picked.includes('b:2,1,1') && s.picked.includes('b:3,1,0') && s.selected === null, `an area holds figures and pieces alike (${s.picked})`);
  const mixed = s.picked.length;
  await slot('copy');
  s = await st();
  const twin = s.picked.find((k) => k.startsWith('m:'));
  assert(s.minis === scene.minis + 1 && s.picked.length === mixed && twin !== 'm:start-wolf' && (await get(twin))?.k === 'wolf' && s.n === scene.n + s.picked.filter((k) => k.startsWith('b:')).length, `Duplicate copies the wolf with the pieces around it (${s.picked})`);
  await undo();
  assert(await dump() === table0 && !(await st()).picked.length, 'and one Undo takes figures and pieces away together');

  // ---- an empty area, and the way out ----
  await arm();
  const empty = await p.evaluate(([w, h]) => {
    const { board, store } = window.__ct, c = document.querySelector('#c');
    for (let x = -1; x <= 6; x++) for (let z = 1; z <= 6; z++) {
      if (store.get(`b:${x},1,${z}`) !== null || [...store.keys('m:')].some((k) => { const m = store.get(k); return m.x === x && m.z === z; })) continue;
      const s = board.ground.position.clone().set(x + 0.5, 1, z + 0.5).project(board.camera), pt = [((s.x + 1) / 2) * c.clientWidth, ((1 - s.y) / 2) * c.clientHeight];
      if (pt[0] < 24 || pt[0] > w - 110 || pt[1] < 40 || pt[1] > h - 130) continue;
      board.aim({ clientX: pt[0], clientY: pt[1] });
      if (board.pickSurface()?.place.join() === `${x},1,${z}`) return pt;
    }
    return null;
  }, [viewport.width, viewport.height]);
  await tapAt(empty);
  s = await st();
  assert(!s.picked.length && s.area && /Nothing stands there/.test(s.notice), `an area with nothing in it says so, and waits for another (${s.notice})`);
  await slot('done');
  s = await st();
  assert(!s.area && s.tool === 'pick' && await slots() === 'play,pieces,make,shape,erase,table' && await dump() === table0, 'Done puts it away, and the table is as it was');
  // With it away, one finger is the camera again.
  const cam1 = await cam();
  await dragTo([viewport.width * 0.25, viewport.height * 0.2], [viewport.width * 0.45, viewport.height * 0.3]);
  assert(await cam() !== cam1 && !(await st()).picked.length, 'and one finger moves the camera again');
  await p.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all good');
done(failed ? 1 : 0);
