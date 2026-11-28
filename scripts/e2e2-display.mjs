// End-to-end check of the table screen (`?ui=2&display=1`, src/ui/display.ts): a GM on a
// phone, and a TV that opens the same table as its screen.
//   npm run build && node scripts/e2e2-display.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw, channel;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); channel = 'chrome'; }
const { chromium, devices } = pw;

const PORT = Number(process.env.E2E_PORT ?? 4480), RELAY = PORT + 1;
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
const room = 'v2-screen-1234', where = `#room=${room}&relays=ws://localhost:${RELAY}`;
const watch = (page, name) => { page.setDefaultTimeout(30000 * SLOW); page.on('pageerror', (e) => { console.log('pageerror', name, e.stack ?? e.message); done(1); }); };

console.log('table screen: a GM on a phone 360x640, a screen 1280x720');
// ---- the GM, on a phone ----
const p = await (await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 360, height: 640 } })).newPage();
watch(p, 'gm');
await p.goto(`http://localhost:${PORT}/?ui=2${where}`);
await p.fill('#name', 'Mo');
await p.tap('#join');
await p.waitForSelector('#app .dock .slot');
await p.evaluate(() => { const { session } = window.__ct; session.starterScene(); session.setGM(true); });
const settle = (ms = 200) => p.waitForTimeout(ms * SLOW);
const slot = async (id) => { await p.tap(`#app .dock [data-slot="${id}"]`); await settle(); };
await settle(400);

// ---- the screen: straight in from the link ----
const d = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
watch(d, 'screen');
await d.goto(`http://localhost:${PORT}/?ui=2&display=1${where}`);
await d.waitForFunction(() => !!window.__ct?.session);
assert(await d.evaluate(() => document.querySelector('#lobby').hidden && window.__ct.session.display && window.__ct.session.name === 'Table screen'), 'a screen gets in from its link alone: no lobby, no name asked');
assert(await d.evaluate(() => new URLSearchParams(location.search).get('display') === '1' && location.hash.includes('room=')), 'and its address still opens it as a screen after a reload');
await d.waitForFunction(() => [...window.__ct.store.keys('m:')].length === 3 && window.__ct.session.gmIds().length === 1);
const chrome = await d.evaluate(() => ({
  made: document.querySelectorAll('#app .dock, #app .drawer, #app .undo, #app .turn, #app .notice, #hud > :not(#toast):not(.sheet)').length,
  seen: [...document.querySelectorAll('#app *, #hud *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity !== '0'; }).map((e) => e.id || e.className).join(),
  canvas: (() => { const r = document.querySelector('#c').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join(); })(),
}));
assert(chrome.made === 0, 'a screen has no dock, no drawer, no Undo pair and no turn strip to tap');
assert(chrome.seen === '', `nothing is drawn over the table (${chrome.seen})`);
assert(chrome.canvas === '0,0,1280,720', `the table has the whole screen (${chrome.canvas})`);
assert(await d.evaluate(() => { const { session, board } = window.__ct; return !session.full() && !session.amGM() && board.followTurns; }), 'it has no powers, and follows the turns');
if (SHOTS) await d.screenshot({ path: `${SHOTS}/screen-rest.png` });

// ---- it changes nothing ----
const dump = () => d.evaluate(() => JSON.stringify(window.__ct.store.dump().filter((r) => r[1] !== null && !r[0].startsWith('turn')).map((r) => [r[0], r[1]]).sort()));
const miniAt = (id) => d.evaluate((id) => {
  const { board, store } = window.__ct, c = document.querySelector('#c'), v = store.get(`m:${id}`);
  const s = board.ground.position.clone().set(v.x + 0.5, v.y + 0.3, v.z + 0.5).project(board.camera);
  const cx = ((s.x + 1) / 2) * c.clientWidth, cy = ((1 - s.y) / 2) * c.clientHeight;
  for (const dy of [0, -10, 10, -20, 20, -30]) for (const dx of [0, -10, 10, -20, 20]) {
    board.aim({ clientX: cx + dx, clientY: cy + dy });
    if (board.pickMini() === id) return [cx + dx, cy + dy];
  }
  return null;
}, id);
const before = await dump();
let knight = null;
for (let i = 0; i < 40 && !knight; i++) { await d.waitForTimeout(250); knight = await miniAt('start-knight'); } // (it is drawn a frame or two after it arrives)
assert(!!knight, 'the knight is on the screen');
await d.mouse.click(knight[0] + 160, knight[1] + 120); // the open table
await d.mouse.move(...knight);
await d.mouse.down();
for (let i = 1; i <= 8; i++) { await d.mouse.move(knight[0] + i * 12, knight[1] + i * 6); await d.waitForTimeout(16); }
await d.mouse.up();
await d.mouse.move(640, 500); // press and hold: a player's ping
await d.mouse.down();
await d.waitForTimeout(900 * SLOW);
await d.mouse.up();
await d.evaluate(() => {
  const { session, board } = window.__ct;
  board.select('start-knight');
  session.patch({ n: 'Mine now' }); session.hurt(-3); session.setOpt('ini', 9);
  session.arm('stone'); session.setMode('build'); session.starterScene(); session.clearBoard(); session.revealAll(); session.next(); session.setGM(true);
  board.select(null);
});
await d.waitForTimeout(400 * SLOW);
assert(await dump() === before, 'a click, a drag on a mini and every action of the session leave the table as it was');
assert(await d.evaluate(() => window.__ct.board.tool) === 'move', 'and there is no tool but looking');
assert(await p.evaluate(() => window.__ct.store.get('m:start-knight').n === '' && window.__ct.session.amGM()), 'the GM saw none of it either');

// ---- the GM's People list ----
await p.waitForFunction(() => window.__ct.session.screens().length === 1);
await slot('table');
const people = await p.evaluate(() => ({
  chips: [...document.querySelectorAll('.drawer .person')].map((e) => e.textContent).join('|'),
  screens: [...document.querySelectorAll('.drawer .person.screen')].map((e) => e.textContent).join('|'),
  players: window.__ct.session.people().map((x) => x.name).join('|'),
}));
assert(people.screens === 'Table screen' && people.chips === 'Mo · GM (you)|Table screen', `the GM's People list shows the screen as a table screen (${people.chips})`);
assert(people.players === 'Mo', `and it is not one of the players a mini can be given to (${people.players})`);
await p.tap('.drawer button:has-text("Table screen")');
await settle();
const link = await p.evaluate(() => {
  const box = document.querySelector('.drawer .screenlink'), qr = box?.querySelector('canvas.qr'), r = qr?.getBoundingClientRect();
  const dark = qr ? [...qr.getContext('2d').getImageData(0, 0, qr.width, qr.height).data].filter((v, i) => i % 4 === 0 && v === 0).length : 0;
  const small = [...document.querySelectorAll('.drawer .screenlink button, .drawer .chips button')].filter((b) => { const q = b.getBoundingClientRect(); return q.height && (q.height < 44 || q.right > innerWidth + 0.5); }).map((b) => b.textContent);
  return { url: box?.querySelector('.url')?.textContent ?? '', qr: r ? [Math.round(r.width), Math.round(r.height), qr.width] : null, dark, small, inside: r ? r.left >= 0 && r.right <= innerWidth : false };
});
assert(link.url === `http://localhost:${PORT}/?ui=2&display=1${where}`, `Table screen shows the link to open on the TV (${link.url})`);
assert(!!link.qr && link.qr[0] >= 150 && link.qr[0] === link.qr[1] && link.inside && link.dark > 200, `and a QR code of it, big enough to scan (${link.qr}, ${link.dark} dark squares)`);
assert(link.small.length === 0, `its buttons are finger-sized and on the screen (${link.small})`);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/gm-table-screen.png` });
await p.tap('.drawer header button');
await settle();

// ---- a hidden mini is not drawn ----
const visible = (id) => d.evaluate((id) => window.__ct.board.minis.get(id)?.group.visible, id);
assert(await visible('start-wolf') === true, 'the wolf is on the screen');
await p.evaluate(() => { const { session, board } = window.__ct; board.select('start-wolf'); session.patch({ h: true }); session.deselect(); });
await d.waitForFunction(() => window.__ct.store.get('m:start-wolf')?.h === true && window.__ct.board.minis.get('start-wolf').group.visible === false);
assert(await visible('start-wolf') === false && await visible('start-knight') === true, 'a mini the GM hides is not drawn on the screen (the others are)');
assert(await p.evaluate(() => window.__ct.board.minis.get('start-wolf').group.visible), 'the GM still sees it');

// ---- the turn, as a banner ----
assert(await d.evaluate(() => document.querySelector('#app .banner').hidden), 'no fight, no banner');
await slot('fight');
await p.tap('.drawer button:has-text("Start")');
await d.waitForFunction(() => !document.querySelector('#app .banner').hidden);
const turn = await d.evaluate(() => {
  const b = document.querySelector('#app .banner'), r = b.getBoundingClientRect(), id = window.__ct.store.get('turn').id;
  return { text: b.textContent, id, size: parseFloat(getComputedStyle(b).fontSize), on: r.left >= 0 && r.right <= innerWidth && r.top >= 0, taps: getComputedStyle(b).pointerEvents };
});
const NAMES = { 'start-knight': 'Knight', 'start-ogre': 'Ogre' };
assert(turn.text === (turn.id === 'start-wolf' ? 'Round 1' : `Round 1 · ${NAMES[turn.id]}`), `the screen says whose turn it is, and does not name a hidden mini (${turn.text}; ${turn.id})`);
assert(turn.size >= 20 && turn.on && turn.taps === 'none', `large, on the screen, and not a button (${turn.size}px)`);
if (SHOTS) await d.screenshot({ path: `${SHOTS}/screen-fight.png` });
await p.tap('.drawer header button');
await settle();

// ---- the GM shows it a view ----
const cam = (page) => page.evaluate(() => { const { p, t } = window.__ct.board.view(); return [...p, ...t]; });
const apart = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
/** The view once the camera has come to rest (a drag coasts on, a glide takes its time). */
const still = async (page) => {
  let a = await cam(page);
  for (let i = 0, same = 0; i < 200 && same < 4; i++) {
    await page.waitForTimeout(300);
    const b = await cam(page), gliding = await page.evaluate(() => !!window.__ct.board.glide);
    same = apart(a, b) < 0.001 && !gliding ? same + 1 : 0;
    a = b;
  }
  return a;
};
const was = await still(d);
await p.evaluate(() => window.__ct.board.lookAt(7, 0, -6));
await settle(300);
const mine = await cam(p);
assert(apart(was, mine) > 3, 'the GM looks somewhere else');
await d.waitForTimeout(400 * SLOW);
const unled = await cam(d);
assert(apart(unled, was) < 0.05, `which the screen does not follow by itself (${was.map((v) => v.toFixed(2))} → ${unled.map((v) => v.toFixed(2))})`);
await slot('table');
await p.tap('.drawer button:has-text("Show this on the table screen")');
await d.waitForFunction((to) => { const { p, t } = window.__ct.board.view(); return [...p, ...t].every((v, i) => Math.abs(v - to[i]) < 0.05); }, mine);
const now = await d.evaluate(() => { const c = window.__ct.board.camera.position; return [c.x, c.y, c.z]; });
assert(apart(now, was.slice(0, 3)) > 3 && apart(await cam(d), mine) < 0.05, `"Show this on the table screen" glides the screen's camera to the GM's (${now.map((v) => v.toFixed(1))})`);
assert(await p.evaluate(() => window.__ct.ui.drawer.id === null), 'and puts the drawer away');

// Follow me: the screen looks where the GM looks, while the GM looks around.
await slot('table');
await p.tap('.drawer button:has-text("Follow me")');
await settle();
assert(await p.evaluate(() => [...document.querySelectorAll('.drawer button')].some((b) => b.textContent === 'Follow me: on' && b.getAttribute('aria-pressed') === 'true')), 'Follow me can be switched on');
await p.tap('.drawer header button');
let sent = 0;
await p.evaluate(() => { const { net } = window.__ct, send = net.send.bind(net); window.__cams = 0; net.send = (m) => { if (m.y === 'cam') window.__cams++; return send(m); }; });
await p.evaluate(() => window.__ct.board.lookAt(-5, 0, 4));
await settle(700);
const led = await cam(p);
await d.waitForFunction((to) => { const { p, t } = window.__ct.board.view(); return [...p, ...t].every((v, i) => Math.abs(v - to[i]) < 0.05); }, led);
sent = await p.evaluate(() => window.__cams);
assert(sent >= 1 && sent <= 4, `with Follow me on, the screen goes where the GM's camera goes (${sent} sent)`);
await settle(1200);
assert(await p.evaluate(() => window.__cams) === sent, 'and nothing is sent while the GM holds still');

// ---- only a GM's view is taken up, and a screen has no powers on a table without a GM ----
const rest = await still(d);
await p.evaluate(() => window.__ct.session.setGM(false));
await d.waitForFunction(() => window.__ct.session.gmIds().length === 0);
await p.evaluate(() => { const { session, net } = window.__ct; session.showView(); void net.send({ y: 'cam', p: [20, 30, 20], t: [10, 0, 10], bd: '' }); });
await d.waitForTimeout(900 * SLOW);
assert(apart(await cam(d), rest) < 0.05, 'a view from someone who is not the GM is ignored');
const free = await dump();
await d.mouse.move(640, 300);
await d.mouse.down();
await d.mouse.up();
await d.evaluate(() => { const { session, board } = window.__ct; board.select('start-knight'); session.patch({ n: 'Mine now' }); session.arm('stone'); session.clearBoard(); board.select(null); });
await d.waitForTimeout(300 * SLOW);
assert(await d.evaluate(() => !window.__ct.session.full()) && await dump() === free, 'with no GM everyone can build, but the screen still changes nothing');
assert(await visible('start-wolf') === false, 'and still does not draw what is hidden');

await browser.close();
console.log(failed ? `${failed} failed` : 'all good');
done(failed ? 1 : 0);
