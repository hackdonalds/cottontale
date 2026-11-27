// End-to-end check: two browsers at one table, synced through a local relay.
//   npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Works with Playwright and its own browser, or with playwright-core driving the Chrome already
// on this machine (no browser download).
const require = createRequire(import.meta.url);
let pw, channel;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); channel = 'chrome'; }
const { chromium, devices } = pw;

const procs = [
  spawn('node', ['scripts/relay.mjs'], { env: { ...process.env, PORT: '7788' }, stdio: 'ignore' }),
  spawn('npx', ['vite', 'preview', '--port', '4188', '--strictPort'], { stdio: 'ignore' }),
];
const done = (code) => { procs.forEach((p) => p.kill()); process.exit(code); };
const assert = (ok, what) => { console.log(ok ? '  ok  ' : ' FAIL ', what); if (!ok) done(1); };
process.on('uncaughtException', (e) => { console.error(e); done(1); });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ channel, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
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
await a.keyboard.press('3');
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
// Dice: pick up, hold over the table, fling.
const fling = async (page) => {
  await page.mouse.move(560, 300);
  await page.mouse.down();
  await page.waitForFunction(() => window.__ct.board.dice.held);
  for (let i = 1; i <= 6; i++) { await page.mouse.move(560 + i * 14, 300 + i * 10); await page.waitForTimeout(16); }
  await page.mouse.up();
};
await a.click('#dice [data-d="20"]');
assert(await a.evaluate(() => window.__ct.board.dice.playing.length === 0 && /1d20 in hand/.test(document.querySelector('#hand').textContent)), 'tapping a die puts it in your hand, not on the table');
await fling(a);
await a.fill('#chatIn', 'hello table');
await a.press('#chatIn', 'Enter');
await b.waitForFunction(() => window.__ct.board.dice.playing.length === 1);
assert(true, 'thrown dice appear on the peer\'s table');
const rolled = (page) => page.waitForFunction(() => /rolled 1d20: (\d+)/.exec(document.querySelector('#msgs').textContent)?.[1]).then((h) => h.jsonValue());
const [ra, rb] = await Promise.all([rolled(a), rolled(b)]);
assert(ra === rb && +ra >= 1 && +ra <= 20, `physics roll lands on the same result for both players (${ra})`);
await a.click('#dice [data-d="100"]');
await a.click('#dice [data-d="100"]');
await a.click('#dice [data-d="8"]');
await fling(a);
await a.waitForFunction(() => /rolled 2d100\+1d8: /.test(document.querySelector('#msgs').textContent));
await a.fill('#chatIn', '/r 4d6+2');
await a.press('#chatIn', 'Enter');
await fling(a);
await a.fill('#chatIn', '/r 3d7');
await a.press('#chatIn', 'Enter');
await a.waitForFunction(() => /rolled 4d6\+2/.test(document.querySelector('#msgs').textContent) && /rolled 3d7/.test(document.querySelector('#msgs').textContent));
await b.waitForFunction(() => /rolled 4d6\+2/.test(document.querySelector('#msgs').textContent) && /rolled 2d100\+1d8/.test(document.querySelector('#msgs').textContent) && /Ada: hello table/.test(document.querySelector('#msgs').textContent));
await a.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/dice-desktop.png` });
assert(true, 'mixed hands, percentile, /r and chat delivered');

// ---- GM tools: one player runs the table, the other only sees and moves what they should ----
const ok = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 8000 }).then(() => true, () => false);
const id = await a.evaluate(() => [...window.__ct.store.keys('m:')][0].slice(2));
await a.keyboard.press('1');
await a.click('#menuBtn');
await a.click('[data-act="gm"]');
assert(await ok(b, (id) => document.body.classList.contains('player') && getComputedStyle(document.querySelector('#modes')).display === 'none'
  && !window.__ct.board.hooks.canMove(id) && !!document.querySelector('#players svg'), id), 'with a GM, players lose the build tools and cannot move the GM\'s minis');

await a.evaluate((id) => window.__ct.board.select(id), id);
await a.selectOption('#miniOwner', { label: '🎮 Bo' });
assert(await ok(b, (id) => window.__ct.board.hooks.canMove(id), id), 'GM hands a mini to a player, who can then move it');

await a.fill('#mhp', '20');
await a.press('#mhp', 'Tab');
await a.click('#hpDown');
assert(await ok(b, (id) => { const v = window.__ct.store.get(`m:${id}`); return v.mhp === 20 && v.hp === 19; }, id), 'hit points sync');

await a.click('#miniHide');
assert(await ok(b, (id) => window.__ct.board.minis.get(id).group.visible === false, id)
  && await a.evaluate((id) => window.__ct.board.minis.get(id).group.visible, id), 'a hidden mini disappears for players but not for the GM');
await a.click('#miniHide');
assert(await ok(b, (id) => window.__ct.board.minis.get(id).group.visible === true, id), 'and comes back when revealed');

await a.fill('#ini', '15');
await a.press('#ini', 'Tab');
await a.click('#nextTurn');
assert(await ok(b, () => !document.querySelector('#init').hidden && document.querySelectorAll('#order button.on').length === 1
  && /Round 1/.test(document.querySelector('#round').textContent) && !document.querySelector('#nextTurn').hidden), 'turn order shows for everyone; the player whose turn it is can end it');
await a.click('#endFight');
assert(await ok(b, () => document.querySelector('#init').hidden), 'ending the fight clears the turn order');

// How many blocks a player's table shows: everything not under fog or above the cutaway.
const SHOWN = () => {
  const b = window.__ct.board;
  let n = 0;
  for (const l of b.layers.values()) for (const k of l.cells) if (!b.cellHidden(...k.slice(2).split(',').map(Number))) n++;
  return n;
};
const drawn = (page) => page.evaluate(SHOWN);
const shows = (page, n) => page.waitForFunction(`(${SHOWN})() === ${n}`, null, { timeout: 8000 }).then(() => true, () => false);
await a.keyboard.press('5');
await a.mouse.move(top[0] - 40, top[1]);
await a.mouse.down();
await a.mouse.move(top[0] + 40, top[1], { steps: 8 });
await a.mouse.up();
assert(await ok(b, () => [...window.__ct.store.keys('f:')].length > 0) && await shows(b, 0)
  && (await drawn(a)) === 2, 'fog painted by the GM hides the terrain under it from players only');
await a.click('#palette [title="Reveal everything"]');
assert(await shows(b, 2), 'revealing brings it back');

await a.keyboard.press('4');
await a.mouse.move(300, 520);
await a.mouse.down();
await a.mouse.move(460, 600, { steps: 6 });
await a.mouse.up();
assert(await ok(b, () => window.__ct.board.rulers.size === 1), 'a ruler is visible to the other player while it is out');
await a.mouse.click(300, 520);
assert(await ok(b, () => window.__ct.board.rulers.size === 0), 'a tap puts the ruler away for everyone');

await a.click('#floorDown');
const draws = (n) => shows(a, n);
assert(await draws(1) && (await drawn(b)) === 2, 'cutaway hides the upper floor, for that player only');
await a.click('#floorUp');
assert(await draws(2), 'and shows it again');

await a.keyboard.press('1');
await a.click('#secret');
await a.click('#dice [data-d="6"]');
await fling(a);
assert(await ok(b, () => /Ada rolled in secret/.test(document.querySelector('#msgs').textContent) && window.__ct.board.dice.playing.some((p) => p.blank))
  && await ok(a, () => /rolled 1d6: \d/.test(document.querySelector('#msgs').textContent)), 'a secret GM roll shows players blank dice and no result');

// Emotes and stats on a mini.
await a.evaluate((id) => window.__ct.board.select(id), id);
await a.click('#palette [title="attack"]');
assert(await ok(b, () => window.__ct.board.anims.length === 1) && await ok(b, () => window.__ct.board.anims.length === 0), 'an emote plays on the other player\'s table and ends');
await a.click('#palette [title="Knock down"]');
await a.click('#miniMore');
await a.fill('#stats .st', 'AC 15');
await a.press('#stats .st', 'Tab');
assert(await ok(b, (id) => { const v = window.__ct.store.get(`m:${id}`); return v.d === true && v.st?.[0] === 'AC 15'; }, id), 'knocked-down state and extra stats sync');
await a.click('#palette [title="Stand up"]');

// Boards: the GM prepares a second map alone, then brings everyone over.
await a.click('#menuBtn');
await a.click('[data-act="boards"]');
await a.click('#boardNew');
assert(await ok(a, () => !document.querySelector('#prep').hidden && [...window.__ct.store.keys('b:')].length === 0), 'a new board opens empty, for the GM alone');
await a.click('#boards [data-close]');
await a.keyboard.press('2');
await a.mouse.click(640, 430);
await a.waitForFunction(() => [...window.__ct.store.keys('b:')].length === 1);
await b.waitForTimeout(600);
assert((await count(b, 'b:')) === 2 && await b.evaluate(() => [...window.__ct.store.entries.keys()].some((k) => k.startsWith('@'))), 'players stay on their board while the GM builds another');
await a.click('#prepGo');
assert(await ok(b, () => [...window.__ct.store.keys('b:')].length === 1 && window.__ct.board.minis.size === 0) && await shows(b, 1), 'the GM brings everyone to the new board');
await a.click('#menuBtn');
await a.click('[data-act="boards"]');
await a.click('#boardList .row:first-child button[title="Bring everyone here"]');
assert(await ok(b, () => [...window.__ct.store.keys('b:')].length === 2 && window.__ct.board.minis.size === 1), 'and back to the main board, with everything still there');
a.once('dialog', (d) => d.accept());
await a.click('#boardList button[title="Delete this board"]');
assert(await ok(a, () => document.querySelectorAll('#boardList .row').length === 1 && [...window.__ct.store.keys('bd:')].length === 0)
  && await ok(b, () => [...window.__ct.store.entries.entries()].every(([k, e]) => !k.startsWith('@') || e.v === null)), 'a deleted board leaves the list at once, and takes its contents with it');
await a.click('#boards [data-close]');

// Copy an area and paste it elsewhere.
await a.click('[data-mode="build"]');
await a.click('[data-cat="scenes"]');
await a.click('#palette [title^="Copy"]');
await a.mouse.move(top[0] - 30, top[1]);
await a.mouse.down();
await a.mouse.move(top[0] + 30, top[1], { steps: 6 });
await a.mouse.up();
assert(await ok(a, () => window.__ct.board.slab?.cells.length === 2 && window.__ct.board.brush === 'paste'), 'dragging the copy brush lifts the blocks under it into a slab');
await a.mouse.click(300, 560);
assert(await ok(b, () => [...window.__ct.store.keys('b:')].length === 4), 'pasting stamps the slab for everyone');
await a.keyboard.press('Control+z');
assert(await ok(b, () => [...window.__ct.store.keys('b:')].length === 2), 'one undo removes the whole paste');
await a.keyboard.press('1');

// Atmosphere: every soundscape starts without error, and the choice reaches the table.
await a.click('#menuBtn');
await a.click('[data-act="atmo"]');
for (const name of ['Wind', 'Campfire', 'Cave', 'Calm', 'Battle', 'Rain']) {
  await a.click(`#scapes button:has-text("${name}")`);
  await a.waitForTimeout(350);
}
await a.click('#skies button:has-text("Night")');
const playing = await a.evaluate(() => window.__ct.sound.playing);
assert(await ok(b, () => window.__ct.store.get('set:amb') === 'rain' && window.__ct.store.get('set:sky') === 'night') && ['rain', 'off'].includes(playing), `sky and soundscape are shared (this device is playing: ${playing})`);
// Firelight: the GM's dial reaches everyone, and at zero the lamps are out.
await a.evaluate(() => window.__ct.store.set('b:6,0,6', { i: 'stone' }));
await a.evaluate(() => window.__ct.store.set('b:6,1,6', { i: 'torch' }));
await a.fill('#glow', '2');
assert(await ok(b, () => window.__ct.store.get('set:glow') === 2 && window.__ct.board.lamps.some((l) => l.intensity > 15)), 'the firelight slider turns the lamps up for everyone');
await a.fill('#glow', '0');
assert(await ok(b, () => window.__ct.board.lamps.every((l) => l.intensity === 0)), 'and at zero puts them out');
await a.fill('#glow', '1');
await a.evaluate(() => { window.__ct.store.set('b:6,1,6', null); window.__ct.store.set('b:6,0,6', null); });
await a.click('#scapes button:has-text("Silence")');
await a.click('#skies button:has-text("Day")');
await a.click('#atmo [data-close]');

await a.click('#menuBtn');
await a.click('[data-act="gm"]');
assert(await ok(b, () => !document.body.classList.contains('player')), 'when the GM steps down the table is free play again');

// A big edit, then a late joiner must receive everything from relay snapshots.
await a.click('#menuBtn');
await a.click('[data-act="meadow"]');
const total = await count(a, 'b:');
await b.waitForFunction((n) => [...window.__ct.store.keys('b:')].length === n, total);
assert(total > 400, `starter scene synced live (${total} cells)`);
await a.evaluate(() => window.__ct.net.snapshot());
await a.screenshot({ path: process.env.SHOT ?? '/tmp/cottontale-e2e.png' });
const walls = await count(a, 'w:'), figures = await count(a, 'm:');
assert(walls > 20, `the starter cottage stands on edge walls (${walls})`);
await a.close();
await b.close();
const c = await join('Cy');
await c.waitForFunction((n) => [...window.__ct.store.keys('b:')].length === n, total);
assert((await count(c, 'm:')) === figures && (await count(c, 'w:')) === walls, 'late joiner restored the whole table from snapshots');

// ---- phones: the primary target. Real touch events, both orientations. ----
for (const [label, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
  console.log(`phone ${label}`);
  const p = await join('Mo', `phone-${label}-1234`, { ...devices['iPhone 13'], viewport });
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const cells = () => p.evaluate(() => [...window.__ct.store.keys('b:')]);
  const [cx, cy] = [viewport.width / 2, viewport.height / 2];
  const settle = () => p.waitForTimeout(120);

  await p.tap('[data-mode="build"]');
  await p.tap('#palette [title="Grass"]');
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

  await p.tap('[data-cat="figures"]');
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
  await p.tap('[data-mode="play"]');
  await touch('touchStart', [[m0.sx, m0.sy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[m0.sx - i * 12, m0.sy - i * 3]]);
  await touch('touchEnd', []);
  await settle();
  const m1 = await mini();
  assert(m1.x !== m0.x || m1.z !== m0.z, 'mini dragged with a finger');

  // Layout: with the mini editor open, then the palette open, nothing may overlap or leave the screen.
  const layout = () => p.evaluate(() => {
    const vis = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
    const boxes = ['#top', '#tools', '#palette', '#minipanel', '#floors', '#init'].map((q) => document.querySelector(q)).filter((e) => !e.hidden && vis(e))
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
  // Build mode: every category's tray, then the tools that came with the redesign.
  await p.tap('[data-mode="build"]');
  for (const cat of ['land', 'walls', 'things', 'figures', 'scenes']) {
    await p.tap(`[data-cat="${cat}"]`);
    bad = await layout();
    assert(!bad.length && await p.evaluate(() => document.querySelector('#palette').classList.contains('tray')), `${cat} tray layout clean ${bad.join('; ')}`);
  }
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-build.png` });
  const keys = (prefix) => p.evaluate((q) => [...window.__ct.store.keys(q)], prefix);
  const drag = async (x0, y0, x1, y1) => {
    await touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10]]);
    await touch('touchEnd', []);
    await settle();
  };
  // Land: a tap with the raise brush lifts the ground a level, and one undo takes it back.
  await p.tap('[data-cat="land"]');
  await p.tap('#palette [title="Raise the ground"]');
  const spot = await p.evaluate(() => { // where the one block is on screen now (the pinch moved the camera)
    const { board, store } = window.__ct;
    const [x, y, z] = [...store.keys('b:')][0].slice(2).split(',').map(Number);
    const s = board.ground.position.clone().set(x + 0.5, y + 1, z + 0.5).project(board.camera), c = document.querySelector('#c');
    return [((s.x + 1) / 2) * c.clientWidth, ((1 - s.y) / 2) * c.clientHeight];
  });
  await touch('touchStart', [spot]);
  await touch('touchEnd', []);
  await settle();
  assert((await cells()).length === 2 && (await cells()).some((k) => k.split(',')[1] === '1'), 'the raise brush lifts the ground a level');
  await p.tap('#undo');
  await settle();
  assert((await cells()).length === 1, 'and undo lowers it again');
  // Walls: a tap puts one wall on an edge, a drag draws a run, a second finger still never edits.
  await p.tap('[data-cat="walls"]');
  await p.tap('#palette [title="Stone wall"]');
  await touch('touchStart', [[cx - 40, cy + 90]]);
  await touch('touchEnd', []);
  await settle();
  assert((await keys('w:')).length === 1 && (await cells()).length === 1, 'a wall goes on the edge of a cell, not in it');
  const h = viewport.height; // strokes are placed by the height of the screen, so they clear the dock either way up
  await drag(cx - 170, cy + h * 0.15, cx + 150, cy + h * 0.21);
  const run = await keys('w:');
  assert(run.length >= 3 && new Set(run.slice(1).map((k) => k.split(',')[3])).size === 1, `one-finger drag draws a straight run of wall (${run.length - 1})`);
  await p.tap('#undo');
  await settle();
  assert((await keys('w:')).length === 1, 'undo takes the whole run back');
  // A room in one drag: walls all round with a doorway, and a floor if there is ground to lay it on.
  await p.tap('#palette [title="Drag out its floor"]');
  await drag(cx - 150, cy - h * 0.2, cx + 60, cy - h * 0.07);
  const room = await p.evaluate(() => [...window.__ct.store.keys('w:')].map((k) => window.__ct.store.get(k).i));
  assert(room.length > 8 && room.filter((i) => i === 'walldoor').length === 1, `dragging the room brush builds a room with one doorway (${room.length - 1} walls)`);
  await p.tap('#undo');
  await settle();
  // Scenes: generate a dungeon from the sheet; its rooms are listed, and one can be refurnished alone.
  await p.tap('[data-cat="scenes"]');
  await p.tap('#palette [title="Generate a scene"]');
  await p.tap('#genThemes button:has-text("Dungeon")');
  await p.tap('#genGo');
  await p.waitForFunction(() => [...window.__ct.store.keys('b:')].length > 100 && document.querySelectorAll('#genRooms .row').length > 2);
  bad = await layout();
  const fitsGen = await p.evaluate(() => { const r = document.querySelector('#gen').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
  assert(fitsGen && !bad.length, `generate sheet opens on screen ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-generate.png` });
  const wallsBefore = JSON.stringify((await keys('w:')).sort()), seedBefore = await p.evaluate(() => window.__ct.store.get('gen').rooms[1].seed);
  await p.evaluate(() => document.querySelectorAll('#genRooms .row')[1].querySelectorAll('button')[1].click());
  await settle();
  assert(JSON.stringify((await keys('w:')).sort()) === wallsBefore && await p.evaluate((s) => window.__ct.store.get('gen').rooms[1].seed !== s, seedBefore), 'refurnishing one room leaves every wall where it was');
  await p.tap('#gen [data-close]');
  await p.tap('#undo');
  await p.tap('#undo');
  await settle();
  assert((await cells()).length === 1 && (await keys('w:')).length === 1, 'undo brings back the table from before the scene');
  await p.evaluate(() => window.__ct.store.set([...window.__ct.store.keys('w:')][0], null));

  // Measure with one finger; press and hold to ping.
  await p.tap('[data-mode="play"]');
  await p.tap('[data-tool="ruler"]');
  await touch('touchStart', [[cx - 90, cy - 70]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 90 + i * 20, cy - 70 + i * 4]]);
  await touch('touchEnd', []);
  bad = await layout();
  assert(await p.evaluate(() => window.__ct.board.rulers.has('me')) && (await cells()).length === 1 && !bad.length, `one-finger drag measures (and edits nothing) ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-ruler.png` });
  await p.tap('[data-tool="move"]');
  await touch('touchStart', [[cx + 60, cy - 110]]);
  await p.waitForTimeout(750);
  await touch('touchEnd', []);
  const pg = await p.evaluate(() => ({ pings: window.__ct.board.pings.length, rulers: window.__ct.board.rulers.size, sel: window.__ct.board.selected, tool: window.__ct.board.tool }));
  assert(pg.pings === 1 && !pg.rulers, `press and hold pings; leaving the ruler tool puts the ruler away ${JSON.stringify(pg)}`);

  for (const sheet of ['boards', 'atmo']) {
    await p.tap('#menuBtn');
    await p.tap(`[data-act="${sheet}"]`);
    bad = await layout();
    const fits = await p.evaluate((id) => { const r = document.querySelector(`#${id}`).getBoundingClientRect(); return r.width > 200 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }, sheet);
    assert(fits && !bad.length, `${sheet} sheet opens on screen ${bad.join('; ')}`);
    await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-${sheet}.png` });
    await p.tap(`#${sheet} [data-close]`);
  }

  await p.tap('#logToggle');
  bad = await layout();
  const sheet = await p.evaluate(() => { const r = document.querySelector('#log').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
  assert(sheet && !bad.length, `dice & chat sheet opens on screen ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-sheet.png` });
  for (let i = 0; i < 3; i++) await p.tap('#dice [data-d="6"]');
  assert(await p.evaluate(() => document.querySelector('#logToggle').dataset.n === '3'), 'hand of three dice is shown on the dice button');
  // Second finger while holding: dice go back to the hand, nothing is thrown.
  await touch('touchStart', [[cx, cy - 80]]);
  await touch('touchStart', [[cx, cy - 80], [cx + 80, cy - 80]]);
  await touch('touchEnd', []);
  await settle();
  assert(await p.evaluate(() => !window.__ct.board.dice.held && window.__ct.board.dice.playing.length === 0 && window.__ct.board.hand.length === 3), 'a second finger cancels the hold without throwing');
  // Hold with one finger (the sheet gets out of the way), flick, release.
  await touch('touchStart', [[cx - 40, cy - 60]]);
  await p.waitForFunction(() => window.__ct.board.dice.held && document.querySelector('#log').classList.contains('closed'));
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-dice-held.png` });
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cx - 40 + i * 10, cy - 60 - i * 6]]); await p.waitForTimeout(16); }
  await touch('touchEnd', []);
  await p.waitForFunction(() => window.__ct.board.dice.playing.length === 1 && !window.__ct.board.dice.held);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-dice-air.png` });
  await p.waitForFunction(() => /rolled 3d6/.test(document.querySelector('#msgs').textContent));
  const onScreen = await p.evaluate(() => {
    const { board } = window.__ct;
    return board.dice.playing[0].meshes.slice(0, 3).every((m) => { const v = m.position.clone().project(board.camera); return Math.abs(v.x) < 1 && Math.abs(v.y) < 1; });
  });
  assert(onScreen && (await cells()).length === 1, 'flung dice come to rest in view, and the throw edits nothing');
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-dice.png` });
  await p.context().close();
}

// Every piece in the library, laid out for a look (and to prove each one renders).
const sheet = await join('Zed', 'library-1234', { viewport: { width: 1600, height: 1000 } });
const lib = await sheet.evaluate(() => {
  const { store, board, catalog } = window.__ct;
  const pieces = [...Object.keys(catalog.BLOCKS), ...Object.keys(catalog.PROPS)];
  pieces.forEach((id, i) => store.set(`b:${(i % 14) * 2 - 14},0,${Math.floor(i / 14) * 2 - 12}`, { i: id }));
  const minis = Object.keys(catalog.MINIS);
  minis.forEach((k, i) => store.set(`m:lib${i}`, { x: (i % 14) * 2 - 14, y: 0, z: Math.floor(i / 14) * 2 + 2, k, c: '#3e63dd', n: '', r: 0, s: 1 }));
  board.camera.position.set(-1, 17, 17);
  board.controls.target.set(-1, 0, -1);
  return { pieces: pieces.length, minis: minis.length, drawn: () => 0 };
});
await sheet.waitForTimeout(700);
await sheet.click('#log', { position: { x: 5, y: 5 } }).catch(() => {});
await sheet.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/library.png` });
const shown = await sheet.evaluate(() => ({ props: window.__ct.board.props.size, minis: [...window.__ct.board.minis.values()].filter((m) => m.group.visible).length }));
assert(shown.minis === lib.minis && shown.props > 45 && lib.pieces > 75, `library renders: ${lib.pieces} blocks and props, ${lib.minis} minis`);

await browser.close();
console.log('all good');
done(0);
