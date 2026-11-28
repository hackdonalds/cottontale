// What Play's slots open: dice and chat, the fight tracker, the number pad for hit points,
// the tools (ruler, fog, floors), a mini's details, and the GM's quick board. Each is a
// drawer; the turn strip is the one thing that stays on the table during a fight.

import { EMOTES, type MiniVal, type Sky } from '../board';
import { MINIS, PLAYER_COLORS } from '../catalog';
import { SHOTS } from '../shots';
import { SOUNDSCAPES } from '../sound';
import { atmo, setAtmo } from '../theme';
import { btn, esc, h, ico } from './dom';
import type { Ctx } from './buildSheets';
import type { DrawerOpts } from './drawer';
import { renderSoundboard } from './soundPage';

const nameOf = (v: MiniVal) => v.n || MINIS[v.k]?.name || 'Figure';
const hpText = (v: MiniVal) => (v.hp === undefined && v.mhp === undefined ? '–' : `${v.hp ?? v.mhp}${v.mhp === undefined ? '' : `/${v.mhp}`}`);

/** The dice and chat log: lines are kept here, so the drawer can open on what was missed. */
export class Log {
  lines: string[] = [];
  unread = 0;
  onChange: () => void = () => {};
  add(html: string, mine = false): void {
    this.lines.push(html);
    if (this.lines.length > 200) this.lines.shift();
    if (!mine) this.unread++;
    this.onChange();
  }
}

/** Dice: pick some up, then drag on the table and let go. Chat sits under them. */
export function diceSheet({ s, drawer }: Ctx, log: Log): DrawerOpts {
  const D: [number, string][] = [[2, 'coin'], [4, 'd4'], [6, 'd6'], [8, 'd8'], [10, 'd10'], [12, 'd12'], [20, 'd20'], [100, 'd100']];
  return {
    title: 'Dice and chat',
    render(body) {
      log.unread = 0;
      const msgs = h('div', { class: 'msgs', html: log.lines.slice(-60).map((l) => `<div>${l}</div>`).join('') || '<div class="hint">Rolls and messages show here.</div>' });
      const n = s.dice.count();
      const hand = h('p', { class: 'hint', text: n ? `${s.dice.text()} in hand — drag on the table and let go to throw` : 'Tap dice to pick them up' });
      const dice = h('div', { class: 'dice' }, ...D.map(([sides, label]) => btn(label, () => { s.dice.pickUp(sides); void s.dice.armShake(); drawer.redraw(); })),
        btn('', () => { s.dice.empty(); drawer.redraw(); }, { icon: 'x', title: 'Put the dice back', disabled: !n }));
      const extras = h('div', { class: 'chips' },
        s.full() && btn('Secret', () => { s.dice.secret = !s.dice.secret; drawer.redraw(); }, { icon: 'eyeoff', on: s.dice.secret, title: 'Roll in secret: players see blank dice' }),
        s.full() && btn('Boulder', () => { s.armBoulder(!s.board.boulderArmed); }, { on: s.board.boulderArmed, title: 'Boulder trap: press where it starts and flick' }),
        s.dice.canShake() && btn('Shake', () => { s.dice.setShake(!s.dice.shake); drawer.redraw(); }, { icon: 'buzz', on: s.dice.shake, title: 'Shake the phone to throw' }),
      );
      const input = h('input', { maxlength: 300, placeholder: 'Say something… /r 2d6+3 · /w name hi', 'aria-label': 'Chat', autocomplete: 'off', enterkeyhint: 'send' });
      const form = h('form', { onsubmit: (e) => { e.preventDefault(); const t = input.value; input.value = ''; s.chat(t); msgs.scrollTop = msgs.scrollHeight; } }, input);
      body.append(msgs, hand, dice, extras, form);
      msgs.scrollTop = msgs.scrollHeight;
    },
  };
}

/** A number pad: type an amount, then say what it is. */
export function keypadSheet({ s, drawer, notice }: Ctx, ids: () => string[], back?: () => void): DrawerOpts {
  let n = '';
  const targets = () => ids().map((id) => s.store.get<MiniVal>(`m:${id}`)).filter((v): v is MiniVal => !!v);
  return {
    title: 'Hit points', stay: true,
    render(body) {
      const t = targets();
      const who = t.length === 1 ? `${nameOf(t[0])} · ${hpText(t[0])}` : `${t.length} figures`;
      const amount = () => Math.min(9999, +n || 0);
      const apply = (sign: number) => { if (!amount()) return notice.say('Type an amount first.'); s.hurt(sign * amount(), ids()); notice.say(`${sign < 0 ? 'Damage' : 'Healing'} ${amount()} · ${who.split(' · ')[0]}`); n = ''; if (back) back(); else drawer.redraw(); };
      const set = (key: 'hp' | 'mhp') => { for (const id of ids()) { const v = s.store.get<MiniVal>(`m:${id}`); if (v && s.mine(v)) s.board.write([[`m:${id}`, { ...v, [key]: amount(), ...(key === 'mhp' && v.hp === undefined ? { hp: amount() } : {}) }]]); } n = ''; drawer.redraw(); };
      body.append(
        h('div', { class: 'readout' }, h('span', { text: who }), h('b', { text: n || '0' })),
        h('div', { class: 'keys' },
          ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => btn(d, () => { if (n.length < 4) n += d; drawer.redraw(); })),
          btn('', () => { n = n.slice(0, -1); drawer.redraw(); }, { icon: 'back', title: 'Delete a digit' }), btn('0', () => { if (n && n.length < 4) n += '0'; drawer.redraw(); }), btn('Max', () => set('mhp'), { title: 'Set the maximum to this' }),
        ),
        h('div', { class: 'chips big' }, btn('Damage', () => apply(-1), { cls: 'hurt' }), btn('Heal', () => apply(1), { cls: 'heal' }), btn('Set', () => set('hp'), { title: 'Set hit points to this' })),
      );
    },
  };
}

/** The fight: who is in it, in what order, and how they are doing. */
export function fightSheet(ctx: Ctx): DrawerOpts {
  const { s, drawer, notice } = ctx;
  const { store, board } = s;
  const picked = new Set<string>();
  const all = () => [...store.keys('m:')].map((k) => ({ id: k.slice(2), v: store.get<MiniVal>(k)! })).filter((m) => m.v && (s.full() || !m.v.h));
  const roll = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 20) + 1;
  const join = (ms: { id: string; v: MiniVal }[]) => { board.commit(ms.filter((m) => m.v.ini === undefined).map((m) => [`m:${m.id}`, { ...m.v, ini: roll() }])); };
  const self: DrawerOpts = {
    title: 'Fight', stay: true,
    render(body) {
      const f = s.fight(), gm = s.full(), minis = all();
      const inFight = new Set(f.order.map((o) => o.id)), out = minis.filter((m) => !inFight.has(m.id));
      for (const id of [...picked]) if (!minis.some((m) => m.id === id)) picked.delete(id);
      if (!minis.length) { body.append(h('p', { class: 'hint', text: 'No figures on this board yet. Place some in Build → Pieces.' })); return; }
      if (gm) body.append(h('div', { class: 'chips' },
        btn(f.order.length ? 'Add the rest' : 'Start: everyone rolls', () => { join(out); if (!s.fight().current) s.next(); }, { icon: 'swords', cls: f.order.length ? '' : 'primary', disabled: !out.length }),
        f.order.length > 0 && btn(f.current ? 'Next turn' : 'Begin', () => s.next(), { icon: 'next' }),
        f.order.length > 0 && btn('End fight', () => { s.endFight(); }, { icon: 'x' }),
      ));
      if (f.current) body.append(h('p', { class: 'hint', text: `Round ${f.round} — tap figures to pick targets, then Damage or Heal` }));
      const row = (m: { id: string; v: MiniVal }, on: boolean) => {
        const ini = h('input', { type: 'number', inputmode: 'numeric', class: 'ini', placeholder: '–', 'aria-label': `Initiative of ${nameOf(m.v)}`, value: m.v.ini ?? '', disabled: !gm,
          onchange: () => { const n = Math.round(+ini.value), { ini: _, ...rest } = m.v; board.commit([[`m:${m.id}`, ini.value.trim() === '' || !Number.isFinite(n) ? rest : { ...rest, ini: Math.max(-99, Math.min(999, n)) }]]); } });
        return h('div', { class: `line fighter${f.current?.id === m.id ? ' now' : ''}${picked.has(m.id) ? ' picked' : ''}${on ? '' : ' out'}` },
          ini,
          h('button', { type: 'button', class: 'grow who', 'aria-pressed': String(picked.has(m.id)), html: `<i style="background:${esc(m.v.c)}"></i><span>${esc(nameOf(m.v))}${m.v.h ? ' (hidden)' : ''}</span><b>${hpText(m.v)}</b>`, onclick: () => { if (picked.has(m.id)) picked.delete(m.id); else picked.add(m.id); drawer.redraw(); } }),
          btn('', () => board.focusMini(m.id), { icon: 'eye', title: `Show ${nameOf(m.v)}` }),
        );
      };
      for (const o of f.order) body.append(row(o, true));
      if (out.length && f.order.length) body.append(h('p', { class: 'hint', text: 'Not in the fight — give a number to add one' }));
      for (const m of out) body.append(row(m, false));
      if (picked.size) body.append(h('div', { class: 'chips big sticky' },
        btn(`Damage or heal ${picked.size}`, () => drawer.open('hp', keypadSheet(ctx, () => [...picked], () => drawer.open('fight', self))), { icon: 'heart', cls: 'primary' }),
        btn('Clear', () => { picked.clear(); drawer.redraw(); }),
      ));
      void notice;
    },
  };
  return self;
}

/** The turn strip: who is up, and Next within reach. Only there during a fight. */
export function mountTurn(root: HTMLElement, { s }: Ctx): { render(): void; el: HTMLElement } {
  const who = h('button', { type: 'button', class: 'who' }), next = h('button', { type: 'button', class: 'next', title: 'Next turn', 'aria-label': 'Next turn', html: ico('next'), onclick: () => s.next() });
  const el = h('div', { class: 'turn', hidden: true }, who, next);
  root.append(el);
  return {
    el,
    render() {
      const f = s.fight();
      el.hidden = !f.current;
      if (!f.current) return;
      const i = f.order.indexOf(f.current), after = f.order[(i + 1) % f.order.length];
      who.innerHTML = `<i style="background:${esc(f.current.v.c)}"></i><span><b>${esc(nameOf(f.current.v))}</b><small>Round ${f.round}${after && after !== f.current ? ` · then ${esc(nameOf(after.v))}` : ''}</small></span>`;
      who.onclick = () => { s.board.focusMini(f.current!.id); if (s.board.tool === 'move') s.board.select(f.current!.id); };
      next.hidden = !f.mayAdvance;
    },
  };
}

/** Tools of Play: the ruler, the fog brush, floors, line of sight. */
export function toolsSheet({ s, drawer, notice }: Ctx): DrawerOpts {
  return {
    title: 'Tools',
    render(body) {
      const c = s.cutState();
      body.append(
        h('div', { class: 'chips' },
          btn('Ruler', () => { s.setTool('ruler'); drawer.close(); notice.say('Drag on the table to measure.'); }, { icon: 'ruler' }),
          s.amGM() && btn('Fog', () => { s.setTool('fog'); drawer.close(); notice.say('Tap a room to hide it from the players, or drag to paint.'); }, { icon: 'fog' }),
        ),
        h('p', { class: 'hint', text: 'Floors — hide what is above, to look inside buildings' }),
        h('div', { class: 'chips' },
          btn('', () => { s.cut('down'); drawer.redraw(); }, { icon: 'down', title: 'Hide upper floors' }),
          btn(`${c.auto ? 'Auto · ' : ''}${c.level === Infinity ? 'All floors' : `Up to ${c.level}`}`, () => { s.cut('auto'); drawer.redraw(); }, { on: c.auto, title: 'Follow the selected figure' }),
          btn('', () => { s.cut('up'); drawer.redraw(); }, { icon: 'up', title: 'Show more floors' }),
        ),
        h('div', { class: 'chips', hidden: !s.full() }, btn(`Line of sight: ${s.los() ? 'on' : 'off'}`, () => { s.setLos(!s.los()); }, { icon: s.los() ? 'eye' : 'eyeoff', on: s.los(), title: 'Players see only what their figures can' })),
        h('p', { class: 'hint', text: 'Press and hold the table to ping a spot for everyone.' }),
      );
    },
  };
}

/** More, for a selected mini: everything about it that is not hit points. */
export function miniMoreSheet({ s, drawer, notice }: Ctx): DrawerOpts {
  const FLY = [0, 1, 2, 3, 5, 8], SIZE: Record<number, number> = { 1: 1.5, 1.5: 2, 2: 0.7 };
  return {
    title: 'Figure', stay: true,
    render(body) {
      const v = s.sel();
      if (!v) return drawer.close();
      const mine = s.mine(v), gm = s.full();
      const name = h('input', { maxlength: 20, placeholder: 'Name', 'aria-label': 'Name', enterkeyhint: 'done', value: v.n, disabled: !mine, onchange: () => s.patch({ n: name.value.trim().slice(0, 20) }) });
      const num = (label: string, key: 'mhp' | 'ini', lo: number, hi: number) => {
        const i = h('input', { type: 'number', inputmode: 'numeric', placeholder: '–', 'aria-label': label, value: v[key] ?? '', disabled: !mine,
          onchange: () => { const n = Math.round(+i.value), val = i.value.trim() === '' || !Number.isFinite(n) ? undefined : Math.max(lo, Math.min(hi, n)); s.setOpt(key, val); if (key === 'mhp' && val !== undefined && s.sel()?.hp === undefined) s.patch({ hp: val }); } });
        return h('label', { class: 'field' }, h('span', { text: label }), i);
      };
      body.append(name, h('div', { class: 'fields' }, num('Max HP', 'mhp', 1, 9999), num('Initiative', 'ini', -99, 999)));
      if (!mine) return;
      if (gm) {
        const owner = h('select', { 'aria-label': 'Who may move it', onchange: () => s.setOpt('o', owner.value) });
        const opts: [string, string][] = [['', 'Moved by: GM only'], ['*', 'Moved by: everyone'], ...s.people().map((p): [string, string] => [p.id, `Moved by: ${p.name}${p.id === s.meId ? ' (me)' : ''}`])];
        if (v.o && !opts.some(([k]) => k === v.o)) opts.push([v.o, 'Moved by: someone away']);
        owner.innerHTML = opts.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('');
        owner.value = v.o ?? '';
        body.append(owner);
      }
      body.append(h('div', { class: 'chips' },
        btn('Turn', () => s.patch({ r: ((s.sel()?.r ?? 0) + 1) % 8 }), { icon: 'turn' }),
        btn(`Size ${v.s ?? 1}`, () => s.patch({ s: SIZE[s.sel()?.s ?? 1] ?? 1 }), { icon: 'grow' }),
        btn(`Flying ${v.e || 0}`, () => s.patch({ e: FLY[(FLY.indexOf(s.sel()?.e ?? 0) + 1) % FLY.length] }), { icon: 'wing' }),
        btn(v.d ? 'Stand up' : 'Knock down', () => s.patch({ d: !s.sel()?.d }), { on: !!v.d }),
        gm && btn('Delete', () => { s.removeSel(); drawer.close(); notice.say('Removed. Undo brings it back.'); }, { icon: 'trash' }),
      ));
      body.append(h('div', { class: 'swatches' }, ...PLAYER_COLORS.map((c) => h('button', { type: 'button', class: c === v.c ? 'on' : '', style: `--c:${c}`, 'aria-label': `Colour ${c}`, onclick: () => s.patch({ c }) }))));
      body.append(h('p', { class: 'hint', text: 'Emote, shoot (then tap a target) or shove (then tap which way)' }));
      body.append(h('div', { class: 'chips' },
        ...Object.entries(EMOTES).map(([kind, icon]) => btn(icon, () => s.emote(kind), { title: kind, cls: 'chip' })),
        ...Object.entries(SHOTS).map(([kind, k]) => btn(k.icon, () => { s.aim(kind); drawer.close(); }, { title: k.name, cls: 'chip' })),
        btn('💨', () => { if (s.board.aimShove(s.board.selected)) { drawer.close(); notice.say('Tap which way to shove.'); } }, { title: 'Shove', cls: 'chip' }),
      ));
    },
  };
}

/** The GM's quick board: the things reached for mid-session, one tap each. */
export function quickSheet({ s, drawer }: Ctx): DrawerOpts {
  const SKY: [Sky, string][] = [['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']];
  return {
    title: 'Quick', stay: true,
    render(body) {
      const active = s.activeBoard(), here = s.here(), boards = s.boardList();
      if (boards.length > 1) {
        body.append(h('p', { class: 'hint', text: 'Boards — tap to bring everyone there' }));
        body.append(h('div', { class: 'chips' }, ...boards.map((b) => btn(b.n, () => s.bringEveryone(b.id), { icon: 'map', on: b.id === active, cls: 'chip' }))));
        if (here !== active) body.append(h('p', { class: 'hint', text: `You are looking at “${s.boardName(here)}”; the players are on “${s.boardName(active)}”.` }));
      }
      const sfx = h('div', { class: 'chips' });
      renderSoundboard(sfx, s.tableSounds, s.full());
      const scapes: Record<string, string> = { ...SOUNDSCAPES, ...Object.fromEntries(Object.entries(s.gameTheme()?.sounds?.scapes ?? {}).map(([id, r]) => [id, r.name])), ...s.tableSounds.scapeNames() };
      const amb = atmo(s.store, 'amb', 'off'), sky = atmo<Sky>(s.store, 'sky', 'day');
      body.append(
        sfx,
        h('p', { class: 'hint', text: 'Soundscape' }),
        h('div', { class: 'chips' }, ...Object.entries(scapes).map(([id, label]) => btn(String(label).replace(/^[^\p{L}\p{N}]+/u, ''), () => setAtmo(s.store, 'amb', id), { on: id === amb, cls: 'chip' }))),
        h('p', { class: 'hint', text: 'Sky' }),
        h('div', { class: 'chips' }, ...SKY.map(([id, label]) => btn(label, () => setAtmo(s.store, 'sky', id), { on: id === sky, cls: 'chip' }))),
        h('div', { class: 'chips' },
          btn('Reveal all', () => s.revealAll(), { icon: 'sun' }),
          btn('Add a figure', () => { drawer.close(); s.setMode('build'); s.armMini(s.mini.kind); }, { icon: 'pawn', title: 'Put another figure on the table' }),
        ),
      );
    },
  };
}
