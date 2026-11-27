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

// E2E_PORT moves the three local servers (site, relay = +1, blossom = +2) so several runs can share a machine.
const PORT = Number(process.env.E2E_PORT ?? 4188), RELAY = process.env.E2E_PORT ? PORT + 1 : 7788, BLOSSOM = PORT + 2;
// E2E_SLOW=4 gives every wait four times as long: for a machine that is busy with other runs.
const SLOW = +(process.env.E2E_SLOW ?? 1);
const procs = [
  spawn('node', ['scripts/relay.mjs'], { env: { ...process.env, PORT: String(RELAY) }, stdio: 'ignore' }),
  spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' }), // not npx: killing npx leaves vite running
  // A picky file server: takes small blobs, refuses anything over 200 kB.
  spawn('node', ['scripts/blossom.mjs'], { env: { ...process.env, PORT: String(BLOSSOM), MAX_SIZE: '200000' }, stdio: 'ignore' }),
];
const done = (code) => { procs.forEach((p) => p.kill()); process.exit(code); };
const assert = (ok, what) => { console.log(ok ? '  ok  ' : ' FAIL ', what); if (!ok) done(1); };
process.on('uncaughtException', (e) => { console.error(e); done(1); });
// Wait for the site to answer rather than a fixed time: a busy machine starts it slowly.
for (let i = 0; i < 120; i++) {
  if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 1000));

const browser = await chromium.launch({ channel, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const url = (room) => `http://localhost:${PORT}/#room=${room}&relays=ws://localhost:${RELAY}`;
async function join(name, room = 'test-room-1234', ctxOptions = { viewport: { width: 1280, height: 800 } }) {
  const page = await (await browser.newContext(ctxOptions)).newPage();
  page.setDefaultTimeout(30000 * SLOW);
  page.on('pageerror', (e) => { console.log('pageerror', name, e.message); done(1); });
  await page.goto(url(room));
  await page.fill('#name', name);
  await page.click('#join');
  await page.waitForSelector('#hud:not([hidden])', { state: 'attached' });
  return page;
}
const count = (page, prefix) => page.evaluate((p) => [...window.__ct.store.keys(p)].length, prefix);

// A picture to import: a PNG made here (white paper, a red disc with a blue eye), so nothing is fetched or shipped.
function png(w, h, at) {
  const { deflateSync } = require('node:zlib');
  const row = w * 4 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(at(x, y), y * row + 1 + x * 4);
  const crc = (buf) => { let c = ~0; for (const v of buf) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); out.write(type, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w); head.writeUInt32BE(h, 4); head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TOKEN = { name: 'IMG_0042.png', mimeType: 'image/png', buffer: png(320, 320, (x, y) => (Math.hypot(x - 160, y - 160) < 110 ? (Math.hypot(x - 190, y - 130) < 18 ? [30, 60, 200, 255] : [200, 40, 40, 255]) : [255, 255, 255, 255])) };
/** The alpha of the picture being cut out, at its corner and in its middle. */
const cutAlpha = (page) => page.evaluate(() => { const c = document.querySelector('.impCut'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return { corner: d[3 + (2 * c.width + 2) * 4], mid: d[3 + ((c.height >> 1) * c.width + (c.width >> 1)) * 4], w: c.width }; });

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
const ok = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 8000 * SLOW }).then(() => true, () => false);
const id = await a.evaluate(() => [...window.__ct.store.keys('m:')][0].slice(2));
await a.keyboard.press('1');
await a.click('#menuBtn');
await a.click('[data-act="gm"]');
assert(await ok(b, (id) => document.body.classList.contains('player') && getComputedStyle(document.querySelector('#modes')).display === 'none'
  && !window.__ct.board.hooks.canMove(id) && !!document.querySelector('#players svg'), id), 'with a GM, players lose the build tools and cannot move the GM\'s minis');

await a.evaluate((id) => window.__ct.board.select(id), id);
assert(await a.evaluate(() => document.querySelector('#minipanel').hidden && document.querySelectorAll('#ring button').length === 4), 'selecting a piece shows a ring of actions on it, not a panel');
{ // Pan the piece out of view: its ring goes too, and comes back with it.
  const pan = (dx) => a.evaluate((dx) => { const { board } = window.__ct; board.controls.target.x += dx; board.camera.position.x += dx; board.controls.update(); board.hooks.onView(); }, dx);
  const ringShown = () => a.evaluate(() => getComputedStyle(document.querySelector('#ring')).visibility !== 'hidden');
  await pan(200);
  assert(!(await ringShown()), 'panning a selected piece out of view hides its ring');
  await pan(-200);
  assert(await ringShown(), 'and panning back shows it again');
}
await a.click('#ring [title="More"]');
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
const shows = (page, n) => page.waitForFunction(`(${SHOWN})() === ${n}`, null, { timeout: 8000 * SLOW }).then(() => true, () => false);
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
await a.click('#ring [title="Emote"]');
await a.click('#ring [title="attack"]');
assert(await ok(b, () => window.__ct.board.anims.length === 1) && await ok(b, () => window.__ct.board.anims.length === 0), 'an emote plays on the other player\'s table and ends');
await a.click('#ring [title="Knock down"]');
await a.click('#ring [title="Back"]');
await a.click('#ring [title="More"]');
await a.click('#miniMore');
await a.fill('#stats .st', 'AC 15');
await a.press('#stats .st', 'Tab');
assert(await ok(b, (id) => { const v = window.__ct.store.get(`m:${id}`); return v.d === true && v.st?.[0] === 'AC 15'; }, id), 'knocked-down state and extra stats sync');
await a.click('#ring [title="Emote"]');
await a.click('#ring [title="Stand up"]');

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
// Each board has its own atmosphere: night falls on the new one, and only there.
const skyOf = (page) => page.evaluate(() => JSON.parse(window.__ct.board.skySig)[0]);
await a.evaluate(() => window.__ct.store.set('at:sky', 'night'));
assert(await ok(a, () => JSON.parse(window.__ct.board.skySig)[0] === 'night'), 'the GM sets the sky of the board being prepared');
assert((await count(b, 'b:')) === 2 && await b.evaluate(() => [...window.__ct.store.entries.keys()].some((k) => k.startsWith('@'))), 'players stay on their board while the GM builds another');
await a.click('#prepGo');
assert(await ok(b, () => [...window.__ct.store.keys('b:')].length === 1 && window.__ct.board.minis.size === 0) && await shows(b, 1), 'the GM brings everyone to the new board');
assert(await ok(b, () => JSON.parse(window.__ct.board.skySig)[0] === 'night' && window.__ct.store.get('set:sky') === null), 'and its atmosphere comes with it');
await a.click('#menuBtn');
await a.click('[data-act="boards"]');
await a.click('#boardList .row:first-child button[title="Bring everyone here"]');
assert(await ok(b, () => [...window.__ct.store.keys('b:')].length === 2 && window.__ct.board.minis.size === 1), 'and back to the main board, with everything still there');
assert(await skyOf(b) === 'day' && await skyOf(a) === 'day', 'where the sky is as it was');
a.once('dialog', (d) => d.accept());
await a.click('#boardList button[title="Delete this board"]');
assert(await ok(a, () => document.querySelectorAll('#boardList .row').length === 1 && [...window.__ct.store.keys('bd:')].length === 0)
  && await ok(b, () => [...window.__ct.store.entries.entries()].every(([k, e]) => !k.startsWith('@') || e.v === null)), 'a deleted board leaves the list at once, and takes its contents with it');
// A copy of a board keeps its atmosphere.
await a.evaluate(() => window.__ct.store.set('at:sky', 'dusk'));
await a.click('#boardCopy');
assert(await ok(a, () => { const { store, board } = window.__ct; return !document.querySelector('#prep').hidden && [...store.entries.keys()].some((k) => /^@.+\/at:sky$/.test(k)) && store.get('at:sky') === 'dusk' && JSON.parse(board.skySig)[0] === 'dusk'; }), 'a copied board keeps its atmosphere');
a.once('dialog', (d) => d.accept());
await a.click('#boardList button[title="Delete this board"]');
await a.evaluate(() => window.__ct.store.set('at:sky', null));
assert(await ok(a, () => document.querySelectorAll('#boardList .row').length === 1 && document.querySelector('#prep').hidden) && await ok(b, () => JSON.parse(window.__ct.board.skySig)[0] === 'day'), 'and deleting the copy brings the GM back');
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
// (The soundscapes are recipes in public/sounds, loaded after the table is up: the buttons are whatever arrived.)
for (const name of ['Wind', 'Campfire', 'Cave', 'Calm', 'Battle', 'Sea', 'Rain']) {
  await a.click(`#scapes button:has-text("${name}")`);
  await a.waitForTimeout(350);
}
await a.click('#skies button:has-text("Night")');
const playing = await a.evaluate(() => window.__ct.sound.playing);
assert(await ok(b, () => window.__ct.store.get('at:amb') === 'rain' && window.__ct.store.get('at:sky') === 'night') && ['rain', 'off'].includes(playing), `sky and soundscape are shared (this device is playing: ${playing})`);
// Firelight: the GM's dial reaches everyone, and at zero the lamps are out.
await a.evaluate(() => window.__ct.store.set('b:6,0,6', { i: 'stone' }));
await a.evaluate(() => window.__ct.store.set('b:6,1,6', { i: 'torch' }));
await a.fill('#glow', '2');
assert(await ok(b, () => window.__ct.store.get('at:glow') === 2 && window.__ct.board.lamps.some((l) => l.intensity > 15)), 'the firelight slider turns the lamps up for everyone');
await a.fill('#glow', '0');
assert(await ok(b, () => window.__ct.board.lamps.every((l) => l.intensity === 0)), 'and at zero puts them out');
await a.fill('#glow', '1');
await a.evaluate(() => { window.__ct.store.set('b:6,1,6', null); window.__ct.store.set('b:6,0,6', null); });
// A theme: one tap sets the whole mood for everyone and brings its pieces to the front of the library.
await a.click('#themes button:has-text("Vampires")');
assert(await ok(b, () => { const s = window.__ct.store; return s.get('at:theme')?.id === 'vampire' && s.get('at:sky') === 'night' && s.get('at:season') === 'winter' && s.get('at:amb') === 'crypt'; }), 'picking a theme sets sky, season and soundscape for the board');
// The vampires' soundscape is a recipe the theme carries, not one of the app's: it is offered by its own name and played, on every device.
await a.waitForTimeout(350);
const crypt = await a.evaluate(() => ({ button: [...document.querySelectorAll('#scapes button')].some((b) => b.textContent === 'Crypt' && b.classList.contains('on')), playing: window.__ct.sound.playing }));
assert(crypt.button && crypt.playing === (playing === 'rain' ? 'crypt' : 'off') && await ok(b, () => window.__ct.sound.knows('crypt')),
  `a theme's own soundscape is listed and plays (this device is playing: ${crypt.playing})`);
await a.evaluate(() => { for (const fx of ['clack', 'thud', 'ping', 'emote:cheer', 'emote:shrug']) window.__ct.sound[fx.startsWith('emote') ? 'emote' : fx](fx.includes(':') ? fx.split(':')[1] : 0.5); });
// The theme's own look is data too: its light, haze, grade and dice reach everyone (the grade only where the finished look is drawn).
const lookOf = (page) => page.evaluate(() => {
  const { board } = window.__ct, u = board.look?.grade.uniforms;
  return { near: board.scene.fog.near, fog: board.scene.fog.color.getHexString(), sun: board.sun.intensity, sat: u ? u.uSat.value : null, dice: board.dice.look };
});
assert(await ok(b, () => window.__ct.board.scene.fog.near === 18), 'a theme brings its own haze');
let themed = await lookOf(b);
assert(themed.fog === '0b1020' && themed.sun === 1.1 && [null, 0.62].includes(themed.sat) && themed.dice.body === '#5c0f1a' && themed.dice.ink === '#e8dcc0', `and its own light, grade and dice ${JSON.stringify(themed)}`);
await a.click('#skies button:has-text("Dusk")');
assert(await ok(b, () => window.__ct.board.scene.fog.near === 60), 'under another sky the theme\'s light and haze step aside');
themed = await lookOf(b);
assert(themed.sun === 2.3 && [null, 0.62].includes(themed.sat) && themed.dice.body === '#5c0f1a', `while its grade and dice stay ${JSON.stringify(themed)}`);
await a.click('#skies button:has-text("Night")');
await a.click('#themes button:has-text("Vampires")');
assert(await ok(b, () => window.__ct.store.get('at:theme') === '' && window.__ct.store.get('at:sky') === 'night' && window.__ct.board.scene.fog.near === 60), 'tapping it again lets go of the theme and keeps the mood');
themed = await lookOf(b);
assert(themed.sun === 0.75 && [null, 0.9].includes(themed.sat) && themed.dice.body === undefined, `and the picture is the plain night again ${JSON.stringify(themed)}`);
assert(await ok(a, () => ![...document.querySelectorAll('#scapes button')].some((b) => b.textContent === 'Crypt') && !window.__ct.sound.knows('crypt') && window.__ct.sound.playing === 'off'), 'and its soundscape goes with it');
await a.click('#skies button:has-text("Day")');
await a.click('#seasons button:has-text("Summer")');
await a.click('#scapes button:has-text("Silence")');
await a.click('#skies button:has-text("Day")');
await a.click('#atmo [data-close]');
// A scene from a preset that is nothing but data (public/gens/cove.json): it is built, and the other player gets it.
const beforeCove = await count(a, 'b:');
await a.click('#menuBtn');
await a.click('[data-act="gen"]');
const offered = await a.evaluate(() => [...document.querySelectorAll('#genThemes button')].map((b) => b.textContent));
await a.click('#genThemes button:has-text("Pirate cove")');
const labels = await a.evaluate(() => [...document.querySelectorAll('#genSliders .slider span')].map((e) => e.textContent).join());
await a.click('#genGo');
const cove = await ok(b, () => {
  const s = window.__ct.store, ids = [...s.keys('b:')].map((k) => s.get(k).i);
  return s.get('gen')?.o.theme === 'cove' && ids.length > 200 && ids.includes('palm') && ids.filter((i) => i === 'sand').length > 50 && ids.filter((i) => i === 'water').length > 20;
});
assert(cove && labels === 'Size,Growth,Dunes' && ['Wilderness', 'Dungeon', 'Cave', 'Tavern', 'Pirate cove', 'Crypt', "Ship's hold"].join() === offered.join(), `a preset from a file builds a scene that reaches the other player (${offered.join(', ')})`);
await a.click('#gen [data-close]');
await a.keyboard.press('Control+z');
assert(await ok(b, (n) => [...window.__ct.store.keys('b:')].length === n && !window.__ct.store.get('gen'), beforeCove), 'and one undo takes it away again');

// Pieces from a pack (see registry.ts): a board can name ones this device does not have. They
// stand as plain markers, and become the real thing when the pack registers.
await a.evaluate(() => {
  const s = window.__ct.store;
  s.set('b:9,0,9', { i: 'ada:moonrock' });
  s.set('b:10,0,9', { i: 'ada:keg', r: 1 });
  s.set('m:robot', { x: 11, y: 0, z: 9, k: 'ada:robot', c: '#e5484d', n: 'R2', r: 0, s: 1 });
});
const standins = () => { const { board } = window.__ct; return ['b:9,0,9', 'b:10,0,9'].every((k) => board.props.get(k)?.userData.pending) && board.minis.has('robot') && !board.layers.has('ada:moonrock'); };
assert(await ok(a, standins) && await ok(b, standins), 'pieces nobody here has are drawn as stand-ins');
await a.evaluate(() => {
  const { registry, catalog } = window.__ct;
  registry.registerPack('ada', {
    blocks: { moonrock: { name: 'Moon rock', color: '#9999aa' } },
    props: { keg: { name: 'Keg', icon: '🛢️', make: () => catalog.PROPS.barrel.make() } },
    minis: { robot: { name: 'Robot', icon: '🤖', height: 1, make: () => catalog.MINIS.knight.make() } },
    shelves: { blocks: { Terrain: ['moonrock'] }, props: { Space: ['keg'] }, minis: { Heroes: ['robot'] } },
  });
});
assert(await ok(a, () => { const { board } = window.__ct; return board.layers.get('ada:moonrock')?.cells.size === 1 && !board.props.has('b:9,0,9') && board.props.get('b:10,0,9')?.userData.pending === undefined && !board.minis.get('robot').group.children[0].children[2].material.transparent; }), 'when the pack registers they stand up as themselves');
await a.click('[data-mode="build"]');
await a.click('[data-cat="things"]');
await a.click('#palette .chip:has-text("Space")');
await a.click('#palette [title="Keg"]');
assert(await ok(a, () => window.__ct.board.brush === 'ada:keg'), 'and take their place on the shelves');
await a.click('[data-cat="land"]');
assert(await ok(a, () => !!document.querySelector('#palette [title="Moon rock"]')), 'blocks too');
await a.click('[data-cat="things"]');
await a.click('#palette [title="Keg"]');
await a.evaluate(() => window.__ct.registry.unregisterPack('ada'));
assert(await ok(a, standins) && await ok(a, () => !document.querySelector('#palette [title="Keg"]') && !!document.querySelector('#palette .tile')) && await ok(b, standins), 'a pack that leaves takes them off the shelves and leaves stand-ins on the board');
assert(await a.evaluate(() => !window.__ct.board.brush.includes(':')), 'and out of the hand');
await a.evaluate(() => { const s = window.__ct.store; for (const k of ['b:9,0,9', 'b:10,0,9', 'm:robot']) s.set(k, null); });
await a.keyboard.press('1');

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
  const shelf = await p.evaluate(() => document.querySelector('#palette').getBoundingClientRect().height);
  await p.tap('#palette [title="Grass"]');
  const folded = await p.evaluate(() => ({ h: document.querySelector('#palette').getBoundingClientRect().height, cur: document.querySelector('#palette .cur')?.textContent, tiles: document.querySelectorAll('#palette .tile').length }));
  assert(folded.h <= 66 && folded.h < shelf && folded.cur === 'Grass' && folded.tiles === 0, `picking a piece folds the shelf to one row showing it (${Math.round(shelf)}px to ${Math.round(folded.h)}px)`);
  await p.tap('#palette .cur');
  assert(await p.evaluate(() => document.querySelectorAll('#palette .tile').length > 5), 'and its picture opens the shelf again');
  await p.tap('#palette .cur');
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

  // A pinch whose first finger lands on a mini still zooms the camera, and leaves the mini put.
  const camDist = () => p.evaluate(() => { const { board } = window.__ct; return board.camera.position.distanceTo(board.controls.target); });
  const d0 = await camDist();
  await touch('touchStart', [[m1.sx, m1.sy]]);
  await touch('touchStart', [[m1.sx, m1.sy], [m1.sx + 160, m1.sy]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[m1.sx + i * 8, m1.sy], [m1.sx + 160 - i * 8, m1.sy]]); await p.waitForTimeout(16); }
  await touch('touchEnd', [[m1.sx + 96, m1.sy]]);
  await touch('touchEnd', []);
  await settle();
  const m2 = await mini();
  assert(m2.x === m1.x && m2.z === m1.z, 'a pinch starting on a mini does not move it');
  assert(await camDist() > d0 + 0.3, 'a pinch starting on a mini zooms the camera');

  // Layout: with the mini editor open, then the palette open, nothing may overlap or leave the screen.
  const layout = () => p.evaluate(() => {
    const vis = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
    const boxes = ['#top', '#tools', '#palette', '#minipanel', '#floors', '#edits', '#init', '.sheet:not(.closed)', '#prepPages'].map((q) => document.querySelector(q)).filter((e) => e && !e.hidden && vis(e))
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
    if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) bad.push('the page scrolls sideways');
    return bad;
  });
  let bad = await layout();
  // A selected piece keeps the table: a ring of full-size buttons on screen around it, and no panel.
  const ring = await p.evaluate(() => {
    const top = document.querySelector('#top').getBoundingClientRect().bottom, dock = document.querySelector('#tools').getBoundingClientRect().top;
    return { panel: !document.querySelector('#minipanel').hidden, free: Math.round(((dock - top) / innerHeight) * 100),
      buttons: [...document.querySelectorAll('#ring button')].map((b) => b.getBoundingClientRect()).filter((r) => r.left >= 0 && r.top >= top && r.right <= innerWidth && r.bottom <= innerHeight).length };
  });
  assert(!ring.panel && ring.buttons === 4 && ring.free >= 60 && !bad.length, `a selected piece leaves the table clear (${ring.free}% of the height free) ${bad.join('; ')}`);
  // Hit points from the ring, then the full editor on request, with the piece still in view above it.
  await p.tap('#ring [title="Hit points"]');
  await p.tap('#ring [title="Gain a hit point"]');
  await p.tap('#ring [title="Back"]');
  await p.tap('#ring [title="More"]');
  await p.waitForTimeout(300);
  bad = await layout();
  const seen = await p.evaluate(() => {
    const { board, store } = window.__ct, spot = board.spotOf(board.selected), panel = document.querySelector('#minipanel').getBoundingClientRect();
    const beside = panel.left > spot.x || panel.right < spot.x; // on wide screens the editor sits beside the piece
    return { hp: store.get(`m:${board.selected}`).hp, open: !document.querySelector('#minipanel').hidden, clear: beside || spot.y < panel.top };
  });
  assert(seen.hp === 1 && seen.open && seen.clear && !bad.length, `the ring changes hit points, and the editor opens without hiding the piece ${JSON.stringify(seen)} ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-mini.png` });
  // Build mode: every category's tray, then the tools that came with the redesign.
  await p.tap('[data-mode="build"]');
  for (const cat of ['land', 'walls', 'things', 'figures', 'scenes']) {
    await p.tap(`[data-cat="${cat}"]`);
    bad = await layout();
    assert(!bad.length && await p.evaluate(() => document.querySelector('#palette').classList.contains('tray')), `${cat} tray layout clean ${bad.join('; ')}`);
  }
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-build.png` });
  // A theme, picked by touch: its shelf leads the things and the figures, with nothing overlapping.
  await p.tap('#menuBtn');
  await p.tap('[data-act="atmo"]');
  bad = await layout();
  await p.tap('#themes button:has-text("Pirates")');
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-theme.png` });
  await p.tap('#atmo [data-close]');
  await p.tap('[data-mode="build"]');
  await p.tap('[data-cat="things"]');
  const mine = await p.evaluate(() => ({ chip: document.querySelector('#palette .chip.on')?.textContent, palm: !!document.querySelector('#palette [title="Palm"]'), first: document.querySelector('#palette .tile')?.title }));
  await p.tap('[data-cat="figures"]');
  const crew = await p.evaluate(() => document.querySelector('#palette .tile')?.title);
  bad.push(...await layout());
  assert(mine.chip?.includes('Pirates') && mine.palm && crew === 'Pirate' && !bad.length, `a theme picked by touch puts its own shelf first ${JSON.stringify(mine)} ${crew} ${bad.join('; ')}`);
  await p.evaluate(() => { const s = window.__ct.store; s.set('at:theme', ''); s.set('at:amb', 'off'); });

  // ---- the hotbar and the library: recents, favourites, search and a grid, all by touch ----
  const saved = (k) => p.evaluate((k) => JSON.parse(localStorage.getItem(`cottontale:${k}`) ?? '{}').things ?? [], k);
  const sheetAt = (id) => p.evaluate((id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { h: e.dataset.h ?? 'half', tall: Math.round(r.height), closed: e.classList.contains('closed') }; }, id);
  await p.tap('[data-cat="things"]');
  await p.tap('#palette [title="Bush"]');
  await touch('touchStart', [[cx, cy - 60]]);
  await touch('touchEnd', []);
  await settle();
  await p.waitForSelector('#palette [title="Recent pieces"]');
  assert((await saved('recent'))[0] === 'p_bush', 'a piece put on the table leads the recents, kept on this device');
  await p.tap('#undo');
  await settle();
  await p.tap('#palette [title="Nature"]');
  await p.tap('#palette [title="Recent pieces"]');
  const recent = await p.evaluate(() => ({ brush: window.__ct.board.brush, tiles: [...document.querySelectorAll('#palette .tile')].map((t) => t.title) }));
  bad = await layout();
  assert(recent.brush === 'bush' && recent.tiles.join() === 'Bush' && !bad.length, `the recents shelf puts the last piece back in hand in one tap ${JSON.stringify(recent)} ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-recents.png` });
  // Search: the library opens at half height, and finds a piece that is on another shelf.
  await p.tap('#palette [title="Search the library"]');
  await settle();
  bad = await layout();
  const lib = await p.evaluate(() => ({ h: document.querySelector('#lib').dataset.h ?? 'half', rows: new Set([...document.querySelectorAll('#libGrid .tile')].map((t) => Math.round(t.getBoundingClientRect().top))).size, heads: [...document.querySelectorAll('#libGrid h3')].map((e) => e.textContent) }));
  assert(lib.h === 'half' && lib.rows > 2 && lib.heads[0] === 'Recent' && lib.heads.includes('Furniture') && !bad.length, `the library opens at half height as a grid, shelf by shelf ${JSON.stringify(lib)} ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-library.png` });
  await p.fill('#libQ', 'barr');
  await settle();
  const found = await p.evaluate(() => [...document.querySelectorAll('#libGrid .tile')].map((t) => t.title));
  bad = await layout();
  assert(found.join() === 'Barrel' && !bad.length, `search finds a piece on another shelf by name (${found}) ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-search.png` });
  // The handle is a button: each tap is another height, and every height is clean.
  const steps = [await sheetAt('lib')];
  for (let i = 0; i < 3 && (i === 0 || steps.at(-1).h !== 'half'); i++) {
    await p.tap('#lib .grab');
    await settle();
    steps.push(await sheetAt('lib'));
    bad.push(...await layout());
    if (steps.at(-1).h !== 'half') await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-library-${steps.at(-1).h}.png` });
  }
  const tall = Object.fromEntries(steps.map((x) => [x.h, x.tall]));
  assert(steps.at(-1).h === 'half' && tall.peek <= 64 && tall.peek < tall.half && (label === 'landscape' || tall.full > tall.half) && steps.every((x, i) => !i || x.tall !== steps[i - 1].tall) && !bad.length,
    `tapping the handle steps the sheet through its heights ${JSON.stringify(steps.map((x) => `${x.h} ${x.tall}`))} ${bad.join('; ')}`);
  // Favourites by tap: the star turns taps into pins. Then a pick arms the piece and folds the sheet away.
  await p.tap('#libPin');
  await p.tap('#libGrid [title="Barrel"]');
  await settle();
  const pinned = await p.evaluate(() => ({ brush: window.__ct.board.brush, star: !!document.querySelector('#libGrid .tile.fav[title="Barrel"]') }));
  assert((await saved('favs')).join() === 'p_barrel' && pinned.star && pinned.brush === 'bush', `with the star on, tapping a piece pins it and leaves the piece in hand alone ${JSON.stringify(pinned)}`);
  await p.tap('#libPin');
  await p.tap('#libGrid [title="Barrel"]');
  await settle();
  bad = await layout();
  const picked = await p.evaluate(() => ({ brush: window.__ct.board.brush, cur: document.querySelector('#palette .cur')?.textContent, shelf: document.querySelector('#palette .chip.on:not([title="Search the library"])')?.textContent, h: document.querySelector('#lib').dataset.h }));
  assert(picked.brush === 'barrel' && picked.cur === 'Barrel' && picked.shelf === 'Furniture' && picked.h === 'peek' && !bad.length, `picking in the library arms the piece and folds the sheet to its search row ${JSON.stringify(picked)} ${bad.join('; ')}`);
  await p.tap('#lib [data-close]');
  await settle();
  // The favourites shelf, and the long-press shortcut that lets a favourite go.
  await p.tap('#palette [title="Favourites"]');
  await settle();
  const star = await p.evaluate(() => { const t = document.querySelector('#palette .tile.fav[title="Barrel"]'); t.scrollIntoView({ inline: 'center' }); const r = t.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  bad = await layout();
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-favourites.png` });
  await touch('touchStart', [star]);
  await p.waitForTimeout(700);
  await touch('touchEnd', []);
  await settle();
  assert((await saved('favs')).length === 0 && !bad.length && await p.evaluate(() => !document.querySelector('#palette [title="Favourites"]') && document.querySelector('#lib').classList.contains('closed')), `a long press unpins, and an empty favourites shelf goes away ${bad.join('; ')}`);
  await p.tap('[data-cat="land"]');
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
    // A finger on the table folds the sheet to one row; its handle brings it back.
    await touch('touchStart', [[cx - 100, viewport.height * 0.3]]);
    await touch('touchEnd', []);
    await settle();
    bad = await layout();
    const row = await p.evaluate((id) => { const e = document.querySelector(`#${id}`); return { h: e.dataset.h, tall: e.getBoundingClientRect().height, closed: e.classList.contains('closed') }; }, sheet);
    assert(row.h === 'peek' && row.tall <= 64 && !row.closed && !bad.length, `touching the table drops the ${sheet} sheet to a single row ${JSON.stringify(row)} ${bad.join('; ')}`);
    await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-${sheet}-peek.png` });
    await p.tap(`#${sheet} .grab`);
    if (sheet === 'boards') {
      // Drilling down stays in the sheet: a page with Back takes the place of its content.
      await p.evaluate(() => window.__ct.ui.pushSheetPage('boards', 'A board', (el) => { el.innerHTML = '<p class="hint">Details</p>'; }));
      bad = await layout();
      const page = await p.evaluate(() => ({ sheets: document.querySelectorAll('.sheet:not(.closed)').length, list: document.querySelector('#boardList').offsetParent !== null, title: document.querySelector('#boards .page b')?.textContent }));
      await p.tap('#boards .page [aria-label="Back"]');
      const back = await p.evaluate(() => document.querySelector('#boardList').offsetParent !== null && !document.querySelector('#boards .page'));
      assert(page.sheets === 1 && !page.list && page.title === 'A board' && back && !bad.length, `a drill-down is a page inside the same sheet, and Back returns ${JSON.stringify(page)} ${bad.join('; ')}`);
    }
    await p.tap(`#${sheet} [data-close]`);
  }

  // ---- Prep: full-screen pages with a title bar and Back; the phone's own back button works too ----
  await p.tap('[data-mode="prep"]');
  await settle();
  bad = await layout();
  const prep = await p.evaluate(() => ({ title: document.querySelector('#prepTitle').textContent, rows: [...document.querySelectorAll('.prepRow b')].map((b) => b.textContent), dock: document.querySelector('#tools').offsetParent !== null, focus: document.activeElement?.id }));
  assert(prep.title === 'Prep' && prep.rows.join() === 'Theme,Packs,Import,Rules,Sound' && !prep.dock && prep.focus === 'prepTitle' && !bad.length, `Prep opens as a full-screen list of pages, in place of the dock ${JSON.stringify(prep)} ${bad.join('; ')}`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-prep.png` });
  await p.tap('.prepRow[data-page="theme"]');
  await p.waitForSelector('.card[data-theme="pirate"]');
  await p.tap('.card[data-theme="pirate"]');
  await p.waitForFunction(() => window.__ct.store.get('at:theme')?.id === 'pirate' && document.querySelector('.card.on')?.dataset.theme === 'pirate');
  bad = await layout();
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-prep-theme.png` });
  await p.tap('.card[data-theme="pirate"]');
  await p.waitForFunction(() => window.__ct.store.get('at:theme') === '' && !document.querySelector('.card.on'));
  assert(await p.textContent('#prepTitle') === 'Theme' && await p.evaluate(() => document.querySelectorAll('.card').length >= 4) && !bad.length, `the Theme page is a gallery; a card picks a theme and lets go of it, as the Atmosphere sheet does ${bad.join('; ')}`);
  await p.evaluate(() => window.__ct.store.set('set:amb', 'off'));
  await p.tap('#prepPageBack');
  await p.waitForFunction(() => document.querySelector('#prepTitle').textContent === 'Prep');
  await p.tap('.prepRow[data-page="packs"]');
  await p.waitForFunction(() => document.querySelector('#prepTitle').textContent === 'Packs');
  bad = await layout();
  await p.goBack();
  await p.waitForFunction(() => document.querySelector('#prepTitle').textContent === 'Prep');
  await p.goBack();
  await p.waitForFunction(() => document.querySelector('#prepPages').hidden);
  bad.push(...await layout());
  assert(await p.evaluate(() => !window.__ct.ui.prep.isOpen && document.querySelector('#tools').offsetParent !== null && location.hash.includes('room=')) && !bad.length, `Back walks out of Prep a page at a time, by the button and by the phone's own, and the table is as it was ${bad.join('; ')}`);

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

  // ---- the GM's own pieces: a picture from the phone becomes a figure (Prep → Import), and Packs shows it ----
  {
  const shot = (name) => p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-${name}.png` });
  // Upright with a file server; lying down with none (the picture stays on the phone and goes from player to player).
  await p.evaluate((list) => window.__ct.store.set('set:blossom', list), label === 'portrait' ? [`http://localhost:${BLOSSOM}`] : []);
  await p.evaluate(() => { for (const s of document.querySelectorAll('.sheet:not(.closed) [data-close]')) s.click(); });
  await p.tap('[data-mode="prep"]');
  await p.tap('.prepRow[data-page="import"]');
  await p.waitForSelector('#impShoot');
  bad = await layout();
  const inputs = await p.evaluate(() => ({ camera: document.querySelector('#impCamera').getAttribute('capture'), accept: document.querySelector('#impCamera').accept, many: document.querySelector('#impFiles').multiple }));
  assert(inputs.camera === 'environment' && inputs.accept === 'image/*' && inputs.many && !bad.length, `Import offers the camera and the phone's pictures ${bad.join('; ')}`);
  await shot('import');
  await p.setInputFiles('#impFiles', TOKEN);
  await p.waitForSelector('#impCrop');
  await settle();
  bad = await layout();
  // One finger moves the picture, two zoom it; the buttons do the same for a thumb.
  const cropBox = await p.locator('#impCrop').boundingBox(), [kx, ky] = [cropBox.x + cropBox.width / 2, cropBox.y + cropBox.height / 2];
  await p.tap('#impIn');
  await touch('touchStart', [[kx, ky]]);
  for (let i = 1; i <= 4; i++) await touch('touchMove', [[kx + i * 6, ky + i * 3]]);
  await touch('touchEnd', []);
  await touch('touchStart', [[kx - 30, ky]]);
  await touch('touchStart', [[kx - 30, ky], [kx + 30, ky]]);
  for (let i = 1; i <= 4; i++) await touch('touchMove', [[kx - 30 - i * 5, ky], [kx + 30 + i * 5, ky]]);
  await touch('touchEnd', []);
  await settle();
  await shot('import-crop');
  await p.tap('[data-frame="square"]'); // back to the whole picture in a square frame
  await p.tap('#impNext');
  await p.waitForSelector('.impCut');
  await settle();
  const cutBox = await p.locator('.impCut').boundingBox();
  const before = await cutAlpha(p);
  await p.touchscreen.tap(cutBox.x + 5, cutBox.y + 5);
  await settle();
  const erased = await cutAlpha(p);
  // A second finger never edits: rubbing out with two fingers down changes nothing.
  await p.tap('[data-tool="erase"]');
  const [mx, my] = [cutBox.x + cutBox.width / 2, cutBox.y + cutBox.height / 2];
  await touch('touchStart', [[mx, my]]);
  await touch('touchStart', [[mx, my], [mx + 50, my]]);
  for (let i = 1; i <= 4; i++) await touch('touchMove', [[mx + i * 4, my], [mx + 50 + i * 4, my]]);
  await touch('touchEnd', []);
  await settle();
  const twoFingers = await cutAlpha(p);
  bad.push(...await layout());
  assert(before.corner === 255 && erased.corner === 0 && erased.mid === 255 && twoFingers.mid === 255 && !bad.length, `tapping the background cuts it away and leaves the figure; two fingers edit nothing ${JSON.stringify({ before, erased, twoFingers })} ${bad.join('; ')}`);
  await shot('import-cut');
  await p.tap('#impNext');
  await p.waitForSelector('#impName');
  await p.fill('#impName', 'Orc');
  await p.evaluate(() => document.activeElement?.blur());
  bad = await layout();
  await p.waitForTimeout(250);
  await shot('import-name');
  await p.tap('#impDone');
  await p.waitForSelector('.impDone li.ok');
  bad.push(...await layout());
  const saved = await p.evaluate(() => ({ text: document.querySelector('.impDone li.ok').textContent, pack: window.__ct.packs.listPacks()[0] }));
  const piece = saved.pack?.pieces[0];
  assert((label === 'portrait' ? /Stored on 1 server/ : /Saved on this phone and shared with players directly/).test(saved.text) && piece?.group === 'minis' && piece.entry.kind === 'standee' && piece.entry.name === 'Orc'
    && /^image\/(webp|png)$/.test(piece.entry.ref.m) && piece.bytes <= 60 * 1024 + 28 && !bad.length, `a picture becomes a figure of the table's own pack, and says where it was stored (${saved.text.slice(3, 70)}; ${piece?.bytes} bytes) ${bad.join('; ')}`);
  await shot('import-done');
  await p.tap('#impPacks');
  await p.waitForSelector('.pkPiece i[style]');
  bad = await layout();
  await shot('packs');
  await p.tap('.pkPiece');
  await p.tap('.pkDropPiece');
  await p.waitForSelector('.pkYes');
  bad.push(...await layout());
  await p.waitForTimeout(250);
  await shot('packs-confirm');
  await p.tap('.pkKeep');
  await p.tap('.pkRename');
  await p.fill('.pkName', 'Horde');
  await p.evaluate(() => document.activeElement?.blur());
  bad.push(...await layout());
  await p.tap('.pkSave');
  await p.waitForFunction(() => window.__ct.packs.listPacks()[0]?.name === 'Horde' && document.querySelector('.pkHead b')?.textContent === 'Horde');
  assert(await p.evaluate(() => window.__ct.packs.listPacks()[0].pieces.length === 1 && document.querySelectorAll('.pkPiece').length === 1) && !bad.length, `Packs shows the pack with its pieces; removing asks first, in the page; a pack can be renamed ${bad.join('; ')}`);
  await p.evaluate(() => window.__ct.ui.prep.close());
  // And in Build the piece is on its shelf, with its picture, like any other.
  await p.tap('[data-mode="build"]');
  await p.tap('[data-cat="figures"]');
  if (await p.evaluate(() => ![...document.querySelectorAll('#palette .chip')].some((c) => c.textContent === 'Horde'))) await p.tap('#palette .cur');
  await p.evaluate(() => [...document.querySelectorAll('#palette .chip')].find((c) => c.textContent === 'Horde').click());
  await p.waitForFunction(() => /url\(/.test(document.querySelector('#palette .tile[title="Orc"] i, #palette .cur i')?.getAttribute('style') ?? ''));
  bad = await layout();
  await shot('packs-shelf');
  const hand = await p.evaluate(() => ({ k: window.__ct.board.hooks.newMini().k, id: window.__ct.packs.listPacks()[0].pieces[0].id }));
  assert(hand.k === hand.id && !bad.length, `the new figure is on its shelf in Build, with its picture, and in hand ${JSON.stringify(hand)} ${bad.join('; ')}`);
  }
  await p.context().close();
}

// ---- files without a server (src/blob.ts): Blossom server, player to player, and a server that says no ----
{
  const a = await join('Fay', 'files-1234'), b = await join('Gus', 'files-1234');
  await a.waitForFunction(() => window.__ct.net.peers.size === 1);
  await b.waitForFunction(() => window.__ct.net.peers.size === 1);
  const server = `http://localhost:${BLOSSOM}`;
  /** Put pseudo-random bytes on a page; returns the reference, a checksum of the plain bytes and how the servers answered. */
  const put = (page, size, seed) => page.evaluate(async ([size, seed]) => {
    const bytes = new Uint8Array(size);
    for (let i = 0, x = seed; i < size; i++) bytes[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 16;
    const { blobs } = window.__ct;
    const ref = await blobs.put(bytes, 'image/png');
    const sum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].join();
    return { ref, sum, outcomes: blobs.outcomes(ref.h) };
  }, [size, seed]);
  const get = (page, ref) => page.evaluate(async (ref) => {
    const { blobs } = window.__ct;
    const seen = [];
    const off = blobs.onProgress((h, loaded, total) => seen.push([h, loaded, total]));
    try {
      const [bytes, again] = await Promise.all([blobs.get(ref), blobs.get(ref)]); // asked twice, fetched once
      const sum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].join();
      return { sum, n: bytes.length, same: again.length === bytes.length, via: blobs.source(ref.h), progress: seen.filter(([h]) => h === ref.h).length, last: seen.at(-1) };
    } catch (e) { return { error: String(e) }; } finally { off(); }
  }, ref);
  const servers = async (list) => {
    await a.evaluate((list) => window.__ct.store.set('set:blossom', list), list);
    await b.waitForFunction((n) => window.__ct.blobs.servers().length === n, list.length);
  };

  // (a) A server is configured and takes the blob: the other player gets it from there.
  await servers([server]);
  const one = await put(a, 50_000, 1);
  assert(one.outcomes.length === 1 && one.outcomes[0].ok && one.ref.s?.[0] === server && one.ref.n === 50_028 && /^[0-9a-f]{64}$/.test(one.ref.h),
    `a blob put with a Blossom server configured is accepted there (${JSON.stringify(one.outcomes)})`);
  const stored = await fetch(`${server}/${one.ref.h}`).then((r) => r.arrayBuffer());
  assert(stored.byteLength === one.ref.n, 'the server holds the ciphertext under its hash');
  const gotOne = await get(b, one.ref);
  assert(gotOne.sum === one.sum && gotOne.via === 'server' && gotOne.same && gotOne.progress > 0, `the other player gets identical bytes from the server (${JSON.stringify({ ...gotOne, sum: undefined })})`);
  assert((await get(b, one.ref)).via === 'cache', 'and finds it in the local cache the next time');
  const bad = await get(b, { ...one.ref, m: 'image/jpeg' });
  assert(/Error/.test(bad.error ?? ''), 'a reference that lies about the type is refused');

  // (b) No server at all: the blob travels from player to player (too big for the relay path, so WebRTC it is).
  await servers([]);
  const two = await put(a, 300_000, 2);
  assert(two.outcomes.length === 0 && !two.ref.s, 'with no server configured a blob is kept on the device only');
  const gotTwo = await get(b, two.ref);
  assert(gotTwo.sum === two.sum && gotTwo.via === 'peer' && gotTwo.progress > 10 && gotTwo.last?.[1] === two.ref.n,
    `with no server the other player gets it peer-to-peer over WebRTC (${JSON.stringify({ ...gotTwo, sum: undefined })})`);

  // (c) The server refuses the upload (too large for it): that is reported, not thrown, and the players pass it on themselves.
  await servers([server]);
  const three = await put(a, 250_000, 3);
  assert(three.outcomes.length === 1 && three.outcomes[0].ok === false && three.outcomes[0].status === 413 && /too large/i.test(three.outcomes[0].reason) && !three.ref.s,
    `a server that refuses the upload is reported, not thrown (${JSON.stringify(three.outcomes)})`);
  const gotThree = await get(b, three.ref);
  assert(gotThree.sum === three.sum && gotThree.via === 'peer', `and the blob still arrives, peer-to-peer (${gotThree.via ?? gotThree.error})`);

  // WebRTC unavailable (as behind strict NATs): a small blob goes through the relay in pieces, a big one fails cleanly.
  await servers([]);
  await b.evaluate(() => { window.__rtc = window.RTCPeerConnection; delete window.RTCPeerConnection; });
  const four = await put(a, 40_000, 4);
  const gotFour = await get(b, four.ref);
  assert(gotFour.sum === four.sum && gotFour.via === 'relay', `without WebRTC a small blob comes through the relay in pieces (${gotFour.via ?? gotFour.error})`);
  const five = await put(a, 100_000, 5);
  const gotFive = await get(b, five.ref);
  assert(/not available/.test(gotFive.error ?? ''), 'and a big one is reported as unavailable rather than hanging');
  await b.evaluate(() => { window.RTCPeerConnection = window.__rtc; });
  assert((await get(b, five.ref)).sum === five.sum, 'which works again once WebRTC is back');
  const url = await b.evaluate(async (ref) => {
    const { blobs } = window.__ct;
    const u = await blobs.objectUrl(ref);
    const n = (await (await fetch(u)).arrayBuffer()).byteLength;
    blobs.release(ref);
    await new Promise((r) => setTimeout(r, 50));
    return { n, revoked: await fetch(u).then(() => false, () => true) };
  }, one.ref);
  assert(url.n === 50_000 && url.revoked, 'objectUrl hands out the decrypted file and revokes it on release');
  await a.context().close();
  await b.context().close();
}

// ---- the GM's own pieces (src/packs.ts, src/standee.ts): a picture imported on one device is a piece on every device ----
{
  console.log('packs');
  const a = await join('Ivy', 'packs-1234'), b = await join('Jon', 'packs-1234');
  await a.waitForFunction(() => window.__ct.net.peers.size === 1);
  await b.waitForFunction(() => window.__ct.net.peers.size === 1);
  await a.evaluate((server) => { const s = window.__ct.store; s.set(`gm:${s.me}`, true); s.set('set:blossom', [server]); }, `http://localhost:${BLOSSOM}`);
  await b.waitForFunction(() => window.__ct.blobs.servers().length === 1 && document.body.classList.contains('player'));
  for (const page of [a, b]) await page.evaluate(() => { const { board } = window.__ct; board.camera.position.set(3, 7, 15); board.controls.target.set(3, 0, 3); });
  /** Take one picture through Prep → Import as the GM would: crop, cut the paper away, name it, say what it is. */
  const bring = async (name, as) => {
    await a.evaluate(() => window.__ct.ui.prep.open('import'));
    await a.setInputFiles('#impFiles', TOKEN);
    await a.click('#impNext');
    await a.waitForSelector('.impCut');
    await a.click('.impCut', { position: { x: 4, y: 4 } });
    await a.click('#impNext');
    await a.fill('#impName', name);
    await a.click(`[data-as="${as}"]`);
    await a.click('#impDone');
    await a.waitForFunction((name) => [...document.querySelectorAll('.impDone li.ok b')].some((x) => x.textContent === name), name);
  };
  await bring('Orc', 'figure');
  await bring('Idol', 'thing');
  const made = await a.evaluate(() => ({ said: document.querySelector('.impDone li.ok span').textContent, pack: window.__ct.packs.listPacks()[0], keys: [...window.__ct.store.keys('pk:')] }));
  const orc = made.pack.pieces.find((x) => x.entry.name === 'Orc'), idol = made.pack.pieces.find((x) => x.entry.name === 'Idol');
  assert(made.keys.length === 1 && made.keys[0] === `pk:${made.pack.ns}` && /^u-[0-9a-f]{10}$/.test(made.pack.ns) && orc?.group === 'minis' && idol?.group === 'props' && /Stored on 1 server/.test(made.said)
    && [orc, idol].every((x) => x.entry.kind === 'standee' && x.bytes <= 60 * 1024 + 28 && x.entry.ref.s?.length === 1), `the GM imports a picture as a figure and as a thing: one pack in the table, files on the server (${orc?.bytes} and ${idol?.bytes} bytes, ${orc?.entry.ref.m})`);
  // On the table: a figure and a thing. The other player has the pack as stand-ins until the pieces are drawn, then as pictures.
  await a.evaluate(([m, p]) => { const s = window.__ct.store; s.set('m:tok', { x: 1, y: 0, z: 6, k: m, c: '#3e63dd', n: 'Grok', r: 0, s: 1, hp: 5, mhp: 9 }); s.set('b:0,0,0', { i: p }); }, [orc.id, idol.id]);
  const drawn = ([m, p]) => {
    const { board, packs, registry } = window.__ct, card = (o) => o?.geometry?.userData.standee;
    const batch = board.scene.children.filter((o) => o.userData.standees && o.visible);
    return registry.known.mini(m) && registry.known.prop(p) && packs.pieceState(m) === 'ready' && packs.pieceState(p) === 'ready'
      && !!card(board.minis.get('tok')?.group.children[0].children[2]) && !!card(board.props.get('b:0,0,0')?.children[0]) && batch.length === 1 && batch[0].count === 2;
  };
  await b.waitForFunction(drawn, [orc.id, idol.id]);
  await a.waitForFunction(drawn, [orc.id, idol.id]);
  const seen = await b.evaluate(([m, ref]) => {
    const { board, blobs, catalog } = window.__ct, page = board.scene.children.find((o) => o.userData.standees), g = page.material.map.image.getContext('2d');
    const mini = board.minis.get('tok');
    return { via: blobs.source(ref.h), page: page.material.map.image.width, edge: g.getImageData(8, 8, 1, 1).data[3], mid: [...g.getImageData(128, 128, 1, 1).data], height: catalog.MINIS[m].height,
      label: mini.group.children[1].visible, base: mini.group.children[0].children[0].isMesh };
  }, [orc.id, orc.entry.ref]);
  assert(seen.via === 'server' && seen.page === 1024 && seen.edge === 0 && seen.mid[3] === 255 && seen.mid[0] > 150 && seen.mid[2] < 90 && seen.height > 1 && seen.label && seen.base,
    `the other player sees them as themselves: the picture fetched through blobs, cut out, on a shared page, with a base and a name plate ${JSON.stringify(seen)}`);
  await b.waitForTimeout(400);
  await b.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/standees.png` });
  // A hidden figure, line of sight and the rest are the board's own, as for any mini: the GM hides it, the player loses it.
  await a.evaluate(() => { const s = window.__ct.store; s.set('m:tok', { ...s.get('m:tok'), h: true }); });
  await b.waitForFunction(() => window.__ct.board.minis.get('tok').group.visible === false && window.__ct.board.scene.children.find((o) => o.userData.standees).count === 1);
  assert(await a.evaluate(() => window.__ct.board.scene.children.find((o) => o.userData.standees).count === 2), 'a hidden standee leaves the player\'s table and stays (faded) on the GM\'s');
  await a.evaluate(() => { const s = window.__ct.store; s.set('m:tok', null); });

  // Draw calls: twenty tokens cost what one costs (one call for the page they share).
  const calls = (page) => page.evaluate(() => new Promise((done) => {
    const { board } = window.__ct, info = board.renderer.info, was = board.hooks.onView;
    info.autoReset = false;
    board.touched();
    info.reset();
    board.hooks.onView = () => { board.hooks.onView = was; was(); const n = info.render.calls; info.autoReset = true; done(n); };
  }));
  const things = (n, id) => b.evaluate(([n, id]) => { const s = window.__ct.store; for (let i = 0; i < 20; i++) s.set(`b:${i % 5},0,${Math.floor(i / 5)}`, i < n ? { i: id } : null); }, [n, id]);
  const figures = (n, id) => b.evaluate(([n, id]) => { const s = window.__ct.store; for (let i = 0; i < 20; i++) s.set(`m:f${i}`, i < n ? { x: i % 5, y: 0, z: 6 + Math.floor(i / 5), k: id, c: '#3e63dd', n: '', r: 0, s: 1 } : null); }, [n, id]);
  const settled = (n) => b.waitForFunction((n) => { const m = window.__ct.board.scene.children.find((o) => o.userData.standees); return (m?.visible ? m.count : 0) === n; }, n);
  await a.evaluate(() => { const s = window.__ct.store; s.set(`gm:${s.me}`, null); }); // free play again: the player may build
  await b.waitForFunction(() => !document.body.classList.contains('player'));
  let cost;
  for (let tries = 0; tries < 4; tries++) { // the board may change its own quality between two measurements on a busy machine: measure until it did not
    await things(1, idol.id); await settled(1); await b.waitForTimeout(300);
    const one = await calls(b);
    await things(20, idol.id); await settled(20); await b.waitForTimeout(300);
    const twenty = await calls(b);
    await things(1, idol.id); await settled(1); await b.waitForTimeout(300);
    cost = { one, twenty, again: await calls(b) };
    if (cost.one === cost.again) break;
  }
  await things(0, idol.id);
  await settled(0);
  // Figures keep the base and name plate every mini has; the card itself adds nothing per figure.
  await figures(1, orc.id); await settled(1); await b.waitForTimeout(300);
  const fig1 = await calls(b);
  await figures(20, orc.id); await settled(20); await b.waitForTimeout(300);
  const fig20 = await calls(b);
  await b.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/standees-20.png` });
  await figures(0, orc.id); await settled(0);
  await figures(1, 'marker'); await b.waitForTimeout(400);
  const core1 = await calls(b);
  await figures(20, 'marker'); await b.waitForTimeout(400);
  const core20 = await calls(b);
  await figures(0, 'marker');
  console.log(`      draw calls a frame — standee things: 1 → ${cost.one}, 20 → ${cost.twenty}; standee figures: 1 → ${fig1}, 20 → ${fig20}; built-in marker figures: 1 → ${core1}, 20 → ${core20}`);
  assert(cost.one === cost.again && cost.twenty === cost.one, `twenty standees cost the draw calls of one (${cost.one} a frame with 1, ${cost.twenty} with 20)`);
  assert(fig20 - fig1 <= core20 - core1, `and a standee figure costs no more than the simplest built-in one (${fig20 - fig1} for 19 more, against ${core20 - core1})`);

  // The table's export carries the pack (the manifest: the files stay where they are stored).
  await a.evaluate(([m, p]) => { const s = window.__ct.store; s.set(`gm:${s.me}`, true); s.set('m:tok', { x: 1, y: 0, z: 6, k: m, c: '#3e63dd', n: 'Grok', r: 0, s: 1 }); s.set('b:0,0,0', { i: p }); }, [orc.id, idol.id]);
  await b.waitForFunction(drawn, [orc.id, idol.id]);
  const rows = await a.evaluate(() => window.__ct.store.dump().filter((r) => r[1] !== null && r[0].startsWith('pk:')).map(([k, v]) => [k, v]));
  assert(rows.length === 1 && Object.keys(rows[0][1].pieces.minis).length === 1, 'saving the table keeps its packs');
  // Removing the pack (Packs page, with its confirm step) leaves stand-ins on every device.
  await a.click('#impPacks');
  await a.waitForSelector('.pkPiece i[style]');
  await a.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/packs-desktop.png` });
  await a.click('.pkDrop');
  assert(await a.evaluate(() => [...window.__ct.store.keys('pk:')].length === 1 && !!document.querySelector('.pkAsk[role="alertdialog"]')), 'removing a pack asks first, in the page');
  await a.click('.pkYes');
  const standIns = ([m, p]) => {
    const { board, packs, registry } = window.__ct, batch = board.scene.children.filter((o) => o.userData.standees && o.visible);
    return !registry.known.mini(m) && !registry.known.prop(p) && packs.pieceState(m) === null && board.props.get('b:0,0,0')?.userData.pending === true
      && board.minis.get('tok')?.group.children[0].children[2].material.transparent === true && batch.length === 0;
  };
  await b.waitForFunction(standIns, [orc.id, idol.id]);
  assert(await a.evaluate(standIns, [orc.id, idol.id]) && await a.evaluate(() => !document.querySelector('.pkPack')), 'with the pack removed its pieces are stand-ins again, for everyone');
  // And importing the saved table brings the pack back: the pictures are still where they were stored.
  await a.evaluate(() => window.__ct.ui.prep.close());
  await a.setInputFiles('#file', { name: 'table.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ cottontale: 1, rows })) });
  await b.waitForFunction(drawn, [orc.id, idol.id]);
  assert(await a.evaluate(drawn, [orc.id, idol.id]), 'importing the table brings its packs back, pictures and all');
  await a.context().close();
  await b.context().close();
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
