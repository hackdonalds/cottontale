# Cottontale UI redesign plan

Clean-slate chrome for a GM running everything from a phone. Built from the
research in `reports/Mobile first VTT UX research.md`, the audit in
`research_notes/Mobile first VTT UX research/current_ui_audit.md`, and the
owner's answers in two interviews.

## Decisions taken

| Topic | Decision |
|---|---|
| Primary user | GM on a phone; players on phones second |
| Structure | Two table states, **Play** and **Build**, switched from the dock, plus one **Table** slot that opens full-screen pages. Prep stops being a mode; the ☰ menu is removed |
| Navigation | The dock is the only navigation, and the selected thing decides what it shows |
| Build, one finger | Select-first: tap a piece selects it, drag on empty ground moves the camera. Picking a piece arms the brush; one finger paints until Done |
| Ring and gestures | No ring. Labelled dock actions only. Undo and Redo are visible buttons. "A second finger never edits" stays absolute; long-press is only ever a shortcut |
| Roles | Whoever starts a table is its GM. "Everyone can build" is a table setting, off by default |
| Encounter tracking | Generic HP, initiative and conditions always work; a rules system adds to them |
| Player movement | Free drag with live distance; every move is undoable |
| Play, first version | Encounter sheet, GM quick board, room/region fog reveal, TV table-display role |
| Delivery | Big-bang: new chrome on a branch beside the old, e2e rewritten once, switched over when complete |

## Screen budget (the rule that drives every layout choice)

The table is the product; chrome rents space from it. On the smallest screen
(360 × 640 portrait, 640 × 360 landscape) every state must fit this budget, and
e2e measures it in `layout()`:

| State | Table left visible |
|---|---|
| Nothing open | ≥ 85% of the screen |
| Something selected, or brush armed | ≥ 80% (the dock swaps, it does not grow) |
| Sheet at peek (hotbar, turn strip) | ≥ 70% |
| Sheet at half | ≥ 45% |

How the design meets it:

- **No top bar.** Nothing is pinned to the top edge; the dock is the only permanent chrome, one row of 48px slots plus the safe area.
- **Swap, never add.** A new state replaces the dock's slots; it never adds a second row, a floating panel or a ring over the table.
- **Chrome appears only while it is useful.** Undo/Redo show in Build and for a few seconds after an undoable action in Play; the turn strip exists only during a fight; notices are one line and fade; hints likewise.
- **Icons with short labels in the dock, values on the piece.** HP, conditions and distance are drawn at the mini, not in a panel.
- **Landscape phone:** the dock becomes a vertical rail on the thumb side and sheets open as a side panel, so the short axis is never spent on chrome.
- **Larger screens** get more table, not more chrome: the same dock, with sheets as side panels that leave the table interactive.
- **Dense content goes full-screen** (Table pages, forms, the library at full), where it can use the whole screen instead of squeezing beside the table.

## Target design

### The dock, by state (five or six slots, always)

| State | Slots |
|---|---|
| GM · Play · nothing selected | Play/Build switch · Fight · Dice · Quick · Tools (ruler templates, fog brush, chat, ping) · Table |
| GM · Play · mini selected | HP · Conditions · Hide · Sheet · More (shoot, shove, emote, owner, delete) · Done |
| GM · Build · nothing selected | Play/Build switch · Pieces · Make (room, generate, scatter, paste) · Shape (raise, lower, level, repaint) · Erase · Table |
| GM · Build · brush armed | Current piece (tap opens the library) · Turn · Size · Pick from scene · Erase · Done |
| GM · Build · piece selected | Move · Turn · Duplicate · Delete · More (repaint, select area; for a mini: name, HP, owner) · Done |
| Player | Dice · Sheet · Ruler · Chat · Table (reduced) |
| Display (TV) | no dock |

Outside the dock, and only while useful (see the screen budget): **Undo / Redo**
(a small pair at the edge above the dock), the **turn strip** (compact, on the
edge, Next within thumb reach, during a fight only), and **notices** (one fading
line on the table, replacing system lines in the closed log).

### Build

- **Select and manipulate** every placed thing: blocks, walls, props, loose pieces, minis. "Select area" (today's copy marquee) gives group Move, Duplicate, Delete.
- **Hotbar**: the library sheet at peek is the hotbar (recent and pinned pieces). Tapping the current piece opens the library. One search covers every category.
- **Categories** re-cut: Ground · Walls and doors · Things · Figures. Generation and prefabs move to Make.
- **Minis are finished where they are placed**: name, HP, owner in the selected-mini dock, in Build as in Play.
- **Undo covers every write** (minis, starter scene, clear, reveal all, end fight), with a notice naming what was undone. No `confirm()`, `prompt()` or `alert()` left.
- **Generate** rerolls layout and furnishing separately, pins anything the GM touched, and is one undo step.
- The level stepper says that it also caps placement.

### Play

- **Encounter sheet** (Fight): Start fight, add all or selected minis, roll all, drag to reorder, a list with HP and condition chips, damage or heal typed on a keypad and applied to one or several, End fight undoable.
- **Selected mini** leads with HP (same keypad), Conditions, Hide.
- **Quick board**: a one-tap grid for boards, soundboard, reveal, add a monster. It does not fold when the table is touched. Pins are stored table-wide.
- **Fog**: tap a room or region to reveal or hide it; the brush stays as the override; "See as players" preview; Reveal all undoable.
- **Distance while dragging** a mini; the ruler is only for templates.
- **Roll from the character sheet** without closing it.
- **Display role**: a device joins as "the table screen": no chrome, the party's combined view, a QR code to join, and the GM can push their camera to it.

### Table pages (the old menu and Prep, one home each)

Boards · Theme · Sound · Pieces (import, packs, models) · Rules · People (invite link and QR, GM, everyone-can-build, display) · Settings (line of sight, follow, relays, left-hand dock) · Save and load · Help.
A search field at the top finds pieces, actions and settings.

### Onboarding

- Lobby splits into **Start a table** and **Join**; relays and keys behind "Advanced".
- A new table asks for a theme (a few large cards) and opens on a generated scene with Reroll visible.
- A joining player gives a name and colour, then picks their character from the unowned minis.
- Hints appear one at a time, in context, once per device. No tour.
- Tools a role cannot use are shown disabled with the reason.

## Architecture

Unchanged: `store`, `net`, `rules`, `gen`, `system`, `theme`, `packs`, `blob`, `sound(s)`, `registry`, `catalog`, `library`, the Prep page modules, `ui/sheets.ts`, `ui/sheet.ts`.

**`src/main.ts`** shrinks from one 1,620-line closure to wiring. New modules in `src/ui/`:

| Module | Job | Pure part to unit-test |
|---|---|---|
| `dock.ts` | renders the dock from `dockFor(role, mode, selection, armed)` | `dockFor` — every state has ≤ 6 slots |
| `selection.ts` | selected-piece actions for Build and Play | — |
| `encounter.ts` | the Fight sheet and turn strip | `fight.ts`: add, order, damage, conditions |
| `quick.ts` | quick board | pin list parse (`set:quick`, untrusted) |
| `fogRooms.ts` | room reveal UI | `regions()` in `rules.ts`: flood fill bounded by walls and blocks |
| `tablePages.ts` | Table shell (reuses `prep.ts`) and search | search index |
| `lobby.ts`, `hints.ts`, `notice.ts`, `display.ts` | onboarding, hints, notices, TV role | hint sequencing |

**`src/board.ts`** (the only engine work):
1. A `select` tool for Build: hit-test any piece kind, drag-on-empty moves the camera, drag-on-selection moves the piece.
2. Move, turn, duplicate, delete for a selection or an area, as ordinary undoable edits.
3. Mini place, move and delete go on the undo stack.
4. Live distance label during a mini drag.
5. Region highlight for fog; a `display` view mode (combined vision, no input).

Still render-on-demand; no per-instance geometry or materials; selection highlight is one shared outline mesh.

**Store**: new table-wide keys `set:free` (everyone can build) and `set:quick`; a `disp` flag in presence. Existing tables with no GM open as free play, so nothing migrates.

## Progress

- **Step 1, shell — done.** `src/session.ts` (the table without chrome), `src/app.ts`, the dock (`src/ui/dockFor.ts`, tested, and `src/ui/dock.ts`), notices, the Undo / Redo pair, portrait row and landscape rail. Reached with `?ui=2`; the old chrome is untouched and still the default.
- **Step 2, board work — done.** The `pick` tool (select first), move by drag or by Move-then-tap, turn, duplicate, delete (`src/pick.ts`, tested), mini placement and moves on the undo stack, distance while a mini is carried, pick-from-scene.
- Checked by `node scripts/e2e2.mjs` on 360 × 640 and 640 × 360: every dock state fits the screen budget.
- **Steps 3–5, first pass — done.** Every dock slot now opens something real, in a drawer (`src/ui/drawer.ts`) that swaps and never stacks:
  - Build: the library with one search over every piece and recents (`src/ui/buildSheets.ts`), Make (rooms, scenes with reroll and room locks, scatter, copy/paste, slab codes), Shape, and More for a piece.
  - Play (`src/ui/playSheets.ts`): the Fight tracker with the turn strip, hit points by number pad for one or several figures, dice and chat with an unread badge, figure details, Tools (ruler and fog bring their own dock), the quick board.
  - Table (`src/ui/tableSheet.ts`): people and invite, boards, the Prep pages (theme, sound, import, packs, rules), device settings, save/load/clear, help. Character sheets and rules scripts are wired in.
- **Select area in Build — done.** Make → "Select an area" (or More → "Select area") swaps the dock for `Area · Done`; one finger drags the marquee and everything standing in it is selected (the ground under it joins with More → "With the ground"). Move, Turn (the whole area about its middle), Duplicate (a footprint over) and Delete each take one Undo. Checked by `node scripts/e2e2-area.mjs`.
- **Still to do:** drag-to-reorder in the fight, room/region fog reveal and "see as players", select-area in Build, a pinned hotbar row, search over actions and settings, the new lobby and creator-is-GM (step 6), the TV display role (step 7), and the switch-over with the old chrome removed (step 8).

## Build order (one branch, switched over at the end)

1. **Shell**: new `index.html` and base CSS (portrait phone first), `dockFor` with tests, notices, Undo/Redo pair. Old chrome still the default; new one behind `?ui=2`.
2. **Board work**: items 1–4 above, with unit tests where pure.
3. **Build mode**: hotbar and library, armed brush, selection dock, Make and Shape, re-cut categories.
4. **Play mode**: selected-mini dock, keypad, Fight sheet and turn strip, quick board, room fog, player dock.
5. **Table pages**: move every menu row and Prep page to its one home; search; settings.
6. **Lobby and roles**: Start/Join, creator is GM, `set:free`, theme-then-generate first run, character claim, hints.
7. **Display role**.
8. **Switch over**: rewrite the phone section of `scripts/e2e.mjs` (new `layout()` states for every dock state, both orientations), delete the old chrome and the flag, update `CLAUDE.md`, check bundle size and the lazy-load request log.

Each step ends with `npm test` and a phone-viewport check; `npm run build && npm run e2e` is green again at step 8.

## Risks

- **Untested on a real phone GM.** No product does this, so select-first Build, the Fight sheet layout and the dock slots are informed guesses. Steps 3 and 4 should each be tried in a real session before step 8.
- **Select-first changes muscle memory**: painting now needs a piece picked first. Mitigation: the last brush re-arms with one tap on the hotbar.
- **Block selection granularity**: a tap selects one block; rooms as resizable objects are left for later.
- **e2e is red on the branch** until step 8 (about 190 taps on 116 selectors to rewrite). Unit tests carry the branch until then.
- **Six slots are tight** for GM Play; Tools is the overflow, and what sits in it should be revisited after the first session.

## Not in this redesign

Rooms as resizable objects · tap-destination movement · two-finger-tap undo · user-chosen control schemes.
