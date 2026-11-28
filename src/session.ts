// One seat at one table, with no chrome: identity, the store and its transport, the board,
// sound, files, and everything a player or GM can *do* (throw dice, move between boards, run
// a fight, generate a scene…). It never touches the DOM beyond the canvas it is given: what
// the chrome should show arrives through `SessionHooks`, and the chrome reads the rest off
// the session whenever `changed()` fires.

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { BOULDER_REACH, boulderHits, simulateBoulder } from './boulder';
import { Board, type MiniVal, type Ruler, type Sky, type Slab, type Tool, type Vec } from './board';
import { BLOCKS, MINIS, MINI_SHELVES, PROPS } from './catalog';
import * as registry from './registry';
import { loadKit, type Season } from './kit';
import { EDGES, PARTY, canControl, eyesOf, fullPowers, gms, miniShown, nextTurn, parseEdge, pid, roomEdges, setting, turnOrder, type CellVal, type Turn } from './rules';
import { PRESETS, addPresets, generate, loadPresets, parsePreset, type GenOpts, type GenRoom, type KnownPiece, type Preset, type Theme } from './gen';
import { MAX_DICE, decode, kindsFor, results, rollValues, simulate, type Kind, type Start, type Throw } from './dice';
import { Blobs, deriveBlobKey, pickIce, pickServers } from './blob';
import { DEFAULT_RELAYS, Net, deriveRoom, hex, pack, unhex, unpack, type Msg } from './net';
import { SOUNDSCAPES, Sound, addSounds, loadSounds } from './sound';
import { TableSounds, isTableSoundId } from './sounds';
import { Store, type Row } from './store';
import { activeTheme, atmo, loadThemes, moodEdits, setAtmo, themeLook, type GameTheme, type Known } from './theme';
import * as packs from './packs';
import './model'; // the piece kind for the GM's own 3D models (the rest of it loads when one is drawn or imported)
import { buzz, rollBuzz, ticker } from './haptics';
import { askShake, canShake, shakeNeedsAsking, watchShake, type Shake } from './shake';
import { SHOTS, readShot } from './shots';
import { LOOSE, MAX_LOOSE, type LooseVal } from './loose';
import { pour } from './pour';
import { MAX_BLAST, blast, fellLine, shove, type Fall } from './forces';
import { kindOf } from './pick';
import { authority } from './system';
import type { SystemUI } from './ui/sheet';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const ls = {
  get: (k: string) => { try { return localStorage.getItem(`cottontale:${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`cottontale:${k}`, v); } catch { /* storage full or blocked */ } },
};

/** What the chrome is told. Everything else it reads off the session when `changed` fires. */
export interface SessionHooks {
  /** One line for the table: what just happened, or what to do next. */
  notice(text: string): void;
  /** A line for the dice and chat log (HTML, already escaped). `mine`: nothing the reader missed. */
  log(html: string, mine?: boolean): void;
  /** Dice landed: the result, large, and who rolled what. */
  rolled(shown: string, by: string): void;
  /** Something the chrome shows may have changed. Called at most once a tick. */
  changed(): void;
  /** A finger took hold of the dice over the table: whatever covers the table steps aside. */
  grabbed(): void;
}

export interface SessionOpts {
  canvas: HTMLCanvasElement; name: string; code: string; relays: string[]; color: string; hooks: SessionHooks;
  /** A table screen (src/ui/display.ts): it looks on with the party, and can change nothing. */
  display?: boolean;
}
export type Mode = 'play' | 'build';
interface SceneRec { o: GenOpts; rooms: GenRoom[]; p?: unknown }
export const SLAB_TAG = 'cottontale-slab:';

export type Session = Awaited<ReturnType<typeof startSession>>;

export async function startSession({ canvas, name, code, relays, color: myColor, hooks, display = false }: SessionOpts) {
  // A table screen has a key of its own: opened in the browser the GM plays in, it is still another seat.
  const skKey = display ? 'skd' : 'sk';
  let skHex = ls.get(skKey);
  if (!skHex) ls.set(skKey, (skHex = hex(generateSecretKey())));
  const sk = unhex(skHex);
  const me = getPublicKey(sk);
  const meId = pid(me);
  const store = new Store(meId);
  /** Whose eyes the table is drawn for: this player's, or (a table screen) the whole party's. */
  const seat = display ? PARTY : meId;
  const full = () => fullPowers(store, seat);
  /** May this device change the mini? A table screen changes nothing, whoever the mini belongs to. */
  const may = (v: MiniVal) => !display && canControl(store, meId, v);
  /** Does this device get to see the mini at all? */
  const shown = (v: MiniVal) => miniShown(store, seat, v, eyesOf(store, seat)) !== 'no';
  const amGM = () => gms(store).includes(meId);
  // The modelled pieces; without them (offline, first visit) the table falls back to plain shapes.
  const [{ tag }] = await Promise.all([deriveRoom(code), loadKit('./kit').catch(() => {})]);

  const customRelays = relays.join() !== DEFAULT_RELAYS.join();
  const invite = `${location.origin}${location.pathname}${location.search}#room=${encodeURIComponent(code)}${customRelays ? `&relays=${relays.join(',')}` : ''}`;
  history.replaceState(null, '', invite);

  const sound = new Sound();
  sound.enabled = ls.get('sound') !== 'off';
  addEventListener('pointerdown', () => sound.unlock(), true); // browsers only let a page make sound after a tap

  /** The board this device is showing ('' is the main one). Live actions are tagged with it. */
  let here = '';
  const send = (m: Msg) => net.send({ ...m, bd: here });
  const state = { ready: false, queued: false };
  const sys = (text: string) => hooks.notice(text);

  // Minis placed with the mini brush use these.
  let miniKind = 'knight', miniColor = myColor;
  /** The ruler this player has out, if any: a circle is also where the GM's blast goes off. */
  let myRuler: Ruler | null = null;
  // The scatter brush: which loose pieces it pours out, and how many at a time.
  let pourKind = 'stone', pourCount = 6;

  const board = new Board(canvas, store, {
    onSelect: (id) => { rules?.follow(id); if (cutAuto) autoCut(); later(); },
    onPick: () => later(),
    onLiveMove: (id, p) => void send({ y: 'mv', id, p }),
    onLand: (mine) => { sound.knock(); if (mine) buzz(8); },
    onPing: (p) => { if (display) return; board.ping(p, myColor); sound.ping(); void send({ y: 'ping', p }); },
    newMini: () => ({ k: miniKind, c: miniColor, n: '', r: 0, s: 1 }),
    canMove: (id) => {
      const v = store.get<MiniVal>(`m:${id}`);
      if (!v || !may(v)) return false;
      // In a fight, players move on their own turn (the GM always can).
      const turn = store.get<Turn>('turn');
      return full() || !turn || !turnOrder(store).some((o) => o.id === turn.id) || turn.id === id;
    },
    onRuler: (r) => { myRuler = r; void send({ y: 'ruler', r }); later(); },
    onFall: (id, cells) => fell([{ id, cells }]),
    onShove: (id, sx, sz) => {
      const out = sx || sz ? shove(store, id, sx, sz, full()) : null;
      if (out) {
        board.write(out.edits);
        fell(out.falls);
      } else if (sx || sz) { // something is in the way: it leans and stays
        board.nudge(id, sx * 2, sz * 2);
        navigator.vibrate?.(20);
      }
      later();
    },
    onView: () => {},
    onLight: (name) => sys(`Light: ${name}`),
    onSlab: (slab) => {
      board.brush = 'paste';
      board.setTool('build');
      sys(`Copied ${slab.cells.length} pieces. Tap where to put them.`);
      later();
    },
    onGrab: () => hooks.grabbed(),
    onThrow: (starts, vel) => void throwHand(starts, vel),
    onPour: (a, b) => void pourOut(a, b),
    onBoulder: (start, vel) => void rollBoulder(start, vel),
  });

  async function pourOut(a: Vec, b: Vec): Promise<void> {
    if (!full()) return;
    if (board.loose.count >= MAX_LOOSE) return sys(`This board holds no more than ${MAX_LOOSE} loose pieces. Erase some first.`);
    void pour({
      store, here: () => here, count: () => board.loose.count, solidsNear: (c, r) => board.solidsNear(c, r),
      send: (t) => void send({ y: 'pour', t }), play: (t) => board.loose.play(t), commit: (edits) => board.commit(edits),
    }, pourKind, pourCount, a, b);
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => ls.set(`room:${tag}`, JSON.stringify(store.dump()));
  /** The table's game system and its sheets (src/ui/sheet.ts), once the chrome has mounted them. */
  let rules: SystemUI | undefined;
  store.onChange = (k, v, prev) => {
    board.apply(k, v, prev);
    rules?.onStore(k, v, prev);
    packs.packChanged(k); // the GM's own pieces (packs.ts)
    later(); // role, turn order and the chrome follow the store
    saveTimer ??= setTimeout(() => { saveTimer = undefined; save(); }, 1500);
  };

  // Restore our local copy of this table, then let the relays fill in the rest.
  const unconfirmed = new Set<string>();
  let fresh = true; // nothing of this table was on this device: whoever opens it first is starting it
  try {
    for (const row of JSON.parse(ls.get(`room:${tag}`) ?? '[]') as Row[]) { fresh = false; if (store.merge(row)) unconfirmed.add(row[0]); }
  } catch { /* corrupt cache: relays will restore */ }

  const relay = { open: 0, total: relays.length };
  const net = new Net({
    code, relays, sk, name, color: myColor, display, store, unconfirmed,
    onMsg: handle,
    onPeers: () => later(),
    onStatus: (open, total) => { relay.open = open; relay.total = total; later(); },
  });
  await net.start();
  board.loose.onHit = (strength) => sound.clack(strength * 0.6);
  board.shots.onSound = (kind, hit) => sound.shot(kind, hit);
  // Everyone hears the dice; only the thrower feels them in the hand.
  const tick = ticker();
  board.dice.onHit = (strength, owner) => {
    sound.clack(strength);
    const ms = owner === me ? tick(strength, performance.now()) : 0;
    if (ms) buzz(ms);
  };
  board.boulder.onRumble = (level) => sound.rumble(level);
  board.boulder.onThud = (strength) => sound.thud(strength);
  board.onBreak = (k, i) => void send({ y: 'broke', k, i });
  board.onCrumble = (wood) => sound.crumble(wood);
  board.onOffer = () => later();

  // The GM's own files (src/blob.ts). Servers: this device's list (local storage `cottontale:blossom`), else the table's (`set:blossom`), else the defaults.
  const blobs = new Blobs({
    key: deriveBlobKey(code), sk, net,
    servers: () => pickServers(ls.get('blossom'), store.get('set:blossom')),
    ice: () => pickIce(ls.get('stun')),
  });
  // The table's own sounds (src/sounds.ts): recordings come out of the file store, and only on devices with sound on.
  const tableSounds = new TableSounds({ store, sound, blobs, full, send: (m) => void net.send(m) });
  packs.initPacks({ store, blobs, me: meId, full });

  function who(from: string): string { return `<b style="color:${net.colorOf(from)}">${esc(net.nameOf(from))}</b>`; }
  const meTag = `<b style="color:${myColor}">${esc(name)}</b>`;

  function handle(msg: Msg, from: string): void {
    const elsewhere = (msg.bd ?? '') !== here; // it happened on a board this device is not showing
    switch (msg.y) {
      case 'emote':
        if (!elsewhere && typeof msg.id === 'string') { board.emote(msg.id, String(msg.e)); sound.emote(String(msg.e)); }
        break;
      case 'shot': {
        const shot = elsewhere ? null : readShot(store, msg, pid(from));
        if (shot) board.shoot(shot);
        break;
      }
      case 'chat':
        if (msg.to && msg.to !== meId) break; // a whisper for someone else
        hooks.log(`${who(from)}${msg.to ? ' <span class="sys">whispers</span>' : ''}: ${esc(String(msg.m).slice(0, 300))}`);
        break;
      case 'ruler': {
        const r = elsewhere ? null : msg.r;
        const ok = r && Array.isArray(r.a) && Array.isArray(r.b) && r.a.length === 3 && r.b.length === 3 && ['line', 'circle', 'cone'].includes(r.m);
        board.showRuler(from, ok ? r : null, net.colorOf(from));
        break;
      }
      case 'roll': {
        if (msg.s && !full()) {
          // The GM rolled in secret: players see blank dice tumble, and no result.
          if (msg.t && !elsewhere) void board.dice.play(msg.t, net.colorOf(from), from, true);
          hooks.log(`🎲 ${who(from)} rolled in secret`);
          break;
        }
        // With a recorded throw, watch the dice land first; what they show is the result.
        const labels = msg.t ? results(msg.t) : null;
        if (!msg.t || !labels || elsewhere) { showRoll(who(from), msg, false); break; }
        const shown = { ...msg, r: rollValues(msg.t.k, labels) };
        void board.dice.play(msg.t, net.colorOf(from), from).then(() => showRoll(who(from), shown, false));
        break;
      }
      // Only a GM's boulder rolls (on a table without one, anybody's).
      case 'boulder': if (!elsewhere && fullPowers(store, pid(from))) board.boulder.play(msg.t); break;
      case 'ping': if (!elsewhere && Array.isArray(msg.p) && msg.p.every(Number.isFinite)) { board.ping(msg.p, net.colorOf(from)); sound.ping(); } break;
      case 'broke': if (!elsewhere && typeof msg.k === 'string') board.broke(msg.k, String(msg.i)); break;
      // Only someone who may build can pour; the recording itself is checked by the view.
      case 'pour': if (!elsewhere && fullPowers(store, pid(from))) void board.loose.play(msg.t); break;
      case 'mv': if (!elsewhere && Array.isArray(msg.p)) board.liveMove(String(msg.id), msg.p as Vec); break;
      case 'sroll': case 'sys': rules?.onMsg(msg, from); break;
      case 'sfx': if (state.ready) tableSounds.heard(msg.id, fullPowers(store, pid(from))); break; // the GM's soundboard, heard on every board
      case 'fall': {
        // Only what this player can see is worth a line: a fall must not give a mini away.
        const v = elsewhere ? null : store.get<MiniVal>(`m:${String(msg.id)}`), n = Math.round(Number(msg.n));
        if (v && n > 0 && n <= 40 && shown(v)) sys(fellLine(v, n));
        break;
      }
      // The GM shows the table screen a view. Only a GM's is taken up, and only by a screen.
      case 'cam': if (display && !elsewhere && gms(store).includes(pid(from))) board.flyTo(msg.p, msg.t); break;
      case 'blast': if (!elsewhere && Array.isArray(msg.c) && msg.c.every(Number.isFinite)) board.rock(msg.c, Math.max(1, Math.min(MAX_BLAST, Number(msg.r) || 1))); break;
    }
  }

  /** Say that minis fell, and tell the table. A hidden mini's fall stays with the GM: nothing is sent. */
  function fell(falls: Fall[]): void {
    for (const { id, cells } of falls) {
      const v = store.get<MiniVal>(`m:${id}`);
      if (!v) continue;
      sys(fellLine(v, cells));
      if (!v.h) void send({ y: 'fall', id, n: cells });
    }
  }
  /** The GM's blast, set off where the circle template lies: minis are thrown outward, props rock. One step of undo. */
  function blastHere(): void {
    const r = myRuler;
    if (!r || r.m !== 'circle' || !full()) return;
    const c: Vec = [Math.floor(r.a[0]), Math.round(r.a[1]), Math.floor(r.a[2])];
    const radius = Math.max(1, Math.min(MAX_BLAST, Math.round(Math.hypot(r.b[0] - r.a[0], r.b[2] - r.a[2]))));
    const out = blast(store, c, radius, true);
    board.editAll(out.edits);
    board.rock(c, radius);
    navigator.vibrate?.(30);
    void send({ y: 'blast', c, r: radius });
    fell(out.falls);
  }

  function showRoll(by: string, m: { d: string; r: number[]; mod: number }, mine: boolean): void {
    const r = (Array.isArray(m.r) ? m.r : []).slice(0, 20).map(Number);
    const total = r.reduce((a, b) => a + b, 0) + (Number(m.mod) || 0);
    const detail = r.length > 1 || m.mod ? ` <span class="sys">(${r.join(' + ')}${m.mod ? ` ${m.mod > 0 ? '+' : '−'} ${Math.abs(m.mod)}` : ''})</span>` : '';
    // A lone coin reads as a side, not a sum.
    const shown = m.d === '1d2' && !m.mod && r.length === 1 ? (r[0] === 1 ? 'Heads' : 'Tails') : String(total);
    hooks.log(`🎲 ${by} rolled ${esc(String(m.d))}: <span class="tot">${shown}</span>${detail}`, mine);
    hooks.rolled(shown, `${mine ? 'You' : by} · ${esc(String(m.d))}`);
  }

  // ---- dice: pick some up, hold them over the board, let go ----

  const hand = new Map<number, number>(); // sides → how many
  let handMod = 0, secret = false;
  /** Dice a character sheet put in the hand: it says what they are, and reads them when they land. */
  let asked: { kinds: Kind[]; text: string; landed: (t: Throw) => void } | null = null;
  const handKinds = (): Kind[] => asked?.kinds ?? [...hand].flatMap(([sides, n]) => kindsFor(n, sides) ?? []);
  const handText = () => asked?.text ?? [...hand].map(([sides, n]) => `${n}d${sides}`).join('+') + (handMod ? (handMod > 0 ? '+' : '') + handMod : '');
  function syncHand(): void {
    board.hand = handKinds();
    board.diceColor = myColor;
    canvas.style.cursor = board.hand.length ? 'grabbing' : '';
    if (board.hand.length) { void import('cannon-es'); armBoulder(false); } // warm up the physics engine before the throw
    syncShake();
    later();
  }
  function pickUp(sides: number, n = 1): boolean {
    asked = null;
    const next = new Map(hand).set(sides, (hand.get(sides) ?? 0) + n);
    const kinds = [...next].map(([s, c]) => kindsFor(c, s));
    if (kinds.some((k) => !k) || kinds.flat().length > MAX_DICE) return false;
    hand.set(sides, next.get(sides)!);
    syncHand();
    return true;
  }
  function emptyHand(): void {
    asked = null;
    hand.clear();
    handMod = 0;
    syncHand();
  }
  // Shake to roll, an extra for phones. The motion sensor is only listened to while dice are in
  // hand. Where the browser wants asking (iOS) it starts off, and is asked for from a tap.
  let shakeOn = canShake() && (ls.get('shake') ?? (shakeNeedsAsking() ? 'off' : 'on')) === 'on';
  let shakeOk = !shakeNeedsAsking();
  let unwatch: (() => void) | null = null;
  function syncShake(): void {
    const want = shakeOn && shakeOk && hand.size > 0;
    if (want && !unwatch) unwatch = watchShake(onShake);
    else if (!want && unwatch) { unwatch(); unwatch = null; }
  }
  /** From a tap: make sure we may listen (iOS forgets between visits, and answers at once if already allowed). */
  async function armShake(): Promise<void> {
    if (!shakeOn || shakeOk) return;
    shakeOk = await askShake();
    if (!shakeOk) {
      shakeOn = false;
      ls.set('shake', 'off');
      sys('This browser will not share its motion sensor, so shaking is off.');
    }
    syncHand();
  }
  function setShake(on: boolean): void {
    shakeOn = on && canShake();
    ls.set('shake', shakeOn ? 'on' : 'off');
    sys(shakeOn ? 'Shake the phone to throw the dice in your hand.' : 'Shaking no longer throws the dice.');
    syncHand();
    void armShake();
  }
  function onShake(s: Shake): void {
    // Thrown across the middle of the view, the way the phone was shaken (up the screen = away from you).
    const { target, cam, tray } = board.throwSpot();
    const len = Math.hypot(target[0] - cam[0], target[2] - cam[2]);
    const fx = len > 0.01 ? (target[0] - cam[0]) / len : 0, fz = len > 0.01 ? (target[2] - cam[2]) / len : -1;
    const dx = -fz * s.x + fx * s.y, dz = fx * s.x + fz * s.y, speed = 5 + 9 * s.power;
    hooks.grabbed();
    board.toss([target[0] - dx * tray * 0.4, target[1] + 1.5, target[2] - dz * tray * 0.4], [dx * speed, 0, dz * speed]);
  }
  async function throwHand(starts: Start[], vel: Vec): Promise<void> {
    const kinds = handKinds(), d = handText(), mod = handMod, sheet = asked;
    emptyHand();
    const { target, tray } = board.throwSpot();
    // Simulate the throw, share the recording, and let everyone watch it land.
    const t = await simulate(kinds, starts, vel, target, store, tray, board.solidsNear(target, tray + 1));
    board.dice.endHold();
    if (sheet) { navigator.vibrate?.(12); return sheet.landed(t); } // the sheet reads its own dice
    const r = rollValues(kinds, results(t)!);
    void send({ y: 'roll', d, r, mod, t, ...(secret ? { s: true } : {}) });
    buzz(12);
    await board.dice.play(t, myColor, me);
    const felt = rollBuzz(kinds, r);
    if (felt) buzz(felt);
    showRoll(meTag, { d, r, mod }, true);
    // If the view was turned away during the roll, bring our own dice back into it.
    const rest = decode(t);
    if (rest) board.revealDice(rest.pos.map((p) => p[t.n - 1]));
  }
  /** `2d6+1d20+3`: standard dice go into the hand; anything else (d7, 30 dice) is just rolled as numbers. */
  function rollCommand(expr: string): boolean {
    const dice: [number, number][] = [];
    let mod = 0;
    for (const term of expr.replace(/\s/g, '').match(/[+-]?[^+-]+/g) ?? []) {
      const d = /^\+?(\d*)d(\d+)$/i.exec(term);
      if (d && +d[2] >= 2 && +d[2] <= 1000) dice.push([Math.min(Math.max(+(d[1] || 1), 1), 20), +d[2]]);
      else if (/^[+-]\d+$/.test(term)) mod += +term;
      else return false;
    }
    if (!dice.length) return false;
    hand.clear();
    if (dice.every(([n, sides]) => pickUp(sides, n))) {
      handMod = mod;
      syncHand();
      hooks.grabbed();
      sys('Dice in hand: drag on the table and let go to throw.');
      return true;
    }
    emptyHand();
    const r = dice.flatMap(([n, sides]) => [...crypto.getRandomValues(new Uint32Array(n))].map((x) => (x % sides) + 1));
    const d = dice.map(([n, sides]) => `${n}d${sides}`).join('+') + (mod ? (mod > 0 ? '+' : '') + mod : '');
    showRoll(meTag, { d, r, mod }, true);
    void net.send({ y: 'roll', d, r, mod });
    return true;
  }
  /** A line typed into the chat: `/r 2d6+3` rolls, `/w name hi` whispers, anything else is said to the table. */
  function chat(text: string): void {
    text = text.trim();
    if (!text) return;
    const r = /^\/r(?:oll)?\s+(.+)$/i.exec(text);
    if (r && rollCommand(r[1])) return;
    const w = /^\/w\s+(\S+)\s+(.+)$/i.exec(text);
    if (w) {
      const to = [...net.peers].find(([, p]) => p.name.toLowerCase().startsWith(w[1].toLowerCase()));
      if (!to) return sys(`Nobody here is called “${w[1]}”.`);
      hooks.log(`${meTag} <span class="sys">to ${esc(to[1].name)}</span>: ${esc(w[2])}`, true);
      return void net.send({ y: 'chat', m: w[2], to: pid(to[0]) });
    }
    hooks.log(`${meTag}: ${esc(text)}`, true);
    void net.send({ y: 'chat', m: text });
  }

  // The boulder trap, the GM's: arm it, press on the table where it starts, flick the way it should roll.
  function armBoulder(on: boolean): void {
    board.boulderArmed = on && full();
    if (board.boulderArmed) {
      if (hand.size || asked) emptyHand();
      void import('cannon-es'); // warm up the physics engine before the roll
      hooks.grabbed();
      sys('Boulder ready: press on the table where it starts and flick the way it should roll.');
    } else board.boulder.endHold();
    later();
  }
  async function rollBoulder(start: Vec, vel: Vec): Promise<void> {
    if (!full()) return armBoulder(false);
    if (Math.hypot(vel[0], vel[2]) < 1.5) { // no flick, no roll: it stays ready
      board.boulder.endHold();
      return sys('Flick or drag the way the boulder should roll.');
    }
    board.boulderArmed = false; // one boulder a go; it stays in the hand until the roll is worked out
    const at = here;
    // Simulate the roll, share the recording, and let everyone watch it go.
    const t = await simulateBoulder(start, vel, store, board.solidsNear(start, BOULDER_REACH, false));
    armBoulder(false);
    if (at !== here) return;
    void send({ y: 'boulder', t });
    navigator.vibrate?.(20);
    // The figures in its way go down as it reaches them: ordinary edits, one undo step, made here only.
    const hits = boulderHits(t, store);
    let step: ReturnType<typeof board.commit> | undefined;
    board.boulder.play(t, (f) => {
      while (hits.length && hits[0].f <= f) {
        const h = hits.shift()!, v = store.get<MiniVal>(`m:${h.id}`);
        // Moved or removed since the boulder set off: it got out of the way.
        if (v && v.x === h.from[0] && v.y === h.from[1] && v.z === h.from[2]) step = board.commit([[`m:${h.id}`, { ...v, x: h.to[0], y: h.to[1], z: h.to[2], d: true }]], step);
      }
    });
  }

  // ---- the two table states, and what is in hand in Build ----

  const building = () => board.tool === 'pick' || board.tool === 'build' || board.tool === 'mini';
  const mode = (): Mode => (building() ? 'build' : 'play');
  /** A brush is in hand: one finger paints with it until Done. */
  const armed = () => board.tool === 'build' || board.tool === 'mini';
  function setTool(t: Tool): void {
    if (t !== 'move' && t !== 'ruler' && !full()) t = 'move';
    board.sampling = false;
    board.setTool(t);
    later();
  }
  /** Play or Build. Going over keeps the selection, the fight and the camera where they are. */
  function setMode(m: Mode): void {
    if (m === mode()) return;
    setTool(m === 'build' ? 'pick' : 'move');
  }
  /** Take a brush in hand: a block, a prop, a wall piece, or one of the tools (`erase`, `room`, `raise`…). */
  function arm(brush: string): void {
    if (!full()) return;
    board.brush = brush;
    setTool('build');
  }
  /** Take a kind of mini in hand. */
  function armMini(kind: string, color = miniColor): void {
    if (!full() || !registry.known.mini(kind)) return;
    miniKind = kind;
    miniColor = color;
    setTool('mini');
  }
  /** Put the brush down: back to selecting. */
  function disarm(): void { if (building()) setTool('pick'); }
  /** Pick from the scene: the next tap takes whatever it lands on as the brush. */
  function sample(on = true): void {
    if (!full()) return;
    if (!armed()) setTool('build');
    board.sampling = on;
    if (on) sys('Tap a piece on the table to take it in hand.');
    later();
  }
  board.onSample = (key) => {
    const kind = kindOf(key), v = store.get<{ i?: string; k?: string; c?: string; r?: number }>(key);
    if (!v) return;
    if (kind === 'mini' && v.k) return armMini(v.k, v.c);
    if (kind === 'loose' && v.i && LOOSE[v.i]) { pourKind = v.i; return arm('pour'); }
    if (!v.i) return;
    if (kind === 'cell' && PROPS[v.i]) board.rot = (v as CellVal).r ?? 0;
    arm(v.i);
  };
  /** What is in hand, for the chrome to name: a piece by its key (`b_grass`, `p_barrel`, `m_knight`), or a tool. */
  function inHand(): { key: string | null; name: string } {
    if (board.tool === 'mini') return { key: `m_${miniKind}`, name: MINIS[miniKind]?.name ?? 'Figure' };
    const b = board.brush;
    if (BLOCKS[b]) return { key: `b_${b}`, name: BLOCKS[b].name };
    if (PROPS[b]) return { key: `p_${b}`, name: PROPS[b].name };
    const tools: Record<string, string> = { erase: 'Erase', room: 'Room', raise: 'Raise', lower: 'Lower', level: 'Level', grow: 'Grow', copy: 'Copy', paste: 'Paste', light: 'Light', pour: LOOSE[pourKind]?.name ?? 'Scatter' };
    return { key: null, name: tools[b] ?? 'Piece' };
  }
  // Pieces that arrive in a pack (see registry.ts) may leave again, and take what is in hand with them.
  registry.onRegistry(() => {
    if (!registry.known.mini(miniKind)) miniKind = MINI_SHELVES.Heroes[0];
    if (state.ready && board.brush.includes(':') && !registry.kindOf(board.brush) && armed()) disarm();
    later();
  });

  // ---- undo: one step back, and a word about what it was ----

  function undo(redo = false): void {
    const n = redo ? board.redo() : board.undo();
    if (n) sys(`${redo ? 'Redone' : 'Undone'}: ${n === 1 ? '1 change' : `${n} changes`}`);
    later();
  }

  // ---- the selection ----

  const sel = () => (board.selected ? store.get<MiniVal>(`m:${board.selected}`) : null);
  const mine = (v = sel()) => !!v && may(v);
  /** Change the selected mini (if it is ours to change), as a step of undo. */
  function patch(p: Partial<MiniVal>): void {
    const v = sel();
    if (v && may(v)) board.write([[`m:${board.selected}`, { ...v, ...p }]]);
  }
  /** Write a field that may be cleared: `undefined` removes it from the mini. */
  function setOpt(key: 'hp' | 'mhp' | 'ini' | 'o', value: number | string | undefined): void {
    const v = sel();
    if (!v || !may(v)) return;
    const { [key]: _, ...rest } = v;
    board.write([[`m:${board.selected}`, value === undefined || value === '' ? rest : { ...rest, [key]: value }]]);
  }
  /** Damage (negative) or healing for the selected mini, or for the ones named. */
  function hurt(by: number, ids: string[] = board.selected ? [board.selected] : []): void {
    const edits: [string, unknown][] = [];
    for (const id of ids) {
      const v = store.get<MiniVal>(`m:${id}`);
      if (!v || !may(v)) continue;
      edits.push([`m:${id}`, { ...v, hp: Math.max(0, Math.min(v.mhp ?? 9999, (v.hp ?? v.mhp ?? 0) + by)) }]);
    }
    board.write(edits);
  }
  function deselect(): void {
    board.select(null);
    board.pick([]);
    later();
  }
  /** Move was tapped: the next touch on the table says where the selection goes (tap again to call it off). */
  function place(on = !board.placing): void {
    board.placing = on && board.selection().length > 0;
    if (board.placing) sys('Tap where it goes, or drag it there.');
    later();
  }
  const blocked = (ok: boolean, why: string) => { if (!ok) { buzz(20); sys(why); } later(); };
  const turnSel = () => blocked(board.turnPicked(), 'That cannot be turned.');
  const copySel = () => blocked(board.copyPicked(), 'No room beside it for a copy.');
  const removeSel = () => blocked(board.removePicked(), 'Nothing to remove.');
  function emote(kind: string): void {
    if (!board.selected) return;
    board.emote(board.selected, kind);
    sound.emote(kind);
    void send({ y: 'emote', id: board.selected, e: kind });
  }
  /** Pick what to shoot: the next tap on a mini or on the table is the target. Shown to everyone, changes nothing. */
  function aim(kind: string): void {
    const a = board.selected;
    if (!a || !SHOTS[kind]) return;
    board.aimed = (b) => {
      board.aimed = null;
      later();
      if (b === a) return; // tapping the shooter calls it off
      board.shoot({ k: kind, a, b });
      void send({ y: 'shot', k: kind, a, b });
    };
    sys('Tap a target.');
    later();
  }

  // ---- slabs travel as text, so they can be sent over any chat app ----

  const slabCode = async (): Promise<string | null> => (board.slab ? SLAB_TAG + await pack(board.slab) : null);
  async function loadSlab(text: string): Promise<boolean> {
    try {
      const s = await unpack<Slab>(text.trim().replace(SLAB_TAG, ''));
      const ok = Array.isArray(s.cells) && s.cells.length > 0 && s.cells.length <= 4000 && [s.w, s.h, s.d].every((n) => Number.isInteger(n) && n > 0 && n <= 200)
        && s.cells.every((c) => Array.isArray(c) && c.slice(0, 3).every(Number.isInteger) && (BLOCKS[c[3]?.i] || PROPS[c[3]?.i]));
      if (!ok) throw new Error('bad slab');
      board.slab = s;
      arm('paste');
      sys(`Slab loaded (${s.cells.length} pieces). Tap where to put it.`);
      return true;
    } catch { sys('That is not a Cottontale slab code.'); return false; }
  }

  // ---- boards: one table, several maps ----

  let peek: string | null = null; // a board the GM is preparing while the players are elsewhere
  const boardList = () => [{ id: '', n: 'Main' }, ...[...store.keys('bd:')].map((k) => ({ id: k.slice(3), n: String(store.get<{ n: string }>(k)?.n ?? 'Board') }))];
  const boardName = (id: string) => boardList().find((b) => b.id === id)?.n ?? 'Main';
  const activeBoard = () => { const a = setting(store, 'board', ''); return boardList().some((b) => b.id === a) ? a : ''; };
  /** Point this device at another board and redraw the table from it. */
  function enter(id: string): void {
    here = id;
    store.setBoard(id);
    board.clear();
    for (const p of ['b:', 'f:', 'm:', 'w:', 'l:']) for (const k of [...store.keys(p)]) board.apply(k, store.get(k), null);
    cutAuto = true;
    setCut(Infinity);
    emptyHand();
    armBoulder(false);
  }
  function newBoard(copy: boolean): void {
    if (!full()) return;
    const id = crypto.randomUUID().slice(0, 6);
    if (copy) for (const p of ['b:', 'f:', 'm:', 'w:', 'l:', 'at:']) for (const k of [...store.keys(p)]) store.setRaw(`@${id}/${k}`, store.get(k));
    store.set(`bd:${id}`, { n: copy ? `${boardName(here)} copy`.slice(0, 24) : `Board ${boardList().length + 1}` });
    peek = id; // start on it alone; bring the players over when it is ready
    sync();
  }
  function renameBoard(id: string, n: string): void { if (full() && id) store.set(`bd:${id}`, { n: n.trim().slice(0, 24) || 'Board' }); }
  /** Look at a board alone (the players stay where they are); null goes back to theirs. */
  function lookAtBoard(id: string | null): void { peek = full() && id !== activeBoard() ? id : null; sync(); }
  function bringEveryone(id = here): void { if (!full()) return; peek = null; store.set('set:board', id); }
  function deleteBoard(id: string): void {
    if (!full() || !id) return;
    // Nobody may be left standing on a board that is gone: the players, or the GM preparing it.
    if (peek === id) peek = null;
    if (activeBoard() === id) store.set('set:board', '');
    for (const [k, e] of [...store.entries]) if (e.v !== null && k.startsWith(`@${id}/`)) store.setRaw(k, null);
    store.set(`bd:${id}`, null);
    sync();
  }

  // ---- atmosphere and themes ----

  const known: Known = { ...registry.known, amb: (id) => id in SOUNDSCAPES || isTableSoundId(id), gen: (id) => id in PRESETS, edge: (id) => id in EDGES };
  const knownPiece: KnownPiece = (kind, id) => known[kind]!(id);
  /** The theme of the board in front of us (each board has its own atmosphere, see theme.ts). */
  const gameTheme = (): GameTheme | null => activeTheme(atmo(store, 'theme', null), known);
  /** The themes on offer (public/themes): data that arrives after the table is up, never part of the app. */
  let gameThemes: GameTheme[] = [];
  // Sound recipes and generator presets are files too (public/sounds, public/gens). Themes name them, so they come first.
  const loaded = Promise.all([loadSounds('./sounds').then(addSounds), loadPresets('./gens', knownPiece).then(addPresets)])
    .then(() => { sound.refresh(); later(); return loadThemes('./themes', known); })
    .then((list) => { gameThemes = list; later(); });
  const themesOffered = (): GameTheme[] => {
    const offered = [...gameThemes], own = gameTheme();
    if (own && !offered.some((t) => t.id === own.id)) offered.push(own); // a theme the table brought with it
    return offered;
  };
  /** Take a theme up, or (given the one the board has) let go of it. */
  function pickTheme(t: GameTheme): void {
    if (!full()) return;
    if (t.id === gameTheme()?.id) {
      // A soundscape the theme brought leaves with it: fall silent by choice, not by a name nobody knows.
      if (t.sounds?.scapes?.[atmo(store, 'amb', 'off')]) setAtmo(store, 'amb', 'off');
      setAtmo(store, 'theme', null);
      return;
    }
    setAtmo(store, 'theme', t); // the whole theme, so the board carries it
    for (const [k, v] of moodEdits(t)) setAtmo(store, k, v);
    if (t.gen) genOpts = { ...genOpts, theme: t.gen as Theme };
  }
  function setSound(on: boolean): void {
    sound.setEnabled(on);
    ls.set('sound', on ? 'on' : 'off');
    later();
  }
  // This device's own choices (not shared): ambient motion (off by default for those who ask for
  // less motion; it also saves battery) and whether the camera follows the turn order.
  const local = {
    ambient: (ls.get('ambient') ?? (matchMedia('(prefers-reduced-motion: reduce)').matches ? '0' : '1')) === '1',
    follow: display || ls.get('follow') !== '0', // a table screen is nobody's to steer: it goes where the turn is
  };
  function setLocal(k: 'ambient' | 'follow', on: boolean): void {
    local[k] = on;
    ls.set(k, on ? '1' : '0');
    board.setAmbient(local.ambient);
    board.followTurns = local.follow;
    later();
  }
  board.setAmbient(local.ambient);
  board.followTurns = local.follow;

  // ---- role, settings, the board in view: all derived from the store ----

  function later(): void {
    if (state.queued || !state.ready) return;
    state.queued = true;
    setTimeout(() => { state.queued = false; sync(); });
  }
  let role = '', los = false;
  function sync(): void {
    const f = full(), now = `${amGM()}|${f}`;
    if (now !== role) {
      role = now;
      board.setRole(seat, f);
      if (!f && board.tool !== 'move' && board.tool !== 'ruler') setTool('move');
      if (!f) secret = false;
    }
    // Follow the table to its active board, unless the GM is off preparing another one.
    const ids = boardList().map((b) => b.id), active = activeBoard();
    if (!f || (peek !== null && !ids.includes(peek))) peek = null;
    if ((peek ?? active) !== here) enter(peek ?? active);
    const l = setting(store, 'los', false);
    if (l !== los) { los = l; board.refresh(); }
    board.setGlow(atmo(store, 'glow', 1));
    const sky = atmo<Sky>(store, 'sky', 'day'), look = themeLook(gameTheme(), sky);
    board.setSky(sky, look.light, look.fog);
    board.setGrade(look.grade);
    board.setDice(look.dice);
    board.setSeason(atmo<Season>(store, 'season', 'summer'));
    sound.theme(gameTheme()?.sounds);
    tableSounds.refresh(); // the table's own sounds come before the theme's
    sound.scape(atmo(store, 'amb', 'off'));
    const order = turnOrder(store), turn = store.get<Turn>('turn');
    board.setTurn(order.find((o) => o.id === turn?.id)?.id ?? null);
    if (cutAuto) autoCut();
    rules?.refresh();
    hooks.changed();
  }

  // ---- who is the GM ----

  /** Take the GM's seat (false: someone who is here has it) or give it up. */
  function setGM(on: boolean): boolean {
    if (display) return false; // a table screen is nobody's seat
    const g = gms(store), present = [meId, ...[...net.peers.keys()].map(pid)];
    if (!on) { store.set(`gm:${meId}`, null); return true; }
    if (g.includes(meId)) return true;
    if (g.some((id) => present.includes(id))) { sys('This table already has a GM. They can step down from Table → People.'); return false; }
    // Take over from GMs who are away, so a table can never get stuck without one.
    for (const id of g) store.set(`gm:${id}`, null);
    store.set(`gm:${meId}`, true);
    sys('You are the GM: you build, hide things and move every mini.');
    return true;
  }

  // ---- a fight: turn order ----

  function fight() {
    const f = full(), order = turnOrder(store).filter((o) => f || !o.v.h), turn = store.get<Turn>('turn');
    const current = order.find((o) => o.id === turn?.id) ?? null;
    return { order, current, round: current ? turn!.round : 0, mayAdvance: f || mine(current?.v) };
  }
  function next(): void { const t = display ? null : nextTurn(store); if (t) store.set('turn', t); }
  /** Everyone leaves the turn order. One step of undo for the GM. */
  function endFight(): void {
    const edits: [string, unknown][] = turnOrder(store).map((o) => { const { ini: _, ...rest } = o.v; return [`m:${o.id}`, rest]; });
    board.commit([...edits, ['turn', null]]);
    sys('The fight is over. Undo brings it back.');
  }

  // ---- fog ----

  function revealAll(): void {
    const keys = [...store.keys('f:')];
    if (!keys.length) return;
    board.commit(keys.map((k) => [k, null]));
    sys('Everything is revealed. Undo covers it again.');
  }

  // ---- cutaway: hide everything above a floor to look inside buildings ----

  let cutAuto = true;
  function setCut(level: number): void { if (level !== board.cut) board.setCut(level); later(); }
  /** Auto: lift the roof off whatever the selected mini is standing under. */
  function autoCut(): void {
    const v = sel();
    let level = Infinity;
    if (v) for (let y = v.y + 2, top = board.maxHeight(); y < top; y++) {
      const c = store.get<{ i: string }>(`b:${v.x},${y},${v.z}`);
      if (c && BLOCKS[c.i]) { level = y; break; }
    }
    if (level !== board.cut) board.setCut(level);
  }
  function cut(step: 'auto' | 'up' | 'down'): void {
    if (step === 'auto') { cutAuto = !cutAuto; if (cutAuto) autoCut(); later(); return; }
    cutAuto = false;
    if (step === 'down') setCut(Math.max(1, (board.cut === Infinity ? board.maxHeight() : board.cut) - 1));
    else setCut(board.cut + 1 >= board.maxHeight() ? Infinity : board.cut + 1);
  }

  // ---- the whole table: save, load, clear ----

  function exportTable(): Blob {
    const rows = store.dump().filter((r) => r[1] !== null).map(([k, v]) => [k, v]);
    return new Blob([JSON.stringify({ cottontale: 1, rows })], { type: 'application/json' });
  }
  /** Everything a table is made of comes back, read strictly wherever it is used, as anything another player wrote would be. */
  function importTable(text: string): boolean {
    try {
      if (display) throw new Error('a table screen changes nothing');
      const data = JSON.parse(text);
      for (const [k, v] of data.rows as [string, unknown][]) if (/^(?:[bmfwl]:|at:|gen$)/.test(k)) store.set(k, v);
        else if (/^(?:@[\w-]+\/(?:[bmfwl]:|at:|gen$)|bd:)/.test(k)) store.setRaw(k, v);
        else if (full() && /^(?:snd:|set:(?:system|theme|sky|season|glow|amb)$)/.test(k)) store.set(k, v);
        else if (k.startsWith(packs.PACK_KEY) && full() && packs.parsePack(v, k.slice(3))) store.set(k, v); // the table's own packs (their files stay in the blob cache and on the servers)
      return true;
    } catch { sys('That file is not a Cottontale table.'); return false; }
  }
  /** Take everything off this board. One step of undo. */
  function clearBoard(): void {
    if (!full()) return;
    const keys = ['b:', 'm:', 'f:', 'w:', 'l:'].flatMap((p) => [...store.keys(p)]);
    board.commit([...keys.map((k): [string, unknown] => [k, null]), ['gen', null], ['turn', null]]);
    sys('The board is clear. Undo brings it all back.');
  }
  const emptyBoard = () => { for (const p of ['b:', 'm:', 'w:', 'l:']) for (const _ of store.keys(p)) return false; return true; };
  const leave = () => net.stop().then(() => { location.hash = ''; location.reload(); });

  // ---- scene generator ----

  const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
  let genOpts: GenOpts = { theme: '', seed: newSeed(), size: 2, density: 2, detail: 2 }; // the first preset on offer, until one is picked
  let genRecent: GenOpts[] = [];
  try { genRecent = JSON.parse(ls.get('genRecent') ?? '[]'); } catch { /* start with none */ }
  /** The scene on this board, remembered with the table so its rooms can be redone or locked later. */
  const sceneRec = () => store.get<SceneRec>('gen');
  /** The generator presets on offer: the loaded ones (public/gens), and the ones the table's theme brings. */
  const presets = (): Preset[] => {
    const own = gameTheme()?.gens ?? [];
    return [...Object.values(PRESETS).filter((p) => !own.some((q) => q.id === p.id)), ...own];
  };
  const presetOf = (id: Theme): Preset | undefined => gameTheme()?.gens?.find((p) => p.id === id) ?? PRESETS[id];
  const presetFor = (rec: SceneRec): Preset | undefined => (rec.p ? parsePreset(rec.p, knownPiece) : null) ?? presetOf(rec.o.theme);
  /**
   * Build a scene in place of the one on the table. `prior` rooms that are locked are kept;
   * with `fixed` every room stays where it is and only what changed in them is rebuilt.
   */
  function buildScene(o: GenOpts, prior: GenRoom[] = [], fixed = false, preset = presetOf(o.theme) ?? presets()[0]): boolean {
    if (!full() || !preset) return false;
    o = { ...o, theme: preset.id };
    const old = sceneRec(), was = old && presetFor(old);
    // What the old scene put on the table follows from its numbers, so it can be cleared exactly.
    const gone = new Set(old && was ? generate(old.o, was, old.rooms, true).edits.map(([k]) => k) : []);
    const scene = generate(o, preset, prior, fixed);
    board.applyScene([...scene.edits, ['gen', { o, rooms: scene.rooms, ...(PRESETS[preset.id] === preset ? {} : { p: preset }) }]], scene.bounds, gone, !fixed);
    const same = (p: GenOpts) => JSON.stringify(p) === JSON.stringify(o);
    genRecent = [{ ...o }, ...genRecent.filter((p) => !same(p))].slice(0, 6);
    ls.set('genRecent', JSON.stringify(genRecent));
    genOpts = o;
    later();
    return true;
  }
  /** Another scene like this one: a new seed, keeping the rooms that are locked. */
  function reroll(): boolean {
    const rec = sceneRec(), locked = rec?.o.theme === genOpts.theme ? rec.rooms.filter((q) => q.lock) : [];
    if (presetOf(genOpts.theme)?.algo === 'building' && rec && locked.length) {
      // A tavern is one building: with a room locked it stays standing and the other rooms are refurnished.
      return buildScene(rec.o, rec.rooms.map((q) => (q.lock ? q : { ...q, seed: newSeed() })), true, presetFor(rec));
    }
    return buildScene({ ...genOpts, seed: newSeed() }, locked);
  }
  function refurnish(i: number): void {
    const rec = sceneRec();
    if (rec?.rooms[i] && !rec.rooms[i].lock) buildScene(rec.o, rec.rooms.map((r, j) => (j === i ? { ...r, seed: newSeed() } : r)), true, presetFor(rec));
  }
  function lockRoom(i: number, lock: boolean): void {
    const rec = sceneRec();
    if (rec?.rooms[i] && full()) store.set('gen', { ...rec, rooms: rec.rooms.map((r, j) => (j === i ? { ...r, lock } : r)) });
  }

  /** A starter scene: a cottage in a clearing, with something to fight. One step of undo. */
  function starterScene(): void {
    if (!full()) return;
    const edits: [string, unknown][] = [];
    const put = (x: number, y: number, z: number, i: string, r = 0) => edits.push([`b:${x},${y},${z}`, r ? { i, r } : { i }]);
    const rnd = (x: number, z: number) => (Math.imul(x * 73856093 ^ z * 19349663, 0x9e3779b1) >>> 8) / 0x1000000;
    /** Smooth hills of chance, the same on every device. */
    const roll = (x: number, z: number) => {
      const u = x / 6, v = z / 6, x0 = Math.floor(u), z0 = Math.floor(v), fx = u - x0, fz = v - z0;
      return (rnd(x0, z0) * (1 - fx) + rnd(x0 + 1, z0) * fx) * (1 - fz) + (rnd(x0, z0 + 1) * (1 - fx) + rnd(x0 + 1, z0 + 1) * fx) * fz;
    };
    const X0 = -4, X1 = 0, Z0 = -4, Z1 = -1, DOOR = -2; // the room, and the column its door is in
    const inRoom = (x: number, z: number, pad = 0) => x >= X0 - pad && x <= X1 + pad && z >= Z0 - pad && z <= Z1 + pad;
    for (let x = -10; x < 10; x++) {
      for (let z = -10; z < 10; z++) {
        const path = x === DOOR && z > Z1 && z < 7;
        put(x, 0, z, inRoom(x, z) ? 'wood' : path ? 'stone' : 'grass');
        if (inRoom(x, z, 2) || Math.abs(x - DOOR) < 2 && z > Z1) continue;
        // The clearing is level; the land rolls up toward its rim, a level at a time.
        const out = Math.max(0, Math.max(Math.abs(x + 0.5), Math.abs(z + 0.5)) - 5.5) / 4;
        const high = Math.min(3, Math.round(out * (0.3 + roll(x, z) * 2.6)));
        for (let y = 1; y <= high; y++) put(x, y, z, 'grass');
        const edge = out > 0.4, r = rnd(x, z), wood = roll(x + 40, z - 17); // woods gather by kind
        const tree = wood < 0.38 ? 'pine' : wood < 0.5 ? 'birch' : wood > 0.72 ? 'poplar' : 'tree';
        const prop = r < (edge ? 0.3 : 0.07) ? tree : r < (edge ? 0.34 : 0.09) ? 'tree' : r < 0.13 ? 'rock' : r < 0.15 ? 'bush' : null;
        if (prop) put(x, high + 1, z, prop);
      }
    }
    // Thin walls on the edges of the room. The two sides away from the default camera are a
    // storey taller and half-timbered, like an opened doll's house.
    for (const [k, piece] of roomEdges(X0, X1, Z0, Z1, 1, false)) edits.push([k, { i: piece }]);
    for (const [k, piece] of roomEdges(X0, X1, Z0, Z1, 2, true)) {
      const [x, , z, side] = parseEdge(k);
      if (side === 'n' ? z === Z0 : x === X0) edits.push([k, { i: piece }]);
    }
    put(-3, 1, -3, 'table'); put(-4, 1, -4, 'barrel'); put(-3, 1, -4, 'barrel'); put(0, 1, -4, 'crate'); put(0, 1, -2, 'chair', 1);
    put(2, 1, 1, 'campfire'); put(3, 1, 0, 'crate'); put(1, 1, 3, 'rock');
    const mini = (id: string, k: string, x: number, z: number, c: string, r: number) => edits.push([`m:${id}`, { x, y: 1, z, k, c, n: '', r, s: 1 }]);
    mini('start-knight', 'knight', DOOR, 2, '#3e63dd', 1);
    mini('start-wolf', 'wolf', 3, 2, '#8b8d98', 6);
    mini('start-ogre', 'ogre', 4, 4, '#e5484d', 7);
    board.commit(edits);
  }

  // ---- lifecycle: phones suspend background tabs and kill their sockets ----

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      save();
      sound.suspend(true);
      return;
    }
    net.wake(Date.now() - hiddenAt > 20_000);
    void navigator.wakeLock?.request('screen').catch(() => {});
    board.invalidate();
    sound.suspend(false);
  });
  addEventListener('online', () => net.wake(false));
  addEventListener('pageshow', (e) => { if (e.persisted) net.wake(true); });
  addEventListener('pagehide', () => { save(); void net.pause(); });
  void navigator.wakeLock?.request('screen').catch(() => {}); // a phone that dims mid-encounter is no fun

  setTool('move');
  syncHand();
  state.ready = true;
  sync();

  return {
    // who and where
    me, meId, name, color: myColor, invite, store, net, board, sound, blobs, tableSounds, packs, loaded, fresh,
    full, amGM, setGM, gmIds: () => gms(store), relay, leave,
    /** The players here. Table screens are not among them (nobody's seat, never a mini's owner): those are `screens`. */
    people: () => [...(display ? [] : [{ id: meId, name, color: myColor }]), ...[...net.peers].filter(([, p]) => !p.disp).map(([pk, p]) => ({ id: pid(pk), name: p.name, color: p.color }))],
    display, screens: () => [...net.peers].filter(([, p]) => p.disp).map(([pk, p]) => ({ id: pid(pk), name: p.name, color: p.color })),
    /** The GM's view of the table, for every table screen on this board to take up. */
    showView: () => { if (amGM()) void send({ y: 'cam', ...board.view() }); },
    shown,
    // play and build
    mode, setMode, setTool, armed, arm, armMini, disarm, sample, inHand, undo,
    mini: { get kind() { return miniKind; }, get color() { return miniColor; }, set color(c: string) { miniColor = c; later(); } },
    scatter: { get kind() { return pourKind; }, set kind(k: string) { pourKind = k; later(); }, get count() { return pourCount; }, set count(n: number) { pourCount = n; later(); } },
    // the selection
    sel, mine, patch, setOpt, hurt, deselect, place, turnSel, copySel, removeSel, emote, aim,
    // dice and chat
    dice: { pickUp, empty: emptyHand, text: handText, count: () => handKinds().length, get secret() { return secret; }, set secret(on: boolean) { secret = on && full(); later(); }, get shake() { return shakeOn; }, setShake, canShake, armShake },
    hold: (kinds: Kind[], text: string, landed: (t: Throw) => void) => { hand.clear(); handMod = 0; asked = { kinds, text, landed }; syncHand(); hooks.grabbed(); },
    chat, armBoulder, blastHere, ruler: () => myRuler,
    // a fight, fog, floors
    fight, next, endFight, revealAll, cut, cutState: () => ({ auto: cutAuto, level: board.cut }),
    // boards
    here: () => here, boardList, boardName, activeBoard, newBoard, renameBoard, lookAtBoard, bringEveryone, deleteBoard,
    // atmosphere and themes
    known, gameTheme, themesOffered, pickTheme, setSound, local, setLocal,
    // scenes and the whole table
    gen: { get opts() { return genOpts; }, set opts(o: GenOpts) { genOpts = o; later(); }, get recent() { return genRecent; }, presets, presetOf, presetFor, scene: sceneRec, build: buildScene, reroll, refurnish, lockRoom, newSeed },
    starterScene, emptyBoard, clearBoard, exportTable, importTable, slabCode, loadSlab,
    attachRules: (r: SystemUI) => { rules = r; later(); }, system: () => rules?.system() ?? null, openSheet: (id?: string | null) => rules?.open(id),
    /** Would this device apply what the rules say follows (the GM's; lowest id of several; the actor's with no GM here)? */
    referee: () => authority(gms(store), [meId, ...[...net.peers.keys()].map(pid)], meId) === meId,
    send: (m: Msg) => void send(m), secretRoll: () => secret,
    setLos: (on: boolean) => { if (full()) store.set('set:los', on); }, los: () => setting(store, 'los', false),
    /** Ask for the chrome to be redrawn (after a change the store does not know about). */
    touch: later,
  };
}

export type { LooseVal };
