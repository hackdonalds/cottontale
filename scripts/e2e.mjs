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

// Ports can be moved (E2E_WEB, E2E_RELAY) so several checkouts can run their checks at once.
const WEB = process.env.E2E_WEB ?? '4188', RELAY = process.env.E2E_RELAY ?? '7788';
const procs = [
  spawn('node', ['scripts/relay.mjs'], { env: { ...process.env, PORT: RELAY }, stdio: 'ignore' }),
  spawn('npx', ['vite', 'preview', '--port', WEB, '--strictPort'], { stdio: 'ignore' }),
];
const done = (code) => { procs.forEach((p) => p.kill()); process.exit(code); };
const assert = (ok, what) => { console.log(ok ? '  ok  ' : ' FAIL ', what); if (!ok) done(1); };
process.on('uncaughtException', (e) => { console.error(e); done(1); });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ channel, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const url = (room) => `http://localhost:${WEB}/#room=${room}&relays=ws://localhost:${RELAY}`;
async function join(name, room = 'test-room-1234', ctxOptions = { viewport: { width: 1280, height: 800 } }) {
  const page = await (await browser.newContext(ctxOptions)).newPage();
  page.on('pageerror', (e) => { console.log('pageerror', name, e.stack ?? e.message); done(1); });
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
const ok = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const id = await a.evaluate(() => [...window.__ct.store.keys('m:')][0].slice(2));
await a.keyboard.press('1');
await a.click('#menuBtn');
await a.click('[data-act="gm"]');
assert(await ok(b, (id) => document.body.classList.contains('player') && getComputedStyle(document.querySelector('#modes')).display === 'none'
  && !window.__ct.board.hooks.canMove(id) && !!document.querySelector('#players svg'), id), 'with a GM, players lose the build tools and cannot move the GM\'s minis');

await a.evaluate((id) => window.__ct.board.select(id), id);
assert(await a.evaluate(() => document.querySelector('#minipanel').hidden && document.querySelectorAll('#ring button').length === 6), 'selecting a piece shows a ring of actions on it, not a panel');
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
  await sa.click('#palette [aria-label="Erase"]');
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
  await p.tap('#palette [aria-label="Erase"]');
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
  const bare = await p.evaluate(() => {
    for (let y = innerHeight / 2; y > 60; y -= 20) for (const x of [innerWidth / 2, innerWidth / 4, (innerWidth * 3) / 4]) if (document.elementFromPoint(x, y)?.id === 'c') return [x, y];
    return null;
  });
  await touch('touchStart', [bare]);
  await p.evaluate(() => window.__ct.store.set('turn', { id: 'far2', round: 1 }));
  await p.waitForFunction(() => window.__ct.board.turnId === 'far2');
  await p.waitForTimeout(200);
  const held = await target();
  await touch('touchEnd', []);
  assert(Math.abs(held[0] - 40.5) < 0.05 && (await p.evaluate(() => !window.__ct.board.glide)), 'the camera does not move while a finger is on the table');
  // A glide under way (frames held still so it cannot finish first) is dropped the moment a finger lands.
  await p.evaluate(() => window.__ct.board.renderer.setAnimationLoop(null));
  await p.evaluate(() => window.__ct.store.set('turn', { id: 'far1', round: 2 })); // (in view already: no move)
  await p.waitForFunction(() => window.__ct.board.turnId === 'far1');
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
  if (await p.evaluate(() => document.querySelector('#log').classList.contains('closed'))) await p.tap('#logToggle'); // (it may be open still)
  bad = await layout();
  await p.tap('#boulder');
  assert(await p.evaluate(() => window.__ct.board.boulderArmed && document.querySelector('#log').classList.contains('closed')) && !bad.length, `the GM picks up a boulder from the dice sheet ${bad.join('; ')}`);
  await touch('touchStart', [[cx, cy - 80]]);
  await touch('touchStart', [[cx, cy - 80], [cx + 80, cy - 80]]);
  await touch('touchEnd', []);
  await settle();
  assert(await p.evaluate(() => { const { board } = window.__ct; return !board.boulder.held && board.boulder.rolling.length === 0 && board.boulderArmed; }), 'a second finger cancels the boulder without rolling it');
  await touch('touchStart', [[cx - 60, cy - 40]]);
  await p.waitForFunction(() => window.__ct.board.boulder.held);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cx - 60 + i * 12, cy - 40 - i * 4]]); await p.waitForTimeout(16); }
  await touch('touchEnd', []);
  await p.waitForFunction(() => { const { board } = window.__ct; return board.boulder.rolling.length === 1 && !board.boulder.held && !board.boulderArmed; });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/phone-${label}-boulder.png` });
  assert(await p.evaluate(() => { const r = window.__ct.board.boulder.rolling[0]; return r.pos[r.n - 1].distanceTo(r.pos[0]) > 1.5; }) && (await cells()).length === 1, 'a flick sends the boulder rolling, and edits no terrain');
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
