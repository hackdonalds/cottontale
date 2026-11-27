# Cottontale

3D virtual tabletop in the browser; multiplayer over Nostr. See README.md.

## Mobile first (standing rule)

Phones are the primary target. Design and build every feature for a phone
first, then enhance for larger screens.

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
- `src/gen.ts` seeded scene generators (wilderness, dungeon, cave, tavern): pure, whole numbers only, return ordinary edits — unit-test here
- `src/sound.ts` synthesised soundscapes and effects (no audio files)
- `src/theme.ts` themes: plain data, never code — a mood, the pieces shown first, a generator. None is written into the app: the ones on offer are files (`public/themes/*.json`, listed in `index.json`), and picking one copies it whole into `set:theme`. Everything goes through `parseTheme` — unit-test here
- `src/ui/` the chrome that is not the table, wired into `main.ts` by small hooks — new UI logic goes here, not into `main.ts`:
  - `sheets.ts` sheet heights. Every `.sheet` has three (`data-h`: peek = its first row, half = as it opens, full = forms) and a grab handle that is a real button (`setSheetHeight(id, 'peek'|'half'|'full')`, `sheetHeight`, `cycleSheetHeight`). One sheet at a time; a sheet sits on top of the dock (`--dock`) and drops to peek when a finger lands on the table; `#hud[data-sheet]` hides what a sheet would cover. Drill down with `pushSheetPage(id, title, render)` (a page with Back in the same sheet), never a second sheet
  - `library.ts` (pure: recents, favourites, search — unit-test here) and `hotbar.ts` (the Recent / Favourites shelves, the `#lib` sheet with search and a grid). Pieces are named by key (`b_grass`, `p_barrel`, `m_knight`) and looked up at draw time, never assumed to exist; long-press pins, but the star in the library is the tap path
  - `prep.ts` Prep, the third mode: full-screen pages with a title bar and Back (button, Escape and the phone's back button share the history). Add a page with `registerPrepPage({ id, title, icon, order, hint, render(el, ctx), update?(el, ctx) })`; `prepPages.ts` has the Theme gallery and placeholders that a page with the same id replaces
- Thin walls live on cell edges, not in cells: `w:x,y,z,n|w` (low-z / low-x side of a cell, see `src/rules.ts`).
  They block sight unless the piece is a window or doorway; corner posts are derived, never stored.
- Board-specific keys (`b:` `m:` `f:` `w:` `turn`) are scoped per board by the store;
  everything else is table-wide. Live messages carry the board id (`bd`).

## Commands

- `npm run dev` · `npm test` · `npm run build && npm run e2e`
- `npm run relay` — local in-memory relay (used by e2e)
- `npm run thumbs` — re-render the library pictures (`public/ui/thumbs.webp`, indexed by `src/thumbs.json`) after the kit changes
- `npm run kit` — rebuild the kit packs with headless Blender (`-- --sheet out.png` also renders a contact sheet); which family ships in which pack is `assets/blender/packs.py`
