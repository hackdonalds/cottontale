# Cottontale

3D virtual tabletop in the browser; multiplayer over Nostr. See README.md.

## Mobile first (standing rule)

Phones are the primary target. Design and build every feature for a phone
first, then enhance for larger screens.

- **Screen real estate drives the design:** on the smallest phone the table gets
  the screen and chrome rents space from it. Prefer swapping what is shown over
  adding to it, show chrome only while it is useful, and send dense content to a
  full-screen page instead of squeezing it beside the table.
- **Layout:** base CSS is the portrait-phone layout; landscape-phone and desktop
  are media-query layers on top (`src/style.css`). New UI goes in the bottom
  dock or a sheet, within thumb reach, and must respect the safe-area and
  keyboard variables (`--st/--sb/--sl/--sr`, `--kb`).
- **Touch:** every action must be reachable by touch alone — no hover-only,
  keyboard-only or right-click-only features. Touch targets ≥ 44px; inputs
  ≥ 16px font (iOS zooms otherwise).
- **Gestures:** one finger = the current tool, two fingers = camera. A second
  finger must never cause an edit (`src/board.ts`).
- **Budget:** render on demand (`board.invalidate()`), no per-frame work when
  idle, keep the bundle and GPU cost phone-sized. Draw calls are the scarce
  resource: pieces are baked into shared merged geometry (`makeProp`/`makeMini`
  in `src/catalog.ts`) — never add per-instance geometry or materials. Shadows
  redraw only when the table changes (`touched()`), not when the camera moves.
- **Replace, never stack:** the dock shows at most five or six slots in any mode; a sheet takes
  the place of what it would cover; Prep pages take the whole screen. New states go into `layout()` in `scripts/e2e.mjs`.
- **Verify on a phone viewport:** `npm run e2e` runs phone portrait/landscape
  checks (touch gestures, overlap, target sizes). Extend them with new UI.

## Layout of the code

- `src/store.ts` shared last-writer-wins state · `src/net.ts` Nostr transport
- `src/rules.ts` pure table rules (GM, visibility, line of sight, turns) — unit-test here
- `src/board.ts` 3D view and pointer input · `src/dice.ts` physics dice
- `src/main.ts` UI wiring · `src/catalog.ts` blocks, props, minis (and their shelves)
- `src/kit.ts` loads the modelled pieces (`public/kit/*.glb`), built by the Blender scripts in `assets/blender`
- `src/gen.ts` seeded scene generators: four ways of laying a scene out (wilderness, dungeon, cave, building) are code — pure, whole numbers only, return ordinary edits. Everything thematic is a *preset*, data (`public/gens/*.json`, listed in `index.json`; a theme may carry its own in `gens`): pieces, room kinds and their furnishing, names, slider labels, icon. `generate(opts, preset, …)` is handed its preset and never looks one up; `parsePreset(raw, known)` reads untrusted ones. Never name a piece in the engine — unit-test here (old seeds are pinned by hash)
- `src/sound.ts` one Web Audio engine that plays *recipes*, data (`public/sounds/*.json` + `index.json` for soundscapes, `effects.json` for the dice clack, ping, emote stings; a theme may carry its own in `sounds`): noise layers, drones, timed patterns. No audio files are shipped; a recipe may name a recording (`file`), played only through `Sound.resolver` when the app sets one. `parseRecipe`/`parseEffect` clamp everything (untrusted). `SOUNDSCAPES` and `PRESETS` fill as the files load: `id in …` is how "known" is asked
- The GM's own 3D models: `src/model.ts` is the piece kind `model` (all of it that loads up front). `src/ingest.ts` (run in `ingest.worker.ts`, one worker per import) shrinks a `.glb` to budget with `meshoptimizer`: one mesh, one material, at most one atlas texture; a figure or thing ≤ 15k triangles and 1.5 MB, a set piece ≤ 50k and 4 MB; refused with the reason if it cannot. `src/glb.ts` reads untrusted GLBs (pure, bounds-checked, never follows a URI) — unit-test here (`model.test.ts`). `src/modelBuild.ts` checks the stored file again and decodes it into one shared geometry and material per model (untextured models all share `PLAIN`). `src/ui/modelPage.ts` is the flow inside Prep → Import. Only `model.ts` and `modelBudget.ts` may be imported statically by the main bundle
- `src/sounds.ts` the table's own sounds (`snd:<id>`, table-wide, read strictly by `parseSound`, at most 24): the GM's recordings (a recipe's `file` is a `BlobRef` as JSON, `encodeRef`/`decodeRef`; fetched from `src/blob.ts` only on devices with sound on), soundscapes mixed from `public/sounds/mixer.json`, and effects that re-voice a built-in one (`as`) or sit on the soundboard (live message `sfx`, never a store write). A board's `amb` names one as `t:<id>`. The screen is Prep → Sound (`src/ui/soundPage.ts`). Budgets, checked before upload: effect ≤ 10 s / 150 KB, music or ambience ≤ 5 min / 4 MB; no transcoding except shrinking a short WAV effect
- `src/theme.ts` themes: plain data, never code — a mood, the pieces shown first, a generator. None is written into the app: the ones on offer are files (`public/themes/*.json`, listed in `index.json`), and picking one copies it whole into the board's `at:theme`. A mood may carry its own look as data (`light`, `fog`, `grade`, and the theme's `dice`), over the three named skies. Everything goes through `parseTheme` — unit-test here
- Atmosphere (`at:theme|sky|season|glow|amb`) belongs to a board; read and write it only with `atmo`/`setAtmo` (`src/theme.ts`), which fall back to the table-wide `set:*` as the default
- `src/registry.ts` pieces that are not built in: `registerPack(ns, pack)` puts `ns:name` blocks, props, minis and shelves into the catalog records at run time (`known`, `onRegistry`). Bare ids are the core. An id nobody has registered is drawn as a stand-in, never a crash
- `src/blob.ts` the GM's own files without a server of ours: encrypted, named by the SHA-256 of the ciphertext, kept in a
  local cache, offered to Blossom servers (`set:blossom`), else passed between players (`src/blobpeer.ts`, WebRTC).
  The store only ever holds the small reference `{h,n,m,s?}`; read it back with `parseRef` — use `blobs.put/get/objectUrl`.
- `src/packs.ts` the GM's own pieces, as data in the table: one key `pk:<ns>` (table-wide; a device's own is `ownNs(me)`) holds a manifest
  `{ v, id, name, pieces: { props, minis }, shelves? }` whose entries point at files by blob reference. Untrusted: `parsePack` (≤ 8 packs, ≤ 64 pieces, sizes per kind;
  40 MB soft / 100 MB hard a table). Every device follows `pk:*`: pieces register at once as stand-ins and are fetched and built when first *drawn*
  (or their picture asked for with `packThumb`). What a piece is, is a kind: `registerPieceKind(kind, { parse, build, budget?, groups? })`. Write with `addPiece/removePiece/renamePack/removePack`
- `src/standee.ts` the kinds `standee` (an upright picture; all of them share atlas pages and are drawn by ONE InstancedMesh a page — `standees`, synced
  by the board when the table changes; what the registry holds is an invisible, pickable card) and `flat` (a picture on the ground, own texture). `src/pixels.ts`: pure pixel work (flood-erase, crop, budgets)
- `src/ui/` the chrome that is not the table, wired into `main.ts` by small hooks — new UI logic goes here, not into `main.ts`:
  - `sheets.ts` sheet heights. Every `.sheet` has three (`data-h`: peek = its first row, half = as it opens, full = forms) and a grab handle that is a real button (`setSheetHeight(id, 'peek'|'half'|'full')`, `sheetHeight`, `cycleSheetHeight`). One sheet at a time; a sheet sits on top of the dock (`--dock`) and drops to peek when a finger lands on the table; `#hud[data-sheet]` hides what a sheet would cover. Drill down with `pushSheetPage(id, title, render)` (a page with Back in the same sheet), never a second sheet
  - `library.ts` (pure: recents, favourites, search — unit-test here) and `hotbar.ts` (the Recent / Favourites shelves, the `#lib` sheet with search and a grid). Pieces are named by key (`b_grass`, `p_barrel`, `m_knight`) and looked up at draw time, never assumed to exist; long-press pins, but the star in the library is the tap path
  - `prep.ts` Prep, the third mode: full-screen pages with a title bar and Back (button, Escape and the phone's back button share the history). Add a page with `registerPrepPage({ id, title, icon, order, hint, render(el, ctx), update?(el, ctx) })`; `prepPages.ts` has the Theme gallery and placeholders that a page with the same id replaces
- `src/ui/display.ts` the table screen (`?ui=2&display=1#room=…`: a TV on the table; no lobby, no chrome, changes nothing, its own key `skd`). It sits in the seat `PARTY` (`src/rules.ts`): never any powers, sees what any player-owned mini sees. It says so in presence (`d` in `hi` → `Peer.disp`; `session.screens()`, not in `people()`). The GM's side is Table → People: the link with a QR code (`src/qr.ts`, pure) and "Show this on the table screen" / "Follow me" (live message `cam`, read with `readView` in `src/glide.ts`, taken up only from a GM and only by a screen: `board.flyTo`). Checked by `scripts/e2e2-display.mjs`
- `src/system.ts` game systems as data (pure, whole numbers only — unit-test in `src/system.test.ts`): the format and
  strict `parseSystem`, the expression language, dice notation (`planRoll` picks the physical dice, `readRoll` reads
  the landed faces), `derive` (sheet from what was entered + condition modifiers), triggers (`fire`), `authority`.
  Nothing game-specific in code: systems are files in `public/systems` (listed in `index.json`), copied whole into
  `set:system` when picked. With none picked the app behaves as it always did.
- `src/ui/sheet.ts` the character sheet drawn from a system's schema, the rules picker (`renderSystemPicker`), and the
  referee: triggers are applied by one device only (the GM's; lowest id of several; the actor's with no GM here).
- Scripts of a system (`scripts: { name: source }`, run by a trigger's `{ script }`) are a stranger's code: they run
  only in QuickJS-in-WebAssembly inside a worker — `src/scriptbox.ts` (the box and its limits; pure, unit-tested under
  node in `src/script.test.ts`), `src/script.worker.ts`, `src/script.ts` (the worker's keeper, budgets, and the
  per-device "Allow" for that exact set of scripts). Never `eval`/`new Function` them, never give the box a host
  function beyond `roll` and `log`; all that comes out is edits for `parseEdits`. `main.ts` imports `./script` lazily,
  and the worker and `.wasm` load only on the device that referees, on the first script due: keep it that way
  (e2e checks the request log). `public/systems/hard-knocks.json` is the example.
- A mini stores only inputs and outcomes: `sv` (entered stats), `cn` (conditions), `fx` (ids of the last events applied
  to it, so a repeat is harmless) beside the old `hp`/`mhp`/`ini`. Derived values are never stored.
- `src/themeEdit.ts` pure theme editing (copy under `<player>:<slug>`, set/clamp, pieces, share code, size, undo): every edit is read
  back through `parseTheme`, so what is written is what is read — unit-test here (`src/themeEdit.test.ts`).
  `src/ui/themeEditor.ts` (+ its own `.css`) is the UI: the Prep → Theme gallery, the see-through editor page (one panel with tabs,
  the table as live preview: `PrepPage.see`, `board.setInset`) and the piece-picker page. It writes the whole theme to `at:theme` at
  most every 300 ms; "Mine" is this device's `cottontale:themes`; "Use on every board" writes `set:theme`.
  - `importPage.ts` Prep → Import (photo or picture → crop → cut out → name → the device's pack; a flow is steps of one page, its state in the module) and `packsPage.ts` Prep → Packs (confirming is a step in the page, never `confirm()`)
- Thin walls live on cell edges, not in cells: `w:x,y,z,n|w` (low-z / low-x side of a cell, see `src/rules.ts`).
  They block sight unless the piece is a window or doorway; corner posts are derived, never stored.
- Loose pieces lie where they fell, at any angle: `l:<id>` → `{ i, p: [cm], q: [‰] }` (`src/loose.ts`; poured by `src/pour.ts`, drawn by `src/looseview.ts`).
- Board-specific keys (`b:` `m:` `f:` `w:` `l:` `at:` `turn`) are scoped per board by the store;
  everything else is table-wide. Live messages carry the board id (`bd`).

## The redesign (in progress, behind `?ui=2`)

The chrome is being rebuilt from scratch beside the old one (`reports/Redesign plan.md` has the target and the build
order; `reports/Mobile first VTT UX research.md` the reasons). Until it takes over, `main.ts` is the old chrome and must keep working.

- `src/session.ts` one seat at one table with no chrome: identity, store, net, board, sound, files, and everything a player
  or GM can do (dice, boards, fights, scenes…). It never touches the DOM; the chrome is told things through `SessionHooks`
  (`notice`, `log`, `rolled`, `changed`) and reads the rest off the session. New table logic goes here, never into a UI module
- `src/app.ts` wires a session to the new chrome (`#app`, styles in `src/ui/shell.css`). It only wires
- `src/ui/dockFor.ts` what the dock shows, pure: one function from the table's state to at most six slots — add a state here
  first, with a test (`dockFor.test.ts`). `src/ui/dock.ts` draws it, with the Undo / Redo pair; `src/ui/notice.ts` is the
  one fading line that replaces system messages in the log
- `src/ui/drawer.ts` the one sheet of the new chrome: a slot opens a drawer, another slot swaps it, a touch on the table puts it away
  (unless `stay`). What the slots open lives in `buildSheets.ts`, `playSheets.ts` and `tableSheet.ts`, each a function returning `DrawerOpts`;
  `dock.ts` maps slot ids to them. Half height keeps the table ≥ 45% of the screen (e2e2 measures it); `full` is for lists and forms
- `src/pick.ts` editing what is already placed, pure (move, turn, copy, remove a selection of store keys) — unit-test here.
  The board's `pick` tool is Build with nothing in hand: tap selects, a finger on the selection carries it, anything else is
  the camera. Select area (`board.pickArea`, armed from Make or More; `areaKeys`) lets one finger drag a rectangle: what stands in it
  is picked, and is then moved, turned about its middle (`turnAreaEdits`), copied a footprint over or removed as one step
  (`node scripts/e2e2-area.mjs`). `board.write` is an undoable edit anyone may make to what is theirs; `board.commit` is the same for whoever may build
- Fog by the room: with the fog tool a tap hides or reveals the whole room under the finger as one step of undo (`regions` in
  `src/rules.ts`: the floor of one level, bounded by walls of every kind, doorways too, and by blocks; null on open ground, where a
  tap is one column as before), a drag still paints columns. "As players" in its dock is `board.preview(on)`: only this device's view
  (fog solid, hidden minis gone, the players' line of sight), no brush edits while it is on, and it ends with the tool.
  `node scripts/e2e2-fog.mjs` checks both
- Rules of the new chrome: no top bar; a new state swaps the dock's slots and never adds a row; no ring and no hidden
  gestures (long-press is only ever a shortcut); nothing is confirmed with a dialog — it is done, said in a notice, and Undo takes it back
- `node scripts/e2e2.mjs` (after a build) checks it on phone viewports, including the screen budget: every dock state goes through its `layout()`

## Commands

- `npm run dev` · `npm test` · `npm run build && npm run e2e` · `npm run e2e:new` (the redesigned chrome)
- `npm run relay` — local in-memory relay (used by e2e)
- `npm run blossom` — local in-memory Blossom file server (used by e2e; `MAX_SIZE`/`REJECT_MIME` make it picky)
- `npm run thumbs` — re-render the library pictures (`public/ui/thumbs.webp`, indexed by `src/thumbs.json`) after the kit changes
- `npm run kit` — rebuild the kit packs with headless Blender (`-- --sheet out.png` also renders a contact sheet); which family ships in which pack is `assets/blender/packs.py`
