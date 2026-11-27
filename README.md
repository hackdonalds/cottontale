# 🐇 Cottontale

A small 3D virtual tabletop for family adventures, played in the browser.
Build a map out of blocks and props, drop minis on it, roll dice, and chat —
with everyone connected **over Nostr relays**. No server, no accounts.

## Play

```sh
npm install
npm run dev        # http://localhost:5173
```

Enter a name, keep (or type) a table code, and send the **Invite** link to the
others. Everyone with the same code sits at the same table.

| | |
|---|---|
| ✋ Move | drag minis; click one to rename, recolour, turn, resize, remove |
| 🧱 Build | click a surface to place the selected block or prop |
| ⛏️ Erase | click a block or prop to remove it |
| ♟️ Minis | click to place the selected mini |
| 📣 Ping | click to show everyone a spot |

**Phone / tablet (the primary target):** one finger looks around; with 🧱 or ⛏️
selected, tap to edit and drag to paint a flat layer. Two fingers pan, pinch to
zoom and twist to turn — and never edit. ↩️ undoes (a whole stroke at once), 🎲
opens dice and chat. Add it to your home screen to run it full-screen like an app.

**Desktop:** left-drag orbits, right-drag pans, wheel zooms. Keys: `1`–`5`
tools, `R` rotate, `Ctrl+Z` undo, `Del` remove mini, `Enter` chat.

**Dice are real:** tap dice in the 🎲 sheet to pick them up (any mix, up to 12),
then touch the table — they hover and tumble under your finger — and let go to
throw. A flick flings them; they bounce off the terrain, everyone watches the
same tumble, and the faces that end up on top are the result. `/r 2d6+1d20+3`
in chat puts those dice in your hand.

The ☰ menu has a starter meadow, export/import, and clear.

`npm run build` produces a static site in `dist/` that can be hosted anywhere
with HTTPS (the browser's crypto API requires it).

## How multiplayer works

- The table code is run through PBKDF2 to derive an **AES-GCM key** and a public
  **room tag**. All event content is encrypted; relays only see the tag.
- Live actions (edits, drags, dice, chat, pings, presence) are ephemeral events
  (kind `21420`), so relays don't keep them.
- Each player periodically publishes an encrypted, gzipped **snapshot** of the
  board as addressable events (kind `30078`, chunked). Late joiners and
  returning players rebuild the table from these. A copy is also kept in
  `localStorage` and re-published if the relays have lost it.
- A dice throw is simulated on the thrower's device (`src/dice.ts`, physics
  engine loaded on demand), recorded, and sent inside the roll event; everyone
  replays the recording, so all players see identical dice.
- State is a last-writer-wins map (`src/store.ts`), so ops and snapshots merge
  in any order and all players converge.
- Your Nostr key is generated on first visit and stays in the browser.

Relays are editable on the join screen. For offline/LAN play, run the bundled
dev relay (`npm run relay`, `ws://<your-ip>:7777`) and use that instead.

## Develop

```sh
npm test                      # unit tests (state merge, crypto)
npm run build && npm run e2e  # two desktop players + phone portrait/landscape
                              # touch checks, on a local relay (needs Playwright)
```

`src/catalog.ts` holds every block, prop and mini — all built from primitives,
so adding one is a few lines. Development is mobile first; see `CLAUDE.md`.
