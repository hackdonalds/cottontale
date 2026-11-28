// Table: the one slot for everything that is not the table itself. One list, in a full-height
// drawer, where each feature has a single home: people and inviting, boards, the Prep pages
// (theme, sound, pieces, rules), this device's settings, and saving or leaving.

import { buzz, canBuzz, hapticsOn, setHaptics } from '../haptics';
import { btn, h } from './dom';
import type { Ctx } from './buildSheets';
import type { DrawerOpts } from './drawer';
import { prepPages, type Prep } from './prep';
import { tableSearch } from './tableSearch';

/** `dock` runs what a slot of the dock does, by its id (ui/dock.ts): the search reaches them all. */
export function tableSheet(ctx: Ctx, prep: () => Prep | undefined, dock: (slot: string) => void): DrawerOpts {
  const { s, drawer, notice } = ctx;
  let asking = '';
  const search = tableSearch(ctx, prep, dock);
  return {
    title: 'Table', height: 'full',
    render(body) {
      const full = s.full(), gm = s.amGM();
      const head = (t: string) => h('h3', { text: t });
      const share = async () => {
        try { if (navigator.share) await navigator.share({ title: 'Cottontale', text: 'Join my table!', url: s.invite }); else { await navigator.clipboard.writeText(s.invite); notice.say('Invite link copied. Anyone with it can join.'); } }
        catch { notice.say('Could not share the link. It is in the address bar.'); }
      };
      // People
      const gms = s.gmIds();
      body.append(head('People'),
        h('div', { class: 'chips' }, ...s.people().map((p) => h('span', { class: 'person', style: `--c:${p.color}`, text: `${p.name}${gms.includes(p.id) ? ' · GM' : ''}${p.id === s.meId ? ' (you)' : ''}` }))),
        h('div', { class: 'chips' },
          btn('Invite someone', () => void share(), { icon: 'link', cls: 'primary' }),
          btn(gm ? 'Stop being the GM' : 'Become the GM', () => { s.setGM(!gm); }, { icon: 'crown', on: gm }),
        ),
        h('p', { class: 'hint', text: gms.length ? 'The GM builds, hides things and moves every figure. Players move their own.' : 'Nobody is the GM, so everyone can build. Become the GM to keep the table yours.' }),
      );
      // Boards
      const active = s.activeBoard(), here = s.here();
      body.append(head('Boards'));
      for (const b of s.boardList()) {
        const name = h('input', { maxlength: 24, 'aria-label': 'Board name', value: b.n, disabled: !full || !b.id, onchange: () => s.renameBoard(b.id, name.value) });
        body.append(h('div', { class: `line${b.id === here ? ' now' : ''}` }, name,
          b.id === active ? h('small', { text: 'players here' }) : null,
          full && b.id !== here && btn('', () => s.lookAtBoard(b.id), { icon: 'eye', title: 'Look at it yourself (players stay where they are)' }),
          full && b.id !== active && btn('', () => s.bringEveryone(b.id), { icon: 'play', title: 'Bring everyone here' }),
          full && !!b.id && btn('', () => { asking = asking === b.id ? '' : b.id; drawer.redraw(); }, { icon: 'trash', title: 'Delete this board', on: asking === b.id }),
        ));
        if (asking === b.id) body.append(h('div', { class: 'chips' }, btn(`Delete “${b.n}” and everything on it`, () => { asking = ''; s.deleteBoard(b.id); }, { cls: 'hurt' }), btn('Keep it', () => { asking = ''; drawer.redraw(); })));
      }
      if (full) body.append(h('div', { class: 'chips' }, btn('New board', () => s.newBoard(false), { icon: 'map' }), btn('Copy this one', () => s.newBoard(true), { icon: 'copy' })));
      // The Prep pages: theme, sound, pieces, rules
      const pr = prep();
      if (pr && full) {
        body.append(head('Prepare'));
        for (const p of prepPages()) if (p.listed !== false) body.append(h('button', { type: 'button', class: 'rowlink', html: `<svg><use href="#i-${p.icon}"/></svg><span><b>${p.title}</b><small>${p.hint ?? ''}</small></span>`, onclick: () => { drawer.close(); pr.open(p.id); } }));
      }
      // This device
      body.append(head('This device'), h('div', { class: 'chips' },
        btn(`Sound: ${s.sound.enabled ? 'on' : 'off'}`, () => { s.setSound(!s.sound.enabled); }, { icon: s.sound.enabled ? 'sound' : 'mute', on: s.sound.enabled }),
        canBuzz() && btn(`Vibration: ${hapticsOn() ? 'on' : 'off'}`, () => { setHaptics(!hapticsOn()); buzz(20); drawer.redraw(); }, { icon: 'buzz', on: hapticsOn() }),
        btn(`Ambient motion: ${s.local.ambient ? 'on' : 'off'}`, () => s.setLocal('ambient', !s.local.ambient), { icon: 'tree', on: s.local.ambient }),
        btn(`Follow turns: ${s.local.follow ? 'on' : 'off'}`, () => s.setLocal('follow', !s.local.follow), { icon: 'next', on: s.local.follow }),
      ));
      // The whole table
      const file = h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: () => { const f = file.files?.[0]; if (f) void f.text().then((t) => { if (s.importTable(t)) notice.say('Table loaded.'); }); file.value = ''; } });
      const save = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(s.exportTable()); a.download = 'cottontale-table.json'; a.click(); URL.revokeObjectURL(a.href); };
      body.append(head('Save and load'), file, h('div', { class: 'chips' },
        btn('Save to a file', save, { icon: 'save' }),
        full && btn('Load a file', () => file.click(), { icon: 'open' }),
        full && btn('Clear this board', () => { s.clearBoard(); drawer.close(); }, { icon: 'trash', title: 'Take everything off this board (Undo brings it back)' }),
        btn('Leave', () => void s.leave(), { icon: 'door' }),
      ));
      body.append(head('Help'), h('p', { class: 'hint', html: 'One finger: look around, or use what is in hand. Two fingers: pan, pinch to zoom, twist to turn.<br>In Build, tap a piece to move, turn, copy or delete it. Pieces puts one in hand; Done puts it down.<br>Press and hold the table to ping. Dice: pick them up, drag on the table, let go.' }));
      // One search over all of it, and over what has no row here: it goes on top, and takes the sections' place while something is typed.
      search.mount(body, { invite: () => void share(), save, load: () => file.click() });
    },
  };
}
