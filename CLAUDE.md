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
  idle, keep the bundle and GPU cost phone-sized.
- **Verify on a phone viewport:** `npm run e2e` runs phone portrait/landscape
  checks (touch gestures, overlap, target sizes). Extend them with new UI.

## Commands

- `npm run dev` · `npm test` · `npm run build && npm run e2e`
- `npm run relay` — local in-memory relay (used by e2e)
