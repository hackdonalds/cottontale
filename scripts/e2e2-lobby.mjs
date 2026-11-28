// End-to-end check of the new lobby and the first run (`?ui=2`, src/ui/lobby.ts, src/ui/firstRun.ts), on phone viewports.
//   npm run build && node scripts/e2e2-lobby.mjs
// Beside scripts/e2e2.mjs (the chrome itself) until the new chrome takes over: start a table and be its GM,
// pick a theme and get a scene, invite a player who picks a character, and let everyone build.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw, channel;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); channel = 'chrome'; }
const { chromium, devices } = pw;

const PORT = Number(process.env.E2E_PORT ?? 4460), RELAY = PORT + 1;
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
const BASE = `http://localhost:${PORT}/?ui=2`, RELAYS = `relays=ws://localhost:${RELAY}`;

/** A device of its own (its own key and local storage). */
async function device(viewport) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  return ctx;
}
async function open(ctx, name, url) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000 * SLOW);
  page.on('pageerror', (e) => { console.log('pageerror', name, e.stack ?? e.message); done(1); });
  await page.goto(url);
  await page.waitForSelector('#welcome');
  return page;
}
const seated = (page) => page.waitForSelector('#app .dock .slot');
const synced = (page) => page.waitForFunction(() => window.__ct?.net.synced);
const slots = (page) => page.evaluate(() => [...document.querySelectorAll('#app .dock .slot')].map((b) => b.dataset.slot).join());
const settle = (page, ms = 150) => page.waitForTimeout(ms * SLOW);
const count = (page) => page.evaluate(() => [...window.__ct.store.keys('b:')].length + [...window.__ct.store.keys('w:')].length);
const seed = (page) => page.evaluate(() => window.__ct.store.get('gen')?.o.seed ?? null);
const role = (page) => page.evaluate(() => { const s = window.__ct.session; return { gm: s.amGM(), full: s.full(), build: s.build(), gms: s.gmIds().join(), me: s.meId }; });
const noticed = (page, text) => page.waitForFunction((t) => document.querySelector('#app .notice')?.textContent.includes(t), text, { timeout: 8000 * SLOW }).then(() => true, async () => { console.log('       the notice reads:', await page.evaluate(() => document.querySelector('#app .notice')?.textContent)); return false; });

/** The lobby holds: on screen above the keyboard (`kb`), nothing sideways, targets big enough, and the step's one decision in view. */
const lobby = (page, kb = 0) => page.evaluate((kb) => {
  const bad = [], el = document.querySelector('#welcome'), r = el.getBoundingClientRect();
  if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight - kb + 0.5) bad.push(`the panel leaves the screen (${Math.round(r.top)}–${Math.round(r.bottom)} of ${innerHeight - kb})`);
  if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth || el.scrollWidth > el.clientWidth + 1) bad.push('it scrolls sideways');
  for (const b of el.querySelectorAll('button, summary, input, textarea')) {
    const q = b.getBoundingClientRect(), what = b.id || b.textContent || b.getAttribute('aria-label');
    if (!q.width || !b.checkVisibility()) continue; // (what a closed fold holds is not on screen)
    if (q.width < 43.5 || q.height < 43.5) bad.push(`small target ${what} ${Math.round(q.width)}x${Math.round(q.height)}`);
    if (q.left < r.left - 0.5 || q.right > r.right + 0.5) bad.push(`${what} sticks out sideways`);
    if (b.matches('input, textarea') && parseFloat(getComputedStyle(b).fontSize) < 16) bad.push(`input ${what} under 16px`);
  }
  const main = el.querySelector('.primary')?.getBoundingClientRect();
  if (!main) bad.push('no primary button');
  else if (main.top < r.top - 0.5 || main.bottom > Math.min(r.bottom, innerHeight - kb) + 0.5) bad.push('the primary button is out of view');
  return bad;
}, kb);
/** The chrome of the table holds: the drawer and dock on screen, targets big enough, nothing sideways. */
const chrome = (page) => page.evaluate(() => {
  const bad = [];
  for (const e of document.querySelectorAll('#app .dock, #app .drawer:not([hidden])')) { const r = e.getBoundingClientRect(); if (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) bad.push(`${e.className} off-screen`); }
  for (const b of document.querySelectorAll('#app button')) { const r = b.getBoundingClientRect(); if (b.offsetParent && (r.width < 43.5 || r.height < 43.5)) bad.push(`small target ${b.dataset.slot || b.title || b.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`); }
  for (const b of document.querySelectorAll('#app .drawer:not([hidden]) :is(button, input, select)')) { const r = b.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) bad.push(`${b.textContent} sticks out sideways`); }
  if (document.querySelectorAll('#app .dock .slot').length > 6) bad.push('more than six slots');
  if (document.documentElement.scrollWidth > innerWidth) bad.push('the page scrolls sideways');
  const d = document.querySelector('#app .drawer:not([hidden])'), dock = document.querySelector('#app .dock').getBoundingClientRect();
  if (d && d.dataset.h !== 'full') { const r = d.getBoundingClientRect(), table = 1 - (r.width * r.height + dock.width * dock.height) / (innerWidth * innerHeight); if (table < 0.45) bad.push(`the table keeps ${(table * 100).toFixed(1)}%`); }
  return bad;
});

for (const [label, viewport] of [['portrait', { width: 360, height: 640 }], ['landscape', { width: 640, height: 360 }]]) {
  console.log(`lobby and first run, phone ${label} ${viewport.width}x${viewport.height}`);
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/lobby-${label}-${name}.png` }); };
  const fits = async (page, what, kb = 0) => { const bad = await lobby(page, kb); assert(!bad.length, `${what}: the lobby holds${bad.length ? ` — ${bad.join('; ')}` : ''}`); await shot(page, what.replace(/\W+/g, '-')); };
  const holds = async (page, what) => { const bad = await chrome(page); assert(!bad.length, `${what}: layout holds${bad.length ? ` — ${bad.join('; ')}` : ''}`); await shot(page, what.replace(/\W+/g, '-')); };

  // ---- the lobby, on a device that has never been here ----
  const mo = await device(viewport);
  const p = await open(mo, 'Mo', `${BASE}#${RELAYS}`);
  const first = await p.evaluate(() => {
    const el = document.querySelector('#welcome'), old = document.querySelector('#lobby');
    return { step: el.dataset.step, old: old.hidden && !old.children.length, text: el.innerText, ids: [...el.querySelectorAll('[id]')].filter((e) => e.checkVisibility()).map((e) => e.id).join(), names: document.querySelectorAll('#name').length, scrolls: el.scrollHeight > el.clientHeight + 1 };
  });
  assert(first.old && first.step === 'home' && first.names === 1, 'the new lobby stands in for the old form');
  assert(first.ids === 'name,lbStart' && /Start a table/.test(first.text) && /Join a table/.test(first.text), `two choices, start or join, and no table to go back to yet (${first.ids})`);
  assert(!/nostr|relay|encrypt|key\b/i.test(first.text), 'the first screen speaks plainly: no relays, keys or encryption');
  assert(!first.scrolls, 'and it fits without scrolling');
  await fits(p, 'home');
  await p.evaluate((kb) => { document.documentElement.style.setProperty('--kb', `${kb}px`); document.querySelector('#name').focus(); }, label === 'portrait' ? 280 : 170);
  await settle(p);
  await fits(p, 'home with the keyboard up', label === 'portrait' ? 280 : 170);
  await p.evaluate(() => { document.documentElement.style.setProperty('--kb', '0px'); document.activeElement.blur(); });
  await p.tap('#welcome summary');
  await settle(p);
  const adv = await p.evaluate(() => ({ code: document.querySelector('#lbCode').value, relays: document.querySelector('#lbRelays').value }));
  assert(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/.test(adv.code) && adv.relays === `ws://localhost:${RELAY}`, `Advanced holds a fresh table code and the relays (${adv.code})`);
  await fits(p, 'home with Advanced open');
  await p.tap('#welcome summary');
  await p.tap('#welcome .acts >> text=Join a table');
  await settle(p);
  assert(await p.evaluate(() => document.querySelector('#welcome').dataset.step === 'join' && !!document.querySelector('#lbPaste') && !!document.querySelector('#join') && !document.querySelector('#lbStart')), 'Join a table asks for a code or a link');
  await fits(p, 'join');
  await p.fill('#lbPaste', 'abc');
  await p.tap('#join');
  await settle(p);
  assert(await p.evaluate(() => /name/i.test(document.querySelector('#welcome .err').textContent) && !window.__ct), 'without a name nobody sits down, and the lobby says why');
  await p.tap('#welcome .acts >> text=Back');
  await settle(p);

  // ---- start a table: in, and its GM ----
  await p.fill('#name', 'Mo');
  await p.tap('#lbStart');
  await seated(p);
  await p.waitForFunction(() => window.__ct.session.amGM());
  const code = decodeURIComponent(new URLSearchParams(new URL(p.url()).hash.slice(1)).get('room'));
  const mine = await role(p);
  assert(code === adv.code && mine.gm && mine.gms === mine.me && await p.evaluate(() => !document.querySelector('#welcome')), `starting a table sits you down as its GM (${code})`);
  await p.waitForSelector('#app .drawer[data-id="start"]:not([hidden]) .pick');
  const cards = await p.evaluate(() => [...document.querySelectorAll('#app .drawer .pick')].map((c) => c.dataset.theme));
  assert(cards.length >= 2 && await count(p) === 0, `an empty table offers Start with…: ${cards.length} themes (${cards.join()})`);
  assert(await p.evaluate(() => { const t = [...document.querySelectorAll('#app .drawer .chips button')].map((b) => b.textContent).join(); return /Starter scene/.test(t) && /Empty table/.test(t) && /Invite players/.test(t) && !/Another/.test(t); }), 'with a starter scene, an empty table and inviting players beside them');
  await holds(p, 'start with');
  assert(await slots(p) === 'build,fight,dice,quick,tools,table', 'the dock under it is the GM\'s');

  // Pick a theme: a scene is built, as one step.
  await p.tap(`#app .drawer .pick[data-theme="${cards[0]}"]`);
  await p.waitForFunction(() => window.__ct.store.get('gen'));
  await settle(p, 400);
  const n1 = await count(p), s1 = await seed(p);
  assert(n1 > 50 && await p.evaluate((id) => window.__ct.session.gameTheme()?.id === id, cards[0]), `picking a theme takes it up and builds a scene (${n1} pieces)`);
  assert(await p.evaluate(() => !document.querySelector('#app .drawer').hidden && /Another/.test(document.querySelector('#app .drawer .primary')?.textContent ?? '')), 'the step stays up, now with Another');
  await holds(p, 'a first scene');
  await p.tap('#app .drawer .primary');
  await p.waitForFunction((s) => window.__ct.store.get('gen')?.o.seed !== s, s1);
  await settle(p, 400);
  const n2 = await count(p), s2 = await seed(p);
  assert(s2 !== s1 && n2 > 50 && n2 !== n1, `Another builds a different one (${n1} → ${n2} pieces)`);
  await p.evaluate(() => window.__ct.session.undo());
  await settle(p, 300);
  assert(await seed(p) === s1 && await count(p) === n1, 'one Undo brings the first scene back');
  await p.evaluate(() => window.__ct.session.undo());
  await settle(p, 300);
  assert(await seed(p) === null && await count(p) === 0, 'and one more empties the table again');
  await p.evaluate(() => { window.__ct.session.undo(true); window.__ct.session.undo(true); });
  await settle(p, 300);
  assert(await seed(p) === s2 && await count(p) === n2, 'Redo puts both back');
  // Invite players: the link goes to the share sheet, or to the clipboard with a word about it.
  await p.tap('#app .drawer .chips >> text=Invite players');
  const invite = await p.evaluate(() => window.__ct.session.invite);
  assert(invite.includes(`room=${encodeURIComponent(code)}`) && await noticed(p, 'nvite link copied'), 'Invite players copies the link and says so');
  await p.tap('#app .drawer >> text=Keep it');
  await settle(p);
  assert(await p.evaluate(() => document.querySelector('#app .drawer').hidden), 'Keep it puts the step away');

  // ---- a player opens the invite: one form, one button ----
  const pip = await device(viewport);
  const q = await open(pip, 'Pip', invite);
  const inv = await q.evaluate(() => {
    const el = document.querySelector('#welcome');
    return { step: el.dataset.step, ids: [...el.querySelectorAll('[id]')].map((e) => e.id).join(), more: el.querySelectorAll('details, textarea, input:not(#name)').length, text: el.innerText };
  });
  assert(inv.step === 'invite' && inv.ids === 'name,join' && !inv.more && /Join/.test(inv.text) && !/Start a table/.test(inv.text), `an invite shows a name, a colour and Join, nothing else (${inv.ids})`);
  await fits(q, 'invite');
  await q.fill('#name', 'Pip');
  await q.tap('#join');
  await seated(q);
  await q.waitForFunction(() => !window.__ct.session.full() && window.__ct.store.get('gen'));
  await settle(q, 300);
  const theirs = await role(q);
  assert(!theirs.gm && !theirs.full && theirs.gms === mine.me && await slots(q) === 'dice,ruler,chat,table', `the player is a player: a short dock, and the GM is still the one who started (${await slots(q)})`);
  assert((await role(p)).gms === mine.me, 'the GM seat was not taken');
  assert(await noticed(q, 'Ask the GM for a character'), 'with no figure free, the player is told to ask the GM');
  assert(await q.evaluate(() => document.querySelector('#app .drawer').hidden), 'and no Start with… for a player');

  // ---- everyone can build: the GM's switch ----
  await p.tap('#app .dock [data-slot="table"]');
  await settle(p);
  await p.tap('#app .drawer >> text=Everyone can build: off');
  await q.waitForFunction(() => window.__ct.session.build());
  await settle(q, 300);
  assert(await slots(q) === 'build,dice,ruler,chat,table' && !(await role(q)).full, `Everyone can build gives the player the Build slot (${await slots(q)})`);
  assert(await p.evaluate(() => /Everyone can build: on/.test(document.querySelector('#app .drawer').textContent)), 'the switch shows it is on');
  await holds(p, 'table drawer');
  await q.tap('#app .dock [data-slot="build"]');
  await settle(q);
  assert(await slots(q) === 'play,pieces,make,shape,erase,table' && await q.evaluate(() => window.__ct.board.tool === 'pick'), 'and Build is theirs to enter');
  assert(await noticed(q, 'Tap a piece to change it') && await q.evaluate(() => JSON.parse(localStorage.getItem('cottontale:hints')).includes('build')), 'the first time in Build brings its hint, once');
  const fog = await q.evaluate(() => { const { session, board } = window.__ct; session.setTool('fog'); const t = board.tool; session.setMode('build'); return t; });
  assert(fog !== 'fog', `fog stays the GM's (${fog})`);
  // A piece put down by the player's finger reaches the GM.
  await q.evaluate(() => window.__ct.session.arm('stone'));
  await settle(q);
  assert(await q.evaluate(() => window.__ct.board.tool === 'build') && (await slots(q)).startsWith('hand,'), 'the player can take a brush in hand');
  const spot = [viewport.width * 0.4, viewport.height * 0.4];
  const cell = await q.evaluate(([x, y]) => { const { board } = window.__ct; board.aim({ clientX: x, clientY: y }); const at = board.pickSurface()?.place; return at ? `b:${at.join()}` : null; }, spot);
  await q.touchscreen.tap(...spot);
  const built = !!cell && await p.waitForFunction((k) => window.__ct.store.get(k)?.i === 'stone', cell, { timeout: 10000 * SLOW }).then(() => true, () => false);
  assert(built, `and what their finger puts down reaches the GM (${cell})`);
  await q.evaluate(() => window.__ct.session.disarm());
  await p.tap('#app .drawer >> text=Everyone can build: on');
  await q.waitForFunction(() => !window.__ct.session.build());
  await settle(q, 300);
  assert(await slots(q) === 'dice,ruler,chat,table' && await q.evaluate(() => window.__ct.board.tool === 'move'), 'switched off, the player is back in Play with the short dock');
  await p.evaluate(() => window.__ct.ui.drawer.close());

  // ---- pick your character: a figure the GM left to everyone ----
  await p.evaluate(() => { const { store } = window.__ct; store.set('m:hero', { x: 0, y: 1, z: 0, k: 'knight', c: '#3e63dd', n: 'Rook', r: 0, s: 1, o: '*' }); store.set('m:boss', { x: 2, y: 1, z: 2, k: 'ogre', c: '#e5484d', n: 'Grub', r: 0, s: 1 }); });
  await q.waitForSelector('#app .drawer[data-id="character"]:not([hidden]) [data-claim]');
  const free = await q.evaluate(() => [...document.querySelectorAll('#app .drawer [data-claim]')].map((b) => b.dataset.claim).join());
  assert(free === 'hero', `the player is offered the free figure, and only that one (${free})`);
  await holds(q, 'pick your character');
  await q.tap('#app .drawer [data-claim="hero"]');
  await p.waitForFunction((id) => window.__ct.store.get('m:hero')?.o === id, theirs.me);
  await settle(q);
  assert(await q.evaluate(() => document.querySelector('#app .drawer').hidden && window.__ct.board.selected === 'hero' && window.__ct.session.mine()), 'a tap makes it theirs: selected, and theirs to move');
  assert(await q.evaluate(() => !window.__ct.session.claim('boss')) && (await p.evaluate(() => window.__ct.store.get('m:boss').o)) === undefined, 'the GM\'s own figures cannot be taken');
  await q.close();

  // ---- coming back: the first device is still the GM, and nobody else becomes it ----
  await p.reload();
  await p.waitForSelector('#welcome');
  assert(await p.evaluate(() => document.querySelector('#welcome').dataset.step === 'invite' && document.querySelector('#name').value === 'Mo'), 'reloading the table asks only to join again, name remembered');
  await p.tap('#join');
  await seated(p);
  await synced(p);
  await settle(p, 500);
  let again = await role(p);
  assert(again.gm && again.gms === mine.me && await p.evaluate(() => document.querySelector('#app .drawer').hidden), 'the first device comes back as the GM, and is not asked how to start');
  await p.close();
  const back = await open(mo, 'Mo', `${BASE}#${RELAYS}`);
  assert(await back.evaluate(() => !!document.querySelector('#lbBack') && document.querySelector('#welcome .acts').firstElementChild.id === 'lbBack'), 'the lobby now offers Back to your table');
  await fits(back, 'home with a table to go back to');
  await back.tap('#lbBack');
  await seated(back);
  await synced(back);
  await settle(back, 500);
  again = await role(back);
  assert(again.gm && again.gms === mine.me && decodeURIComponent(new URL(back.url()).hash).includes(code), 'Back to your table opens the same table, still as its GM');
  await back.close();
  // Somebody else "starts" a table with this table's code: it is not new, so it is not theirs.
  const eve = await device(viewport);
  const r = await open(eve, 'Eve', `${BASE}#${RELAYS}`);
  await r.fill('#name', 'Eve');
  await r.tap('#welcome summary');
  await r.fill('#lbCode', code);
  await r.tap('#lbStart');
  await seated(r);
  await synced(r);
  await settle(r, 1500);
  const hers = await role(r);
  assert(!hers.gm && !hers.full && hers.gms === mine.me, 'starting a table that already exists never takes its GM seat');
  await eve.close();
  await pip.close();
  await mo.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all good');
done(failed ? 1 : 0);
