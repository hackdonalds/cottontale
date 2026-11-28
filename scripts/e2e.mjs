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
// E2E_KEEP=1 carries on past a failed check and counts them, to see everything that is wrong in one run.
let failed = 0;
const assert = (ok, what) => { console.log(ok ? '  ok  ' : ' FAIL ', what); if (!ok) { failed++; if (!process.env.E2E_KEEP) done(1); } };
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
  page.on('pageerror', (e) => { console.log('pageerror', name, e.stack ?? e.message); done(1); });
  await page.goto(url(room));
  await page.fill('#name', name);
  await page.click('#join');
  await page.waitForSelector('#hud:not([hidden])', { state: 'attached' });
  return page;
}
const count = (page, prefix) => page.evaluate((p) => [...window.__ct.store.keys(p)].length, prefix);

/** A short WAV file (16-bit mono), made here: a tone that fades out. */
function wavFile(seconds, rate = 8000, hz = 330) {
  const n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 9000 * (1 - i / n)), 44 + i * 2);
  return b;
}
/** Choose a file as a finger would: tap the button, and answer the phone's file picker. */
async function chooseFile(page, button, file, tap = false) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tap ? page.tap(button) : page.click(button)]);
  await chooser.setFiles(file);
}
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
// Models to import (src/model.ts): made here too, as plain glTF binary.
/** A .glb made here: one mesh, material and node for each part ({ pos, idx, rgb?, uv?, image?, at? }). */
function glb(parts, images = [], more = () => {}) {
  const chunks = [], bufferViews = [], accessors = [];
  let at = 0;
  const view = (bytes) => { bufferViews.push({ buffer: 0, byteOffset: at, byteLength: bytes.length }); chunks.push(bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)); at += (bytes.length + 3) & ~3; return bufferViews.length - 1; };
  const acc = (a, type, n) => { accessors.push({ bufferView: view(Buffer.from(a.buffer)), componentType: a instanceof Float32Array ? 5126 : 5125, count: a.length / n, type }); return accessors.length - 1; };
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: parts.map((_, i) => i) }], nodes: [], meshes: [], materials: [], accessors, bufferViews };
  parts.forEach((p, i) => {
    const attributes = { POSITION: acc(Float32Array.from(p.pos), 'VEC3', 3) };
    if (p.uv) attributes.TEXCOORD_0 = acc(Float32Array.from(p.uv), 'VEC2', 2);
    json.meshes.push({ primitives: [{ attributes, indices: acc(Uint32Array.from(p.idx), 'SCALAR', 1), material: i }] });
    json.materials.push({ pbrMetallicRoughness: { baseColorFactor: [...(p.rgb ?? [1, 1, 1]), 1], ...(p.image !== undefined ? { baseColorTexture: { index: p.image } } : {}) } });
    json.nodes.push({ mesh: i, ...(p.at ? { translation: p.at } : {}) });
  });
  if (images.length) { json.images = images.map((b) => ({ bufferView: view(b), mimeType: 'image/png' })); json.textures = images.map((_, i) => ({ source: i })); }
  json.buffers = [{ byteLength: at }];
  more(json);
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks), head = Buffer.alloc(20), mid = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + text.length + bin.length, 8); head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  mid.writeUInt32LE(bin.length, 0); mid.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, text, mid, bin]);
}
function boxPart(w, h, d) {
  const pos = [], idx = [];
  for (let i = 0; i < 8; i++) pos.push(i & 1 ? w : 0, i & 2 ? h : 0, i & 4 ? d : 0);
  for (const [a, b, c, e] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) idx.push(a, b, c, a, c, e);
  return { pos, idx };
}
function ballPart(seg, r = 1) {
  const pos = [], idx = [], uv = [], rows = seg / 2;
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= seg; x++) { const a = (x / seg) * Math.PI * 2, b = (y / rows) * Math.PI; pos.push(Math.cos(a) * Math.sin(b) * r, Math.cos(b) * r, Math.sin(a) * Math.sin(b) * r); uv.push(x / seg, y / rows); }
  for (let y = 0; y < rows; y++) for (let x = 0; x < seg; x++) { const i = y * (seg + 1) + x; idx.push(i, i + 1, i + seg + 1, i + 1, i + seg + 2, i + seg + 1); }
  return { pos, idx, uv };
}
// A snowman of 40,000 triangles with a red hat and a blue box beside it; a crate with a picture on it; and two that must be refused.
const STATUE = { name: 'snow_man.glb', mimeType: 'model/gltf-binary', buffer: glb([{ ...ballPart(180, 0.5), rgb: [0.9, 0.9, 0.95], at: [0, 0.5, 0] }, { ...ballPart(90, 0.32), rgb: [0.9, 0.9, 0.95], at: [0, 1.2, 0] }, { ...boxPart(0.4, 0.3, 0.4), rgb: [0.8, 0.1, 0.1], at: [-0.2, 1.45, -0.2] }, { ...boxPart(0.3, 0.3, 0.3), rgb: [0.1, 0.2, 0.8], at: [0.6, 0, 0] }], [], (j) => { j.animations = [{ channels: [], samplers: [] }]; }) };
const crate = boxPart(1, 1, 1);
const CRATE = { name: 'crate.glb', mimeType: 'model/gltf-binary', buffer: glb([{ pos: [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1], idx: [0, 1, 2, 0, 2, 3], uv: [0, 1, 1, 1, 1, 0, 0, 0], image: 0 }, { ...crate, rgb: [0.6, 0.4, 0.2] }], [png(64, 64, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [220, 40, 40, 255] : [250, 220, 60, 255])]) };
const HUGE = { name: 'city.glb', mimeType: 'model/gltf-binary', buffer: Buffer.alloc(26 * 1024 * 1024) };
const DENSE = { name: 'scan.glb', mimeType: 'model/gltf-binary', buffer: glb([boxPart(1, 1, 1)], [], (j) => { j.accessors[1].count = 3_000_000; }) };

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

// Dice bounce off the pieces on the table, and a piece that is hit rocks, settles, and stays where it was.
const knock = await a.evaluate(async () => {
  const { board, store } = window.__ct;
  const [id, m] = [...board.minis][0], v = m.val, before = JSON.stringify(store.get(`m:${id}`));
  const solid = board.solidsNear([v.x + 0.5, v.y, v.z + 0.5], 1).some((s) => s.round && s.p[0] === v.x + 0.5 && s.p[2] === v.z + 0.5);
  const at = m.group.position.clone().set(v.x + 0.9, v.y + 0.4, v.z + 0.5);
  board.dice.onBump(at, at.clone().set(-6, 0, 0));
  await new Promise((r) => setTimeout(r, 150));
  const lean = Math.abs(m.group.children[0].rotation.z) + Math.abs(m.group.children[0].rotation.x);
  for (let i = 0; i < 80 && board.wobbles.has(id); i++) await new Promise((r) => setTimeout(r, 100)); // (frames can be slow here)
  const body = board.minis.get(id).group.children[0];
  return { solid, lean, rocking: board.wobbles.has(id), upright: Math.abs(body.rotation.x) + Math.abs(body.rotation.z) < 1e-6, same: before === JSON.stringify(store.get(`m:${id}`)) };
});
assert(knock.solid && knock.lean > 0.02 && !knock.rocking && knock.upright && knock.same, `a mini is solid to dice; knocked, it rocks and settles without changing the table ${JSON.stringify(knock)}`);
assert(true, 'mixed hands, percentile, /r and chat delivered');

// Feel: a moved mini hops over in an arc and lands squashed; a knocked-down one falls rather than snaps.
// All for show: it ends exactly on the resting pose and writes nothing of its own to the table.
const feel = await a.evaluate(async () => {
  const { board, store } = window.__ct;
  const [id, m] = [...board.minis][0], orig = { ...m.val }, body = () => board.minis.get(id).group.children[0];
  // Watch the mini every frame until `until` says it is over (or time runs out).
  const watch = (until, ms = 20000) => new Promise((res) => {
    const seen = { top: -Infinity, squashed: 1, part: false }, t0 = performance.now();
    const tick = () => {
      const g = board.minis.get(id).group, rx = body().rotation.x;
      seen.top = Math.max(seen.top, g.position.y);
      seen.squashed = Math.min(seen.squashed, body().scale.y / (orig.s || 1));
      if (rx < -0.05 && rx > -Math.PI / 2 + 0.05) seen.part = true;
      if (until() || performance.now() - t0 > ms) res(seen); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const calm = () => { const x = board.minis.get(id); return !x.hop && !x.fall && x.squash === undefined && !board.wobbles.has(id); };
  store.set(`m:${id}`, { ...orig, x: orig.x + 2 });
  const hopping = !!board.minis.get(id).hop;
  const hop = await watch(calm);
  const g = board.minis.get(id).group, b = body();
  const landed = g.position.x === orig.x + 2.5 && g.position.y === orig.y && b.scale.y === (orig.s || 1) && b.scale.x === (orig.s || 1) && Math.abs(b.rotation.x) + Math.abs(b.rotation.z) < 1e-6;
  store.set(`m:${id}`, { ...orig, x: orig.x + 2, d: true });
  const fall = await watch(calm);
  const flat = body().rotation.x === -Math.PI / 2;
  store.set(`m:${id}`, { ...orig, x: orig.x + 2 });
  const rise = await watch(calm);
  const up = body().rotation.x === 0;
  store.set(`m:${id}`, orig);
  await watch(calm);
  return { hopping, top: hop.top - orig.y, squashed: hop.squashed, landed, fell: fall.part, flat, rose: rise.part, up, back: JSON.stringify(store.get(`m:${id}`)) === JSON.stringify(orig), calm: calm() };
});
assert(feel.hopping && feel.top > 0.15 && feel.squashed < 0.99 && feel.landed, `a moved mini hops in an arc, lands with a squash and settles exactly on its cell (${JSON.stringify(feel)})`);
assert(feel.fell && feel.flat && feel.rose && feel.up && feel.back && feel.calm, 'a knocked-down mini topples into the lying pose and stands back up, and the table goes quiet again');

// ---- GM tools: one player runs the table, the other only sees and moves what they should ----
// (Frames are slow in a browser without a GPU, and animations run on frames: be patient.)
const ok = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout: timeout * SLOW }).then(() => true, () => false);
const id = await a.evaluate(() => [...window.__ct.store.keys('m:')][0].slice(2));
await a.keyboard.press('1');
await a.click('#menuBtn');
await a.click('[data-act="gm"]');
assert(await ok(b, (id) => document.body.classList.contains('player') && getComputedStyle(document.querySelector('#modes')).display === 'none'
  && !window.__ct.board.hooks.canMove(id) && !!document.querySelector('#players svg'), id), 'with a GM, players lose the build tools and cannot move the GM\'s minis');

await a.evaluate((id) => window.__ct.board.select(id), id);
assert(await a.evaluate(() => document.querySelector('#minipanel').hidden && document.querySelectorAll('#ring button').length === 6), 'selecting a piece shows a ring of actions on it, not a panel');
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

// The boulder trap: rolled on the GM's device, replayed for the player, who never sees it under fog.
// The figures in its way go down and are shoved on (the hidden one too, still unseen); one undo puts them back.
await b.evaluate(() => {
  const { board } = window.__ct, seen = (window.__seen = { fog: 0, clear: 0, leak: 0, rocked: false });
  const watch = () => {
    for (const r of board.boulder.rolling) {
      const fog = Math.floor(r.mesh.position.x) === 26;
      if (fog && r.mesh.visible) seen.leak++;
      else if (fog) seen.fog++;
      else if (r.mesh.visible) seen.clear++;
    }
    if (board.wobbles.has('near')) seen.rocked = true;
    requestAnimationFrame(watch);
  };
  watch();
});
await a.evaluate(() => {
  const { store, board } = window.__ct, fig = (x, z, more) => ({ x, y: 0, z, k: 'knight', c: '#ffffff', n: '', r: 0, s: 1, ...more });
  store.set('m:pin', fig(24, 20));
  store.set('m:near', fig(23, 21)); // beside the path: rocks, but stays standing
  store.set('m:sly', fig(28, 20, { h: true }));
  store.set('f:26,20', true);
  board.hooks.onBoulder([20.5, 1.5, 20.5], [9, 0, 0]);
});
assert(await ok(b, () => window.__ct.board.boulder.rolling.length === 1), 'the GM\'s boulder rolls on the player\'s table too');
const down = (page) => ok(page, () => { const s = window.__ct.store, p = s.get('m:pin'), y = s.get('m:sly'), n = s.get('m:near'); return p.d && p.x === 25 && y.d && y.x === 29 && !n.d && n.x === 23; });
assert(await down(a) && await down(b), 'figures in the boulder\'s way are knocked down and pushed a cell on; one beside it is not');
const gone = (page) => page.waitForFunction(() => window.__ct.board.boulder.rolling.length === 0, null, { timeout: 120000 }).then(() => true, () => false);
assert(await gone(b) && await gone(a), 'the boulder goes once it has stopped');
const seen = await b.evaluate(() => ({ ...window.__seen, sly: window.__ct.board.minis.get('sly').group.visible }));
assert(seen.clear > 0 && seen.fog > 0 && !seen.leak && !seen.sly && seen.rocked, `the player sees it roll, but not under fog, and the hidden figure stays hidden ${JSON.stringify(seen)}`);
await a.evaluate(() => window.__ct.board.undo());
assert(await ok(b, () => { const s = window.__ct.store, p = s.get('m:pin'), y = s.get('m:sly'); return !p.d && p.x === 24 && !y.d && y.x === 28; }), 'one undo stands them all back up');
await a.evaluate(() => { for (const k of ['m:pin', 'm:near', 'm:sly', 'f:26,20']) window.__ct.store.set(k, null); });
assert(await ok(b, () => !window.__ct.store.get('m:pin') && !window.__ct.store.get('f:26,20')), 'trap cleared away');

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

// ---- game systems: rules as data, with the GM's app as the referee ----
{
  const mini = (page) => page.evaluate((id) => window.__ct.store.get(`m:${id}`), id);
  const chat = (page, re) => page.evaluate((src) => [...document.querySelectorAll('#msgs > div')].filter((d) => new RegExp(src).test(d.textContent)).length, re.source);
  await a.click('#ring [title="Back"]');
  assert(await a.evaluate(() => document.querySelectorAll('#ring button').length === 6 && getComputedStyle(document.querySelector('#sheetBtn')).display === 'none'), 'with no system on the table there is no sheet anywhere');
  await a.click('#menuBtn');
  await a.click('[data-act="rules"]');
  await a.click('#rulesList button:has-text("Lantern d20")');
  assert(await ok(b, () => window.__ct.rules.system()?.id === 'lantern-d20' && document.body.classList.contains('sys')), 'the GM picks a system and it reaches the player');
  await a.click('#rules [data-close]');

  // The player opens the sheet of the piece they were handed, changes a stat, and rolls it.
  await b.evaluate((id) => window.__ct.board.select(id), id);
  await b.click('#ring [title="Character sheet"]');
  await b.fill('#sheet [data-stat="str"]', '16');
  await b.press('#sheet [data-stat="str"]', 'Tab');
  assert(await ok(a, (id) => window.__ct.store.get(`m:${id}`).sv?.str === 16, id) && await b.evaluate(() => /d20\+3/.test(document.querySelector('#sheet [data-roll="str"]').textContent)), 'a stat entered on the sheet is stored raw; its modifier is derived');
  await b.click('#sheet [data-roll="str"]');
  assert(await b.evaluate(() => window.__ct.board.hand.join() === 'd20'), 'tapping a rollable stat puts its dice in the hand');
  await fling(b);
  const read = (page) => page.waitForFunction(() => /Strength 1d20\+3: (\d+) \[(\d+)\] \+ 3/.exec(document.querySelector('#msgs').textContent)?.slice(1, 3).join()).then((h) => h.jsonValue());
  const [sa, sb] = await Promise.all([read(a), read(b)]);
  const [tot, die] = sa.split(',').map(Number);
  assert(sa === sb && tot === die + 3 && die >= 1 && die <= 20, `a sheet roll lands on the same face for both, and the total is the face plus the modifier (${die} + 3 = ${tot})`);

  // The sheet got out of the way of the throw. With nothing selected, the dock opens the player's own character.
  await b.evaluate(() => window.__ct.board.select(null));
  await b.click('#sheetBtn');
  assert(await b.evaluate(() => !document.querySelector('#sheet').classList.contains('closed') && document.querySelector('#sheet [data-stat="str"]')?.value === '16'), 'the dock opens the sheet of the piece the player was handed');
  // A condition the GM puts on the piece shows for the player: on the piece, and in how they roll.
  await a.click('#ring [title="Character sheet"]');
  await a.click('#sheet [data-cond="poisoned"]');
  assert(await ok(b, (id) => window.__ct.store.get(`m:${id}`).cn?.includes('poisoned') && window.__ct.board.minis.get(id).sig.includes('🤢')
    && /2d20kl1\+3/.test(document.querySelector('#sheet [data-roll="str"]').textContent) && document.querySelector('#sheet [data-cond="poisoned"]').classList.contains('on'), id), 'a condition applied by the GM marks the piece for the player and changes their rolls');
  await a.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/sheet-desktop.png` });

  // A named roll that feeds the turn order, thrown with the dice the condition imposes.
  await b.click('#sheet [data-roll="initiative"]');
  assert(await b.evaluate(() => window.__ct.board.hand.join() === 'd20,d20'), 'poisoned: two dice are thrown, the lower is kept');
  await fling(b);
  assert(await ok(a, (id) => { const m = /Initiative 2d20kl1: (\d+) /.exec(document.querySelector('#msgs').textContent); return !!m && window.__ct.store.get(`m:${id}`).ini === +m[1]; }, id), 'the initiative roll puts the piece in the turn order with its total');

  // A trigger: burning hurts at the start of the turn. Only the GM's app applies it, once.
  await a.click('#sheet [data-cond="burning"]');
  const hp0 = (await mini(a)).hp;
  await a.click('#nextTurn');
  assert(await ok(b, () => /Burning: \d/.test(document.querySelector('#msgs').textContent)), 'a trigger fires at the start of the turn and its line reaches the player');
  await a.waitForTimeout(700);
  const burn = +(await a.evaluate(() => /Burning: (\d)/.exec(document.querySelector('#msgs').textContent)[1]));
  const [ma, mb] = [await mini(a), await mini(b)];
  assert(burn >= 1 && burn <= 4 && ma.hp === hp0 - burn && mb.hp === ma.hp && (await chat(a, /Burning: \d/)) === 1 && (await chat(b, /Burning: \d/)) === 1
    && ma.fx?.length === 1, `the trigger fired exactly once, on both tables (${hp0} − ${burn} = ${ma.hp})`);
  // Dropping to nothing is a happening of its own: the rules mark the piece and say so.
  await a.evaluate((id) => { const { store } = window.__ct; store.set(`m:${id}`, { ...store.get(`m:${id}`), hp: 0 }); }, id);
  assert(await ok(b, (id) => window.__ct.store.get(`m:${id}`).cn?.includes('down') && /is down!/.test(document.querySelector('#msgs').textContent), id), 'hit points running out puts the piece down for everyone');
  await a.evaluate((id) => { const { store } = window.__ct; const { cn: _, ...v } = store.get(`m:${id}`); store.set(`m:${id}`, { ...v, hp: 19 }); }, id);
  await a.click('#endFight');
  await a.click('#sheet [data-close]');
  await a.click('#menuBtn');
  await a.click('[data-act="rules"]');
  await a.click('#rulesList button:has-text("No rules")');
  assert(await ok(b, () => !document.body.classList.contains('sys') && !window.__ct.rules.system()), 'clearing the rules puts the table back as it was');
  await a.click('#rules [data-close]');
  // Leave the piece as the checks after this one expect it: selected, its ring one step in.
  await a.evaluate((id) => window.__ct.board.select(id), id);
  await a.click('#ring [title="Emote"]');
}
// Breaking: the GM smashes a statue. It is one edit (rubble is left, undo restores it), and the
// debris and the rocking are worked out on each device; under fog a player gets none of it.
const smash = (page, key) => page.evaluate((key) => { const { board } = window.__ct; board.offer(key); board.breakOffered(); }, key);
const chunks = (page) => page.evaluate(() => window.__ct.board.debris.count);
await a.evaluate(() => { const { store } = window.__ct; store.set('b:9,0,9', { i: 'statue' }); store.set('b:10,0,9', { i: 'table' }); store.set('w:30,0,30,n', { i: 'wall' }); store.set('f:30,30', true); });
const stood = () => window.__ct.store.get('w:30,0,30,n') && window.__ct.store.get('b:9,0,9') && window.__ct.board.props.get('b:10,0,9')?.userData.pending === undefined;
assert(await ok(b, stood) && await ok(a, stood), 'pieces to break reach the player');
await b.evaluate(() => { window.__ct.board.offer('b:9,0,9'); window.__ct.board.breakOffered(); });
assert(await b.evaluate(() => window.__ct.store.get('b:9,0,9').i === 'statue' && window.__ct.board.offered === null), 'a player cannot break anything');
await smash(a, 'b:9,0,9');
const flew = await chunks(a);
assert(flew >= 12 && flew <= 24 && await a.evaluate(() => window.__ct.store.get('b:9,0,9').i === 'rock' && window.__ct.board.wobbles.has('b:10,0,9')), `a broken statue leaves a rock, ${flew} chunks fly as one mesh, and the table beside it rocks`);
assert(await ok(b, () => window.__ct.store.get('b:9,0,9').i === 'rock' && window.__ct.board.debris.count >= 12 && window.__ct.board.wobbles.size > 0), 'the player sees it burst too');
assert(await ok(a, () => window.__ct.board.debris.count === 0 && !window.__ct.board.wobbles.size && !window.__ct.board.wasBusy)
  && await ok(b, () => window.__ct.board.debris.count === 0), 'the debris is gone in a moment and the table is idle again');
await a.evaluate(() => window.__ct.board.undo());
assert(await ok(b, () => window.__ct.store.get('b:9,0,9').i === 'statue') && (await chunks(a)) === 0 && (await chunks(b)) === 0, 'undo stands the statue up again, with no debris');
await smash(a, 'w:30,0,30,n');
assert(await ok(b, () => !window.__ct.store.get('w:30,0,30,n')) && (await chunks(a)) >= 12, 'a wall under fog breaks for the GM');
await b.waitForTimeout(400);
assert((await chunks(b)) === 0 && await b.evaluate(() => !window.__ct.board.breaking.size), 'and the player sees no debris from under the fog');
await a.evaluate(() => { const { store } = window.__ct; for (const k of ['b:9,0,9', 'b:10,0,9', 'f:30,30']) store.set(k, null); });
assert(await ok(b, () => !window.__ct.store.get('b:9,0,9') && !window.__ct.store.get('f:30,30')), 'cleared up after the breaking');
// Shots: an arrow from one mini to another flies on every table, rocks the target, and changes nothing.
await a.click('#ring [title="Back"]');
await a.evaluate((id) => {
  const { store } = window.__ct, v = store.get(`m:${id}`);
  // Stand it a couple of cells off, on whichever side has nothing built in between.
  const open = (dx) => [1, 2].every((i) => !store.get(`b:${v.x + dx * i},${v.y},${v.z}`) && !store.get(`b:${v.x + dx * i},${v.y + 1},${v.z}`));
  store.set('m:target', { ...v, x: v.x + (open(1) ? 2 : -2), n: 'Target', o: undefined });
}, id);
assert(await ok(b, () => window.__ct.board.minis.get('target')?.group.visible), 'a second mini to shoot at');
await b.evaluate(() => { const { shots } = window.__ct.board, fire = shots.fire.bind(shots); window.__fired = 0; shots.fire = (...args) => { window.__fired++; fire(...args); }; });
const shootAt = async (kind) => {
  if (await a.$('#ring [title="Shoot"]')) await a.click('#ring [title="Shoot"]'); // (after a shot the picker stays open)
  await a.click(`#ring [title="${kind}"]`);
  const spot = await a.evaluate(() => window.__ct.board.spotOf('target'));
  await a.mouse.click(spot.x, spot.y);
};
const tableBefore = await a.evaluate(() => JSON.stringify(window.__ct.store.dump()));
await shootAt('Arrow');
assert(await a.evaluate((id) => window.__ct.board.selected === id && window.__ct.board.aimed === null, id), 'tapping the target fires, and leaves the shooter selected');
assert(await ok(b, () => window.__ct.board.shots.live > 0) && await ok(b, () => window.__ct.board.wobbles.has('target'))
  && await ok(b, () => window.__ct.board.shots.live === 0 && window.__ct.board.wobbles.size === 0), 'a shot flies on the other table, rocks the mini it hits, and is gone');
assert(await a.evaluate((t) => JSON.stringify(window.__ct.store.dump()) === t, tableBefore) && await b.evaluate(() => window.__fired === 1), 'and nothing on the table changed');
// A hidden mini must not give itself away: players see no shot at it, and it does not flinch.
await a.evaluate(() => { const { store } = window.__ct; store.set('m:target', { ...store.get('m:target'), h: true }); });
assert(await ok(b, () => window.__ct.board.minis.get('target').group.visible === false), 'the GM hides the target');
await shootAt('Fire bolt');
assert(await ok(a, () => window.__ct.board.wobbles.has('target')) && await ok(a, () => window.__ct.board.shots.live === 0), 'the GM sees the shot at a hidden mini land');
await b.waitForTimeout(300);
assert(await b.evaluate(() => window.__fired === 1 && window.__ct.board.shots.live === 0 && window.__ct.board.wobbles.size === 0), 'players see nothing of a shot at a hidden mini');
await a.evaluate(() => window.__ct.store.set('m:target', null));
await a.click('#ring [title="Back"]');
// Shoved off a tower, a mini falls: it lands knocked down and the log says so, but never about a hidden one.
await a.evaluate(() => {
  const { store } = window.__ct, mini = { k: 'knight', c: '#fff', r: 0, s: 1, o: '*', x: 30, y: 3, z: 30 };
  for (let y = 0; y < 3; y++) for (const x of [30, 40]) store.set(`b:${x},${y},30`, { i: 'stone' });
  store.set('m:tower', { ...mini, n: 'Goblin' });
  store.set('m:lurker', { ...mini, n: 'Lurker', x: 40, h: true });
});
await b.waitForFunction(() => window.__ct.store.get('m:tower') && window.__ct.store.get('m:lurker')); // (the pieces first: a fall is only announced for a mini the device knows)
await a.evaluate(() => { const { board } = window.__ct; board.hooks.onShove('lurker', 1, 0); board.hooks.onShove('tower', 1, 0); });
assert(await ok(b, () => { const v = window.__ct.store.get('m:tower'), l = window.__ct.store.get('m:lurker'); return !!v && !!l && v.x === 31 && v.y === 0 && v.d === true && l.x === 41 && l.y === 0 && /Goblin fell 15 ft/.test(document.querySelector('#msgs').textContent); })
  && await a.evaluate(() => /Goblin fell 15 ft/.test(document.querySelector('#msgs').textContent) && /Lurker fell 15 ft/.test(document.querySelector('#msgs').textContent))
  && await b.evaluate(() => !/Lurker/.test(document.querySelector('#msgs').textContent)), `a mini shoved off a tower falls, lands knocked down, and the log tells everyone; a hidden one falls unannounced ${JSON.stringify([await b.evaluate(() => [window.__ct.store.get('m:tower'), window.__ct.store.get('m:lurker'), document.querySelector('#msgs').textContent.slice(-200), window.__ct.board.minis.get('tower')?.group.visible]), await a.evaluate(() => document.querySelector('#msgs').textContent.slice(-200))])}`);
await a.evaluate(() => { const { store } = window.__ct; for (const k of ['m:tower', 'm:lurker']) store.set(k, null); for (let y = 0; y < 3; y++) for (const x of [30, 40]) store.set(`b:${x},${y},30`, null); });
await b.waitForFunction(() => !window.__ct.store.get('b:40,2,30'));

// ---- scripts a system brings: boxed in (QuickJS in a worker), on the referee's device only, and only once allowed ----
{
  const mini = (page) => page.evaluate((id) => window.__ct.store.get(`m:${id}`), id);
  const chat = (page, re) => page.evaluate((src) => [...document.querySelectorAll('#msgs > div')].filter((d) => new RegExp(src).test(d.textContent)).length, re.source);
  const fetched = new Map([[a, []], [b, []]]);
  for (const [page, list] of fetched) page.context().on('request', (r) => { if (/assets\/script|\.wasm/.test(r.url())) list.push(r.url().split('/').pop()); });
  const box = (page) => fetched.get(page).filter((u) => /worker|wasm/.test(u));
  const BLED = /Robot bleeds: 1 Vigour lost|Robot staunches the wound/;
  const name = (await mini(a)).n;
  await a.evaluate((id) => { const { store } = window.__ct; store.set(`m:${id}`, { ...store.get(`m:${id}`), n: 'Robot', hp: 10, mhp: 10, ini: 12, cn: ['bleeding'] }); }, id);
  await a.click('#menuBtn');
  await a.click('[data-act="rules"]');
  await a.click('#rulesList button:has-text("Hard Knocks")');
  await a.waitForSelector('#rulesList [data-scripts="later"]');
  assert(await ok(b, () => window.__ct.rules.system()?.id === 'hard-knocks') && box(a).length === 0, 'a system that brings scripts asks the GM first, in the page, and has loaded no engine yet');
  await b.click('#menuBtn');
  await b.click('[data-act="rules"]');
  await b.waitForSelector('#rulesList button:has-text("Hard Knocks").on');
  assert(await b.evaluate(() => !document.querySelector('[data-scripts]')), 'a player who does not referee is not asked');
  await b.click('#rules [data-close]');

  // Not now: the system works, its scripts do not run, and nothing was fetched for them.
  await a.click('#rulesList [data-scripts="later"]');
  await a.waitForSelector('#rulesList [data-scripts="allow"]');
  await a.click('#rules [data-close]');
  await a.click('#nextTurn');
  await ok(b, (id) => window.__ct.store.get('turn')?.id === id, id);
  await a.waitForTimeout(1500);
  let [ma, mb] = [await mini(a), await mini(b)];
  assert(ma.hp === 10 && mb.hp === 10 && mb.cn.join() === 'bleeding' && !(await chat(a, BLED)) && !(await chat(b, BLED)) && box(a).length === 0 && box(b).length === 0
    && await a.evaluate(() => !localStorage.getItem('cottontale:scripts') || localStorage.getItem('cottontale:scripts') === '[]'), `with "Not now" the trigger's script does not run and the engine is never downloaded (${box(a).length} requests for it)`);

  // Allow: from now on the referee's device runs them, in the box.
  await a.click('#menuBtn');
  await a.click('[data-act="rules"]');
  await a.click('#rulesList [data-scripts="allow"]');
  await a.waitForSelector('#rulesList [data-scripts="off"]');
  await a.click('#rules [data-close]');
  await a.click('#nextTurn');
  assert(await ok(b, (src) => new RegExp(src).test(document.querySelector('#msgs').textContent), BLED.source), 'once allowed, the script runs on the turn and its line reaches the player');
  const stopped = (await chat(b, /staunches/)) === 1;
  const landed = await ok(b, ([id, stopped]) => { const v = window.__ct.store.get(`m:${id}`); return stopped ? v.hp === 10 && !v.cn?.includes('bleeding') : v.hp === 9 && !!v.cn?.includes('bleeding'); }, [id, stopped]);
  await a.waitForTimeout(1000);
  [ma, mb] = [await mini(a), await mini(b)];
  assert(landed && (await chat(a, BLED)) === 1 && (await chat(b, BLED)) === 1 && ma.hp === mb.hp && mb.hp === (stopped ? 10 : 9),
    `the script ran exactly once and the player sees what it did (${stopped ? 'the bleeding stopped' : 'bled to 9'}; ${ma.hp}/${mb.hp} ${mb.cn ?? ''})`);
  assert(box(a).some((u) => /script\.worker/.test(u)) && box(a).some((u) => /\.wasm$/.test(u)) && fetched.get(b).length === 0
    && await a.evaluate(() => JSON.parse(localStorage.getItem('cottontale:scripts')).length === 1) && await b.evaluate(() => !localStorage.getItem('cottontale:scripts')),
    `only the referee fetched the worker and the engine, each when first needed (GM: ${[...new Set(fetched.get(a))].join(', ')}; player: ${fetched.get(b).length})`);

  // Other scripts are another question: the answer was for that exact set. And what a script can see is nothing of ours.
  const swap = async (bleed, tag) => {
    await a.evaluate(([id, bleed]) => {
      const { store } = window.__ct;
      store.set('set:system', { ...store.get('set:system'), scripts: { bleed } });
      store.set(`m:${id}`, { ...store.get(`m:${id}`), hp: 10, cn: ['bleeding'] });
    }, [id, bleed]);
    await ok(b, (bleed) => window.__ct.rules.system()?.scripts?.bleed === bleed, bleed);
    await a.click('#menuBtn');
    await a.click('[data-act="rules"]');
    await a.waitForSelector('#rulesList [data-scripts="later"]');
    assert(true, `changed scripts are asked about again (${tag})`);
    await a.click('#rulesList [data-scripts="allow"]');
    await a.waitForSelector('#rulesList [data-scripts="off"]');
    await a.click('#rules [data-close]');
    await a.click('#nextTurn');
  };
  const tail = (page) => page.evaluate(() => [...document.querySelectorAll('#msgs > div')].slice(-4).map((d) => d.textContent).join(' | '));
  await swap('while (true) {}', 'an endless loop');
  const STOPPED = /Script "bleed"(: it ran too long| did not answer and was stopped)/;
  assert(await ok(a, (src) => new RegExp(src).test(document.querySelector('#msgs').textContent), STOPPED.source), `a script that will not stop is interrupted, and the GM is told (${(await tail(a)).split(' | ').pop()})`);
  // What the engine cannot interrupt (one long built-in after another) ends with the worker.
  await swap('var a = new Array(200000).fill("b"); for (;;) a.sort();', 'a hog');
  assert(await ok(a, () => /Script "bleed" did not answer and was stopped/.test(document.querySelector('#msgs').textContent)), `a script the engine cannot interrupt is ended with its worker (${(await tail(a)).split(' | ').pop()})`);
  await a.waitForTimeout(600);
  [ma, mb] = [await mini(a), await mini(b)];
  assert(ma.hp === 10 && mb.hp === 10 && !(await chat(b, /Script "bleed"/)) && await a.evaluate(() => 1 + 1) === 2, 'neither changed anything, only the GM was told, and the table carries on');
  // A new worker takes the next script. What that one can see is nothing of ours.
  await swap('return [{ say: "probe " + [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof importScripts, typeof self, typeof postMessage, typeof document, typeof localStorage, typeof indexedDB, typeof Date].join("") }, { script: "bleed" }];', 'a probe');
  const probed = await ok(b, () => /probe (undefined){10}$/m.test([...document.querySelectorAll('#msgs > div')].map((d) => d.textContent).join('\n')));
  assert(probed && (await chat(b, /probe/)) === 1, `in the worker, a script finds no network, no page, no storage and no clock${probed ? '' : ` (GM: ${await tail(a)}; player: ${await tail(b)})`}`);

  // Clearing the rules takes the runner away again.
  await a.click('#endFight');
  await a.click('#menuBtn');
  await a.click('[data-act="rules"]');
  await a.click('#rulesList button:has-text("No rules")');
  assert(await ok(b, () => !window.__ct.rules.system()) && await a.evaluate(() => !document.querySelector('[data-scripts]')), 'clearing the rules clears the question too');
  await a.click('#rules [data-close]');
  await a.evaluate(([id, n]) => { const { store } = window.__ct; const { cn: _c, ini: _i, n: _n, ...v } = store.get(`m:${id}`); store.set(`m:${id}`, { ...v, ...(n ? { n } : {}), hp: 19 }); }, [id, name]);
}

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

// ---- Make your own theme (ui/themeEditor.ts): start from one that ships, tweak it, and everyone watches it change ----
await a.click('[data-mode="prep"]');
await a.click('.prepRow[data-page="theme"]');
await a.click('[data-edit="vampire"]');
await a.waitForSelector('#ted');
const ownTheme = await a.evaluate(() => window.__ct.store.get('at:theme'));
assert(/^[a-z0-9]{10}:vampires$/.test(ownTheme.id) && ownTheme.id.startsWith(await a.evaluate(() => window.__ct.store.me)) && ownTheme.name === 'My Vampires'
  && await ok(b, (id) => window.__ct.store.get('at:theme')?.id === id && window.__ct.store.get('at:sky') === 'night' && window.__ct.board.sun.intensity === 1.1, ownTheme.id),
  `Customise puts a copy on the board at once, under an id of the GM's own (${ownTheme.id})`);
await a.fill('#ted [data-dial="sunI"]', '2.5');
await a.fill('#ted [data-dial="near"]', '7');
await a.click('#tedTabs [data-tab="dice"]');
await a.click('#ted [data-colour="body"]');
await a.click('#ted [data-swatch="#3dd68c"]');
await a.fill('#ted [data-dial="metal"]', '0.8');
assert(await a.evaluate(() => { const { board } = window.__ct; return board.sun.intensity === 2.5 && board.scene.fog.near === 7 && board.dice.look.body === '#3dd68c'; }), 'the editor shows each change on its own device at once');
assert(await ok(b, () => { const { board } = window.__ct; return board.sun.intensity === 2.5 && board.scene.fog.near === 7 && board.scene.fog.far === 90 && board.dice.look.body === '#3dd68c' && board.dice.look.metal === 0.8 && board.dice.look.ink === '#e8dcc0'; }),
  'and the other player\'s board follows: sun strength, haze and dice');
// Pieces: one off the shelf, another found by searching the whole library.
await a.click('#tedTabs [data-tab="pieces"]');
await a.click('.tedStrip[data-shelf="props"] [data-piece="coffin"]');
await a.click('#ted [data-remove="coffin"]');
await a.click('#ted [data-add="props"]');
await a.fill('#tedQ', 'barr');
const found = await a.evaluate(() => [...document.querySelectorAll('#tedGrid .tile')].map((t) => t.dataset.piece));
await a.click('#tedGrid [data-piece="barrel"]');
const marked = await a.evaluate(() => document.querySelector('#tedGrid [data-piece="barrel"]').classList.contains('on') && /^15 of 24/.test(document.querySelector('#tedCount').textContent));
await a.goBack();
await a.waitForSelector('#ted');
assert(found.join() === 'barrel' && marked && await ok(b, () => { const p = window.__ct.store.get('at:theme')?.pieces.props ?? []; return !p.includes('coffin') && p.at(-1) === 'barrel'; }),
  `a piece is taken off the theme's shelf and another, found by search, added (${found})`);
// Undo and redo walk the session, for everyone.
await a.click('#tedUndo');
assert(await ok(b, () => !window.__ct.store.get('at:theme').pieces.props.includes('barrel')), 'undo takes the last change back, for everyone');
await a.click('#tedRedo');
assert(await ok(b, () => window.__ct.store.get('at:theme').pieces.props.includes('barrel')), 'and redo brings it again');
// About: its name, its size, a code to share, and a place among this device's own themes.
await a.click('#tedTabs [data-tab="about"]');
await a.fill('#ted [data-field="name"]', 'Blood moon');
await a.click('#ted [data-act="share"]');
await a.waitForFunction(() => document.querySelector('#ted [data-field="share"]')?.value.startsWith('cottontale-theme:'));
const themeCode = await a.inputValue('#ted [data-field="share"]');
await a.click('#ted [data-act="save"]');
const about = await a.evaluate(() => ({ bytes: +document.querySelector('#tedSize').dataset.bytes, saved: JSON.parse(localStorage.getItem('cottontale:themes')).map((t) => t.name) }));
assert(about.bytes > 500 && about.bytes < 16384 && about.saved.join() === 'Blood moon' && await ok(b, () => window.__ct.store.get('at:theme')?.name === 'Blood moon'),
  `the theme has a name, a size (${about.bytes} bytes), a share code (${themeCode.length} characters) and is saved on this device`);
await a.evaluate(() => window.__ct.ui.prep.close());
await a.waitForFunction(() => document.querySelector('#prepPages').hidden);
// The GM's library: the theme's shelf is the changed one.
await a.click('[data-mode="build"]');
await a.click('[data-cat="things"]');
const shelfNow = await a.evaluate(() => ({ chip: document.querySelector('#palette .chip.on')?.textContent, tiles: [...document.querySelectorAll('#palette .tile')].map((t) => t.title) }));
assert(shelfNow.chip?.includes('Blood moon') && shelfNow.tiles.at(-1) === 'Barrel' && !shelfNow.tiles.includes('Coffin') && shelfNow.tiles.includes('Tombstone'), `the library's theme shelf shows the changed pieces ${JSON.stringify(shelfNow)}`);
await a.keyboard.press('1');
// The code, pasted by another GM into another board: that board gets the theme, this one keeps its own.
await b.evaluate(() => window.__ct.store.set(`gm:${window.__ct.store.me}`, true));
await b.waitForFunction(() => !document.body.classList.contains('player'));
await b.click('#menuBtn');
await b.click('[data-act="boards"]');
await b.click('#boardNew');
await b.waitForFunction(() => !document.querySelector('#prep').hidden && window.__ct.store.get('at:theme') === null);
await b.click('#boards [data-close]');
await b.click('[data-mode="prep"]');
await b.click('.prepRow[data-page="theme"]');
await b.click('#prepBody [data-act="import"]');
await b.fill('#prepBody [data-field="code"]', 'nonsense');
await b.click('#prepBody [data-act="use"]');
await b.waitForFunction(() => /not a theme code/.test(document.querySelector('#prepBody .tedBox').textContent));
await b.fill('#prepBody [data-field="code"]', `Here you go: ${themeCode}`);
await b.click('#prepBody [data-act="use"]');
const imported = await ok(b, (id) => { const { store, board } = window.__ct, t = store.get('at:theme'); return t?.id === id && t.name === 'Blood moon' && board.sun.intensity === 2.5 && board.dice.look.body === '#3dd68c' && document.querySelector('.card.on')?.dataset.theme === id; }, ownTheme.id);
const elsewhere = await ok(a, () => [...window.__ct.store.entries].filter(([k, e]) => /^@.+\/at:theme$/.test(k) && e.v?.name === 'Blood moon').length === 1);
assert(imported && elsewhere && await a.evaluate(() => window.__ct.store.get('at:theme')?.name === 'Blood moon'), `a share code pasted on another device becomes the theme of the board that device is on (there: ${imported}, seen from here: ${elsewhere})`);
await b.evaluate(() => window.__ct.ui.prep.close());
await b.click('#menuBtn');
await b.click('[data-act="boards"]');
b.once('dialog', (d) => d.accept());
await b.click('#boardList button[title="Delete this board"]');
await b.waitForFunction(() => document.querySelectorAll('#boardList .row').length === 1);
await b.click('#boards [data-close]');
await b.evaluate(() => window.__ct.store.set(`gm:${window.__ct.store.me}`, null));
await a.evaluate(() => { const s = window.__ct.store; s.set('at:theme', ''); for (const [k, v] of [['sky', 'day'], ['season', 'summer'], ['glow', 1], ['amb', 'off']]) s.set(`at:${k}`, v); });
assert(await ok(b, () => document.body.classList.contains('player') && window.__ct.store.get('at:theme') === '' && JSON.parse(window.__ct.board.skySig)[0] === 'day' && window.__ct.board.dice.look.body === undefined), 'and the table is as it was');
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

// ---- scatter: loose pieces poured out by one player fall, and come to rest, the same for everyone ----
{
  const sa = await join('Sy', 'scatter-1234'), sb = await join('Sol', 'scatter-1234');
  await sa.waitForFunction(() => window.__ct.net.peers.size === 1);
  await sb.waitForFunction(() => window.__ct.net.peers.size === 1);
  const DRAWN = () => [...window.__ct.board.loose.swarms.values()].reduce((n, s) => n + s.swarm.mesh.count, 0);
  const lying = (page) => page.evaluate(() => [...window.__ct.store.keys('l:')].sort().map((k) => JSON.stringify(window.__ct.store.get(k))));
  // The peer keeps watch: did it see the fall, and how many pieces did it ever draw at once?
  await sb.evaluate(`window.__watch = { most: 0, fell: false }; setInterval(() => { const w = window.__watch; w.fell ||= window.__ct.board.loose.playing.length > 0; w.most = Math.max(w.most, (${DRAWN})()); }, 16)`);
  await sa.click('[data-mode="build"]');
  await sa.click('[data-cat="things"]');
  await sa.click('#palette [aria-label^="Scatter"]');
  await sa.mouse.click(640, 380);
  const settled = await ok(sb, () => [...window.__ct.store.keys('l:')].length === 6 && window.__ct.board.loose.playing.length === 0 && window.__ct.board.loose.pieces.size === 6, undefined, 120000);
  const [la, lb] = [await lying(sa), await lying(sb)];
  const watch = await sb.evaluate(() => window.__watch);
  const whole = lb.every((v) => { const o = JSON.parse(v); return [...o.p, ...o.q].every(Number.isInteger) && o.p[1] >= 0 && o.p[1] < 100; });
  assert(settled && la.join() === lb.join() && whole, `six pieces poured by a click lie in the same whole-number poses for both players (${settled}, ${lb.length})`);
  assert(watch.fell && watch.most === 6 && await sb.evaluate(`(${DRAWN})() === 6`), `the peer watched them fall, and never drew a piece twice (most ${watch.most})`);
  await sa.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/scatter-desktop.png` });
  const still = await sa.evaluate(async () => { // an idle table with loose pieces on it draws nothing
    const { board } = window.__ct;
    await new Promise((r) => setTimeout(r, 600));
    const before = board.renderer.info.render.frame;
    await new Promise((r) => setTimeout(r, 400));
    return board.renderer.info.render.frame - before;
  });
  const solid = await sa.evaluate(() => { const { board } = window.__ct, p = [...board.loose.pieces.values()][0].p; return board.solidsNear(p, 1).filter((s) => s.q).length; });
  assert(still === 0 && solid >= 1, `resting pieces cost no frames (${still}) and are solid to dice (${solid} near)`);
  // Under the GM's fog a piece is neither drawn nor solid for a player.
  await sa.click('#menuBtn');
  await sa.click('[data-act="gm"]');
  const fogged = await sa.evaluate(() => {
    const { board, store } = window.__ct, p = [...board.loose.pieces.values()][0].p, cell = [Math.floor(p[0]), Math.floor(p[2])];
    store.set(`f:${cell[0]},${cell[1]}`, true);
    return { cell, n: [...board.loose.pieces.values()].filter((v) => Math.floor(v.p[0]) === cell[0] && Math.floor(v.p[2]) === cell[1]).length };
  });
  const hid = await ok(sb, `(${DRAWN})() === ${6 - fogged.n} && !window.__ct.board.solidsNear([${fogged.cell[0] + 0.5}, 0, ${fogged.cell[1] + 0.5}], 0.5).some((s) => s.q)`);
  assert(hid && fogged.n >= 1 && await sa.evaluate(`(${DRAWN})() === 6`), `fog hides the ${fogged.n} piece(s) under it from the player, not from the GM`);
  // A player cannot pour, and a pour sent by one is not played.
  await sb.evaluate(() => window.__ct.net.send({ y: 'pour', bd: '', t: { o: [0, 0, 0], i: 'coin', ids: ['zz'], n: 1, q: [[0, 500, 0, 0, 0, 0, 1000]] } }));
  await sb.waitForTimeout(600);
  assert((await lying(sb)).length === 6 && await sa.evaluate(() => window.__ct.board.loose.playing.length === 0 && window.__ct.board.loose.count === 6)
    && await sb.evaluate(() => document.body.classList.contains('player')), 'only the GM pours');
  await sa.evaluate(() => { const { store } = window.__ct; for (const k of [...store.keys('f:')]) store.set(k, null); });
  // The eraser takes the pieces under the pointer; undo puts them back, and a pour is one undo step.
  await sa.click('#erase');
  const at = await sa.evaluate(() => {
    const { board } = window.__ct, p = [...board.loose.pieces.values()][0].p;
    const v = board.ground.position.clone().set(p[0], p[1], p[2]).project(board.camera);
    return [(v.x + 1) * 640, (1 - v.y) * 400];
  });
  await sa.mouse.click(at[0], at[1]);
  const erased = await ok(sb, () => { const n = [...window.__ct.store.keys('l:')].length; return n >= 1 && n < 6; });
  await sa.keyboard.press('Control+z');
  const back = await ok(sb, () => [...window.__ct.store.keys('l:')].length === 6);
  await sa.keyboard.press('Control+z');
  const gone = await ok(sb, `[...window.__ct.store.keys('l:')].length === 0 && (${DRAWN})() === 0`);
  assert(erased && back && gone, `the eraser removes loose pieces, undo returns them, and a whole pour undoes as one (${erased}, ${back}, ${gone})`);
  await sa.context().close();
  await sb.context().close();
}

// ---- phones: the primary target. Real touch events, both orientations. ----
for (const [label, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
  console.log(`phone ${label}`);
  const p = await join('Mo', `phone-${label}-1234`, { ...devices['iPhone 13'], viewport });
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const cells = () => p.evaluate(() => [...window.__ct.store.keys('b:')]);
  const [cx, cy] = [viewport.width / 2, viewport.height / 2];
  const settle = () => p.waitForTimeout(120);

  // An empty table says where to begin: four full-size ways to start above the dock, which step aside for everything else.
  {
    const card = () => p.evaluate(() => {
      const e = document.querySelector('#start'), r = e.getBoundingClientRect(), d = document.querySelector('#tools').getBoundingClientRect(), t = document.querySelector('#top').getBoundingClientRect();
      return {
        shown: !e.hidden, within: r.left >= 0 && r.right <= innerWidth && r.top >= t.bottom && r.bottom <= innerHeight,
        clear: r.bottom <= d.top || r.left >= d.right || r.right <= d.left, small: [...e.querySelectorAll('button')].filter((b) => { const q = b.getBoundingClientRect(); return q.width < 43.5 || q.height < 43.5; }).length,
      };
    });
    const first = await card();
    await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-start.png` });
    await p.tap('#logToggle');
    const under = (await card()).shown;
    await p.tap('#logToggle');
    await p.tap('[data-mode="build"]');
    const building = (await card()).shown;
    await p.tap('[data-mode="play"]');
    const back = (await card()).shown;
    await p.tap('#startX');
    const gone = (await card()).shown;
    assert(first.shown && first.within && first.clear && !first.small && !under && !building && back && !gone, `an empty table offers ways to start, clear of the dock, and steps aside for a sheet, for Build and for "not now" ${JSON.stringify({ first, under, building, back, gone })}`);
  }
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
    const boxes = ['#top', '#tools', '#palette', '#minipanel', '#floors', '#edits', '#init', '.sheet:not(.closed)', '#prepPages:not([data-see])', '#prepPages[data-see] #prepBar', '#ted', '#tedDo'].map((q) => document.querySelector(q)).filter((e) => e && !e.hidden && vis(e))
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
  assert(!ring.panel && ring.buttons === 6 && ring.free >= 60 && !bad.length, `a selected piece leaves the table clear (${ring.free}% of the height free) ${bad.join('; ')}`);
  // Shooting, by touch alone: the ring offers it, a picker of full-size kinds opens, a tap on the table lets fly.
  await p.tap('#ring [title="Shoot"]');
  const picker = await p.evaluate(() => [...document.querySelectorAll('#ring .pop button')].map((b) => b.getBoundingClientRect())
    .filter((r) => r.width >= 44 && r.height >= 44 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight).length);
  await p.tap('#ring [title="Fire bolt"]');
  const aim = await p.evaluate(() => { const { board, store } = window.__ct, s = board.spotOf(board.selected); return { x: s.x + (s.x > innerWidth / 2 ? -110 : 110), y: s.y + 30, table: JSON.stringify(store.dump()), armed: !!board.aimed }; });
  await touch('touchStart', [[aim.x, aim.y]]);
  await touch('touchEnd', []);
  const flew = await p.waitForFunction(() => window.__ct.board.shots.live > 0, null, { timeout: 5000 }).then(() => true, () => false);
  const landed = await p.waitForFunction(() => window.__ct.board.shots.live === 0, null, { timeout: 5000 }).then(() => true, () => false);
  const after = await p.evaluate(() => ({ table: JSON.stringify(window.__ct.store.dump()), armed: !!window.__ct.board.aimed, picker: !!document.querySelector('#ring [title="Arrow"]') }));
  assert(picker === 6 && aim.armed && flew && landed && !after.armed && after.picker && after.table === aim.table, `a shot is picked and fired by touch, and changes nothing (${picker} full-size choices) ${JSON.stringify({ flew, landed, armed: after.armed })}`);
  await p.tap('#ring [title="Back"]');
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
  // Scatter: brush, kind and count are all chosen by touch; a tap pours, a drag strews, a second finger pours nothing.
  await p.tap('[data-cat="things"]');
  await p.tap('#palette [aria-label^="Scatter"]');
  bad = await layout();
  const pourUi = await p.evaluate(() => ({ kinds: document.querySelectorAll('#palette .tile').length, count: [...document.querySelectorAll('#palette .chip')].filter((c) => /^× \d+$/.test(c.textContent)).map((c) => c.getBoundingClientRect().height)[0] }));
  assert(pourUi.kinds === 5 && pourUi.count >= 44 && !bad.length, `the scatter brush offers its kinds and a count within reach ${JSON.stringify(pourUi)} ${bad.join('; ')}`);
  await p.tap('#palette [title="Coins"]');
  const loose = () => p.evaluate(() => [...window.__ct.store.keys('l:')].map((k) => window.__ct.store.get(k).p));
  const poured = (n) => p.waitForFunction((m) => [...window.__ct.store.keys('l:')].length === m && window.__ct.board.loose.playing.length === 0, n, { timeout: 15000 }).then(() => true, () => false);
  await touch('touchStart', [[cx, cy - h * 0.1]]);
  await touch('touchStart', [[cx, cy - h * 0.1], [cx + 80, cy - h * 0.1]]);
  await touch('touchEnd', []);
  await p.waitForTimeout(400);
  assert(await p.evaluate(() => window.__ct.board.loose.count === 0), 'a second finger pours nothing');
  await touch('touchStart', [[cx, cy - h * 0.1]]);
  await touch('touchEnd', []);
  const tapped = await poured(6);
  const span = (ps) => Math.hypot(Math.max(...ps.map((q) => q[0])) - Math.min(...ps.map((q) => q[0])), Math.max(...ps.map((q) => q[2])) - Math.min(...ps.map((q) => q[2]))) / 100;
  const heap = span(await loose());
  await drag(cx - 130, cy - h * 0.14, cx + 110, cy - h * 0.06);
  const strewn = await poured(12);
  assert(tapped && strewn && (await cells()).length === 1, `a tap pours six coins in a heap (${heap.toFixed(1)} across), a drag strews six more (${span(await loose()).toFixed(1)} across), and nothing else is edited`);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-scatter.png` });
  await p.tap('#erase');
  const coin = await p.evaluate(() => { // a coin on screen, clear of the bars
    const { board } = window.__ct, c = document.querySelector('#c');
    for (const v of board.loose.pieces.values()) {
      const s = board.ground.position.clone().set(...v.p).project(board.camera), x = ((s.x + 1) / 2) * c.clientWidth, y = ((1 - s.y) / 2) * c.clientHeight;
      if (document.elementFromPoint(x, y) === c) return [x, y];
    }
    return null;
  });
  await touch('touchStart', [coin]);
  await touch('touchEnd', []);
  await settle();
  const left = (await loose()).length;
  await p.tap('#undo');
  await settle();
  const again = (await loose()).length;
  await p.tap('#undo');
  await p.tap('#undo');
  await settle();
  assert(left < 12 && again === 12 && (await loose()).length === 0 && (await cells()).length === 1 && (await keys('w:')).length === 1, `a tap with the eraser picks loose pieces up (${12 - left}); undo returns them, then takes back each pour whole`);
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

  // Breaking by touch: tap a wall in play, a Break button comes up over it; tapping that brings the wall down.
  const wall = await p.evaluate(() => {
    const { board, store } = window.__ct, c = document.querySelector('#c'), t = board.controls.target;
    const roof = document.querySelector('#top').getBoundingClientRect().bottom + 70, floor = document.querySelector('#tools').getBoundingClientRect().top - 30;
    board.select(null);
    const minis = [...store.keys('m:')].map((k) => store.get(k)), blocks = [...store.keys('b:')].map((k) => k.slice(2).split(',').map(Number));
    for (let r = 0; r < 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const x = Math.floor(t.x) + dx, z = Math.floor(t.z) + dz;
      if ([...minis, ...blocks.map(([bx, , bz]) => ({ x: bx, z: bz }))].some((m) => Math.hypot(m.x - x, m.z - z) < 3)) continue;
      const s = board.ground.position.clone().set(x + 0.5, 0.5, z).project(board.camera), sx = ((s.x + 1) / 2) * c.clientWidth, sy = ((1 - s.y) / 2) * c.clientHeight;
      if (sx < 60 || sx > c.clientWidth - 60 || sy < roof || sy > floor) continue;
      const key = `w:${x},0,${z},n`;
      store.set(key, { i: 'wall' });
      return { key, sx, sy };
    }
    return null;
  });
  assert(!!wall, 'found a clear spot on screen for a wall');
  await settle();
  await touch('touchStart', [[wall.sx, wall.sy]]);
  await touch('touchEnd', []);
  await settle();
  bad = await layout();
  const offer = await p.evaluate(() => {
    const b = document.querySelector('#break'), r = b.getBoundingClientRect(), top = document.querySelector('#top').getBoundingClientRect().bottom;
    return { key: window.__ct.board.offered, shown: !b.hidden, w: Math.round(r.width), h: Math.round(r.height), on: r.left >= 0 && r.top >= top && r.right <= innerWidth && r.bottom <= document.querySelector('#tools').getBoundingClientRect().top };
  });
  assert(offer.key === wall.key && offer.shown && offer.w >= 44 && offer.h >= 44 && offer.on && !bad.length, `tapping a wall in play offers to break it, with a full-size button on screen ${JSON.stringify(offer)} ${bad.join('; ')}`);
  await touch('touchStart', [[wall.sx, wall.sy]]);
  await touch('touchStart', [[wall.sx, wall.sy], [wall.sx + 50, wall.sy + 40]]);
  await touch('touchEnd', [[wall.sx + 50, wall.sy + 40]]);
  await touch('touchEnd', []);
  await settle();
  assert(await p.evaluate((k) => !!window.__ct.store.get(k), wall.key), 'a second finger never breaks anything');
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-break.png` });
  await p.tap('#break');
  const burst = await p.evaluate((k) => ({ gone: !window.__ct.store.get(k), chunks: window.__ct.board.debris.count, hidden: document.querySelector('#break').hidden }), wall.key);
  assert(burst.gone && burst.chunks >= 12 && burst.chunks <= 24 && burst.hidden, `the Break button brings the wall down in a burst of debris ${JSON.stringify(burst)}`);
  await p.waitForFunction(() => window.__ct.board.debris.count === 0 && !window.__ct.board.wasBusy, null, { timeout: 8000 });
  await p.evaluate(() => window.__ct.board.undo());
  assert(await p.evaluate((k) => window.__ct.store.get(k)?.i === 'wall' && window.__ct.board.debris.count === 0, wall.key), 'undo puts the wall back, and the table went idle after the debris');
  await p.evaluate((k) => window.__ct.store.set(k, null), wall.key);
  // Shove: the ring arms it, the next tap on the table says which way, and the mini goes one cell.
  // The spots to touch: a clear run of cells through the mini, as screen points.
  const lane = () => p.evaluate(() => {
    const { board, store } = window.__ct, id = [...store.keys('m:')][0].slice(2), v = store.get(`m:${id}`), c = document.querySelector('#c');
    const top = document.querySelector('#top').getBoundingClientRect().bottom + 8, dock = document.querySelector('#tools').getBoundingClientRect().top - 60;
    const at = (x, z) => { const s = board.ground.position.clone().set(x + 0.5, v.y, z + 0.5).project(board.camera); return [((s.x + 1) / 2) * c.clientWidth, ((1 - s.y) / 2) * c.clientHeight]; };
    const free = (x, z) => ![...store.keys(`b:${x},`)].some((k) => +k.split(',')[2] === z && +k.split(',')[1] >= v.y);
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const pts = [-1, 0, 1, 2, 3].map((i) => [v.x + sx * i, v.z + sz * i]);
      if (pts.every(([x, z]) => free(x, z)) && pts.map(([x, z]) => at(x, z)).every(([x, y]) => x > 30 && x < innerWidth - 30 && y > top && y < dock)) return { id, v, sx, sz, pts: pts.map(([x, z]) => at(x, z)) };
    }
    return null;
  });
  const tapAt = async ([x, y]) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); await settle(); };
  let ln = await lane();
  assert(!!ln, 'there is room on screen to push the mini about');
  await p.evaluate((id) => window.__ct.board.select(id), ln.id);
  await p.tap('#ring [title="Shove"]');
  bad = await layout();
  assert(await p.evaluate((id) => window.__ct.board.shoving === id && /Tap which way/.test(document.querySelector('#ring').textContent), ln.id) && !bad.length, `Shove on the ring waits for a direction ${bad.join('; ')}`);
  await tapAt(ln.pts[4]);
  const shoved = await p.evaluate((id) => ({ v: window.__ct.store.get(`m:${id}`), armed: window.__ct.board.shoving, sel: window.__ct.board.selected, ring: document.querySelectorAll('#ring > button').length }), ln.id);
  assert(shoved.v.x === ln.v.x + ln.sx && shoved.v.z === ln.v.z + ln.sz && !shoved.armed && shoved.sel === ln.id && shoved.ring === 6, `a tap on the table shoves the mini one cell that way ${JSON.stringify(shoved)}`);

  // Blast: the circle template in Measure, then the Blast chip. Next to the centre, the mini is thrown and floored; one undo.
  ln = await lane();
  assert(!!ln, 'and still room for a blast');
  await p.tap('[data-tool="ruler"]');
  await p.tap('#palette [title="Radius"]');
  assert(await p.evaluate(() => document.querySelector('#palette [title^="Blast"]').disabled), 'Blast waits for a circle to be drawn');
  const [from, , to] = ln.pts; // centre one cell behind the mini, two cells of radius
  await touch('touchStart', [from]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6]]);
  await touch('touchEnd', []);
  await settle();
  bad = await layout();
  await p.tap('#palette [title^="Blast"]');
  await settle();
  const blown = await p.evaluate((id) => window.__ct.store.get(`m:${id}`), ln.id);
  const went = (blown.x - ln.v.x) * ln.sx + (blown.z - ln.v.z) * ln.sz;
  assert(went >= 1 && went <= 4 && blown.d === true && [blown.x, blown.y, blown.z].every(Number.isInteger) && !bad.length, `the GM's blast throws the mini outward and floors it (${went} cells) ${bad.join('; ')}`);
  await p.tap('#palette [title="Undo the last edit"]');
  await settle();
  const back = await p.evaluate((id) => window.__ct.store.get(`m:${id}`), ln.id);
  assert(back.x === ln.v.x && back.z === ln.v.z && !back.d, 'one undo takes the whole blast back');
  await p.tap('[data-tool="move"]');

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
  // Rules: pick a system, then the character sheet the app draws from it.
  {
    const fitsOn = (sel) => p.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.width > 200 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }, sel);
    const piece = () => p.evaluate(() => { const { store } = window.__ct; return store.get([...store.keys('m:')][0]); });
    await p.tap('#menuBtn');
    await p.tap('[data-act="rules"]');
    await p.waitForSelector('#rulesList button:nth-child(4)');
    bad = await layout();
    assert(await fitsOn('#rules') && !bad.length, `rules sheet opens on screen ${bad.join('; ')}`);
    await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-rules.png` });
    await p.tap('#rulesList button:has-text("Lantern d20")');
    await p.waitForFunction(() => document.body.classList.contains('sys'));
    await p.tap('#rules [data-close]');
    await p.evaluate(() => { const { board, store } = window.__ct; board.select([...store.keys('m:')][0].slice(2)); });
    await p.tap('#sheetBtn');
    bad = await layout();
    assert(await fitsOn('#sheet') && !bad.length && await p.evaluate(() => document.querySelectorAll('#sheet .frow').length > 12), `character sheet opens on screen, drawn from the schema ${bad.join('; ')}`);
    await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-charsheet.png` });
    await p.tap('#sheet [title="More Strength"]');
    await p.tap('#sheet [title="More Strength"]');
    await p.tap('#sheet [data-cond="prone"]');
    await p.fill('#sheet [data-stat="hp.max"]', '12');
    await p.evaluate(() => document.activeElement.blur());
    await settle();
    const v = await piece();
    assert(v.sv.str === 12 && v.cn.join() === 'prone' && v.mhp === 12 && await p.evaluate(() => /d20\+1/.test(document.querySelector('#sheet [data-roll="str"]').textContent)), `steppers, conditions and inputs edit the piece by touch ${JSON.stringify(v.sv)}`);
    await p.evaluate(() => document.querySelector('#sheet .rolls').scrollIntoView({ block: 'end' }));
    bad = await layout();
    assert(!bad.length, `the rolls of the sheet are full-size targets ${bad.join('; ')}`);
    await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-charsheet-rolls.png` });
    await p.tap('#sheet [data-mode="adv"]');
    await p.tap('#sheet [data-roll="attack"]');
    assert(await p.evaluate(() => window.__ct.board.hand.join() === 'd20,d20' && document.querySelector('#sheet').classList.contains('closed') && document.querySelector('#logToggle').dataset.n === '2'), 'a roll from the sheet puts its dice in the hand and gets out of the way');
    await touch('touchStart', [[cx - 40, cy - 60]]);
    await p.waitForFunction(() => window.__ct.board.dice.held);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cx - 40 + i * 10, cy - 60 - i * 6]]); await p.waitForTimeout(16); }
    await touch('touchEnd', []);
    await p.waitForFunction(() => /Attack 2d20kh1\+3: \d+ \[/.test(document.querySelector('#msgs').textContent));
    assert(true, 'the thrown dice are read by the rules: advantage keeps the higher');
    // A very different game, same app: three hearts and one die.
    await p.tap('#menuBtn');
    await p.tap('[data-act="rules"]');
    await p.tap('#rulesList button:has-text("Three Hearts")');
    await p.waitForFunction(() => window.__ct.rules.system()?.id === 'three-hearts');
    await p.tap('#rules [data-close]');
    await p.evaluate(() => { const { board, store } = window.__ct; const k = [...store.keys('m:')][0]; store.set(k, { ...store.get(k), hp: 3 }); board.select(k.slice(2)); });
    await p.tap('#sheetBtn');
    await p.tap('#sheet [title="Less Hearts"]');
    await settle();
    bad = await layout();
    const hearts = await p.evaluate(() => { const { board, store } = window.__ct; const id = [...store.keys('m:')][0].slice(2); return { hp: store.get(`m:${id}`).hp, sig: board.minis.get(id).sig, dice: [...document.querySelectorAll('#dice [data-d]')].filter((b) => !b.hidden).length }; });
    assert(await fitsOn('#sheet') && !bad.length && hearts.hp === 2 && hearts.sig.includes('|2|3|') && hearts.dice === 1, `another system redraws the sheet; hearts are the piece's bar ${JSON.stringify(hearts)} ${bad.join('; ')}`);
    await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-hearts.png` });
    await p.tap('#sheet [data-close]');
    await p.tap('#menuBtn');
    await p.tap('[data-act="rules"]');
    // A system with scripts asks first, with buttons a thumb can hit.
    await p.tap('#rulesList button:has-text("Hard Knocks")');
    await p.waitForSelector('#rulesList [data-scripts="later"]');
    await p.evaluate(() => document.querySelector('#rulesList .scriptask').scrollIntoView({ block: 'end' }));
    bad = await layout();
    const asks = await p.evaluate(() => [...document.querySelectorAll('#rulesList [data-scripts]')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }));
    assert(await fitsOn('#rules') && !bad.length && asks.length === 2 && asks.every((n) => n >= 44), `the question about a system's scripts fits a phone, with full-size targets ${asks} ${bad.join('; ')}`);
    await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-scripts.png` });
    await p.tap('#rulesList [data-scripts="later"]');
    await p.waitForSelector('#rulesList [data-scripts="allow"]');
    await p.evaluate(() => document.querySelector('#rulesList').firstElementChild.scrollIntoView());
    await p.tap('#rulesList button:has-text("No rules")');
    await p.waitForFunction(() => !document.body.classList.contains('sys'));
    await p.tap('#rules [data-close]');
    await p.waitForFunction(() => window.__ct.board.dice.playing.length === 0, null, { timeout: 60000 }); // the thrown dice are picked up again
  }

  // ---- Prep → Sound: the table's own sounds, made and played by touch (src/sounds.ts, ui/soundPage.ts) ----
  await p.evaluate(() => window.__ct.store.set('set:blossom', [])); // no file servers here: files stay on the device
  await p.tap('[data-mode="prep"]');
  await p.tap('.prepRow[data-page="sound"]');
  await p.waitForSelector('[data-mix="rain"]');
  bad = await layout();
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-sound-empty.png` });
  // The mixer: two layers, heard on this device, named and saved.
  await p.tap('[data-mix="rain"]');
  await p.tap('[data-mix="heart"]');
  await p.fill('[data-layer="heart"] input[aria-label$="volume"]', '0.8');
  await p.tap('[data-listen]');
  await p.waitForFunction(() => window.__ct.sound.playing === 'trial');
  await p.fill('#sndMixName', 'Storm');
  bad.push(...await layout());
  await p.evaluate(() => document.querySelector('[data-save]').scrollIntoView({ block: 'end' }));
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-sound-mixer.png` });
  await p.tap('[data-save]');
  await p.waitForFunction(() => window.__ct.sounds.list().length === 1 && document.querySelector('.sndRow b')?.textContent === 'Storm' && window.__ct.sound.playing !== 'trial');
  const storm = await p.evaluate(() => { const [id, s] = window.__ct.sounds.list()[0]; return { id, mix: s.mix.map((m) => m.id).join(), layers: s.scape.layers.length, patterns: s.scape.patterns.length }; });
  assert(storm.mix === 'rain,heart' && storm.layers === 2 && storm.patterns === 1 && !bad.length, `a soundscape mixed on the phone is saved to the table as a recipe ${JSON.stringify(storm)} ${bad.join('; ')}`);
  // An effect from a file: named, tried and added, with the file kept on this device (no server here).
  await chooseFile(p, '[data-add="effect"]', { name: 'door_slam.wav', mimeType: 'audio/wav', buffer: wavFile(0.4) }, true);
  await p.waitForSelector('[data-draft="effect"]');
  bad = await layout();
  const draft = await p.evaluate(() => ({ name: document.querySelector('#sndDraftName').value, meta: document.querySelector('[data-draft] small').textContent }));
  await p.evaluate(() => document.querySelector('[data-done]').scrollIntoView({ block: 'end' }));
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-sound-draft.png` });
  await p.tap('[data-try]');
  await p.tap('[data-done]');
  await p.waitForFunction(() => window.__ct.sounds.board().length === 1 && !document.querySelector('[data-draft]'));
  assert(draft.name === 'door slam' && /WAV · 0\.4 s · 6 KB/.test(draft.meta) && !bad.length && await p.evaluate(() => /no file servers/.test(document.querySelector('.sndPart .sndMsg')?.textContent ?? '')),
    `an effect is added from a file by touch, and the page says where the file is ${JSON.stringify(draft)} ${bad.join('; ')}`);
  // The list: a row opens to its options; "use here" plays it on this board; Back ends whatever was being tried.
  await p.tap(`.sndRow[data-snd="${storm.id}"] .sndName`);
  await p.waitForSelector('.sndRow.open [data-remove]');
  bad = await layout();
  await p.evaluate(() => document.querySelector('#prepBody').scrollTo(0, 0));
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-sound.png` });
  await p.tap(`.sndRow[data-snd="${storm.id}"] .sndPlay`);
  await p.waitForFunction(() => window.__ct.sound.playing === 'trial');
  await p.tap(`[data-use="${storm.id}"]`);
  await p.waitForFunction((id) => window.__ct.store.get('at:amb') === `t:${id}` && document.querySelector(`[data-use="${id}"]`).classList.contains('on'), storm.id);
  await p.goBack();
  await p.goBack();
  await p.waitForFunction(() => document.querySelector('#prepPages').hidden);
  assert(await ok(p, (id) => window.__ct.sound.playing === `t:${id}`, storm.id) && !bad.length, `the Sound page lists the table's sounds; one is put on this board, and leaving the page ends the trial ${bad.join('; ')}`);
  // The soundboard: a row of full-size buttons in the Atmosphere sheet, next to the table's soundscape among the choices.
  await p.tap('#menuBtn');
  await p.tap('[data-act="atmo"]');
  await p.evaluate(() => document.querySelector('#sfx').scrollIntoView({ block: 'end' }));
  bad = await layout();
  const sheetSounds = await p.evaluate(() => ({ scape: [...document.querySelectorAll('#scapes button')].some((b) => b.textContent === 'Storm' && b.classList.contains('on')), board: [...document.querySelectorAll('#sfx [data-sfx]')].map((b) => b.textContent), heard: window.__ct.sound.effects }));
  await p.tap('#sfx [data-sfx]');
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-soundboard.png` });
  assert(sheetSounds.scape && sheetSounds.board.join() === 'door slam' && await ok(p, (n) => window.__ct.sound.effects > n, sheetSounds.heard) && !bad.length,
    `the soundboard is a row of buttons in the Atmosphere sheet, and a tap plays the effect ${JSON.stringify(sheetSounds)} ${bad.join('; ')}`);
  await p.tap('#scapes button:has-text("Silence")');
  await p.tap('#atmo [data-close]');

  // ---- Make your own theme: one panel with tabs, and the table still in view and in hand ----
  await p.tap('[data-mode="prep"]');
  await p.tap('.prepRow[data-page="theme"]');
  await p.tap('[data-edit="pirate"]');
  await p.waitForSelector('#ted');
  await settle();
  bad = [];
  const shot = async (name) => { await settle(); bad.push(...(await layout()).map((x) => `${name}: ${x}`)); await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-theme-${name}.png` }); };
  for (const tab of ['look', 'sound', 'pieces', 'dice', 'gen', 'about']) {
    await p.tap(`#tedTabs [data-tab="${tab}"]`);
    await shot(tab);
    if (tab === 'look') { await p.tap('#ted [data-colour="sun"]'); await shot('look-colour'); await p.tap('#ted [data-swatch="#ffc46b"]'); await p.tap('#ted [data-haze]'); await shot('look-haze'); }
    if (tab === 'pieces') { await p.tap('.tedStrip[data-shelf="props"] .tile:nth-child(2)'); await shot('pieces-picked'); await p.tap('#ted [data-move="-1"]'); }
    if (tab === 'dice') { await p.tap('#ted [data-colour="ink"]'); await shot('dice-colour'); }
    if (tab === 'about') { await p.tap('#ted [data-act="share"]'); await shot('about-share'); await p.tap('#ted [data-act="import"]'); await shot('about-import'); await p.tap('#ted [data-act="save"]'); await shot('about-saved'); }
  }
  const panel = await p.evaluate(() => {
    const r = document.querySelector('#ted').getBoundingClientRect(), d = document.querySelector('#tedDo').getBoundingClientRect(), t = window.__ct.store.get('at:theme');
    return { top: Math.min(r.top, d.top) / innerHeight, left: r.left / innerWidth, tabs: document.querySelectorAll('#tedTabs [role="tab"]').length, sun: t.mood.light.sun, fog: t.mood.fog ?? null, first: t.pieces.props[0], saved: JSON.parse(localStorage.getItem('cottontale:themes')).length };
  });
  assert(!bad.length, `every tab of the theme editor is laid out cleanly ${bad.join('; ')}`);
  assert(panel.tabs === 6 && panel.sun === '#ffc46b' && panel.fog?.near === 20 && panel.first === 'rock' && panel.saved === 1 && (label === 'portrait' ? panel.top > 0.4 && panel.left < 0.1 : panel.left > 0.4),
    `the editor is one panel that leaves the table in view (${label === 'portrait' ? 'under' : 'beside'} it), and its controls work by touch ${JSON.stringify(panel)}`);
  // The table is still the table: one finger looks around, two zoom, and neither edits anything.
  // (Somewhere on the visible table that is not a figure: a finger on a figure would move it, as in Play.)
  const [tx, ty] = await p.evaluate(([w, h, tall]) => {
    const { board } = window.__ct, spots = [...board.minis.keys()].map((id) => board.spotOf(id)).filter(Boolean);
    const tries = tall ? [0.2, 0.5, 0.8].flatMap((x) => [0.2, 0.28, 0.36].map((y) => [w * x, h * y])) : [0.1, 0.22, 0.34].flatMap((x) => [0.35, 0.55, 0.75].map((y) => [w * x, h * y]));
    const far = (q) => Math.min(...spots.map((s) => Math.hypot(s.x - q[0], s.y - q[1])), 1e6);
    return tries.sort((a, b) => far(b) - far(a))[0];
  }, [viewport.width, viewport.height, label === 'portrait']);
  const camAt = () => p.evaluate(() => window.__ct.board.camera.position.toArray().map((v) => Math.round(v * 100) / 100).join());
  const edits = () => p.evaluate(() => [...window.__ct.store.keys('b:'), ...window.__ct.store.keys('m:')].map((k) => k + JSON.stringify(window.__ct.store.get(k))).join());
  const [cam0, dist0, edits0] = [await camAt(), await camDist(), await edits()];
  await touch('touchStart', [[tx, ty]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[tx + i * 9, ty + i * 2]]); await p.waitForTimeout(16); }
  await touch('touchEnd', []);
  await settle();
  const cam1 = await camAt();
  await touch('touchStart', [[tx - 20, ty]]);
  await touch('touchStart', [[tx - 20, ty], [tx + 20, ty]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[tx - 20 - i * 8, ty], [tx + 20 + i * 8, ty]]); await p.waitForTimeout(16); }
  await touch('touchEnd', [[tx + 84, ty]]);
  await touch('touchEnd', []);
  await settle();
  const dist1 = await camDist();
  assert(cam1 !== cam0 && dist1 < dist0 - 0.3 && await edits() === edits0 && await p.evaluate(() => !!document.querySelector('#ted')), `with the editor open a one-finger drag on the table turns the camera and a pinch zooms it (${cam0} → ${cam1}, ${dist0.toFixed(1)} → ${dist1.toFixed(1)})`);
  // Adding pieces is a page of its own, with search; Back returns to the panel.
  await p.tap('#tedTabs [data-tab="pieces"]');
  await p.tap('#ted [data-add="minis"]');
  await p.waitForSelector('#tedGrid');
  await p.fill('#tedQ', 'drag');
  await p.tap('#tedGrid [data-piece="dragon"]');
  bad = await layout();
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-theme-pick.png` });
  await p.goBack();
  await p.waitForSelector('#ted');
  await p.waitForFunction(() => window.__ct.store.get('at:theme')?.pieces.minis.at(-1) === 'dragon' && !!document.querySelector('.tedStrip[data-shelf="minis"] [data-piece="dragon"]'));
  await p.goBack();
  await p.waitForSelector('.cards[data-group="mine"] .card.on');
  await p.tap('[data-rename]');
  await settle();
  bad.push(...await layout());
  await p.fill('.cardBox input', 'Salt and rum');
  await p.tap('.cardBox [data-yes]');
  await p.waitForFunction(() => document.querySelector('.cards[data-group="mine"] .card b')?.textContent === 'Salt and rum' && window.__ct.store.get('at:theme')?.name === 'Salt and rum');
  await p.tap('[data-remove]');
  await settle();
  bad.push(...await layout());
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-theme-mine.png` });
  const asked = await p.evaluate(() => !!document.querySelector('.cardBox [data-yes]') && JSON.parse(localStorage.getItem('cottontale:themes')).length === 1);
  await p.tap('.cardBox button:has-text("Keep")');
  assert(asked && !bad.length && await p.evaluate(() => JSON.parse(localStorage.getItem('cottontale:themes'))[0].pieces.minis.at(-1) === 'dragon'), `pieces are added from a page of the library; a theme of one's own is renamed in the gallery, and removing it asks in the page ${bad.join('; ')}`);
  await p.evaluate(() => { window.__ct.ui.prep.close(); const s = window.__ct.store; s.set('at:theme', ''); for (const [k, v] of [['sky', 'day'], ['season', 'summer'], ['glow', 1], ['amb', 'off']]) s.set(`at:${k}`, v); });
  await p.waitForFunction(() => document.querySelector('#prepPages').hidden && !window.__ct.board.camera.view?.enabled);
  await p.tap('[data-mode="play"]');

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
  const let2 = await p.evaluate(() => { const { board } = window.__ct; return { held: !!board.dice.held, playing: board.dice.playing.length, hand: board.hand.length }; });
  assert(!let2.held && let2.playing === 0 && let2.hand === 3, `a second finger cancels the hold without throwing ${JSON.stringify(let2)}`);
  // Hold with one finger (the sheet gets out of the way), flick, release.
  await touch('touchStart', [[cx - 40, cy - 60]]);
  if (!await ok(p, () => window.__ct.board.dice.held && document.querySelector('#log').classList.contains('closed'), undefined, 8000)) {
    // Say what was under the finger and what the table thought it was doing.
    const seen = await p.evaluate(([x, y]) => {
      const e = document.elementFromPoint(x, y), { board, ui } = window.__ct, log = document.querySelector('#log');
      return { under: `${e?.tagName}#${e?.id}.${e?.className}`, within: e?.closest('[id]')?.id, held: !!board.dice.held, hand: board.hand.length, log: [log.classList.contains('closed'), log.dataset.h ?? 'half', Math.round(log.getBoundingClientRect().top)], selected: board.selected, tool: board.tool, prep: ui.prep.isOpen, aimed: !!board.aimed, shoving: board.shoving ?? null, boulder: !!board.boulderArmed };
    }, [cx - 40, cy - 60]);
    assert(false, `a finger on the table holds the dice and the sheet gets out of the way ${JSON.stringify(seen)}`);
  }
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

  // Phone extras: a coin in the picker, shake to throw, and the throw is felt.
  await p.context().grantPermissions(['accelerometer', 'gyroscope']).catch(() => {}); // a headless browser cannot show the prompt
  await p.evaluate(() => { window.__vib = []; navigator.vibrate = (x) => (window.__vib.push(x), true); });
  const shakeIt = () => p.evaluate(() => {
    for (const y of [22, 22, 22, -22, -22, -22]) dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: 0, y, z: 0 }, interval: 16 }));
  });
  await shakeIt();
  await settle();
  assert(await p.evaluate(() => !window.__ct.board.dice.held), 'shaking with an empty hand throws nothing');
  await p.tap('#logToggle');
  const small = await p.evaluate(() => ['#shake', '#dice [data-d="2"]'].filter((q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.width < 44 || r.height < 44; }));
  assert(!small.length, `coin and shake buttons are finger-sized ${small.join(' ')}`);
  // Where the browser wants asking before it shares its motion sensor, shaking starts off: switch it on by touch.
  if (!(await p.evaluate(() => document.querySelector('#shake').classList.contains('on')))) await p.tap('#shake');
  await p.tap('#dice [data-d="2"]');
  await p.waitForFunction(() => /shake/.test(document.querySelector('#hand').textContent));
  assert(await p.evaluate(() => /1d2 in hand.*shake/.test(document.querySelector('#hand').textContent) && document.querySelector('#shake').classList.contains('on')), 'a coin goes in the hand, and the hint offers a shake');
  await shakeIt();
  await p.waitForFunction(() => /rolled 1d2: (Heads|Tails)/.test(document.querySelector('#msgs').textContent));
  const tossed = await p.evaluate(() => {
    const { board } = window.__ct, mine = board.dice.playing[board.dice.playing.length - 1];
    const v = mine.meshes[0].position.clone().project(board.camera);
    return { kind: mine.kinds.join(), seen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1, hand: board.hand.length, sheet: document.querySelector('#log').classList.contains('closed'), vib: window.__vib.length };
  });
  assert(tossed.kind === 'd2' && tossed.seen && !tossed.hand && tossed.sheet && (await cells()).length === 1, 'a shake flips the coin into view, once, and edits nothing');
  assert(tossed.vib > 0, `the thrower feels the throw (${tossed.vib} buzzes)`);
  // Switched off, a shake does nothing; the touch throw is untouched by all this.
  await p.tap('#logToggle');
  await p.tap('#shake');
  await p.tap('#dice [data-d="2"]');
  await shakeIt();
  await settle();
  assert(await p.evaluate(() => window.__ct.board.hand.length === 1 && !window.__ct.board.dice.held && !/shake/.test(document.querySelector('#hand').textContent)), 'with shaking switched off the coin stays in the hand');
  await p.tap('#diceClear');
  // Ambient life: a tree and a fire stir a few frames a second; switched off, an idle table draws nothing.
  await p.evaluate(() => {
    const { board, store } = window.__ct;
    for (const d of board.dice.playing) d.t = 1e9; // put the dice away now, not in the middle of the count
    store.set('b:3,0,3', { i: 'tree' });
    store.set('b:-3,0,3', { i: 'campfire' });
  });
  await p.waitForFunction(() => { const { board } = window.__ct; return !board.dice.playing.length && [...board.props.values()].every((g) => !g.userData.pending); });
  const frames = (ms) => p.evaluate(async (ms) => {
    const { board } = window.__ct, f = board.frames, t = performance.now();
    await new Promise((r) => setTimeout(r, ms));
    return { n: board.frames - f, rate: (board.frames - f) / ((performance.now() - t) / 1000) };
  }, ms);
  const flip = async (act) => {
    await p.tap('#menuBtn');
    await p.tap(`[data-act="${act}"]`);
    const b = await p.evaluate((act) => { const el = document.querySelector(`[data-act="${act}"]`), r = el.getBoundingClientRect(); return { text: el.textContent, h: r.height, w: r.width }; }, act);
    await p.tap('#menuBtn');
    return b;
  };
  const off = await flip('ambient');
  assert(/Ambient motion: off/.test(off.text) && off.h >= 44 && off.w >= 44 && (await p.evaluate(() => document.querySelector('#menu').hidden)), `ambient motion has a thumb-sized switch in the menu (${off.text})`);
  await p.waitForFunction(async () => { const { board } = window.__ct, f = board.frames; await new Promise((r) => setTimeout(r, 400)); return board.frames === f; });
  const still = await frames(1000);
  assert(still.n === 0, `with ambient motion off an idle table draws no frames (${still.n})`);
  // The software renderer here is slow enough to switch ambience off by itself: pretend it is not.
  await p.evaluate(() => { window.__ct.board.slowed = false; window.__ct.board.stirSlow = -1e9; });
  const on = await flip('ambient');
  await p.waitForTimeout(300);
  const stir = await frames(3000);
  const fire = await p.evaluate(() => { const { board } = window.__ct; return { lit: board.lamps.some((l) => l.visible && l.intensity !== l.userData.base), shadows: board.renderer.shadowMap.enabled && board.renderer.shadowMap.needsUpdate /* (with shadows switched off for speed, nothing ever clears the flag) */, alive: board.alive }; });
  assert(/: on/.test(on.text) && fire.alive && stir.n >= 1 && stir.rate < 20 && fire.lit && !fire.shadows, `with it on, leaves and firelight stir at a throttled rate, shadows left alone (${stir.rate.toFixed(1)} frames/s) ${JSON.stringify([on.text, fire, stir, await p.evaluate(() => { const b = window.__ct.board; return { lamps: b.lamps.map((l) => [l.visible, l.intensity, l.userData.base]), target: b.controls.target.toArray(), glow: b.glow, wob: b.wobbles.size, dice: b.dice.playing.length, loose: b.loose.playing.length }; })])}`);
  await p.evaluate(() => { window.__ct.board.slowed = true; });
  const tired = await frames(700);
  assert(tired.n <= 1, `a device that has had to lower quality gets no ambient frames (${tired.n})`);
  await flip('ambient');

  // Camera: the turn passing to a mini out of view glides the camera to it; a finger on the table stops that.
  const target = () => p.evaluate(() => window.__ct.board.controls.target.toArray());
  await p.evaluate(() => {
    const { store } = window.__ct, mini = (x) => ({ x, y: 0, z: 0, k: 'knight', c: '#3e63dd', n: '', r: 0, s: 1, ini: 5 });
    store.set('m:far1', mini(40));
    store.set('m:far2', mini(-40));
  });
  await p.waitForFunction(() => window.__ct.board.minis.has('far1') && window.__ct.board.minis.has('far2'));
  await p.evaluate(() => window.__ct.store.set('turn', { id: 'far1', round: 1 }));
  await p.waitForFunction(() => { const t = window.__ct.board.controls.target; return Math.hypot(t.x - 40.5, t.z - 0.5) < 0.05 && !window.__ct.board.glide; });
  assert(true, 'the camera glides to the mini whose turn it is when it is out of view');
  // A finger already on the table (somewhere clear of the turn strip and the dock): the camera stays put.
  if (await p.evaluate(() => !document.querySelector('#menu').hidden)) await p.tap('#menuBtn'); // (an open menu would take the touch: it closes on a touch elsewhere)
  const bare = await p.evaluate(() => {
    for (let y = innerHeight / 2; y > 60; y -= 20) for (const x of [innerWidth / 2, innerWidth / 4, (innerWidth * 3) / 4]) if (document.elementFromPoint(x, y)?.id === 'c') return [x, y];
    return null;
  });
  await touch('touchStart', [bare]);
  const fingers = await p.evaluate(([x, y]) => { const { board } = window.__ct, e = document.elementFromPoint(x, y); return { pointers: board.pointers.size, hand: board.hand.length, under: `${e?.tagName}#${e?.id}`, menu: !document.querySelector('#menu').hidden, follow: board.followTurns, sel: board.selected, focus: document.hasFocus() }; }, bare);
  await p.evaluate(() => window.__ct.store.set('turn', { id: 'far2', round: 1 }));
  await p.waitForFunction(() => window.__ct.board.turnId === 'far2');
  await p.waitForTimeout(200);
  const held = await target();
  await touch('touchEnd', []);
  assert(Math.abs(held[0] - 40.5) < 0.05 && (await p.evaluate(() => !window.__ct.board.glide)), `the camera does not move while a finger is on the table ${JSON.stringify({ bare, fingers, held })}`);
  // A glide under way (frames held still so it cannot finish first) is dropped the moment a finger lands.
  await p.evaluate(() => window.__ct.board.renderer.setAnimationLoop(null));
  await p.evaluate(() => window.__ct.store.set('turn', { id: 'far1', round: 2 })); // (in view already: no move)
  await p.waitForFunction(() => window.__ct.board.turnId === 'far1');
  // (Stand the other one somewhere that is off this screen for certain: a wide screen sees a long way.)
  await p.evaluate(() => {
    const { board, store } = window.__ct, v = store.get('m:far2'), t = board.controls.target;
    const off = [[-40, 0], [0, 40], [0, -40], [-80, 0]].map(([x, z]) => [Math.round(t.x) + x, Math.round(t.z) + z]).find(([x, z]) => {
      const q = board.ground.position.clone().set(x + 0.5, 0.5, z + 0.5).project(board.camera);
      return Math.abs(q.x) > 1.2 || Math.abs(q.y) > 1.2 || q.z > 1;
    });
    if (off) store.set('m:far2', { ...v, x: off[0], z: off[1] });
  });
  await p.evaluate(() => window.__ct.store.set('turn', { id: 'far2', round: 2 }));
  await p.waitForFunction(() => !!window.__ct.board.glide);
  await touch('touchStart', [bare]);
  const dropped = await p.evaluate(() => !window.__ct.board.glide);
  await touch('touchEnd', []);
  await p.evaluate(() => { const { board } = window.__ct; board.renderer.setAnimationLoop(() => board.frame()); });
  assert(dropped, 'a touch on the table cancels a camera glide at once');
  // Switched off, turns no longer move the camera.
  const follow = await flip('follow');
  const camBefore = await target();
  await p.evaluate(() => window.__ct.store.set('turn', { id: 'far1', round: 3 }));
  await p.waitForFunction(() => window.__ct.board.turnId === 'far1');
  await p.waitForTimeout(200);
  const camAfter = await target();
  assert(/Follow turns: off/.test(follow.text) && follow.h >= 44 && camBefore[0] === camAfter[0] && camBefore[2] === camAfter[2], 'with "Follow turns" off the camera stays where it is');
  // The GM's boulder trap, by touch alone: tap Boulder, press on the table, flick the way it should roll.
  if (!(await p.evaluate(() => document.body.classList.contains('gm')))) { // (an earlier check may have taken the GM's seat already)
    await p.tap('#menuBtn');
    await p.tap('[data-act="gm"]');
  }
  if (await p.evaluate(() => !document.querySelector('#menu').hidden)) await p.tap('#menuBtn');
  // (The dice sheet may be shut, or folded to its first row by a touch on the table: open it afresh.)
  if (await p.evaluate(() => !document.querySelector('#log').classList.contains('closed'))) await p.tap('#logToggle');
  await p.tap('#logToggle');
  bad = await layout();
  await p.tap('#boulder');
  assert(await p.evaluate(() => window.__ct.board.boulderArmed && document.querySelector('#log').classList.contains('closed')) && !bad.length, `the GM picks up a boulder from the dice sheet ${bad.join('; ')}`);
  await touch('touchStart', [[cx, cy - 80]]);
  await touch('touchStart', [[cx, cy - 80], [cx + 80, cy - 80]]);
  await touch('touchEnd', []);
  await settle();
  assert(await p.evaluate(() => { const { board } = window.__ct; return !board.boulder.held && board.boulder.rolling.length === 0 && board.boulderArmed; }), 'a second finger cancels the boulder without rolling it');
  const builtBefore = (await cells()).length;
  // (Press where the table shows: by now a turn strip and other chrome may lie over the usual spot.)
  const [bx, by] = await p.evaluate(() => {
    for (let y = Math.round(innerHeight / 2); y > 60; y -= 20) for (const x of [innerWidth / 2 - 60, innerWidth / 4, (innerWidth * 3) / 4 - 80]) if (document.elementFromPoint(x, y)?.id === 'c' && document.elementFromPoint(x + 72, y - 24)?.id === 'c') return [x, y];
    return [innerWidth / 2 - 60, innerHeight / 2 - 40];
  });
  await touch('touchStart', [[bx, by]]);
  await p.waitForFunction(() => window.__ct.board.boulder.held);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[bx + i * 12, by - i * 4]]); await p.waitForTimeout(16); }
  await touch('touchEnd', []);
  await p.waitForFunction(() => { const { board } = window.__ct; return board.boulder.rolling.length === 1 && !board.boulder.held && !board.boulderArmed; });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-boulder.png` });
  assert(await p.evaluate(() => { const r = window.__ct.board.boulder.rolling[0]; return r.pos[r.n - 1].distanceTo(r.pos[0]) > 1.5; }) && (await cells()).length === builtBefore, `a flick sends the boulder rolling, and edits no terrain ${JSON.stringify(await p.evaluate(() => { const b = window.__ct.board, r = b.boulder.rolling[0]; return r && { n: r.n, from: r.pos[0].toArray().map((v) => +v.toFixed(1)), to: r.pos[r.n - 1].toArray().map((v) => +v.toFixed(1)), target: b.controls.target.toArray().map((v) => +v.toFixed(1)) }; }))} ${(await cells()).length}`);
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
  // From an import to the table in one tap: "Place it" closes Prep with the new piece in hand, on its own shelf.
  await p.tap('[data-mode="prep"]');
  await p.tap('.prepRow[data-page="import"]');
  await p.waitForSelector('.impPlace');
  bad = await layout();
  await p.tap('.impPlace');
  const inHand = await p.evaluate(() => ({ prep: window.__ct.ui.prep.isOpen, tool: window.__ct.board.tool, cur: document.querySelector('#palette .cur')?.textContent, shelf: document.querySelector('#palette .chip.on:not(.cur):not([title="Search the library"])')?.textContent }));
  assert(!inHand.prep && inHand.tool === 'mini' && inHand.cur === 'Orc' && inHand.shelf === 'Horde' && !bad.length, `"Place it" after an import puts the piece in hand on its shelf ${JSON.stringify(inHand)} ${bad.join('; ')}`);
  await p.tap('[data-mode="play"]');
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
  // ---- the GM's own 3D models: a .glb from the phone, worked through here, previewed, sized by touch and saved (ui/modelPage.ts) ----
  {
  await p.tap('[data-mode="prep"]');
  await p.tap('.prepRow[data-page="import"]');
  await p.waitForSelector('#impModel');
  bad = await layout();
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-model-start.png` });
  await p.setInputFiles('#impModelFile', STATUE);
  await p.waitForSelector('#mdSteps, #mdView'); // (the steps, unless it was already through them)
  bad.push(...await layout());
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-model-working.png` });
  await p.waitForSelector('#mdView');
  await p.tap('[data-as="thing"]');
  await p.tap('#mdUp');
  await p.tap('#mdMore');
  await p.waitForTimeout(400);
  bad.push(...await layout());
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-model-preview.png` });
  await p.evaluate(() => document.querySelector('#mdSave').scrollIntoView());
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-model-preview2.png` });
  const shown = await p.evaluate(() => ({ up: document.querySelector('#mdUp').getAttribute('aria-pressed'), size: document.querySelector('#mdSize').textContent, drawn: (() => { const c = document.querySelector('#mdView'); return c.width > 100 && c.height > 100; })() }));
  await p.fill('#mdName', 'Snow thing');
  await p.evaluate(() => document.activeElement?.blur());
  await p.tap('#mdSave');
  await p.waitForFunction(() => [...document.querySelectorAll('.impDone li.ok b')].some((x) => x.textContent === 'Snow thing'));
  bad.push(...await layout());
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-model-done.png` });
  const piece = await p.evaluate(() => window.__ct.packs.listPacks()[0]?.pieces.find((x) => x.entry.kind === 'model'));
  assert(shown.up === 'true' && shown.drawn && piece?.group === 'props' && piece.entry.up === true && piece.entry.tris <= 15000 && !bad.length, `a 3D model from the phone: named steps, a turning preview, stood up and sized by touch, saved as a thing (${shown.size}; ${piece?.bytes} bytes) ${bad.join('; ')}`);
  }
  // A theme saved on this device is still under "Mine" when the app is opened again.
  await p.reload();
  await p.click('#join');
  await p.waitForSelector('#hud:not([hidden])', { state: 'attached' });
  await p.tap('[data-mode="prep"]');
  await p.tap('.prepRow[data-page="theme"]');
  await p.waitForSelector('.cards[data-group="mine"] .card');
  const kept = await p.evaluate(() => ({ name: document.querySelector('.cards[data-group="mine"] .card b').textContent, shipped: document.querySelectorAll('.cards[data-group="offered"] .card').length }));
  assert(kept.name === 'Salt and rum' && kept.shipped >= 4, `a saved theme is under Mine after a reload ${JSON.stringify(kept)}`);
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

// ---- the table's own sounds (src/sounds.ts): a recording the GM adds plays on every device; the soundboard; the mixer ----
{
  const a = await join('Ivy', 'sounds-1234'), b = await join('Jo', 'sounds-1234');
  await a.waitForFunction(() => window.__ct.net.peers.size === 1);
  await b.waitForFunction(() => window.__ct.net.peers.size === 1);
  const far = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 * SLOW }).then(() => true, () => false);
  await a.evaluate((s) => window.__ct.store.set('set:blossom', [s]), `http://localhost:${BLOSSOM}`);
  await b.waitForFunction(() => window.__ct.blobs.servers().length === 1 && /localhost/.test(window.__ct.blobs.servers()[0]));
  // Browsers only make sound after a tap: one on each table.
  await a.mouse.click(640, 300);
  await b.mouse.click(640, 300);
  await a.click('#menuBtn');
  await a.click('[data-act="gm"]');
  await b.waitForFunction(() => document.body.classList.contains('player'));
  const audio = await b.evaluate(() => window.__ct.sound.ctx?.state);
  assert(audio === 'running', `this browser makes sound (the player's audio is ${audio})`);
  // The player has sound switched off for now: nothing of the GM's may be fetched until it is on again.
  await b.click('#menuBtn');
  await b.click('[data-act="atmo"]');
  await b.click('#soundOn');
  assert(await b.evaluate(() => window.__ct.sound.enabled === false), 'the player switches sound off on their device');

  await a.click('[data-mode="prep"]');
  await a.click('.prepRow[data-page="sound"]');
  await a.waitForSelector('[data-add="track"]');
  // Over budget: an effect of eleven seconds is refused in words, on the page, before anything is uploaded.
  await chooseFile(a, '[data-add="effect"]', { name: 'long.wav', mimeType: 'audio/wav', buffer: wavFile(11) });
  await a.waitForSelector('.sndMsg.bad');
  const refused = await a.evaluate(() => ({ msg: document.querySelector('.sndMsg.bad').textContent, draft: !!document.querySelector('[data-draft]'), n: window.__ct.sounds.list().length }));
  assert(/11 s long.*up to 10 s/.test(refused.msg) && !refused.draft && refused.n === 0, `a file over its budget is refused with a plain message (${refused.msg})`);
  await chooseFile(a, '[data-add="track"]', { name: 'notes.txt', mimeType: 'audio/mpeg', buffer: Buffer.from('this is not a sound at all, whatever it says') });
  assert(await ok(a, () => /not a sound file/.test(document.querySelector('.sndMsg.bad')?.textContent ?? '')), 'and so is a file that is not a sound, whatever its name says');
  // A WAV effect that is too heavy but short is made smaller on the device (one channel, a lower sample rate).
  await chooseFile(a, '[data-add="effect"]', { name: 'thunder.wav', mimeType: 'audio/wav', buffer: wavFile(3, 44100, 90) });
  await a.waitForSelector('[data-draft="effect"]');
  const shrunk = await a.evaluate(() => ({ note: document.querySelector('[data-draft] .sndMsg')?.textContent ?? '', meta: document.querySelector('[data-draft] small').textContent }));
  assert(/made smaller: one channel at 22 kHz, 129 KB/.test(shrunk.note) && /WAV · 3\.0 s · 129 KB/.test(shrunk.meta), `a short WAV effect over 150 KB is re-encoded to fit (${shrunk.meta})`);
  await a.click('[data-draft] button:has-text("Cancel")');

  // Ambience from a file: named, tried on this device only, then Done uploads it and says how the server answered.
  await chooseFile(a, '[data-add="track"]', { name: 'harbour-night.wav', mimeType: 'audio/wav', buffer: wavFile(2) });
  await a.waitForSelector('[data-draft="ambience"]');
  await a.fill('#sndDraftName', 'Harbour');
  await a.click('[data-try]');
  assert(await far(a, () => window.__ct.sound.playing === 'trial' && window.__ct.sound.recording === 'playing') && await b.evaluate(() => window.__ct.sounds.list().length === 0),
    'trying a recording plays it on this device only, before it is uploaded');
  await a.click('[data-done]');
  await a.waitForFunction(() => window.__ct.sounds.list().length === 1 && !document.querySelector('[data-draft]'));
  const added = await a.evaluate(() => { const [id, s] = window.__ct.sounds.list()[0]; return { id, s, ref: JSON.parse(s.scape.file), msg: document.querySelector('.sndPart .sndMsg').textContent, row: document.querySelector('.sndRow small').textContent, trial: window.__ct.sound.playing }; });
  assert(added.s.name === 'Harbour' && added.s.kind === 'ambience' && added.ref.m === 'audio/wav' && added.ref.n === 32072 && added.ref.s?.length === 1 && /localhost:\d+: took it/.test(added.msg) && /Ambience · 31 KB · WAV/.test(added.row) && added.trial !== 'trial',
    `Done uploads the recording and says how each server answered (${added.msg})`);
  const tid = `t:${added.id}`;
  await a.click(`[data-use="${added.id}"]`);
  // Everyone gets the choice at once; a device with sound off fetches nothing.
  assert(await ok(b, (tid) => window.__ct.store.get('at:amb') === tid && [...document.querySelectorAll('#scapes button')].some((x) => x.textContent === 'Harbour' && x.classList.contains('on')), tid),
    'the GM picks it for the board, and it is among the soundscapes by name for everyone');
  assert(await far(a, (tid) => window.__ct.sound.playing === tid && window.__ct.sound.recording === 'playing', tid), 'it plays on the GM\'s device');
  await b.waitForTimeout(400);
  const quiet = await b.evaluate(async (h) => ({ playing: window.__ct.sound.playing, resolved: window.__ct.sounds.resolved, has: await window.__ct.blobs.has(h) }), added.ref.h);
  assert(quiet.playing === 'off' && quiet.resolved === 0 && !quiet.has, `a device with sound off does not fetch the recording ${JSON.stringify(quiet)}`);
  await b.click('#soundOn');
  assert(await far(b, (tid) => window.__ct.sound.playing === tid && window.__ct.sound.recording === 'playing' && window.__ct.sounds.resolved === 1, tid)
    && await b.evaluate((h) => window.__ct.blobs.source(h), added.ref.h) === 'server', 'switched on, the player\'s device fetches the GM\'s recording from the server and plays it');
  // A recording that plays once is streamed, not decoded; switching to it fades over, and the first one's URL is given back.
  await a.click(`.sndRow[data-snd="${added.id}"] .sndName`);
  await a.click('.sndRow.open button:has-text("Loops: on")');
  assert(await far(b, (id) => window.__ct.sounds.get(id)?.scape.loop === false && window.__ct.sound.recording === 'playing' && window.__ct.sound.els.some((e) => e.wanted && e.el.src.startsWith('blob:')), added.id)
    && await b.evaluate(() => window.__ct.sounds.resolved === 2), 'set to play once, it is streamed through an audio element on the player\'s device');
  // Nothing plays in a hidden tab.
  await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert(await ok(b, () => window.__ct.sound.ctx.state === 'suspended' && window.__ct.sound.els.every((e) => e.el.paused) && window.__ct.sound.playing === 'off'), 'a hidden tab falls silent');
  await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  assert(await far(b, (tid) => window.__ct.sound.playing === tid && window.__ct.sound.recording === 'playing', tid), 'and picks the soundscape up again when it is back');

  // An effect for the soundboard: the GM taps it during play, and the player hears it (a live message, not a store write).
  await chooseFile(a, '[data-add="effect"]', { name: 'gong.wav', mimeType: 'audio/wav', buffer: wavFile(0.3, 8000, 220) });
  await a.waitForSelector('[data-draft="effect"]');
  await a.click('[data-done]');
  await a.waitForFunction(() => window.__ct.sounds.board().length === 1);
  const gong = await a.evaluate(() => { const [id, s] = window.__ct.sounds.board()[0]; return { id, h: JSON.parse(s.fx.file).h }; });
  assert(await far(b, (h) => window.__ct.blobs.has(h), gong.h), 'the player\'s device fetches the table\'s effects ahead of time (sound is on)');
  await a.goBack();
  await a.goBack();
  await a.waitForFunction(() => document.querySelector('#prepPages').hidden);
  await a.click('#menuBtn');
  await a.click('[data-act="atmo"]');
  await b.waitForTimeout(300 * SLOW);
  const before = await b.evaluate(() => ({ heard: window.__ct.sound.effects, rows: window.__ct.store.entries.size, board: document.querySelector('#sfx').hidden }));
  await a.click(`#sfx [data-sfx="${gong.id}"]`);
  assert(before.board && await ok(b, (n) => window.__ct.sound.effects === n + 1, before.heard) && await b.evaluate((n) => window.__ct.store.entries.size === n, before.rows) && await a.evaluate(() => window.__ct.sound.effects >= 1),
    'a soundboard effect tapped by the GM is heard by the player; players have no soundboard of their own');
  // Re-voiced: the same effect now stands in for the ping, on every device, and leaves the soundboard.
  await a.evaluate((id) => { const { sounds } = window.__ct; sounds.save(id, { ...sounds.get(id), as: 'ping' }); }, gong.id);
  assert(await ok(b, (id) => window.__ct.sounds.bank().effects.ping?.file === window.__ct.sounds.get(id).fx.file && window.__ct.sounds.board().length === 0, gong.id)
    && await ok(a, () => document.querySelector('#sfx').hidden), 'an effect can stand in for a built-in one (the ping) instead');
  await a.click('#atmo [data-close]');

  // The mixer: a soundscape built from presets, saved by the GM, listed and played for the player.
  await a.click('[data-mode="prep"]');
  await a.click('.prepRow[data-page="sound"]');
  await a.click('[data-mix="wind"]');
  await a.click('[data-mix="chimes"]');
  await a.fill('[data-layer="wind"] input[aria-label$="low to high"]', '0.2');
  await a.click('[data-listen]');
  assert(await ok(a, () => window.__ct.sound.playing === 'trial' && window.__ct.sound.recording === 'none'), 'the mix is heard live on the GM\'s device');
  await a.fill('#sndMixName', 'Moor');
  await a.click('[data-save]');
  await a.waitForFunction(() => window.__ct.sounds.list().some(([, s]) => s.name === 'Moor'));
  const moor = await a.evaluate(() => window.__ct.sounds.list().find(([, s]) => s.name === 'Moor')[0]);
  await a.click(`[data-use="${moor}"]`);
  assert(await far(b, (id) => window.__ct.sound.playing === `t:${id}` && window.__ct.sound.recording === 'none' && window.__ct.sound.knows(`t:${id}`)
    && [...document.querySelectorAll('#scapes button')].some((x) => x.textContent === 'Moor' && x.classList.contains('on')) && window.__ct.sound.els.every((e) => !e.wanted), moor),
    'a mixer soundscape saved by the GM is listed and plays for the player, and the recording before it is let go');
  await a.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/sound-desktop.png` });
  // Rename and remove, in the page: no dialogs.
  await a.click(`.sndRow[data-snd="${moor}"] .sndName`);
  await a.fill('.sndRow.open input[aria-label="Name"]', 'High moor');
  await a.press('.sndRow.open input[aria-label="Name"]', 'Enter');
  assert(await ok(b, () => [...document.querySelectorAll('#scapes button')].some((x) => x.textContent === 'High moor')), 'renaming a sound reaches everyone');
  await a.click(`[data-remove="${moor}"]`);
  await a.click(`[data-yes="${moor}"]`);
  assert(await ok(b, (id) => !window.__ct.sounds.get(id) && window.__ct.store.get('at:amb') === 'off' && window.__ct.sound.playing === 'off' && window.__ct.sounds.list().length === 2, moor),
    'removing a sound (confirmed in the page) takes it from the table, and the board falls silent by choice');
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
  // A saved table is the whole table: its look, a loose piece, its rules and a sound of its own come back with it.
  const whole = [...rows, ['at:sky', 'dusk'], ['at:theme', { v: 1, id: 'saved:look', name: 'Saved look' }], ['l:x1', { i: 'stone', p: [50, 0, 50], q: [0, 0, 0, 1000] }],
    ['set:system', JSON.parse(require('node:fs').readFileSync('public/systems/three-hearts.json', 'utf8'))],
    ['snd:saved1', { v: 1, name: 'Saved drone', kind: 'ambience', scape: { name: 'Saved drone', drones: [{ wave: 'sine', freq: 60, gain: 0.1 }] } }]];
  await a.setInputFiles('#file', { name: 'table.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ cottontale: 1, rows: whole })) });
  await b.waitForFunction(drawn, [orc.id, idol.id]);
  assert(await a.evaluate(drawn, [orc.id, idol.id]), 'importing the table brings its packs back, pictures and all');
  assert(await ok(b, () => { const { store, rules, sounds } = window.__ct; return store.get('at:sky') === 'dusk' && store.get('at:theme')?.id === 'saved:look' && !!store.get('l:x1') && rules.system()?.id === 'three-hearts' && !!sounds.get('saved1'); }),
    'and its atmosphere, loose pieces, rules and sounds');
  await a.evaluate(() => { const s = window.__ct.store; for (const k of ['at:sky', 'at:theme', 'l:x1', 'set:system', 'snd:saved1']) s.set(k, null); });
  await a.context().close();
  await b.context().close();
}

// ---- the GM's own 3D models (src/model.ts, src/ingest.ts): a .glb imported on one device is a piece on every device ----
{
  console.log('models');
  const a = await join('Kit', 'models-1234'), b = await join('Lou', 'models-1234');
  await a.waitForFunction(() => window.__ct.net.peers.size === 1);
  await b.waitForFunction(() => window.__ct.net.peers.size === 1);
  await a.evaluate((server) => { const s = window.__ct.store; s.set(`gm:${s.me}`, true); s.set('set:blossom', [server]); }, `http://localhost:${BLOSSOM}`);
  await b.waitForFunction(() => window.__ct.blobs.servers().length === 1 && document.body.classList.contains('player'));
  for (const page of [a, b]) await page.evaluate(() => { const { board } = window.__ct; board.camera.position.set(3, 7, 15); board.controls.target.set(3, 0, 3); });
  await a.evaluate(() => window.__ct.ui.prep.open('import'));
  // Refused before anything is unpacked: a file over 25 MB, and one that says it has a million triangles.
  await a.setInputFiles('#impModelFile', HUGE);
  await a.waitForSelector('.impDone li.bad');
  const tooBig = await a.evaluate(() => document.querySelector('.impDone li.bad span').textContent);
  await a.setInputFiles('#impModelFile', DENSE);
  await a.waitForSelector('#impFail');
  const tooDense = await a.evaluate(() => document.querySelector('#impFail').textContent);
  await a.click('#mdBack');
  await a.waitForFunction(() => document.querySelectorAll('.impDone li.bad').length === 2 && !!document.querySelector('#impModel'));
  assert(/too large \(26 MB; a model may be at most 25 MB\)/.test(tooBig) && /more than 300,000 triangles/.test(tooDense) && await a.evaluate(() => [...window.__ct.store.keys('pk:')].length === 0), `a model over the caps is refused with the reason, before it is unpacked (“${tooBig}” / “${tooDense}”)`);
  /** Take one model through Prep → Import as the GM would. */
  const bring = async (file, name, as, tweak = async () => {}) => {
    await a.setInputFiles('#impModelFile', file);
    await a.waitForSelector('#mdView');
    if (as !== 'figure') await a.click(`[data-as="${as}"]`);
    await tweak();
    await a.fill('#mdName', name);
    const said = await a.evaluate(() => ({ stats: document.querySelector('#mdStats').textContent, notes: document.querySelector('#mdNotes').textContent, size: document.querySelector('#mdSize').textContent }));
    await a.waitForTimeout(300);
    await a.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/model-${name}.png` });
    await a.click('#mdSave');
    await a.waitForFunction((name) => [...document.querySelectorAll('.impDone li.ok b')].some((x) => x.textContent === name), name);
    return said;
  };
  const statue = await bring(STATUE, 'Snowman', 'figure', async () => { await a.click('#mdTurn'); await a.click('#mdMore'); });
  const box = await bring(CRATE, 'Crate', 'thing');
  const made = await a.evaluate(() => ({ said: [...document.querySelectorAll('.impDone li.ok span')].map((x) => x.textContent), pack: window.__ct.packs.listPacks()[0] }));
  const man = made.pack.pieces.find((x) => x.entry.name === 'Snowman'), crate = made.pack.pieces.find((x) => x.entry.name === 'Crate');
  const [, trisIn, trisOut] = /([\d,]+) → ([\d,]+) triangles/.exec(statue.stats).map((s) => +s.replace(/,/g, ''));
  console.log(`      ${statue.stats} · ${statue.size} · ${box.stats}`);
  assert(trisIn > 39_000 && trisOut <= 15_000 && trisOut > 8_000 && /animations/.test(statue.notes) && man?.group === 'minis' && man.entry.kind === 'model' && man.entry.tris === trisOut && man.entry.yaw === 1 && man.entry.h === 1 && !man.entry.tex
    && man.entry.ref.m === 'model/gltf-binary' && man.bytes < 200_000 && /^image\//.test(man.entry.pic?.m ?? ''), `the GM imports a 40,000-triangle model as a figure: simplified on the device, turned and sized by touch, and it says what was left out (${statue.stats}; ${JSON.stringify(man?.entry)})`);
  assert(crate?.group === 'props' && crate.entry.tex === true && crate.entry.tris === 14 && crate.entry.cells === 1 && made.said.every((t) => /Stored on 1 server/.test(t) && /triangles/.test(t)), `and one with a picture as a thing: its texture on one atlas, stored on the server (${made.said[0].slice(0, 60)})`);
  // On the table: the other player has the pack as stand-ins until the pieces are drawn, then as the real models, fetched through blobs.
  await a.evaluate(([m, p]) => { const s = window.__ct.store; s.set('m:man', { x: 1, y: 0, z: 6, k: m, c: '#3e63dd', n: 'Frosty', r: 0, s: 1 }); s.set('b:3,0,6', { i: p }); }, [man.id, crate.id]);
  const drawn = ([m, p]) => {
    const { board, packs } = window.__ct, fig = board.minis.get('man')?.group.children[0].children[2], thing = board.props.get('b:3,0,6')?.children[0];
    return packs.pieceState(m) === 'ready' && packs.pieceState(p) === 'ready' && !!fig?.geometry.userData.model && !!thing?.geometry.userData.model;
  };
  await b.waitForFunction(drawn, [man.id, crate.id]);
  await a.waitForFunction(drawn, [man.id, crate.id]);
  const seen = await b.evaluate(([m, p, ref]) => {
    const { board, blobs, catalog } = window.__ct, fig = board.minis.get('man').group.children[0].children[2], thing = board.props.get('b:3,0,6').children[0];
    const box = fig.geometry.boundingBox, size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    return { via: blobs.source(ref.h), tris: fig.geometry.index.count / 3, said: fig.geometry.userData.model.tris, size: size.map((v) => +v.toFixed(2)), base: +box.min.y.toFixed(2), height: +catalog.MINIS[m].height.toFixed(2),
      shadow: fig.castShadow, plain: !fig.material.map && fig.material.vertexColors, map: thing.material.map?.image?.width, crate: thing.geometry.index.count / 3, own: thing.material !== fig.material, icon: catalog.PROPS[p].name };
  }, [man.id, crate.id, man.entry.ref]);
  assert(seen.via === 'server' && seen.tris === trisOut && seen.tris <= 15_000 && seen.size[1] <= 1.01 && Math.max(seen.size[0], seen.size[2]) <= 0.97 && seen.base === 0.08 && seen.height > 0.5 && seen.shadow && seen.plain && seen.map >= 64 && seen.map <= 1024 && seen.crate === 14,
    `the other player sees the real models, fetched through blobs, inside the budget: on the ground, to scale, casting shadows; the textured one with its own material ${JSON.stringify(seen)}`);
  await b.waitForTimeout(500);
  await b.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/models.png` });
  // The library shows the picture taken at save, without loading the model.
  const thumb = await b.evaluate((id) => new Promise((done) => { const { packs } = window.__ct; const look = () => (packs.packThumb(id) ? done(packs.packThumb(id)) : setTimeout(look, 100)); look(); }), man.id);
  assert(/url\(blob:/.test(thumb), 'the library has its picture, taken once when it was saved');
  // Hidden, selected and turned like any figure.
  await a.evaluate(() => { const s = window.__ct.store; s.set('m:man', { ...s.get('m:man'), h: true }); });
  await b.waitForFunction(() => window.__ct.board.minis.get('man').group.visible === false);
  assert(await a.evaluate(() => { const f = window.__ct.board.minis.get('man').group.children[0].children[2]; return f.material.transparent && f.material.opacity < 0.5 && !f.castShadow; }), 'a hidden model leaves the player\'s table and is a ghost on the GM\'s');
  await a.evaluate(() => { const s = window.__ct.store; s.set('m:man', null); s.set('b:3,0,6', null); s.set(`gm:${s.me}`, null); });
  await b.waitForFunction(() => !document.body.classList.contains('player'));

  // Draw calls: a copy of a model costs what a copy of a built-in piece costs.
  const calls = (page) => page.evaluate(() => new Promise((done) => {
    const { board } = window.__ct, info = board.renderer.info, was = board.hooks.onView;
    info.autoReset = false;
    board.touched();
    info.reset();
    board.hooks.onView = () => { board.hooks.onView = was; was(); const n = info.render.calls; info.autoReset = true; done(n); };
  }));
  const figures = (n, id) => b.evaluate(([n, id]) => { const s = window.__ct.store; for (let i = 0; i < 10; i++) s.set(`m:f${i}`, i < n ? { x: i % 5, y: 0, z: 6 + Math.floor(i / 5), k: id, c: '#3e63dd', n: '', r: 0, s: 1 } : null); }, [n, id]);
  const things = (n, id) => b.evaluate(([n, id]) => { const s = window.__ct.store; for (let i = 0; i < 10; i++) s.set(`b:${i % 5},0,${Math.floor(i / 5)}`, i < n ? { i: id } : null); }, [n, id]);
  const cost = {};
  await b.evaluate(() => { window.__ct.board.adapt = () => {}; }); // the board steps its own quality down on a slow machine: not between two measurements
  for (const [what, put, id] of [['model figures', figures, man.id], ['built-in knights', figures, 'knight'], ['model things', things, crate.id], ['built-in barrels', things, 'barrel']]) {
    await put(1, id);
    // (A built-in piece's own model comes with its kit pack: measure once it stands there.)
    await b.waitForFunction(() => { const { board } = window.__ct, n = (o) => { let k = 0; o.traverse((x) => { if (x.isMesh && x.material.visible !== false) k++; }); return k; }; return [...board.minis.values()].every((m) => n(m.group) === 2) && [...board.props.values()].every((g) => !g.userData.pending && n(g) >= 1); });
    await b.waitForTimeout(500);
    const one = await calls(b);
    await put(10, id); await b.waitForTimeout(500);
    cost[what] = [one, await calls(b)];
    if (what === 'model figures') await b.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/models-10.png` });
    await put(0, id); await b.waitForTimeout(200);
  }
  const grew = (k) => cost[k][1] - cost[k][0];
  console.log(`      draw calls a frame, 1 → 10 copies — ${Object.entries(cost).map(([k, v]) => `${k}: ${v[0]} → ${v[1]}`).join('; ')}`);
  assert(grew('model figures') <= grew('built-in knights') && grew('model things') <= grew('built-in barrels'), `ten copies of a model cost no more draw calls than ten of a built-in piece (${grew('model figures')} against ${grew('built-in knights')} for figures, ${grew('model things')} against ${grew('built-in barrels')} for things)`);
  // Many copies: the Packs page says when the board's models pass what a phone draws happily.
  await a.evaluate(([id]) => { const s = window.__ct.store; s.set(`gm:${s.me}`, true); for (let i = 0; i < 12; i++) s.set(`m:h${i}`, { x: i, y: 0, z: 9, k: id, c: '#3e63dd', n: '', r: 0, s: 1 }); s.set('m:man', { x: 1, y: 0, z: 6, k: id, c: '#3e63dd', n: 'Frosty', r: 0, s: 1 }); }, [man.id]);
  await a.click('#impPacks');
  await a.waitForSelector('#pkHeavy');
  await a.waitForSelector('.pkPiece i[style]');
  await a.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/models-packs.png` });
  assert(/triangles/.test(await a.evaluate(() => document.querySelector('#pkHeavy').textContent)), 'the Packs page warns when the models on the board pass 150,000 triangles');
  // Removing the pack leaves stand-ins on every device.
  await a.click('.pkDrop');
  await a.click('.pkYes');
  const standIn = (m) => { const { board, packs, registry } = window.__ct; return !registry.known.mini(m) && packs.pieceState(m) === null && board.minis.get('man')?.group.children[0].children[2].material.transparent === true && !board.minis.get('man').group.children[0].children[2].geometry.userData.model; };
  await b.waitForFunction(standIn, man.id);
  assert(await a.evaluate(standIn, man.id), 'with the pack removed its models are stand-ins again, for everyone');
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
console.log(failed ? `${failed} failed` : 'all good');
done(failed ? 1 : 0);
