// End-to-end check: two browsers at one table, synced through a local relay.
//   npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Works with a project-local or a globally installed Playwright.
const { chromium } = createRequire(import.meta.url)('playwright');

const procs = [
  spawn('node', ['scripts/relay.mjs'], { env: { ...process.env, PORT: '7788' }, stdio: 'ignore' }),
  spawn('npx', ['vite', 'preview', '--port', '4188', '--strictPort'], { stdio: 'ignore' }),
];
const done = (code) => { procs.forEach((p) => p.kill()); process.exit(code); };
const assert = (ok, what) => { console.log(ok ? '  ok  ' : ' FAIL ', what); if (!ok) done(1); };
process.on('uncaughtException', (e) => { console.error(e); done(1); });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const url = 'http://localhost:4188/#room=test-room-1234&relays=ws://localhost:7788';
async function join(name) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => { console.log('pageerror', name, e.message); done(1); });
  await page.goto(url);
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

await browser.close();
console.log('all good');
done(0);
