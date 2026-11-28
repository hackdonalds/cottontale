// First run: what a seat is offered the moment it sits down, and the hints that follow.
// The GM of an empty board gets "Start with…" (a theme and a first scene, with Another in
// reach), a player without a figure gets "Pick your character". Both are drawers like any
// other: they take the dock's sheet, never block the table, and closing one is an answer.
// Which step is due is decided in ui/firstStep.ts; the hints are sequenced in ui/hints.ts.

import './firstRun.css';
import { MINIS } from '../catalog';
import { ls } from '../session';
import type { GameTheme } from '../theme';
import { btn, esc, h } from './dom';
import type { Ctx } from './buildSheets';
import type { DrawerOpts } from './drawer';
import { face } from './face';
import { stepFor, type Step } from './firstStep';
import { mountHints } from './hints';

/** Hand the invite link to the phone's share sheet, or failing that to the clipboard. */
async function invite({ s, notice }: Ctx): Promise<void> {
  try {
    if (navigator.share) await navigator.share({ title: 'Cottontale', text: 'Join my table!', url: s.invite });
    else { await navigator.clipboard.writeText(s.invite); notice.say('Invite link copied. Anyone with it can join.'); }
  } catch { notice.say('Could not share the link. It is in the address bar.'); }
}

/** Start with…: a look and a first scene for an empty board. */
function startSheet(ctx: Ctx): DrawerOpts {
  const { s, drawer, notice } = ctx;
  /** Take the theme up and build the scene that goes with it, in place of the one before. One step of undo. */
  const pick = (t: GameTheme) => {
    if (t.id !== s.gameTheme()?.id) s.pickTheme(t); // (picking the one the board has would let go of it)
    if (s.gen.build({ ...s.gen.opts, theme: t.gen, seed: s.gen.newSeed() })) notice.say(`${t.name}: a first scene. Another builds a different one.`);
  };
  return {
    title: 'Start with…', stay: true,
    render(body) {
      const scene = !!s.gen.scene(), themes = s.themesOffered(), cur = s.gameTheme()?.id;
      if (scene) body.append(h('div', { class: 'chips big' },
        btn('Another', () => { if (s.gen.reroll()) notice.say('Another one. Undo brings the last back.'); }, { icon: 'dice', cls: 'primary', title: 'Build a different scene of the same kind' }),
        btn('Keep it', () => drawer.close(), { icon: 'check' }),
      ));
      else body.append(h('p', { class: 'hint', text: themes.length ? 'Pick a look. A first scene is built for you, and you can ask for another.' : 'Fetching the themes…' }));
      body.append(h('div', { class: 'picks' }, ...themes.map((t) => h('button', {
        type: 'button', class: `pick${t.id === cur ? ' on' : ''}`, 'data-theme': t.id, 'aria-pressed': String(t.id === cur),
        html: `<i>${esc(t.icon)}</i><span>${esc(t.name)}</span>`, onclick: () => pick(t),
      }))));
      body.append(h('div', { class: 'chips' },
        !scene && btn('Starter scene', () => { s.starterScene(); drawer.close(); notice.say('A cottage in a clearing. Undo takes it away again.'); }, { icon: 'map', title: 'A small ready-made scene with three figures' }),
        !scene && btn('Empty table', () => { drawer.close(); s.setMode('build'); }, { icon: 'cube', title: 'Build it yourself, from nothing' }),
        btn('Invite players', () => void invite(ctx), { icon: 'link' }),
      ));
    },
  };
}

/** Pick your character: the figures the GM left free, one tap to make one yours. */
function characterSheet({ s, drawer, notice }: Ctx): DrawerOpts {
  return {
    title: 'Pick your character', stay: true,
    render(body) {
      const free = s.claimable();
      if (!free.length) return drawer.close(); // somebody else was quicker
      body.append(h('div', { class: 'tiles' }, ...free.map(({ id, v }) => {
        const name = v.n || MINIS[v.k]?.name || 'Figure';
        return h('button', { type: 'button', class: 'tile', 'data-claim': id, title: name, html: `${face(`m_${v.k}`)}<span>${esc(name)}</span>`, onclick: () => { if (s.claim(id)) { drawer.close(); notice.say(`You are ${name}. Drag to move.`); } } });
      })));
      body.append(h('p', { class: 'hint', text: 'Yours to move from now on. The GM can give you another.' }));
    },
  };
}

export interface FirstRun { update(): void }

export function mountFirstRun(ctx: Ctx): FirstRun {
  const { s, drawer, notice } = ctx;
  const hints = mountHints(notice, ls), offered: Step[] = [];
  let synced = false;
  void s.synced.then(() => { synced = true; update(); });

  /** A hint while its moment lasts; one that never got its turn waits for the next time. */
  const when = (on: boolean, id: string, text: string) => { if (on) hints.hint(id, text); else hints.withdraw(id); };
  /** Called whenever the chrome is redrawn: cheap, and nothing happens unless a step or a hint is due. */
  function update(): void {
    // (What a player may take is only worked out while it could still matter: it asks what they can see.)
    const full = s.full(), asking = synced && !full && !offered.includes('character'), owns = asking && s.myMinis().length > 0;
    const step = stepFor({ synced, gm: s.amGM(), full, empty: s.emptyBoard(), owns, free: asking && !owns ? s.claimable().length : 0, busy: drawer.id !== null, offered });
    if (step) {
      offered.push(step);
      if (step === 'start') drawer.open('start', startSheet(ctx));
      else if (step === 'character') drawer.open('character', characterSheet(ctx));
      else notice.say('Ask the GM for a character to move. Until then: look around, measure, roll dice.');
    }
    const mode = s.mode(), armed = s.armed();
    when(mode === 'build' && !armed, 'build', 'Tap a piece to change it. Pieces puts one in hand.');
    when(armed, 'brush', 'One finger places, two fingers move the camera.');
    when(mode === 'play' && s.mine(), 'mini', 'Drag a figure to move it. The dock shows what else it can do.');
    when(s.dice.count() > 0, 'dice', 'Dice in hand: drag on the table and let go to throw.');
  }
  return { update };
}
