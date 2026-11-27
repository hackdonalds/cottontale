// The table's game system at work: the character sheet, the list of systems to pick from,
// and the referee that applies what the rules say follows from a roll or a turn.
//
// The sheet is drawn from the system's schema (src/system.ts); a system's author writes data,
// never HTML. Nothing here knows any particular game.
//
// Who applies what. A player changes only pieces they control, by writing the store like any
// other edit. What the rules do by themselves (triggers) is applied by one device, the
// authority (see `authority`): it writes whole pieces marked with the event's id, so a second
// or late application changes nothing.
import type { Board } from '../board';
import { MINIS } from '../catalog';
import { results, rollValues, type Kind, type Throw } from '../dice';
import type { Msg, Net } from '../net';
import { canControl, eyesOf, fullPowers, gms, miniShown, pid, type MiniVal, type Turn } from '../rules';
import type { Store } from '../store';
import {
  authority, derive, evalExpr, face, fire, modeFor, parseDice, parseEdits, parseIndex, parseSystem, planRoll, readRoll, runEdits,
  scopeOf, scriptCtx, setCond, setStat,
  type Field, type Fired, type GameEvent, type Piece, type RollDef, type RollRead, type ScriptRunner, type StatValue, type System, type SystemRef, type TriggerOn,
} from '../system';

/** What the sheet needs from the app around it. */
export interface SheetHost {
  store: Store; net: Net; board: Board;
  /** This player: short id, public key, and the board this device is showing. */
  me: string; pk: string; here(): string;
  say(html: string, mine?: boolean): void;
  send(msg: Msg): void;
  openSheet(id: string | null): void;
  /** Put physical dice in the player's hand. `landed` gets the throw once it has been simulated. */
  hold(kinds: Kind[], text: string, landed: (t: Throw) => void): void;
  /** Is the GM rolling in secret? */
  secret(): boolean;
}
export interface SystemUI {
  /** The table's system, or null: then the app is exactly as it is without one. */
  system(): System | null;
  /** A store key changed (every change, local or remote). */
  onStore(key: string, value: unknown, prev: unknown): void;
  /** A live message arrived. */
  onMsg(msg: Msg, from: string): void;
  /** The store settled: redraw what is showing. */
  refresh(): void;
  /** Open the sheet for a piece, the selected one, or the player's own character. */
  open(id?: string | null): void;
  /** Another piece was selected: an open sheet follows it. */
  follow(id: string | null): void;
}

type SRoll = Extract<Msg, { y: 'sroll' }>;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ico = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
const rng = (sides: number) => (crypto.getRandomValues(new Uint32Array(1))[0] % sides) + 1;
const FRESH = 30_000; // a change older than this is history being restored, not something happening now

let H: SheetHost | null = null;
let runner: ScriptRunner | null = null;
/**
 * Extension point: give triggers' `{ script: name }` edits something to run. The runner gets
 * plain data about the event and may resolve to a list of edits (the same closed set triggers
 * use); they are validated and applied by the authority. With none set, scripts are ignored.
 */
export function setScriptRunner(fn: ScriptRunner | null): void { runner = fn; }

// The system in the store is a copy somebody else may have written: always read it through the parser.
let rawSeen: unknown, parsedSeen: System | null = null;
function current(): System | null {
  const raw = H?.store.get('set:system') ?? null;
  if (raw !== rawSeen) { rawSeen = raw; parsedSeen = raw ? parseSystem(raw) : null; }
  return parsedSeen;
}

// ---- picking a system ---------------------------------------------------------------------

let offer: SystemRef[] | null = null;
/**
 * The systems on offer (public/systems), to choose one for the table or clear it. Anyone may
 * look; only the GM (or anyone, in free play) may change it.
 */
export function renderSystemPicker(el: HTMLElement): void {
  if (!H) return;
  const { store, me } = H, may = fullPowers(store, me), cur = current();
  el.innerHTML = '';
  el.classList.add('picker');
  const row = (name: string, about: string, on: boolean, click: () => void) => {
    const b = document.createElement('button');
    b.innerHTML = `<b>${esc(name)}</b><span>${esc(about)}</span>`;
    b.classList.toggle('on', on);
    b.disabled = !may;
    b.onclick = click;
    el.append(b);
  };
  row('No rules', 'Just the table: dice, hit points and stat lines as you like.', !cur, () => store.set('set:system', null));
  for (const s of offer ?? []) {
    row(s.name, s.about ?? '', cur?.id === s.id, async () => {
      try {
        const sys = parseSystem(await (await fetch(`./systems/${s.file}`)).json());
        if (!sys) throw new Error('not a system');
        store.set('set:system', sys);
      } catch { H?.say('<span class="sys">That rules file could not be read.</span>'); }
    });
  }
  // A system that came with the table but is not on this device's list still shows as the one in use.
  if (cur && !(offer ?? []).some((s) => s.id === cur.id)) row(cur.name, cur.about ?? '', true, () => {});
  if (!offer) {
    offer = [];
    void fetch('./systems/index.json').then((r) => r.json()).then((raw) => { offer = parseIndex(raw); if (el.isConnected) renderSystemPicker(el); }).catch(() => {});
  }
}

// ---- the app's side of the rules ----------------------------------------------------------------

export function mountSystem(host: SheetHost): SystemUI {
  H = host;
  const { store, net, board, me } = host;
  const key = (id: string) => `m:${id}`;
  const mini = (id: string | null | undefined) => (id ? store.get<MiniVal>(key(id)) : null);
  const nameOf = (v: MiniVal) => v.n || MINIS[v.k]?.name || 'Someone';
  const piece = (id: string | null | undefined): Piece | undefined => { const v = mini(id); return v && id ? { id, v, name: nameOf(v) } : undefined; };
  const present = () => [me, ...[...net.peers.keys()].map(pid)];
  const full = () => fullPowers(store, me);

  board.face = (v) => face(current(), v);

  // ---- referee: apply what the rules say follows ----

  const said = new Set<string>();
  function line(k: string, text: string): void {
    if (said.has(k)) return;
    if (said.size > 500) said.clear();
    said.add(k);
    host.say(`<span class="rule">${esc(text.slice(0, 200))}</span>`);
  }
  function apply(sys: System, ev: GameEvent, fired: Fired): void {
    for (const p of fired.minis) {
      const cur = mini(p.id);
      if (cur && !cur.fx?.includes(ev.id)) store.set(key(p.id), p.v);
    }
    fired.lines.forEach((text, i) => {
      const k = `${ev.id}#${i}`;
      host.send({ y: 'sys', k, m: text });
      line(k, text);
    });
    fired.scripts.forEach((name, i) => {
      if (!runner) return;
      void runner(name, scriptCtx(sys, ev)).then((raw) => {
        const again: GameEvent = { ...ev, id: `${ev.id}~${i}`, self: piece(ev.self?.id), target: piece(ev.target?.id) };
        apply(sys, again, runEdits(sys, again, parseEdits(raw), rng));
      }).catch(() => { /* a script that fails does nothing */ });
    });
  }
  /** Something happened. If this device is the one to apply its consequences, do so. */
  function happened(on: TriggerOn, id: string, actor: string, self?: Piece, target?: Piece, roll?: GameEvent['roll']): void {
    const sys = current();
    if (!sys || !self || authority(gms(store), present(), actor) !== me) return;
    const ev: GameEvent = { on, id, self, ...(target ? { target } : {}), ...(roll ? { roll } : {}) };
    apply(sys, ev, fire(sys, ev, rng));
  }

  function onStore(k: string, v: unknown, prev: unknown): void {
    const sys = current();
    if (!sys || (k !== 'turn' && !k.startsWith('m:'))) return;
    const at = store.stamp(k);
    if (!at || Date.now() - at.t > FRESH) return;
    if (k === 'turn') {
      const was = prev as Turn | null, now = v as Turn | null;
      if (was?.id === now?.id && was?.round === now?.round) return;
      if (was?.id) happened('turn.end', `te:${at.t}:${was.id}`, at.b, piece(was.id));
      if (now?.id) happened('turn.start', `ts:${at.t}:${now.id}`, at.b, piece(now.id));
      return;
    }
    const was = prev as MiniVal | null, now = v as MiniVal | null;
    if (!sys.hp || !was || !now || was.hp === now.hp) return;
    const left = derive(sys, now).hp;
    if (left !== undefined && left <= 0 && (derive(sys, was).hp ?? 1) > 0) happened('hp.zero', `z:${at.t}:${k.slice(2)}`, at.b, piece(k.slice(2)));
  }

  // ---- rolls ----

  /** Which way of rolling the player has picked on the sheet (advantage…), and at whom. */
  let picked: string | null = null, aim: string | null = null;

  function breakdown(r: RollRead): string {
    return r.terms.map((t, i) => {
      const v = t.s * t.value;
      if (!t.dice) return `${v < 0 ? '− ' : i ? '+ ' : ''}${Math.abs(v)}`;
      const dice = t.dice.map((d) => { const n = `${d.v}${d.burst ? '!' : ''}`; return !d.kept ? `<s>${n}</s>` : d.hit ? `<b>${n}</b>` : n; }).join(' ');
      return `${t.s < 0 ? '− ' : i ? '+ ' : ''}[${dice}]`;
    }).join(' ');
  }
  let toastTimer: ReturnType<typeof setTimeout>;
  function toast(big: string, small: string): void {
    const t = $('toast');
    t.innerHTML = `<big>${big}</big>${small}`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  /**
   * A roll made from a sheet has landed, here or on someone else's device. Read it from the
   * recorded throw (never from a total somebody claims), show it, and referee it.
   */
  async function settle(m: SRoll, from: string): Promise<void> {
    const ast = parseDice(m.x);
    if (!ast || typeof m.k !== 'string' || m.k.length > 40 || typeof m.id !== 'string') return;
    const plan = planRoll(ast); // the notation arrives with its numbers worked out by the thrower
    const labels = m.t ? results(m.t) : null;
    if (plan.kinds.length && (!labels || m.t!.k.join() !== plan.kinds.join())) return; // not the dice of this roll
    const read = readRoll(plan, labels && plan.kinds.length ? rollValues(m.t!.k, labels) : [], Array.isArray(m.v) ? m.v.slice(0, 400) : []);
    const mine = from === host.pk, elsewhere = (m.bd ?? '') !== host.here(), hidden = !!m.s && !full() && !mine;
    const who = `<b style="color:${net.colorOf(from)}">${esc(net.nameOf(from))}</b>`;
    // (The wait is bounded: a device in the background still referees, it just does not watch.)
    if (m.t && plan.kinds.length && !elsewhere) await Promise.race([board.dice.play(m.t, net.colorOf(from), from, hidden), new Promise((r) => setTimeout(r, m.t!.n * 34 + 1500))]);
    if (hidden) host.say(`🎲 ${who} rolled in secret`);
    else {
      const sys = current(), v = elsewhere ? null : mini(m.id), def = sys?.rolls.find((r) => r.id === m.ri);
      const as = v && (!v.h || full()) ? ` <span class="sys">as</span> ${esc(nameOf(v))}` : '';
      const label = esc(String(m.n ?? '').slice(0, 60)), vs = typeof m.vs === 'number' && Number.isFinite(m.vs) ? Math.trunc(m.vs) : undefined;
      const verdict = vs === undefined ? '' : ` <span class="sys">against ${vs}:</span> <b>${esc(read.total >= vs ? def?.win ?? 'Success' : def?.lose ?? 'Failure')}</b>`;
      const unit = read.counted ? ` <span class="sys">${read.total === 1 ? 'success' : 'successes'}</span>` : '';
      host.say(`🎲 ${who}${as} · ${label} <span class="sys">${esc(plan.text)}</span>: <span class="tot">${read.total}</span>${unit} <span class="sys">${breakdown(read)}</span>${verdict}`, mine);
      toast(String(read.total), `${mine ? 'You' : who} · ${label}`);
    }
    if (elsewhere) return; // pieces are looked up on the board this device shows
    const self = piece(m.id), actor = pid(from);
    if (!self || !canControl(store, actor, self.v)) return; // nobody rolls for a piece that is not theirs
    if (mine) {
      const def = current()?.rolls.find((r) => r.id === m.ri);
      if (def?.into === 'ini') store.set(key(m.id), { ...self.v, ini: Math.max(-99, Math.min(999, read.total)) });
    }
    happened('roll', `r:${m.k}`, actor, piece(m.id), typeof m.tg === 'string' ? piece(m.tg) : undefined,
      { id: String(m.ri ?? '').slice(0, 24), total: read.total, nat: read.nat, ones: read.ones, ...(typeof m.vs === 'number' ? { vs: Math.trunc(m.vs) } : {}) });
  }

  /** Roll for a piece: physical dice go into the hand and are read when they land; the rest is rolled at once. */
  function roll(id: string, rid: string, label: string, notation: string, def?: RollDef): void {
    const sys = current(), v = mini(id), ast = parseDice(notation);
    if (!sys || !v || !ast || !canControl(store, me, v)) return;
    const self = derive(sys, v), tv = aim && aim !== id ? mini(aim) : null, scope = scopeOf(self, tv ? derive(sys, tv) : null);
    const plan = planRoll(ast, scope, modeFor(sys, picked, self.conds));
    const base = {
      y: 'sroll' as const, k: crypto.randomUUID().slice(0, 12), id, ri: rid, n: label, x: plan.text,
      ...(tv ? { tg: aim! } : {}), ...(def?.vs && tv ? { vs: evalExpr(def.vs, scope) } : {}), ...(host.secret() ? { s: true } : {}),
    };
    const done = (t?: Throw) => {
      const read = readRoll(plan, t ? rollValues(t.k, results(t)!) : [], [], rng);
      const msg: SRoll = { ...base, v: read.extra, ...(t ? { t } : {}) };
      host.send(msg);
      void settle({ ...msg, bd: host.here() }, host.pk);
    };
    picked = null; // a way of rolling is picked for one roll
    if (plan.kinds.length) host.hold(plan.kinds, `${label} ${plan.text}`, done);
    else done();
  }

  function onMsg(msg: Msg, from: string): void {
    if (msg.y === 'sroll') void settle(msg, from);
    else if (msg.y === 'sys' && typeof msg.k === 'string' && typeof msg.m === 'string') {
      // Only whoever applies the rules speaks for them.
      if (authority(gms(store), present(), pid(from)) === pid(from)) line(msg.k.slice(0, 60), msg.m);
    }
  }

  // ---- the sheet ----

  let sheetFor: string | null = null;
  const sheetOpen = () => !$('sheet').classList.contains('closed');
  /** The piece a player means by "my character": the one they were handed. */
  function myCharacter(): string | null {
    for (const k of store.keys('m:')) if (store.get<MiniVal>(k)!.o === me) return k.slice(2);
    return null;
  }
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const button = (inner: string, title: string, click: () => void, cls = '') => {
    const b = el('button', cls);
    b.innerHTML = inner;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.onclick = click;
    return b;
  };

  function renderSheet(): void {
    const body = $('sheetBody'), sys = current(), id = sheetFor, v = mini(id);
    // Never redraw under someone who is typing; a field that merely has the cursor keeps it.
    const at = document.activeElement instanceof HTMLInputElement && body.contains(document.activeElement) ? document.activeElement : null;
    if (at && at.value !== at.defaultValue) return;
    if (at) setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) body.querySelector<HTMLInputElement>(`input[data-stat="${at.dataset.stat}"]`)?.focus(); });
    body.innerHTML = '';
    $('sheetName').textContent = v ? nameOf(v) : sys?.name ?? 'Character';
    if (!sys || !id || !v) {
      body.append(el('p', 'hint', sys ? 'Tap a piece on the table, then open its sheet here.' : 'No rules are in use at this table.'));
      return;
    }
    const mine = canControl(store, me, v), sheet = derive(sys, v), entered = derive(sys, { ...v, cn: [] });
    const write = (next: MiniVal) => { const cur = mini(id); if (cur && next !== cur && canControl(store, me, cur)) store.set(key(id), next); }; // (the sheet redraws when the store settles)
    const set = (stat: string, value: StatValue) => { const cur = mini(id); if (cur) write(setStat(sys, cur, stat, value)); };
    /** A stepper: one more or less than what is entered now (not what was when the sheet was drawn). */
    const step = (stat: string, by: number) => { const cur = mini(id); if (cur) set(stat, (derive(sys, { ...cur, cn: [] }).num.get(stat) ?? 0) + by); };

    // Conditions: toggles for whoever runs the piece, a plain list for everyone else.
    const conds = el('div', 'chips');
    for (const c of sys.conditions) {
      const on = sheet.conds.includes(c.id);
      if (!mine && !on) continue;
      const b = button(`${c.icon ? `${esc(c.icon)} ` : ''}${esc(c.name)}`, c.name, () => { const cur = mini(id); if (cur) write(setCond(sys, cur, c.id, !on)); });
      b.classList.toggle('on', on);
      b.disabled = !mine;
      b.dataset.cond = c.id;
      conds.append(b);
    }
    if (!mine) {
      // Someone else's piece: what everyone at the table can see of it, and no more.
      if (sheet.mhp) body.append(el('p', 'hint', `${fieldName(sys, sys.hp!)}: ${sheet.hp} / ${sheet.mhp}`));
      body.append(conds.childElementCount ? conds : el('p', 'hint', 'Nothing unusual about them.'));
      return;
    }

    const mode = modeFor(sys, picked, sheet.conds), scope = scopeOf(sheet);
    const rollButton = (rid: string, label: string, notation: string, def?: RollDef, text = '') => {
      const plan = planRoll(parseDice(notation)!, scope, mode);
      const b = button(`${ico('dice')}${esc(text ? `${text} ` : '')}<small>${esc(plan.text)}</small>`, `Roll ${label}`, () => roll(id, rid, label, notation, def), 'rollb');
      b.dataset.roll = rid;
      return b;
    };
    const number = (stat: string, value: number, title: string) => {
      const i = el('input');
      Object.assign(i, { type: 'number', inputMode: 'numeric', defaultValue: String(value) });
      i.setAttribute('aria-label', title);
      i.dataset.stat = stat;
      i.onchange = () => {
        const n = Math.round(+i.value), ok = i.value.trim() !== '' && Number.isFinite(n);
        i.defaultValue = i.value; // entered: no longer being typed
        if (ok) set(stat, n);
        setTimeout(renderSheet); // what was typed may have been clamped, or refused
      };
      return i;
    };
    const fieldRow = (f: Field): HTMLElement => {
      const row = el('div', 'frow'), name = el('span', 'fname', f.name);
      name.title = f.name;
      row.append(name);
      const num = sheet.num.get(f.id) ?? 0;
      if (f.type === 'number') {
        const raw = entered.num.get(f.id) ?? 0;
        // A condition is changing it: show what it comes to beside what was entered.
        if (raw !== num) row.append(el('b', 'eff', String(num)));
        row.append(button('−', `Less ${f.name}`, () => step(f.id, -1)), number(f.id, raw, f.name), button('+', `More ${f.name}`, () => step(f.id, 1)));
      } else if (f.type === 'resource') {
        const max = sheet.num.get(`${f.id}.max`) ?? 0;
        row.append(button('−', `Less ${f.name}`, () => step(f.id, -1)), number(f.id, num, f.name), el('span', 'of', '/'));
        row.append(f.max === undefined ? number(`${f.id}.max`, max, `${f.name}, at most`) : el('b', 'val', String(max)));
        row.append(button('+', `More ${f.name}`, () => step(f.id, 1)));
      } else if (f.type === 'text') {
        const i = el('input');
        Object.assign(i, { type: 'text', maxLength: 60, defaultValue: sheet.str.get(f.id) ?? '' });
        i.setAttribute('aria-label', f.name);
        i.dataset.stat = f.id;
        i.onchange = () => { i.defaultValue = i.value; set(f.id, i.value); };
        row.append(i);
      } else if (f.type === 'toggle') {
        const b = button(num ? 'Yes' : 'No', f.name, () => set(f.id, !num), 'val');
        b.classList.toggle('on', !!num);
        row.append(b);
      } else if (f.type === 'choice') {
        const s = el('select');
        s.setAttribute('aria-label', f.name);
        for (const o of f.options!) s.add(new Option(o.name, o.id));
        s.value = sheet.str.get(f.id) ?? '';
        s.onchange = () => set(f.id, s.value);
        row.append(s);
      } else row.append(el('b', 'val', String(num)));
      if (f.roll) row.append(rollButton(f.id, f.type === 'text' ? sheet.str.get(f.id) || f.name : f.name, f.roll));
      return row;
    };
    for (const s of sys.sections) {
      const fields = s.fields.filter((f) => !f.hide);
      if (!fields.length) continue;
      const card = el('div', 'card');
      if (s.name) card.append(el('h4', '', s.name));
      card.append(...fields.map(fieldRow));
      body.append(card);
    }
    body.append(conds);

    if (sys.rolls.length) {
      const card = el('div', 'card');
      card.append(el('h4', '', 'Rolls'));
      // At whom: the rules read the target's sheet (its armour, its guard) and may change it.
      const others = [...store.keys('m:')].map((k) => k.slice(2)).filter((o) => o !== id && miniShown(store, me, mini(o)!, eyesOf(store, me)) !== 'no');
      if (others.length && (sys.rolls.some((r) => r.vs) || sys.triggers.some((t) => t.on === 'roll'))) {
        const row = el('div', 'frow'), s = el('select');
        s.id = 'sheetAim';
        s.setAttribute('aria-label', 'Target');
        s.add(new Option('No target', ''));
        for (const o of others.slice(0, 60)) s.add(new Option(nameOf(mini(o)!), o));
        if (aim && !others.includes(aim)) aim = null;
        s.value = aim ?? '';
        s.onchange = () => { aim = s.value || null; };
        row.append(el('span', 'fname', 'Target'), s);
        card.append(row);
      }
      if (sys.modes.length) {
        const modes = el('div', 'chips');
        for (const m of sys.modes) {
          const b = button(esc(m.name), m.name, () => { picked = picked === m.id ? null : m.id; renderSheet(); });
          b.classList.toggle('on', mode?.id === m.id);
          b.dataset.mode = m.id;
          modes.append(b);
        }
        card.append(modes);
      }
      const rolls = el('div', 'rolls');
      for (const r of sys.rolls) rolls.append(rollButton(r.id, r.name, r.dice, r, r.name));
      card.append(rolls);
      body.append(card);
    }
  }
  const fieldName = (sys: System, id: string) => sys.sections.flatMap((s) => s.fields).find((f) => f.id === id)?.name ?? id;

  function open(id?: string | null): void {
    sheetFor = id ?? board.selected ?? myCharacter();
    picked = null;
    host.openSheet('sheet');
    (document.activeElement as HTMLElement | null)?.blur?.();
    renderSheet();
  }

  // ---- following the table ----

  let shown: System | null | undefined;
  function refresh(): void {
    const sys = current();
    if (sys !== shown) {
      shown = sys;
      document.body.classList.toggle('sys', !!sys);
      // The tray offers the dice the game uses.
      for (const b of $('dice').querySelectorAll<HTMLButtonElement>('[data-d]')) b.hidden = !!sys && !sys.dice.includes(+b.dataset.d!);
      board.refresh(); // bars and marks over the pieces follow the rules
      if (!sys && sheetOpen()) host.openSheet(null);
      host.say(`<span class="sys">${sys ? `Rules: ${esc(sys.name)}.` : 'No rules in use.'}</span>`);
    }
    if (sheetOpen()) renderSheet();
    if (!$('rules').classList.contains('closed')) renderSystemPicker($('rulesList'));
  }
  shown = current() ? undefined : null; // joining a table that has rules announces them; one without stays quiet

  return {
    system: current, onStore, onMsg, refresh, open,
    follow: (id) => { if (id && sheetOpen() && id !== sheetFor) { sheetFor = id; picked = null; renderSheet(); } },
  };
}
