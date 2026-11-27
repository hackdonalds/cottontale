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
| ✋ Move | drag minis; tap one for its panel and emotes (⚔️ 💥 🎉 …); press and hold the table to ping |
| 🧱 Build | tap or drag to place the selected block or prop; ⛏️ erases; pick a shelf (Terrain, Nature, Furniture…) from the picker; *Copy & paste* lifts an area and stamps it elsewhere, or shares it as a text code |
| ♟️ Minis | tap to place the selected mini |
| 📏 Measure | drag for distance, radius or cone; everyone sees it; tap to put it away |
| 🌫️ Fog (GM) | drag to hide areas from players, or to reveal them |
| ▲▼ Cutaway | hide upper floors to look inside buildings; *Auto* lifts the roof over the selected mini |

**Running a game.** ☰ → *Become the GM*. From then on only the GM builds,
places minis, and moves everything; players move the minis the GM hands them
(🎮 in a mini's panel). The GM can also:

- hide a mini (🙈) — players don't see it, the GM sees it ghosted;
- paint fog over unexplored areas, and switch on line of sight so players only
  see creatures their own minis can see;
- track hit points (❤️) and initiative (⚔️): minis with an initiative number
  form the turn order shown at the top, and players move on their own turn;
- make a mini fly (🕊️), knock it down (💀), give it extra stat lines (📊), and
  roll in secret (🙈 in the dice sheet: players see blank dice);
- keep several **boards** on one table (☰ → Boards): prepare a map on your own,
  then bring everyone over with ▶;
- set the **atmosphere** (☰ → Atmosphere): day, dusk or night, and a soundscape
  — rain, wind, campfire, cave, calm music, battle drums. All sound is
  synthesised on the device (nothing to download) and each player can mute it.

- pick the **rules** the table plays by (☰ → Rules): a game system is a data file (`public/systems`) describing the
  character sheet, dice, conditions and what happens by itself. Each piece then has a sheet (Sheet in the dock, or the
  sheet button on a selected piece): tap a stat or a roll to put its dice in your hand; the faces that land are read
  by the rules (advantage, exploding dice, counted successes). Conditions show over the piece.

With no GM the table is free play: everyone can do everything. These rules
decide what each player's app shows — everyone at the table holds the same key,
so they keep honest players from spoilers rather than stop a determined cheat.

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
in chat puts those dice in your hand; `/w name hello` whispers.

The ☰ menu has a starter scene, export/import, and clear.

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

- Files a GM brings (images, models, sounds) never pass through a server of
  ours (`src/blob.ts`). Each is encrypted with a second key derived from the
  table code and named by the SHA-256 of the ciphertext; the table only stores
  that small reference. The blob itself is kept in the browser's cache, offered
  to public [Blossom](https://github.com/hzrd149/blossom) servers (table
  setting `set:blossom`, per-device override in `localStorage`), and when no
  server has it, fetched from another player at the table over WebRTC
  (signalling goes through the encrypted room channel). Whatever arrives is
  checked against its hash before it is decrypted.

Relays are editable on the join screen. For offline/LAN play, run the bundled
dev relay (`npm run relay`, `ws://<your-ip>:7777`) and use that instead.

## Develop

```sh
npm test                      # unit tests (state merge, crypto)
npm run build && npm run e2e  # two desktop players + phone portrait/landscape
                              # touch checks, on a local relay (needs Playwright)
```

`src/catalog.ts` holds every block, prop and mini (about 30, 50 and 40 of them)
— all built from primitives, so adding one is a few lines plus a shelf entry. Development is mobile first; see `CLAUDE.md`.
