// What the dock shows. The dock is the only navigation, and it never grows: whatever state
// the table is in, it holds at most six slots, and a new state swaps them for others.
// Pure, so every state can be checked (dockFor.test.ts) before any of it is drawn.

export type Role = 'gm' | 'player' | 'display';
export type Mode = 'play' | 'build';
/** What is selected: nothing, a mini that is ours to change, a mini we may only look at, or pieces of the scene. */
export type Sel = 'none' | 'mini' | 'theirs' | 'piece';

export interface DockState {
  role: Role;
  mode: Mode;
  sel: Sel;
  /** A brush is in hand (Build): its name, and what kind of brush it is. */
  armed?: { name: string; turns: boolean; sized: boolean; erasing: boolean; sampling: boolean; size: number };
  /** Move was tapped: the next touch says where the selection goes. */
  placing?: boolean;
  /** The table plays by a rules system, so there are character sheets. */
  sheets?: boolean;
  /** The selected mini is hidden from the players. */
  hidden?: boolean;
}

export interface Slot {
  /** What a tap does (see ui/dock.ts). */
  id: string;
  label: string;
  /** A drawing from the icon set in index.html. */
  icon: string;
  /** Lit: this is the state the table is in. */
  on?: boolean;
  /** There, in its usual place, but not for what is in hand. */
  off?: boolean;
}

export const MAX_SLOTS = 6;
const slot = (id: string, label: string, icon: string, more: Partial<Slot> = {}): Slot => ({ id, label, icon, ...more });
const DONE = slot('done', 'Done', 'check');

export function dockFor(s: DockState): Slot[] {
  if (s.role === 'display') return []; // the table screen has no chrome at all
  const gm = s.role === 'gm';
  // A mini that is not ours: look, do not touch.
  if (s.sel === 'theirs') return [slot('details', 'Details', 'list'), DONE];
  // Build with something selected: what you can do to it, where it stands.
  if (gm && s.mode === 'build' && s.sel !== 'none') {
    return [
      slot('move', 'Move', 'move', { on: !!s.placing }), slot('turn', 'Turn', 'turn'), slot('copy', 'Duplicate', 'copy'),
      slot('remove', 'Delete', 'trash'), slot('more', 'More', 'more'), DONE,
    ];
  }
  if (s.sel === 'mini') {
    return [
      slot('hp', 'HP', 'heart'), slot('conditions', 'Conditions', 'flag'),
      ...(gm ? [slot('hide', s.hidden ? 'Hidden' : 'Hide', s.hidden ? 'eyeoff' : 'eye', { on: !!s.hidden })] : []),
      ...(s.sheets ? [slot('sheet', 'Sheet', 'sheet')] : []),
      slot('more', 'More', 'more'), DONE,
    ];
  }
  if (!gm) {
    return [
      slot('dice', 'Dice', 'dice'), ...(s.sheets ? [slot('sheet', 'Sheet', 'sheet')] : []),
      slot('ruler', 'Ruler', 'ruler'), slot('chat', 'Chat', 'chat'), slot('table', 'Table', 'table'),
    ];
  }
  if (s.mode === 'build' && s.armed) {
    const a = s.armed;
    return [
      slot('hand', a.name, 'cube'), slot('rot', 'Turn', 'turn', { off: !a.turns }),
      slot('size', `Size ${a.size}`, 'grow', { off: !a.sized }), slot('sample', 'Pick', 'pick', { on: a.sampling }),
      slot('erase', 'Erase', 'erase', { on: a.erasing }), DONE,
    ];
  }
  if (s.mode === 'build') {
    return [
      slot('play', 'Play', 'play'), slot('pieces', 'Pieces', 'cube'), slot('make', 'Make', 'spark'),
      slot('shape', 'Shape', 'hill'), slot('erase', 'Erase', 'erase'), slot('table', 'Table', 'table'),
    ];
  }
  return [
    slot('build', 'Build', 'cube'), slot('fight', 'Fight', 'swords'), slot('dice', 'Dice', 'dice'),
    slot('quick', 'Quick', 'grid'), slot('tools', 'Tools', 'ruler'), slot('table', 'Table', 'table'),
  ];
}
