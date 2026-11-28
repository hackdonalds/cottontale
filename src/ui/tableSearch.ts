// The search at the top of the Table drawer: one field that finds actions, settings, pages,
// boards and pieces, so a feature needs a name here rather than a slot in the dock. The
// entries are made from the session each time the list is drawn, so they say what this seat
// may do right now; what answers a search is decided in ui/commands.ts (pure).

import './commands.css';
import type { Sky } from '../board';
import { BLOCK_SHELVES, MINI_SHELVES, PROP_SHELVES } from '../catalog';
import { buzz, canBuzz, hapticsOn, setHaptics } from '../haptics';
import { atmo, setAtmo } from '../theme';
import { armKey, type Ctx } from './buildSheets';
import { searchCommands, type Command, type CommandGroup } from './commands';
import { esc, h, ico } from './dom';
import { face, nameOf } from './face';
import { fold } from './library';
import { prepPages, type Prep } from './prep';

/** A result: what the search reads (Command), and what the row shows and does. */
interface Entry extends Command {
  icon: string;
  /** The picture of a piece, in place of the icon. */
  face?: string;
  /** A switch: where it stands ("on", "off"), said after the title. */
  state?: string;
  on?: boolean;
  /** Running it leaves the drawer open, and the row says what it did. */
  stays?: boolean;
  run(): void;
}
/** What only the Table drawer itself can do (ui/tableSheet.ts). */
export interface TableDoes { invite(): void; save(): void; load(): void }

const GM_ONLY = 'GM only', NO_DEVICE = 'Not on this device';
/** Words for the Prep pages beyond their title and hint. */
const PAGE_WORDS: Record<string, string[]> = {
  theme: ['mood', 'look', 'season', 'sky', 'light', 'setting'],
  sound: ['soundscape', 'music', 'ambience', 'effects', 'soundboard', 'recording'],
  import: ['photo', 'picture', 'model', 'token', 'standee', 'camera', 'upload'],
  packs: ['pieces', 'own pieces', 'library', 'delete'],
  rules: ['system', 'game', 'character sheet', 'stats'],
};
const SKIES: [Sky, string, string][] = [['day', 'Day', 'sun'], ['dusk', 'Dusk', 'sun'], ['night', 'Night', 'moon']];

export function tableSearch({ s, drawer, notice }: Ctx, prep: () => Prep | undefined, dock: (slot: string) => void) {
  let q = '';

  function entries(does: TableDoes): Entry[] {
    const full = s.full(), gm = s.amGM(), list: Entry[] = [];
    const add = (group: CommandGroup, id: string, title: string, icon: string, run: () => void, more: Partial<Entry> = {}) => { list.push({ id, title, group, icon, run, ...more }); };
    /** For whoever may change the table: the GM, or anyone while there is none. */
    const table = (ok = full, why = GM_ONLY): Partial<Entry> => (ok ? {} : { available: false, hint: why });
    const leaving = (f: () => void) => () => { drawer.close(); f(); };
    const toggle = (on: boolean): Partial<Entry> => ({ state: on ? 'on' : 'off', on, stays: true });

    // What the dock's slots do, from anywhere.
    add('Action', 'act:build', 'Build', 'cube', () => dock('build'), { keywords: ['mode', 'edit', 'place', 'construct'], ...table() });
    add('Action', 'act:play', 'Play', 'play', () => dock('play'), { keywords: ['mode', 'move figures'] });
    add('Action', 'act:pieces', 'Pieces', 'cube', () => dock('hand'), { keywords: ['library', 'blocks', 'things', 'figures', 'minis'], ...table() });
    add('Action', 'act:make', 'Generate a scene', 'spark', () => dock('make'), { keywords: ['make', 'random', 'dungeon', 'cave', 'wilderness', 'building', 'room', 'scatter', 'copy area', 'paste', 'light'], ...table(), ...(full ? { hint: 'Opens Make' } : {}) });
    add('Action', 'act:shape', 'Shape the land', 'hill', () => dock('shape'), { keywords: ['raise', 'lower', 'level', 'grow', 'terrain', 'hill', 'repaint'], ...table() });
    add('Action', 'act:erase', 'Erase', 'erase', () => dock('erase'), { keywords: ['rubber', 'remove', 'delete pieces'], ...table() });
    add('Action', 'act:fight', 'Fight', 'swords', () => dock('fight'), { keywords: ['initiative', 'turn order', 'combat', 'battle', 'tracker', 'damage', 'heal'] });
    add('Action', 'act:dice', 'Dice and chat', 'dice', () => dock('dice'), { keywords: ['roll', 'd20', 'd6', 'coin', 'message', 'say', 'whisper', 'secret'] });
    add('Action', 'act:quick', 'Quick board', 'grid', () => dock('quick'), { keywords: ['soundboard', 'soundscape', 'ambience', 'sky', 'add a figure'], ...table() });
    add('Action', 'act:tools', 'Tools', 'ruler', () => dock('tools'), { keywords: ['ruler', 'fog', 'floors', 'line of sight', 'ping'] });
    add('Action', 'act:ruler', 'Ruler', 'ruler', () => dock('ruler'), { keywords: ['measure', 'distance', 'radius', 'cone', 'range', 'template'] });
    add('Action', 'act:fog', 'Fog brush', 'fog', leaving(() => { s.setTool('fog'); notice.say('Drag to hide an area from the players.'); }), { keywords: ['hide', 'cover', 'fog of war', 'darkness'], ...table(gm) });
    const c = s.cutState(), floors = c.level === Infinity ? 'All floors' : `Up to ${c.level}`, FLOORS = ['floors', 'cutaway', 'roof', 'inside', 'storey', 'upstairs'];
    add('Action', 'act:floorDown', 'Hide upper floors', 'down', () => s.cut('down'), { keywords: [...FLOORS, 'floor down'], hint: floors, stays: true });
    add('Action', 'act:floorUp', 'Show more floors', 'up', () => s.cut('up'), { keywords: [...FLOORS, 'floor up'], hint: floors, stays: true });
    add('Action', 'act:floorAuto', 'Floors follow the figure', 'pawn', () => s.cut('auto'), { keywords: [...FLOORS, 'auto'], hint: floors, ...toggle(c.auto) });
    add('Setting', 'set:los', 'Line of sight', s.los() ? 'eye' : 'eyeoff', () => s.setLos(!s.los()), { keywords: ['vision', 'see', 'fog', 'hidden'], ...toggle(s.los()), ...table(), ...(full ? { hint: 'Players see only what their figures can' } : {}) });

    // The table: people, boards, the scene, the file.
    add('Action', 'act:invite', 'Invite someone', 'link', does.invite, { keywords: ['share', 'link', 'join', 'players', 'friends', 'add'], stays: true });
    add('Action', 'act:gm', gm ? 'Stop being the GM' : 'Become the GM', 'crown', () => { s.setGM(!gm); }, { keywords: ['gm', 'game master', 'dm', 'referee', 'role', 'step down'], on: gm, stays: true });
    add('Action', 'act:newBoard', 'New board', 'map', leaving(() => s.newBoard(false)), { keywords: ['add board', 'map', 'empty'], ...table() });
    add('Action', 'act:copyBoard', 'Copy this board', 'copy', leaving(() => s.newBoard(true)), { keywords: ['duplicate', 'new board', 'map'], ...table() });
    const active = s.activeBoard(), here = s.here(), boards = s.boardList();
    if (boards.length > 1) for (const b of boards) {
      add('Action', `board:${b.id}`, `Look at ${b.n}`, 'eye', leaving(() => s.lookAtBoard(b.id)), { keywords: ['board', 'go to', 'switch', 'map'], ...table(), ...(full ? (b.id === here ? { available: false, hint: 'You are here' } : { hint: 'Players stay where they are' }) : {}) });
      add('Action', `bring:${b.id}`, `Bring everyone to ${b.n}`, 'play', leaving(() => s.bringEveryone(b.id)), { keywords: ['board', 'go to', 'switch', 'map', 'move players'], ...table(), ...(full && b.id === active ? { available: false, hint: 'The players are here' } : {}) });
    }
    const fogged = [...s.store.keys('f:')].length > 0, fighting = s.fight().order.length > 0;
    add('Action', 'act:reveal', 'Reveal all', 'sun', leaving(() => s.revealAll()), { keywords: ['fog', 'uncover', 'show everything', 'clear fog'], ...table(), ...(full && !fogged ? { available: false, hint: 'Nothing is hidden' } : {}) });
    add('Action', 'act:endFight', 'End fight', 'x', leaving(() => s.endFight()), { keywords: ['combat', 'initiative', 'stop', 'turn order', 'over'], ...table(), ...(full && !fighting ? { available: false, hint: 'No fight is on' } : {}) });
    const sky = atmo<Sky>(s.store, 'sky', 'day');
    for (const [id, name, icon] of SKIES) add('Action', `sky:${id}`, `Sky: ${name}`, icon, leaving(() => setAtmo(s.store, 'sky', id)), { keywords: ['time of day', 'light', 'dark', 'weather'], on: id === sky, ...table() });
    add('Action', 'act:starter', 'Starter scene', 'tree', leaving(() => { s.starterScene(); notice.say('A cottage in a clearing. Undo takes it away.'); }), { keywords: ['example', 'demo', 'cottage', 'sample'], ...table() });
    add('Action', 'act:clear', 'Clear this board', 'trash', leaving(() => s.clearBoard()), { keywords: ['empty', 'wipe', 'delete everything', 'start over'], ...table(), ...(full ? { hint: 'Undo brings it back' } : {}) });
    add('Action', 'act:save', 'Save to a file', 'save', does.save, { keywords: ['export', 'backup', 'download'], stays: true });
    add('Action', 'act:load', 'Load a file', 'open', does.load, { keywords: ['import', 'restore', 'open', 'upload'], stays: true, ...table() });
    add('Action', 'act:leave', 'Leave', 'door', () => void s.leave(), { keywords: ['exit', 'quit', 'lobby', 'log out', 'go away'], hint: 'Back to the front door' });

    // This device.
    const own = (ok = true): Partial<Entry> => (ok ? { hint: 'This device' } : { available: false, hint: NO_DEVICE });
    add('Setting', 'set:sound', 'Sound', s.sound.enabled ? 'sound' : 'mute', () => s.setSound(!s.sound.enabled), { keywords: ['mute', 'audio', 'volume', 'music', 'noise', 'quiet'], ...toggle(s.sound.enabled), ...own() });
    add('Setting', 'set:buzz', 'Vibration', 'buzz', () => { setHaptics(!hapticsOn()); buzz(20); }, { keywords: ['haptics', 'buzz', 'rumble'], ...toggle(hapticsOn()), ...own(canBuzz()) });
    add('Setting', 'set:ambient', 'Ambient motion', 'tree', () => s.setLocal('ambient', !s.local.ambient), { keywords: ['animation', 'reduce motion', 'sway', 'wind', 'battery'], ...toggle(s.local.ambient), ...own() });
    add('Setting', 'set:follow', 'Follow turns', 'next', () => s.setLocal('follow', !s.local.follow), { keywords: ['camera', 'fight', 'whose turn'], ...toggle(s.local.follow), ...own() });
    add('Setting', 'set:shake', 'Shake to roll', 'buzz', () => s.dice.setShake(!s.dice.shake), { keywords: ['dice', 'throw', 'motion sensor'], ...toggle(s.dice.shake), ...own(s.dice.canShake()) });

    // The pages for getting a table ready.
    const pr = prep();
    for (const p of prepPages()) if (p.listed !== false) add('Page', `page:${p.id}`, p.title, p.icon, () => { drawer.close(); pr?.open(p.id); }, { keywords: [...(p.hint ? [p.hint] : []), ...(PAGE_WORDS[p.id] ?? []), 'prep', 'prepare'], hint: p.hint, ...table(full && !!pr) });

    // Every piece this table has, by the shelf it is on (as the library lists them).
    const seen = new Set<string>();
    for (const [kind, shelves] of [['b', BLOCK_SHELVES], ['p', PROP_SHELVES], ['m', MINI_SHELVES]] as const) for (const [shelf, ids] of Object.entries(shelves)) for (const id of ids) {
      const key = `${kind}_${id}`, name = nameOf(key);
      if (name === null || seen.has(key)) continue;
      seen.add(key);
      add('Piece', `piece:${key}`, name, 'cube', leaving(() => { s.setMode('build'); armKey(s, key); }), { keywords: [shelf], face: face(key), hint: shelf, ...table() });
    }
    return list;
  }

  return {
    /** Put the field and its results at the top of the drawer's body. While something is typed, the rest of the body is hidden (commands.css). */
    mount(body: HTMLElement, does: TableDoes): void {
      const list = h('div', { class: 'cmd-list', role: 'list' });
      const row = (e: Entry) => {
        const off = e.available === false;
        return h('button', {
          type: 'button', class: `cmd${e.on ? ' on' : ''}`, 'data-cmd': e.id, disabled: off, 'aria-pressed': e.on === undefined ? undefined : String(e.on),
          html: `${e.face ?? ico(e.icon)}<span><b>${esc(e.title)}${e.state ? `: ${e.state}` : ''}</b><small>${esc([e.group, e.hint].filter(Boolean).join(' · '))}</small></span>`,
          onclick: () => { e.run(); if (e.stays && list.isConnected) fill(); },
        });
      };
      const fill = () => {
        const on = !!fold(q);
        list.classList.toggle('on', on);
        clear.hidden = !q;
        if (!on) return list.replaceChildren();
        const found = searchCommands(entries(does), q);
        list.replaceChildren(...(found.length ? found.map(row) : [h('p', { class: 'hint', text: `Nothing called “${q.trim()}”. Try “dice”, “board” or the name of a piece.` })]));
      };
      const input = h('input', {
        type: 'search', maxlength: 40, placeholder: 'Search actions, settings, pieces…', 'aria-label': 'Search the table', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', value: q,
        oninput: () => { q = input.value; fill(); body.scrollTop = 0; }, onkeydown: (e) => { if ((e as KeyboardEvent).key === 'Enter') input.blur(); }, // Enter puts the keyboard away: the results are the thing to look at
      });
      const clear = h('button', { type: 'button', title: 'Clear the search', 'aria-label': 'Clear the search', html: ico('x'), hidden: true, onclick: () => { q = input.value = ''; fill(); drawer.redraw(); } });
      body.prepend(h('div', { class: 'cmd-q' }, input, clear), list);
      // The drawer is not redrawn while its field has the focus (so typing is never lost): a finger on the sections gives the focus up, so they keep up with the table.
      body.onpointerdown = (e) => { if (document.activeElement === input && !(e.target as HTMLElement).closest('.cmd-q, .cmd-list')) input.blur(); }; // (a property: the body outlives what is drawn in it)
      fill();
    },
  };
}
