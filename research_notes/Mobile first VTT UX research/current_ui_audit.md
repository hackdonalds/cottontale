# Cottontale — current UI/UX audit (code inventory)

Read-only audit of the chrome as it stands, for planning a clean-slate redesign. Primary persona: a GM running everything from a phone (portrait, 390×844 is the e2e reference).
All references are `file:line`. "Full powers" = the GM, or anyone on a table with no GM (`fullPowers`, `src/rules.ts:94`).

Sizes: `index.html` 305 lines · `src/main.ts` 1746 lines / 100 KB · `src/board.ts` 2836 lines / 138 KB · `src/style.css` 485 lines / 38 KB · `src/ui/*` about 3,700 lines · `scripts/e2e.mjs` 2463 lines.

---

## 1. Screen anatomy (phone portrait)

All chrome is static DOM in `index.html`, positioned absolutely inside `#hud` (`index.html:95`, `style.css:46`).

| Region | Element | What it holds | Ref |
|---|---|---|---|
| Top bar | `#top` | rabbit (hidden < 480px), relay status dot, player pills (crown = GM), mode switch `#modes`, `#menuBtn` ☰ | `index.html:96-107`, `style.css:49-110` |
| Dropdown | `#menu` | 15 rows + help text; scrolls | `index.html:108-125`, `style.css:60` |
| Under top bar | `#strips` → `#prep` banner, `#init` turn strip | "Preparing X — players are on Y" + Bring everyone / back; round, order chips, next turn, end fight | `index.html:129-142`, `style.css:171-180` |
| Right edge, top | `#edits` (Build only) | Erase, Undo | `index.html:152-155`, `style.css:188` |
| Right edge, 38% | `#floors` (always) | cutaway up / Auto / down | `index.html:145-149`, `style.css:183` |
| Floating on table | `#ring` | radial actions around the selected mini | `index.html:158`, `main.ts:1261-1358` |
| Floating on table | `#break` | "🔨 Break" over a tapped wall/thing (created in JS) | `src/breakui.ts:6-25` |
| Centre | `#toast` | big roll result, 1.6 s | `index.html:291`, `main.ts:403-407` |
| Bottom dock `#dock` (stacked column) | `#palette` | Build tray (chips row + tiles row) or Ruler/Fog chips | `index.html:162`, `main.ts:748-924` |
| | `#minipanel` | full mini editor (only on "More") | `index.html:164-195` |
| | `#start` | empty-table card, four choices | `index.html:197-205`, `main.ts:1642-1659` |
| | `#tools` | the 5 dock slots | `index.html:207-218` |
| Above dock | `.sheet` ×7 | one at a time | `index.html:221-290` |
| Full screen | `#prepPages` | Prep pages | `index.html:294-300` |

Landscape phone (`style.css:329-357`): dock becomes one row (tools left, tray right), sheets dock to the right (`min(340px, 50%)`), cutaway moves to top-left as a row.
Desktop ≥ 900px (`style.css:360-382`): tools are a left column, sheets a 320px right column, the log is always visible and `#logToggle` is hidden.

---

## 2. Modes

Three "modes", but only two are real states. There is no `mode` variable: mode is derived from the board tool (`building = tool === 'build' || 'mini'`, `main.ts:639`).

- **Switch:** segmented control `#modes` in the top bar (`index.html:102-106`), wired at `main.ts:674`. Play → `setTool('move')`; Build → `setCat(cat)` (last category); Prep → `prep.open()`.
- `#modes` carries `data-gm`: **players at a GM'd table never see the mode switch** (`style.css:390`).
- The switch sits at the top of the screen, out of thumb reach, despite the "bottom dock, thumb reach" rule in CLAUDE.md.
- Prep never shows as "on" in the segmented control (`main.ts:651` only toggles play/build); it is a full-screen overlay with its own history stack.
- Leaving Build always lands on Move, deselects, and closes the library (`main.ts:640-657`, `board.ts:1927-1942`).

### Dock contents per mode (`#tools`, `index.html:207-218`; filtered at `main.ts:646-650`)

| Mode | Slots | Notes |
|---|---|---|
| Play (GM) | Move · Measure · Fog · Dice · Sheet | Fog is `data-gmonly` — **hidden in free play**, shown only once someone is GM (`style.css:390`). Sheet only when a rules system is set (`style.css:394`). So 3–5 slots. |
| Play (player) | Move · Measure · Dice · (Sheet) | |
| Build | Land · Walls · Things · Figures · Scenes | These are library categories, not tools. Erase and Undo live on the right edge, not the dock. |
| Prep | no dock | `#hud.prepping > :not(#prepPages)` hides everything (`style.css:258`). |

The dock has no slot for: undo in Play, boards, turns, sound, invite, the mode switch itself.

### What sits above the dock

- Play + Move: nothing (ring floats on the piece). Empty table: `#start` card.
- Play + Measure: chips Distance / Radius / Cone, + Blast and Undo (GM, circle only), Put away (`main.ts:911-916`).
- Play + Fog: chips Hide / Reveal / Reveal all (`main.ts:918-920`).
- Build: the tray — row 1 chips (scrolls sideways), row 2 picture tiles (scrolls sideways). On small screens, picking a tile folds the tray to one row with a `.cur` button showing the piece in hand; tapping `.cur` re-opens the shelf (`main.ts:784-805`, `883-896`).

---

## 3. Build tray per category (`renderPalette`, `main.ts:748-896`)

Chips in order (left to right, horizontally scrolling):

| Category | Chips | Tiles | Ref |
|---|---|---|---|
| Land | 🔍 · Raise · Lower · Level · Grow · Size 1/3/5 · Repaint | 14 terrain blocks | `main.ts:821-828` |
| Walls | 🔍 · Stone room · Timber room · Turn | 21 Structures (5 edge walls + posts, doors, stairs, statues…) then 15 Building blocks | `main.ts:829-836` |
| Things | 🔍 · (Recent) · (Favourites) · (theme shelf) · Nature · Furniture · Dungeon · (pack shelves) · Turn · Light · Scatter (+ `× N` when scattering) | current shelf's props, or loose kinds | `main.ts:837-852` |
| Figures | 🔍 · (Recent) · (Favourites) · (theme) · Heroes · Folk · Beasts · Monsters · Markers · (packs) · Base colour | current shelf's minis | `main.ts:853-861` |
| Scenes | Generate… · Starter scene · Copy · Paste · Turn · Share · Import | none | `main.ts:862-871` |

Brushes are strings on `board.brush`: a block/prop id, or `raise | lower | level | grow | erase | room | copy | paste | light | pour` (`main.ts:663-669`, `board.ts:1738-1778`).

Library sheet `#lib` (`src/ui/hotbar.ts`): opened by the 🔍 chip; search box, star (pin mode), grid of the *current category only* — Recent, Favourites, then shelf by shelf (`hotbar.ts:127-156`). Search is per category (`hotbar.ts:144-149`): a barrel cannot be found from Land or Figures.

---

## 4. Tap paths (phone, GM, counted from the default screen: Play / Move, nothing open)

"+drag" = a gesture on the table. Counts are the best case.

### Building

| Action | Path | Taps |
|---|---|---|
| Raise ground | Build → (Land, Raise are defaults) → tap/drag table | 1 + gesture |
| Place a terrain block | Build → tile → tap table | 3 |
| Change block (shelf folded) | `.cur` → tile | 2 |
| Paint a surface without stacking | Build → Repaint chip → tile → drag | 3 + drag |
| Draw a wall | Build → Walls → (wall default) → tap/drag edges | 2 + gesture |
| Window / doorway | Build → Walls → `.cur` (if folded) → tile → tap edge | 4–5 |
| Whole room | Build → Walls → Stone/Timber room → drag floor | 3 + drag |
| Place a prop | Build → Things → shelf chip → tile → tap | 4–5 |
| Prop via search | Build → Things → 🔍 → type → tile → tap table | 5 + typing |
| Place a mini | Build → Figures → shelf chip → tile → tap | 4–5 |
| Name a mini / set HP / owner | (after placing) Play → tap mini → More (ring) → field | 3 + typing, **requires a mode switch** — Build deselects (`board.ts:1931`) |
| Erase | Build → Erase (right edge) → tap/drag | 3 |
| Delete a mini | Play → tap mini → More → trash | 3 (eraser never touches minis, `board.ts:2532-2540`) |
| Rotate next piece | Build → Walls/Things/Scenes → Turn chip | 3, and in Things the chip is after every shelf chip, usually scrolled off-screen (`main.ts:843-846`) |
| Rotate a placed prop | not possible — erase and place again | — |
| Move / select a placed block or prop | not possible (only Copy → Paste an area) | — |
| Duplicate | area only: Build → Scenes → Copy → drag marquee → tap to paste (auto-switches to paste, `main.ts:191-196`) | 3 + drag + 1 |
| Height | implicit: a piece lands on the face you tap. Cutaway level caps placement (`board.ts:2651`) | — |
| Cutaway / floors | right-edge stepper, always visible | 1 |
| Undo | Build → Undo (right edge) | 2 from Play; 1 in Build |
| Redo | ☰ → Redo | 2 — menu only |
| Generate a scene | ☰ → Generate a scene → Build it; or Build → Scenes → Generate… → Build it; or start card → Build it | 3 / 4 / 2 |
| Refurnish / lock a room | gen sheet → room row dice / lock | +1 |
| Starter scene | start card; ☰ → Add a starter scene; Build → Scenes → Starter scene | 1 / 2 / 3 — no confirm, not one undo step (`main.ts:1660-1698` writes the store directly) |
| Light level of a torch | Build → Things → Light chip → tap torch | 4 |
| Scatter loose pieces | Build → Things → Scatter → kind → tap/drag | 5 |
| Share / import an area as text | Build → Scenes → Share / Import (native `prompt()`, `main.ts:957`) | 3 |

### Prep

| Action | Path | Taps |
|---|---|---|
| Pick a theme | Prep → Theme → card; or ☰ → Atmosphere & sound → theme; or start card → card | 3 / 3 / 2 |
| Customise a theme | Prep → Theme → Customise → tabs (Look, Sound, Pieces, Dice, Generator, About) | 3+ (`themeEditor.ts:74`) |
| Sky / season / firelight | ☰ → Atmosphere & sound → button | 3 |
| Soundscape | ☰ → Atmosphere & sound → scroll → button | 3 + scroll |
| Import a picture | Prep → Import → Take a photo / Choose pictures → crop → cut out → name → save → "Place it on the table" | 3 + flow (`importPage.ts:200-239`) |
| Import a 3D model | Prep → Import → Add a 3D model → … | 3 + flow |
| Packs | Prep → Packs (or Import → The table's packs) | 2 |
| Rules system | Prep → Rules → row; or ☰ → Rules → row | 3 |
| Sound library / mixer | Prep → Sound | 2 |
| Boards | ☰ → Boards → eye (look alone) / ▶ (bring everyone) / New / Copy / trash | 3 |
| Export / Import table / Clear | ☰ → row | 2 |

### Running play

| Action | Path | Taps |
|---|---|---|
| Move a mini | drag it (Move tool) | gesture |
| Select a mini | tap it → ring | 1 |
| Turn a mini | tap → Turn | 2 |
| HP ±1 | tap → heart → −/+ ; each further point one tap; steps of 1 only (`main.ts:1325-1328`) | 3 |
| HP by number | tap → More → HP field → type | 3 + typing |
| Initiative | tap → More → "init" field → type; one mini at a time (`index.html:179`) | 3 + typing each |
| Start a fight | no button: the strip appears when any mini has an `ini` (`main.ts:1204`); first ▶ starts round 1 | — |
| Next turn | ⏭ on the strip (top of screen) | 1 |
| End fight | ✕ on the strip — clears every initiative, no confirm (`main.ts:1223-1226`) | 1 |
| Jump camera to a combatant | tap its chip in the strip (`main.ts:1213`) | 1 |
| Hide / show a mini | tap → More → Visible/Hidden | 3 |
| Hand a mini to a player | tap → More → owner `<select>` → pick | 4 |
| Size / fly height | tap → More → Size / wing (cycle buttons) | 3 |
| Knock down | tap → 👋 Emote → 💀 (filed under emotes, `main.ts:1316`) | 3 |
| Emote | tap → 👋 → emoji | 3 |
| Shoot (visual only) | tap → 🏹 → kind → tap target | 4 |
| Shove | tap → 💨 → tap direction | 3 |
| Character sheet | Sheet (dock); or tap mini → sheet button on ring | 1 / 2 — needs a rules system |
| Condition | open sheet → scroll past all stat sections → chip (`sheet.ts:397`) | 2–3 + scroll |
| Roll from sheet | open sheet → roll button → sheet closes, drag on table, release | 2 + gesture |
| Roll dice | Dice → die (repeat) → drag on table, release (or shake) | 2 + gesture |
| Secret roll | Dice → 🙈 (stays on) | 2 |
| Fog | Fog → Hide/Reveal → drag | 1–2 + drag |
| Reveal all | Fog → Reveal all — one tap, no confirm, direct store writes (`main.ts:920`) | 2 |
| Line of sight | ☰ → Line of sight | 2 |
| Measure | Measure → (Distance/Radius/Cone) → drag; tap table to put away | 1–2 + drag |
| Blast | Measure → Radius → drag circle → Blast | 4 |
| Break a wall/thing | tap it in Play → Break (GM only) | 2 |
| Boulder trap | Dice → 🪨 Boulder → press and flick on table | 2 + gesture |
| Ping | long-press table 550 ms in Move (`board.ts:2312-2322`) | hold |
| Chat / whisper | Dice → text field; `/w name msg` | 2 + typing |
| Sound effect (soundboard) | ☰ → Atmosphere & sound → scroll to bottom → button (`index.html:265`) | 3 + scroll |
| Switch players to another board | ☰ → Boards → ▶; or `#prep` banner "Bring everyone" when already looking at it | 3 / 1 |
| Invite | ☰ → Invite someone → OS share sheet; start card | 2 / 1 |
| Become / stop being GM | ☰ → Become the GM | 2 |

### Settings (scattered, no settings screen)

| Setting | Where | Ref |
|---|---|---|
| Name, colour, relays | lobby only; changing means Leave and rejoin | `index.html:20-34` |
| Ambient motion, Follow turns | ☰ (toggles keep the menu open) | `main.ts:1467-1489` |
| Sound on this device, Vibration | bottom of the Atmosphere sheet | `index.html:266-267` |
| Shake to throw | dice sheet | `main.ts:485-491` |
| Where files are kept | Prep → Packs | `packsPage.ts:57` |
| Allow a system's scripts | under the rules picker | `sheet.ts:111` |

---

## 5. Sheets (`.sheet`, `src/ui/sheets.ts`, `style.css:194-241`)

One at a time (`openSheet`, `main.ts:609-617`). Three heights via `data-h`: **peek** = first row (`--tap + 18px`), **half** = `min(60%, 440px, room − 112px)`, **full** = up to the top bar. Every sheet gets a grab handle that is a button (tap cycles, drag steps; `sheets.ts:88-105`). A finger on the canvas drops the open sheet to peek (`sheets.ts:174`). `#hud[data-sheet]` hides `#minipanel` always, `#floors` at half, `#floors/#edits/#strips` at full (`style.css:215`). Sub-pages via `pushSheetPage` (`sheets.ts:121`) — exported and tested, but not used by any shipped sheet that I found.

| Sheet | Opened from | Contents | Ref |
|---|---|---|---|
| `#log` | Dice dock button | message log (88px tall in portrait unless full), hand hint, Shake, Boulder (GM), Secret (GM), 8 dice + clear, chat input | `index.html:281-290`, `style.css:244-246` |
| `#lib` | 🔍 chip in Build | search, pin star, close, grid | `index.html:244-251` |
| `#gen` | ☰, Scenes → Generate…, start card | presets, 3 sliders, Build it / Another, room list, recent seeds | `index.html:230-241`, `main.ts:1556-1636` |
| `#boards` | ☰ | rows (name input, "players here", eye, ▶, trash), New board, Copy this one | `index.html:221-228`, `main.ts:989-1044` |
| `#atmo` | ☰ | themes, sky, season, firelight slider, soundscapes, soundboard, sound on/off, vibration | `index.html:253-268`, `main.ts:1124-1147` |
| `#sheet` | Sheet dock button, ring, mini panel | character sheet from the system schema; half height is `min(72%, 560px)` | `index.html:271-274`, `sheet.ts:296-431` |
| `#rules` | ☰ | system picker (same as Prep → Rules) | `index.html:275-279` |

Not sheets: `#menu` (dropdown), `#minipanel` and `#start` (dock panels), `#ring`.

---

## 6. Prep pages (`src/ui/prep.ts`, registered in `main.ts:1084-1104`)

Full-screen shell with title bar + Back; Back button, Escape and the phone's back button share `history` (`prep.ts:150-176`). List rows show icon, title, hint and what the table has now.

| Order | Page | Content | Module |
|---|---|---|---|
| 10 | Theme | gallery cards (shipped: cosy, dark, pirate, vampire; plus "Mine"), Customise / Edit, Import a theme code | `ui/themeEditor.ts:896` (replaces `prepPages.ts:61`) |
| — | Customise theme (unlisted, `see: true`) | see-through editor over the live table: tabs Look · Sound · Pieces · Dice · Generator · About; undo/redo; Share, Save to my themes, Use on every board | `themeEditor.ts:74`, `762-771`, `897-900` |
| — | Add pieces (unlisted) | piece picker for a theme | `themeEditor.ts:901` |
| 20 | Packs | weight bar (40 MB soft / 100 MB hard), where files are kept, per-pack rename/remove, per-piece remove with in-page confirm | `ui/packsPage.ts:147` |
| 30 | Import | Take a photo · Choose pictures · Add a 3D model → crop → cut → name → save; results list with "Place it on the table" | `ui/importPage.ts:200-239`, `527`; `ui/modelPage.ts` |
| 40 | Rules | system picker (No rules, hard-knocks, lantern-d20, six-sides, three-hearts) | `main.ts:1086`, `sheet.ts:86-116` |
| 50 | Sound | this table's sounds (≤ 24), add a recording, mix a soundscape | `ui/soundPage.ts:178`, `351`, `419`, `503` |

Prep has no page for: boards, generator, invite/players, table export/import, clear. "Import" in Prep is pieces; "Import table" is in ☰ (the Import page itself has to explain this, `importPage.ts:211`).

---

## 7. Gesture map (`src/board.ts:2263-2698`)

Global: a second finger always aborts the current gesture and becomes a camera gesture (`board.ts:2272-2281`); two fingers = pan + pinch (OrbitControls `DOLLY_PAN`, `board.ts:621`) + twist to rotate after a 0.14 rad slack (`board.ts:2376-2389`). Move threshold 12px touch / 6px mouse (`board.ts:2396`). No double-tap anywhere. Long-press exists only for ping and for pinning a tile.

| State | One-finger tap | One-finger drag | Long-press |
|---|---|---|---|
| Dice in hand / boulder armed (any tool) | — | hold dice over the table; release throws, flick flings (`board.ts:2291-2300`, `2549-2567`) | — |
| Move | on own mini: select (ring). On another's mini: select read-only. On wall/thing (GM): offer Break. Empty: deselect (`board.ts:2609-2615`) | on a movable mini: drag it, floats 44px above the finger, falls if dropped over an edge (`board.ts:2403-2415`, `2569-2583`). Elsewhere: **orbit camera** (`board.ts:1937`) | empty table, 550 ms: ping (`board.ts:2312-2322`) |
| Move, aiming a shot | names the target (mini or spot) | orbit | — |
| Move, shoving | names the direction | orbit | — |
| Measure | put the ruler away | measure (line / radius / cone), stays out, broadcast (`board.ts:2587-2591`) | — |
| Fog | fog/reveal one column | paint columns (`board.ts:2593-2596`) | — |
| Build: block or prop | place on the tapped face (ghost shows on touch-down) | paint a flat layer at the first cell's height, one undo step (`board.ts:2453-2466`) | — |
| Build: raise/lower/level/grow, Repaint | apply the brush (round, size 1/3/5) | stroke, each column once (`board.ts:1789-1806`) | — |
| Build: wall piece | set the nearest cell edge | run of edges in line with the first (`board.ts:2423`) | — |
| Build: room | — | drag out the floor; release builds floor, walls, windows, doorway (`board.ts:1863`) | — |
| Build: erase | remove wall > prop > loose > block under the finger | erase a flat layer; sweep loose pieces (`board.ts:1759`, `2532`) | — |
| Build: copy | — | marquee; release copies and switches to paste | — |
| Build: paste | stamp the slab | slide the ghost, release stamps | — |
| Build: light | step a torch/fire/crystal: normal, bright, dim, out | — | — |
| Build: scatter | pour N loose pieces | strew along the drag | — |
| Figures (tool `mini`) | place a mini | slide the ghost, release places (`board.ts:2606`, `2654-2659`) | — |

Consequence: **in every tool except Move, one finger never moves the camera** — looking around while building needs two fingers (`board.ts:1936-1937`).
Desktop: left-drag orbit, right-drag pan, wheel zoom; keys 1–5 tools, R rotate, Ctrl+Z/Y, Del, Esc, Enter (`main.ts:1702-1716`).
Tray gestures: long-press a tile 480 ms pins/unpins (`hotbar.ts:102-120`); sheet handle drag (`sheets.ts:94-102`).

---

## 8. Hidden or hard-to-discover behaviour

- Ping by long-press: mentioned only in the Move button's `title` (invisible on touch) and the help paragraph at the bottom of ☰ (`index.html:208`, `main.ts:292-294`).
- Help text lives at the very bottom of a scrolling menu (`index.html:124`).
- Redo: menu only. Undo: Build only (plus a special Undo chip in Measure → Radius for the GM, `main.ts:915`).
- Tapping Erase again returns to the previous brush (`main.ts:622-627`).
- Tapping the active theme lets go of it (`main.ts:1071-1076`).
- Tap in Measure puts the ruler away; "Put away" chip duplicates it.
- Blast lives inside Measure → Radius; Boulder lives inside the dice sheet; Knock down lives inside Emote.
- Break appears only after tapping scenery in Play as GM.
- Fog tool does not exist in free play (`data-gmonly`), so a solo GM who never tapped "Become the GM" cannot find it.
- Character Sheet button and ring entry do not exist until a rules system is picked (`style.css:394`).
- Walls are edge pieces filed under props ("Structures") next to statues and tents (`catalog.ts:576`).
- Cutaway stepper also limits where pieces can be placed (`board.ts:2651`).
- Chat commands `/r` and `/w` are only in the input placeholder (`index.html:289`).
- Initiative: typing a number in a field with a flag icon is what starts turn tracking; no label says so on touch.
- Touching the table collapses the open sheet to its first row (`sheets.ts:174`).
- `.cur` chip (piece in hand) is also the fold/unfold toggle for the shelf.
- Mini placement, mini moves, mini deletion, starter scene, Reveal all, End fight and Clear write the store directly and are not on the undo stack (`board.ts:2578`, `2658`; `main.ts:920`, `1224`, `1440`, `1518`, `1661`).
- Native dialogs: `prompt()` for slab import and clipboard fallback (`main.ts:954`, `957`, `1453`), `confirm()` for board delete and clear (`main.ts:1018`, `1517`), `alert()` for "already has a GM", bad slab, bad file (`main.ts:969`, `1494`, `1535`).
- System messages (welcome, "You are the GM…", "Copied N pieces…", "Boulder ready…", "Light: bright") go to the chat log, which is a closed sheet on phones, and `.sys` lines do not raise the unread dot (`main.ts:392`). Most instructional feedback is therefore never seen.

---

## 9. First run and onboarding

1. **Lobby** (`index.html:20-34`, `main.ts:99-119`): name (required), colour swatches, table code (prefilled random; minlength 6), collapsed Relays, "Sit down at the table". Copy speaks of Nostr, relays, encryption keys. No "create" vs "join" distinction, no role choice.
2. **Join by link**: `#room=` prefills the code (`main.ts:102`); the player still gets the same form and must enter a name (remembered afterwards). The last room is remembered, so reopening the app prefills it.
3. **After joining** (`main.ts:289-295`): HUD appears, a welcome line is written into the closed log. No tour, no coach marks.
4. **Empty table**: `#start` card "An empty table. Start with… A starter scene / A random scene / A theme / Inviting players" (`index.html:197-205`). Shown to anyone with full powers, only in Play, only with no sheet open, nothing selected, no dice in hand; dismissed for the session with ✕ or forever once anything is on the board (`main.ts:1643-1648`). It is the only onboarding element.
5. **GM role is opt-in and never prompted.** A new table is free play: every joiner has Build, Prep and the start card. The GM must find ☰ → Become the GM; the explanation that follows goes to the hidden log (`main.ts:1491-1500`).
6. **Player on a GM'd table**: no mode switch, dock = Move / Measure / Dice (/ Sheet). Nothing says which mini is theirs; "my character" is the first mini whose owner is them (`sheet.ts:277-280`). A player with no mini has nothing to do but look and roll.
7. **Empty states elsewhere**: sheet with no piece: "Tap a piece on the table, then open its sheet here." (`sheet.ts:305`); dice: "Tap dice to pick them up" (`main.ts:431`); Prep list fallback (`prep.ts:114`); library search miss (`hotbar.ts:148`). Boards, gen and atmosphere sheets have no guidance beyond `.hint` lines.

---

## 10. GM vs player

Mechanism: `body.player` (no full powers) and `body.gm` (actually GM) set in `sync()` (`main.ts:1157-1167`); CSS `body.player [data-gm]` and `body:not(.gm) [data-gmonly]` hide elements (`style.css:390`).

| | Free play (no GM) | GM | Player |
|---|---|---|---|
| Mode switch, Build, Prep | yes | yes | hidden |
| Fog tool, Secret roll, Boulder | **hidden** | yes | hidden |
| Menu: LOS, Redo, Generate, Starter, Import table, Clear | yes | yes | hidden |
| Menu: Invite, GM toggle, Boards, Atmosphere, Rules, Ambient, Follow, Export, Leave | yes | yes | yes (Boards/Atmosphere/Rules read-only, buttons disabled) |
| Move minis | all | all | own (`o === me` or `*`), and only on their turn during a fight (`main.ts:163-169`) |
| Ring on a mini | 6 (+sheet) | 6 (+sheet) | own: same; others': one "Details" button (`main.ts:1281-1290`) |
| Mini panel | full | full | others' read-only; trash/hide/owner hidden |
| Break, Blast | yes | yes | no |
| Turn strip | next + end | next + end | next only on own turn (`main.ts:1218-1219`) |
| Hidden minis | ghosted | ghosted | not drawn; fog and line of sight apply (`rules.ts:165-172`) |
| Other boards | look alone, bring everyone | same | follow the table |
| Prep closes itself if powers are lost | | | `prep.ts:184` |

Only one GM present at a time; a GM who is away can be replaced (`main.ts:1492-1500`).

---

## 11. Structure and coupling

**Where UI logic lives.** `main.ts` is one 1,620-line closure, `play()` (`main.ts:123-1746`), holding: network message handling, dice hand, chat, tool/mode switching, the whole Build tray (`renderPalette`, 175 lines), boards, atmosphere, role sync, turn strip, cutaway, the ring, the mini panel, the menu, the generator sheet, the start card, the starter scene, keyboard. State is closure variables (`cat`, `trayOpen`, `thingShelf`, `miniShelf`, `miniKind`, `ringMode`, `moreOpen`, `peek`, `secret`, `hand`, `genOpts`…). Everything re-renders through `sync()` on any store change (`main.ts:1151-1197`).
`src/ui/` holds the newer, cleaner pieces: sheets, prep shell, hotbar/library, character sheet, theme editor, import, packs, sound — each talking to `main.ts` through a small hooks object.

**What a chrome rewrite can keep untouched.**
- `store.ts`, `net.ts`, `rules.ts`, `gen.ts`, `system.ts`, `theme.ts`, `themeEdit.ts`, `packs.ts`, `blob.ts`, `sounds.ts`, `sound.ts`, `registry.ts`, `catalog.ts`, `library.ts` — no DOM.
- `board.ts` — owns the canvas and all pointer input; the chrome drives it through a narrow surface: `setTool`, `brush`, `rot`, `reach`, `surface`, `roomTimber`, `rulerMode`, `fogHide`, `hand`, `boulderArmed`, `aimed`, `aimShove`, `select/selected`, `spotOf`, `keepInView`, `focusMini`, `lookAt`, `setCut/cut/maxHeight`, `undo/redo`, `commit/editAll/applyScene`, `slab`, `setInset`, plus the hooks object at `main.ts:157-201`. The tool/brush model (one finger = current brush) is baked into `board.ts`, so a redesign that wants select-and-move for props, or one-finger pan in Build, needs board work, not just chrome.
- `ui/sheet.ts` (`SheetHost`), `ui/prep.ts` (`PrepApp`), the Prep pages, `ui/themeEditor.ts`, `ui/sheets.ts` — reusable if the element ids they look up survive (`#sheet`, `#sheetBody`, `#toast`, `#dice`, `#rules`, `#prepPages`, `#lib`, `#libQ`, `#libGrid`, `#palette`).

**What is tied to the current DOM.**
- `main.ts` addresses about 70 ids from `index.html` directly.
- `scripts/e2e.mjs` has ~190 taps on ~116 distinct `#id` selectors, plus `title` attributes (`[title="Grass"]`, `[title="Shoot"]`) and `window.__ct` (`main.ts:268`, `1740`). Any re-layout means rewriting most of the phone section (`e2e.mjs:928-1975`).

**Layout rules e2e enforces** (`layout()`, `e2e.mjs:1025-1041`, called ~60 times in both orientations):
- none of `#top, #tools, #palette, #minipanel, #floors, #edits, #init`, the open sheet, `#prepPages`, `#ted`, `#tedDo` may overlap another or leave the screen;
- every visible `#hud button` ≥ 43.5 × 43.5 px;
- every input/textarea font ≥ 16px;
- no sideways page scroll.
Further asserted behaviour: start card clear of the dock and hidden for sheets/Build (`e2e.mjs:937-957`); picking a piece folds the tray to ≤ 66px (`962-965`); tap places, drag paints a flat layer, undo reverts a stroke, two fingers never edit (`967-989`); a pinch starting on a mini zooms and does not move it (`1011-1022`); a selected mini shows 6 ring buttons with ≥ 60% of the height free and no panel (`1044-1049`); library opens at half as a grid, handle steps through heights, pick folds it to peek (`1119-1155`).

---

## 12. Friction points, by reported pain

### Building is slow
1. **Camera vs brush.** In Build one finger is always the brush; orbit is unavailable and pan/zoom need two fingers (`board.ts:1937`). One-handed building on a phone is not possible; every look-around is a two-hand gesture or a trip to Play.
2. **No object selection.** Blocks and props cannot be tapped to move, rotate, duplicate or delete; the only fix is Erase (a brush switch on the far right edge) and place again. Rotation is set before placing and the Turn chip is often off-screen.
3. **Minis are split across modes.** Place in Build → Figures; name, HP, owner, hide, size in Play → tap → More. Populating an encounter is a mode switch per figure or two passes. Minis also bypass undo.
4. **Tray is two horizontally scrolling rows** with actions, shelf selectors and toggles mixed in one chip row (up to 12+ chips in Things). After picking a piece the shelf folds, so changing piece is always two taps.
5. **Category taxonomy leaks implementation.** Walls = edge pieces + "Structures" props + "Building" blocks; Land mixes brushes and blocks; Scenes is not a category of pieces at all. Search is scoped to the current category.
6. **Erase/Undo sit top-right**, the farthest point from a right thumb; Redo is in the menu.
7. **No multi-level aid**: height is implicit, and the cutaway doubles as a placement cap without saying so.

### Things are hard to find
8. **☰ is a 15-row junk drawer** mixing navigation (Boards, Atmosphere, Rules), one-shot actions (Generate, Starter, Clear), device toggles, role, and file I/O.
9. **Duplicated entry points with different surfaces**: themes (Atmosphere sheet buttons vs Prep gallery cards), rules (☰ sheet vs Prep page), generator (☰, Scenes chip, start card), starter scene (three places), invite (☰, start card). None is in the dock.
10. **Sound is in three places**: scape + soundboard + device mute in the Atmosphere sheet, library and mixer in Prep → Sound, theme sounds in the theme editor.
11. **Settings have no home** (section 4, Settings table).
12. **"Import" means two things** (pieces in Prep, tables in ☰); "Prep" is both a mode and a DOM id for the unrelated board-preparation banner (`#prep`, `index.html:131`).
13. **Role-gated features vanish silently** (Fog in free play, Sheet without a system).

### Running live play is clumsy
14. **No GM-facing encounter surface.** Initiative is typed per mini three taps deep; there is no start-fight, roll-all, reorder, or list of combatants with HP. The turn strip is at the top of the screen.
15. **HP changes in steps of 1** from the ring, or by retyping a number in the panel; no damage/heal entry.
16. **Mode switch tears down context**: going to Build to drop one more monster deselects, closes sheets, and returns to Move afterwards.
17. **Soundboard and scene/board switching are ☰ → sheet → scroll**, and the sheet folds to peek the moment the table is touched.
18. **Feedback goes to a closed log.** System lines never raise the unread dot; the only on-table feedback is the roll toast.
19. **One sheet at a time, and the sheet hides the mini panel** (`style.css:215`): dice + character sheet, or chat + mini stats, cannot coexist; rolling from a sheet closes it (`main.ts:259-265`).
20. **Destructive one-taps without confirm or undo**: End fight, Reveal all, Starter scene onto a built board; while board delete and Clear use native `confirm()`.
21. **Conditions sit below every stat section** of the sheet; there is no quick condition toggle on the ring.
22. **Ring crowding**: 6–7 buttons at fixed angles around the piece, sub-modes replace the ring with a popup that has its own Back; Shoot/Shove/Emote take half the ring while Hide/Owner/Initiative are in the panel behind "More".

### Onboarding is unclear
23. **Lobby speaks infrastructure** (table code as encryption key, relays, Nostr) and asks the same form of GM and player.
24. **No role moment.** Nobody is asked "are you running this game?"; free play exposes Build/Prep/Clear to every early joiner.
25. **The start card is the only guidance**, appears only in Play on an empty board, and offers four unrelated verbs with no order.
26. **Gestures are never taught**: one-finger orbit vs two-finger pan, long-press ping, drag-and-release dice, tap-edge walls, two-finger-only camera in Build.
27. **A joining player gets no pointer to their character** and no hint about what they may do.
28. **Three shipped rule systems and four themes are discoverable only through Prep or ☰**; a first-time GM can run a whole session without learning that sheets, conditions or themes exist.
