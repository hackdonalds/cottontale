// End-to-end check: two browsers at one table, synced through a local relay.
//   npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Works with a project-local or a globally installed Playwright.
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const procs = [
  spawn('node', ['scripts/relay.mjs'], { env: { ...process.env, PORT: '7788' }, stdio: 'ignore' }),
  spawn('npx', ['vite', 'preview', '--port', '4188', '--strictPort'], { stdio: 'ignore' }),
];
const done = (code) => { procs.forEach((p) => p.kill()); process.exit(code); };
const assert = (ok, what) => { console.log(ok ? '  ok  ' : ' FAIL ', what); if (!ok) done(1); };
process.on('uncaughtException', (e) => { console.error(e); done(1); });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const url = (room) => `http://localhost:4188/#room=${room}&relays=ws://localhost:7788`;
async function join(name, room = 'test-room-1234', ctxOptions = { viewport: { width: 1280, height: 800 } }) {
  const page = await (await browser.newContext(ctxOptions)).newPage();
  page.on('pageerror', (e) => { console.log('pageerror', name, e.message); done(1); });
  await page.goto(url(room));
  await page.fill('#name', name);
  await page.click('#join');
  await page.waitForSelector('#hud:not([hidden])', { state: 'attached' });
  return page;
}
const count = (page, prefix) => page.evaluate((p) => [...window.__ct.store.keys(p)].length, prefix);

const a = await join('Ada');
const b = await join('Bo');
await a.waitForFunction(() => window.__ct.net.peers.size === 1);
await b.waitForFunction(() => window.__ct.net.peers.size === 1);
assert(true, 'players see each other');

// Build by clicking the table, then stack a block on top of it.
await a.keyboard.press('2');
await a.mouse.click(640, 420);
await a.waitForFunction(() => [...window.__ct.store.keys('b:')].length === 1);
const top = await a.evaluate(() => { // screen position of the new block's top face
  const { board, store } = window.__ct;
  const [x, , z] = [...store.keys('b:')][0].slice(2).split(',').map(Number);
  const v = board.ground.position.clone().set(x + 0.5, 1, z + 0.5).project(board.camera);
  return [(v.x + 1) * 640, (1 - v.y) * 400];
});
await a.mouse.click(top[0], top[1]);
await b.waitForFunction(() => [...window.__ct.store.keys('b:')].length === 2);
const ys = await b.evaluate(() => [...window.__ct.store.keys('b:')].map((k) => +k.split(',')[1]).sort());
assert(ys.join() === '0,1', `blocks placed by click and stacked, synced to peer (y=${ys})`);

// Place a mini and drag it.
await a.keyboard.press('4');
await a.mouse.click(500, 500);
await b.waitForFunction(() => [...window.__ct.store.keys('m:')].length === 1);
const before = await b.evaluate(() => Object.values(Object.fromEntries(window.__ct.store.entries)).find((e) => e.v?.k).v);
await a.keyboard.press('1');
await a.mouse.move(500, 490);
await a.mouse.down();
await a.mouse.move(700, 560, { steps: 8 });
await a.mouse.up();
await b.waitForFunction((x) => [...window.__ct.store.entries.values()].some((e) => e.v?.k && e.v.x !== x), before.x);
assert(true, 'mini placed, dragged, and the move reached the peer');

// Dice + chat.
await a.click('#dice [data-d="20"]');
await a.fill('#chatIn', 'hello table');
await a.press('#chatIn', 'Enter');
await b.waitForFunction(() => /rolled 1d20/.test(document.querySelector('#msgs').textContent) && /Ada: hello table/.test(document.querySelector('#msgs').textContent));
assert(true, 'dice roll and chat delivered');

// A big edit, then a late joiner must receive everything from relay snapshots.
await a.click('#menuBtn');
await a.click('[data-act="meadow"]');
const total = await count(a, 'b:');
await b.waitForFunction((n) => [...window.__ct.store.keys('b:')].length === n, total);
assert(total > 400, `starter meadow synced live (${total} cells)`);
await a.evaluate(() => window.__ct.net.snapshot());
await a.screenshot({ path: process.env.SHOT ?? '/tmp/cottontale-e2e.png' });
await a.close();
await b.close();
const c = await join('Cy');
await c.waitForFunction((n) => [...window.__ct.store.keys('b:')].length === n, total);
assert((await count(c, 'm:')) === 1, 'late joiner restored the whole table from snapshots');

// ---- phones: the primary target. Real touch events, both orientations. ----
for (const [label, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
  console.log(`phone ${label}`);
  const p = await join('Mo', `phone-${label}-1234`, { ...devices['iPhone 13'], viewport });
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const cells = () => p.evaluate(() => [...window.__ct.store.keys('b:')]);
  const [cx, cy] = [viewport.width / 2, viewport.height / 2];
  const settle = () => p.waitForTimeout(120);

  await p.tap('[data-tool="build"]');
  await touch('touchStart', [[cx, cy]]);
  await touch('touchEnd', []);
  await settle();
  assert((await cells()).length === 1, 'tap places one block');

  await touch('touchStart', [[cx - 150, cy + 30]]);
  for (let i = 1; i <= 12; i++) await touch('touchMove', [[cx - 150 + i * 12, cy + 30 + i * 4]]);
  await touch('touchEnd', []);
  await settle();
  const painted = await cells();
  assert(painted.length > 3 && painted.every((k) => k.split(',')[1] === '0'), `one-finger drag paints a flat layer (${painted.length} cells)`);

  await p.tap('#undo');
  await settle();
  assert((await cells()).length === 1, 'undo button reverts the whole stroke');

  await touch('touchStart', [[cx - 60, cy]]);
  await touch('touchStart', [[cx - 60, cy], [cx + 60, cy]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 60 - i * 8, cy - i * 4], [cx + 60 + i * 8, cy + i * 4]]);
  await touch('touchEnd', [[cx + 108, cy + 24]]);
  await touch('touchEnd', []);
  await settle();
  assert((await cells()).length === 1, 'two-finger pinch/twist never edits');

  await p.tap('[data-tool="mini"]');
  await touch('touchStart', [[cx + 60, cy + 60]]);
  await touch('touchEnd', []);
  await p.waitForFunction(() => [...window.__ct.store.keys('m:')].length === 1);
  const mini = () => p.evaluate(() => {
    const { board, store } = window.__ct;
    const v = store.get([...store.keys('m:')][0]);
    const s = board.ground.position.clone().set(v.x + 0.5, v.y + 0.3, v.z + 0.5).project(board.camera);
    const c = document.querySelector('#c');
    return { x: v.x, z: v.z, sx: ((s.x + 1) / 2) * c.clientWidth, sy: ((1 - s.y) / 2) * c.clientHeight };
  });
  const m0 = await mini();
  await p.tap('[data-tool="move"]');
  await touch('touchStart', [[m0.sx, m0.sy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[m0.sx - i * 12, m0.sy - i * 3]]);
  await touch('touchEnd', []);
  await settle();
  const m1 = await mini();
  assert(m1.x !== m0.x || m1.z !== m0.z, 'mini dragged with a finger');

  // Layout: with the mini editor open, then the palette open, nothing may overlap or leave the screen.
  const layout = () => p.evaluate(() => {
    const vis = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
    const boxes = ['#top', '#tools', '#palette', '#minipanel'].map((q) => document.querySelector(q)).filter((e) => !e.hidden && vis(e))
      .map((e) => ({ id: e.id, r: e.getBoundingClientRect() }));
    const bad = [];
    for (const a of boxes) {
      if (a.r.left < 0 || a.r.top < 0 || a.r.right > innerWidth || a.r.bottom > innerHeight) bad.push(`${a.id} off-screen`);
      for (const b of boxes) if (a.id < b.id && a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) bad.push(`${a.id} overlaps ${b.id}`);
    }
    for (const b of document.querySelectorAll('#hud button')) {
      const r = b.getBoundingClientRect();
      if (b.offsetParent && (r.width < 43.5 || r.height < 43.5)) bad.push(`small target ${b.id || b.title || b.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const i of document.querySelectorAll('input, textarea')) if (parseFloat(getComputedStyle(i).fontSize) < 16) bad.push(`input ${i.id} under 16px`);
    return bad;
  });
  let bad = await layout();
  assert(await p.evaluate(() => !document.querySelector('#minipanel').hidden) && !bad.length, `mini editor layout clean ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-mini.png` });
  await p.tap('[data-tool="build"]');
  bad = await layout();
  assert(!bad.length, `palette layout clean ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-build.png` });

  await p.tap('#logToggle');
  bad = await layout();
  await p.tap('#dice [data-d="20"]');
  await p.waitForFunction(() => /rolled 1d20/.test(document.querySelector('#msgs').textContent));
  const sheet = await p.evaluate(() => { const r = document.querySelector('#log').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
  assert(sheet && !bad.length, `dice & chat sheet opens on screen and rolls ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-sheet.png` });
  await p.context().close();
}

await browser.close();
console.log('all good');
done(0);
