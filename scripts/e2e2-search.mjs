// End-to-end check of the search at the top of the Table drawer (`?ui=2`, src/ui/tableSearch.ts),
// on phone viewports. Modelled on e2e2.mjs, and meant to be folded into it.
//   npm run build && node scripts/e2e2-search.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw, channel;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); channel = 'chrome'; }
const { chromium, devices } = pw;

const PORT = Number(process.env.E2E_PORT ?? 4450), RELAY = PORT + 1;
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

/** What a page needs for these checks: the helpers of e2e2.mjs, and a few for the search. */
function on(p, label) {
  const settle = (ms = 150) => p.waitForTimeout(ms * SLOW);
  const slots = () => p.evaluate(() => [...document.querySelectorAll('#app .dock .slot')].map((b) => b.dataset.slot).join());
  const slot = async (id) => { await p.tap(`#app .dock [data-slot="${id}"]`); await settle(); };
  const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-search-${name}.png` }); };
  /** Nothing overlaps or leaves the screen, every target is big enough, the dock holds at most six (e2e2.mjs), and nothing in the drawer is wider than it. */
  const layout = () => p.evaluate(() => {
    const bad = [];
    const boxes = [...document.querySelectorAll('#app .dock, #app .undo:not([hidden]), #app .drawer:not([hidden]), #app .turn:not([hidden])')].map((e) => ({ id: e.className, r: e.getBoundingClientRect() }));
    for (const a of boxes) {
      if (a.r.left < 0 || a.r.top < 0 || a.r.right > innerWidth + 0.5 || a.r.bottom > innerHeight + 0.5) bad.push(`${a.id} off-screen`);
      for (const b of boxes) if (a.id < b.id && a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) bad.push(`${a.id} overlaps ${b.id}`);
    }
    const n = document.querySelectorAll('#app .dock .slot').length;
    if (n > 6) bad.push(`${n} slots in the dock`);
    for (const b of document.querySelectorAll('#app button')) {
      const r = b.getBoundingClientRect();
      if (b.offsetParent && (r.width < 43.5 || r.height < 43.5)) bad.push(`small target ${b.dataset.slot || b.dataset.cmd || b.title} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const b of document.querySelectorAll('#app .drawer:not([hidden]) :is(button, input, select)')) { const r = b.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) bad.push(`${b.textContent || b.placeholder} sticks out sideways`); }
    for (const s of document.querySelectorAll('#app .dock .slot span')) if (s.scrollWidth > s.clientWidth + 1) bad.push(`label cut off: ${s.textContent}`);
    for (const i of document.querySelectorAll('input, textarea')) if (i.offsetParent && parseFloat(getComputedStyle(i).fontSize) < 16) bad.push(`input ${i.id} under 16px`);
    if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) bad.push('the page scrolls sideways');
    // the drawer itself: its list scrolls up and down only, and every row stays inside it
    const body = document.querySelector('#app .drawer:not([hidden]) .body');
    if (body) {
      if (body.scrollWidth > body.clientWidth + 1) bad.push(`the drawer scrolls sideways (${body.scrollWidth} in ${body.clientWidth})`);
      const d = body.getBoundingClientRect();
      for (const b of body.querySelectorAll('.cmd, .cmd-q input')) { const r = b.getBoundingClientRect(); if (r.left < d.left - 0.5 || r.right > d.right + 0.5) bad.push(`${b.dataset.cmd || 'the search field'} is wider than the drawer`); }
      for (const b of body.querySelectorAll('.cmd')) if (b.querySelector('span').getBoundingClientRect().width < 60) bad.push(`${b.dataset.cmd} has no room for its name`);
    }
    return bad;
  });
  const fits = async (what) => { const bad = await layout(); assert(!bad.length, `${what}: layout holds${bad.length ? ` — ${bad.join('; ')}` : ''}`); await shot(what.replace(/\W+/g, '-')); };
  const Q = '#app .drawer .cmd-q input';
  /** Type into the search one key at a time, as a thumb would; false if the field ever lost the focus or the caret. */
  const type = async (text) => {
    await p.tap(Q);
    await p.fill(Q, '');
    let kept = true;
    for (const ch of text) {
      await p.keyboard.type(ch);
      await p.waitForTimeout(30 * SLOW);
      kept &&= await p.evaluate(() => { const i = document.querySelector('#app .drawer .cmd-q input'); return document.activeElement === i && i.selectionStart === i.value.length; });
    }
    await settle();
    return kept && await p.evaluate((t) => document.querySelector('#app .drawer .cmd-q input').value === t, text);
  };
  /** The results on screen: id, what the row says, whether it can be tapped. */
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#app .drawer .cmd-list .cmd')].filter((b) => b.offsetParent).map((b) => ({ id: b.dataset.cmd, title: b.querySelector('b').textContent, hint: b.querySelector('small').textContent, off: b.disabled, pressed: b.getAttribute('aria-pressed'), h: b.getBoundingClientRect().height, pic: !!b.querySelector(':scope > i, :scope > svg') })));
  const row = async (id) => (await rows()).find((r) => r.id === id);
  const run = async (id) => { await p.tap(`#app .drawer .cmd[data-cmd="${id}"]`); await settle(300); };
  /** Are the drawer's own sections showing? */
  const sections = () => p.evaluate(() => [...document.querySelectorAll('#app .drawer .body > h3')].some((e) => e.offsetParent));
  const drawer = () => p.evaluate(() => window.__ct.ui.drawer.id);
  return { settle, slots, slot, fits, type, rows, row, run, sections, drawer, Q };
}

for (const [label, viewport] of [['portrait', { width: 360, height: 640 }], ['landscape', { width: 640, height: 360 }]]) {
  console.log(`table search, phone ${label} ${viewport.width}x${viewport.height}`);
  const room = `v2-search-${label}-1234`;
  const p = await join('Mo', room, viewport);
  const { settle, slots, slot, fits, type, rows, row, run, sections, drawer, Q } = on(p, label);
  const st = () => p.evaluate(() => { const { board, session } = window.__ct; return { tool: board.tool, brush: board.brush, mode: session.mode(), gm: session.amGM(), sound: session.sound.enabled }; });

  // ---- the field is the first thing in the drawer, and typing swaps the sections for results ----
  await slot('table');
  assert(await drawer() === 'table' && await p.evaluate(() => document.querySelector('#app .drawer .body').firstElementChild.matches('.cmd-q')), 'Table opens with a search field at the top');
  assert(await sections() && !(await rows()).length, 'with nothing typed the drawer shows its sections');
  await fits('table, nothing typed');
  assert(await type('barrel'), 'typing keeps the focus and the caret in the field, letter by letter');
  let found = await rows();
  assert(found.length > 0 && found.length <= 30 && !(await sections()), `results take the place of the sections (${found.length} rows)`);
  assert(found[0].id === 'piece:p_barrel' && found[0].title === 'Barrel' && /^Piece/.test(found[0].hint), `"barrel" finds the piece first (${found[0].id}: ${found[0].title}, ${found[0].hint})`);
  assert(found.every((r) => r.h >= 43.5 && r.pic && r.title && r.hint), 'every row is a touch target with a picture, a title and a line saying what it is');
  await fits('results for barrel');
  // The keyboard: the drawer sits above it, so the first results are still on screen.
  await p.evaluate(() => document.documentElement.style.setProperty('--kb', '260px'));
  await settle();
  const over = await p.evaluate(() => {
    const d = document.querySelector('#app .drawer').getBoundingClientRect(), i = document.querySelector('#app .drawer .cmd-q input').getBoundingClientRect(), r = document.querySelector('#app .drawer .cmd').getBoundingClientRect();
    return { drawer: d.bottom, field: i.bottom, first: r.bottom, line: innerHeight - 260 };
  });
  if (label === 'portrait') assert(over.drawer <= over.line + 0.5 && over.field < over.line && over.first <= over.line + 0.5, `with the keyboard up the field and the first result are above it (${Math.round(over.first)} of ${over.line})`);
  else assert(over.drawer <= over.line + 0.5 && over.field <= over.line + 0.5, `sideways, the panel ends above the keyboard and the field stays in it (${Math.round(over.field)} of ${over.line})`);
  await p.evaluate(() => document.documentElement.style.setProperty('--kb', '0px'));
  await settle();

  // ---- a piece: in hand, in Build, and the drawer is out of the way ----
  await run('piece:p_barrel');
  let now = await st();
  assert(await drawer() === null && now.mode === 'build' && now.tool === 'build' && now.brush === 'barrel', `a piece result puts it in hand and enters Build (${now.mode}, ${now.tool}, ${now.brush})`);
  assert((await slots()).startsWith('hand,') && (await slots()).endsWith(',done'), `and the dock is the brush's (${await slots()})`);
  await slot('done');

  // ---- a toggle: the drawer stays, the row says the new state ----
  await slot('table');
  assert(await p.evaluate(() => document.querySelector('#app .drawer .cmd-q input').value === '') && await sections(), 'opened again, the search starts empty');
  assert(await type('gm'), 'typing "gm" keeps the focus');
  assert((await rows())[0]?.id === 'act:gm' && (await rows())[0].title === 'Become the GM', `"gm" finds Become the GM (${(await rows())[0]?.title})`);
  await run('act:gm');
  let gmRow = await row('act:gm');
  assert((await st()).gm && await drawer() === 'table' && gmRow?.title === 'Stop being the GM' && gmRow.pressed === 'true', `it takes the GM's seat, and the row now offers to give it up (${gmRow?.title})`);
  assert(await p.evaluate(() => document.querySelector('#app .drawer .cmd-q input').value === 'gm') && !(await sections()), 'what was typed is still there');
  await run('act:gm');
  gmRow = await row('act:gm');
  assert(!(await st()).gm && gmRow?.title === 'Become the GM', 'and again gives the seat up');
  await run('act:gm');
  assert((await st()).gm, 'the GM again, for what follows');

  // ---- clearing brings the sections back ----
  await p.tap('#app .drawer .cmd-q button');
  await settle();
  assert(await sections() && !(await rows()).length && await p.evaluate(() => document.querySelector('#app .drawer .cmd-q input').value === ''), 'the clear button empties the field and the sections are back');
  assert(await p.evaluate(() => [...document.querySelectorAll('#app .drawer .chips button')].some((b) => b.offsetParent && b.textContent === 'Stop being the GM')), 'and they are up to date');
  assert(await type('zzzz') && !(await rows()).length && await p.evaluate(() => /Nothing called/.test(document.querySelector('#app .drawer .cmd-list').textContent)), 'a search that finds nothing says so');
  await p.fill(Q, '');
  await settle();
  assert(await sections(), 'deleting what was typed brings the sections back too');

  // ---- settings, by other names ----
  assert(await type('mute') && (await rows())[0]?.id === 'set:sound', `"mute" finds Sound (${(await rows())[0]?.id})`);
  const before = (await st()).sound, was = (await row('set:sound')).title;
  await run('set:sound');
  const after = await row('set:sound');
  assert((await st()).sound === !before && await drawer() === 'table' && after.title !== was && after.title === `Sound: ${before ? 'off' : 'on'}`, `a setting flips where it is and says so (${was} → ${after.title})`);
  await run('set:sound');
  assert((await st()).sound === before, 'and flips back');
  await type('fog');
  found = await rows();
  assert(found[0]?.id === 'act:fog' && found.some((r) => r.id === 'act:reveal') && found.some((r) => r.id === 'set:los'), `"fog" finds the brush, Reveal all and line of sight (${found.map((r) => r.id).join()})`);
  await type('board');
  found = await rows();
  assert(found.some((r) => r.id === 'act:newBoard') && found.some((r) => r.id === 'act:copyBoard') && found.some((r) => r.id === 'act:quick'), `"board" finds the board actions (${found.map((r) => r.id).join()})`);
  await fits('results for board');

  // ---- a dock action from anywhere: the ruler comes out with its dock ----
  await type('ruler');
  assert((await rows())[0]?.id === 'act:ruler', `"ruler" finds the ruler first (${(await rows())[0]?.id})`);
  await run('act:ruler');
  now = await st();
  assert(await drawer() === null && now.tool === 'ruler' && await slots() === 'line,circle,cone,blast,done', `the ruler is out, with its own dock (${now.tool}: ${await slots()})`);
  await slot('done');
  assert(await slots() === 'build,fight,dice,quick,tools,table', `Done puts it away (${await slots()})`);

  // ---- a drawer opened from the search takes the Table's place ----
  await slot('table');
  await type('fight');
  await run('act:fight');
  assert(await drawer() === 'fight', 'Fight opens its drawer in place of Table');
  await slot('table');
  await type('night');
  assert((await rows())[0]?.id === 'sky:night', `"night" finds the sky (${(await rows())[0]?.id})`);
  await run('sky:night');
  assert(await p.evaluate(() => window.__ct.store.get('at:sky')) === 'night' && await drawer() === null, 'and the sky turns to night, with the table in view');

  // ---- a page: full screen, and Back returns ----
  await slot('table');
  await type('theme');
  found = await rows();
  assert(found[0]?.id === 'page:theme' && /^Page/.test(found[0].hint), `"theme" finds the Theme page (${found[0]?.id}, ${found[0]?.hint})`);
  await run('page:theme');
  assert(await p.evaluate(() => !document.querySelector('#prepPages').hidden && getComputedStyle(document.querySelector('#app')).display === 'none'), 'the page takes the whole screen');
  await p.tap('#prepPageBack');
  await settle(300);
  if (await p.evaluate(() => !document.querySelector('#prepPages').hidden)) { await p.tap('#prepPageBack'); await settle(300); }
  assert(await p.evaluate(() => document.querySelector('#prepPages').hidden && getComputedStyle(document.querySelector('#app')).display !== 'none') && await drawer() === null, 'and Back returns to the table');

  // ---- a player: the same list, with what is the GM's shown but not theirs to use ----
  const q = await join('Pip', room, viewport);
  await q.waitForFunction(() => !window.__ct.session.full());
  await q.waitForTimeout(200 * SLOW);
  const Qp = on(q, `${label}-player`);
  await Qp.slot('table');
  assert(await Qp.type('barrel'), 'a player can search too');
  let theirs = await Qp.row('piece:p_barrel');
  assert(theirs?.off && /GM only/.test(theirs.hint), `a piece is there but disabled, with the reason (${theirs?.hint})`);
  await q.tap('#app .drawer .cmd[data-cmd="piece:p_barrel"]', { force: true });
  await Qp.settle();
  assert(await Qp.drawer() === 'table' && await q.evaluate(() => window.__ct.board.tool) === 'move', 'and tapping it does nothing');
  await Qp.type('fog');
  theirs = await Qp.row('act:fog');
  assert(theirs?.off && /GM only/.test(theirs.hint) && (await Qp.row('act:reveal'))?.off, `the fog brush and Reveal all are the GM's (${theirs?.hint})`);
  await Qp.fits('a player, results for fog');
  await Qp.type('theme');
  assert((await Qp.row('page:theme'))?.off, 'so are the Prep pages');
  await Qp.type('dice');
  theirs = await Qp.row('act:dice');
  assert(theirs && !theirs.off, 'Dice and chat is theirs');
  await Qp.run('act:dice');
  assert(await Qp.drawer() === 'dice', 'and opens from the search');
  await q.close();
  await p.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all good');
done(failed ? 1 : 0);
