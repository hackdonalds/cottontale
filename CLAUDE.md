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
- `src/theme.ts` themes: plain data, never code — a mood, the pieces shown first, a generator. None is written into the app: the ones on offer are files (`public/themes/*.json`, listed in `index.json`), and picking one copies it whole into the board's `at:theme`. A mood may carry its own look as data (`light`, `fog`, `grade`, and the theme's `dice`), over the three named skies. Everything goes through `parseTheme` — unit-test here
- Atmosphere (`at:theme|sky|season|glow|amb`) belongs to a board; read and write it only with `atmo`/`setAtmo` (`src/theme.ts`), which fall back to the table-wide `set:*` as the default
- `src/registry.ts` pieces that are not built in: `registerPack(ns, pack)` puts `ns:name` blocks, props, minis and shelves into the catalog records at run time (`known`, `onRegistry`). Bare ids are the core. An id nobody has registered is drawn as a stand-in, never a crash
- `src/blob.ts` the GM's own files without a server of ours: encrypted, named by the SHA-256 of the ciphertext, kept in a
  local cache, offered to Blossom servers (`set:blossom`), else passed between players (`src/blobpeer.ts`, WebRTC).
  The store only ever holds the small reference `{h,n,m,s?}`; read it back with `parseRef` — use `blobs.put/get/objectUrl`.
- Thin walls live on cell edges, not in cells: `w:x,y,z,n|w` (low-z / low-x side of a cell, see `src/rules.ts`).
  They block sight unless the piece is a window or doorway; corner posts are derived, never stored.
- Board-specific keys (`b:` `m:` `f:` `w:` `at:` `turn`) are scoped per board by the store;
  everything else is table-wide. Live messages carry the board id (`bd`).

## Commands

- `npm run dev` · `npm test` · `npm run build && npm run e2e`
- `npm run relay` — local in-memory relay (used by e2e)
- `npm run blossom` — local in-memory Blossom file server (used by e2e; `MAX_SIZE`/`REJECT_MIME` make it picky)
- `npm run thumbs` — re-render the library pictures (`public/ui/thumbs.webp`, indexed by `src/thumbs.json`) after the kit changes
- `npm run kit` — rebuild the kit packs with headless Blender (`-- --sheet out.png` also renders a contact sheet); which family ships in which pack is `assets/blender/packs.py`
