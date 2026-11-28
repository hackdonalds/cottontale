# GM and player live-play UX on phones and tablets (state as of late 2026)

Researcher's note on evidence quality (read first): Reddit, the Owlbear Rodeo docs and the D&D Beyond help centre could not be read in this session (search returned nothing usable for Reddit/Owlbear; two official pages returned HTTP 403). The strongest evidence gathered is (a) Foundry VTT's ecosystem of mobile modules, whose feature lists are a direct record of what phone users found missing, (b) vendor statements from Roll20 and D&D Beyond about phone support, (c) forum threads on in-person/TV play, and (d) one review of a phone-as-controller game (Sunderfolk). Several findings come from search-result summaries rather than a full read of the page; these are marked "(search summary)". Nothing was found for Alchemy RPG, Demiplane, Role, Quest Portal, Tableplop, Shmeppy, Mythic Table, Fight Club 5, Kobold+ or dedicated dice apps; those are listed as gaps, not covered from memory.

## 1. Most frequent in-session GM actions and how top tools minimise taps

### Takeaway
No tool was found that documents a phone-first GM surface for the whole action list; the evidence is that phone tooling is overwhelmingly player-side, and GM-side phone control is a gap in the market. The closest documented patterns are combat-tracker shortcuts (apply damage/heal directly to a creature, click-to-roll from a stat block, multi-target damage) and a small persistent set of quick controls (ruler, template, volume, ping).

### Cited Findings
- Improved Initiative's headline feature is direct damage application: "Apply damage – No need to do math anymore, you can apply damage or healing directly to the creature getting hit." Rolls are one tap from the stat block: "you can just click on the attack or damage roll and the tool will automatically generate the result." — [Arcane Eye roundup](https://arcaneeye.com/dm-tools-5e/best-dnd-5e-initiative-tracker/)
- Same review rates Improved Initiative 11/10 for features but 6/10 for ease of use ("learning curve"), and D&D Beyond's tracker 9/10 for ease of use with adding campaign characters "with the push of a button" — but D&D Beyond cannot change initiative order mid-encounter, and character HP does not carry into the tracker automatically. — [Arcane Eye roundup](https://arcaneeye.com/dm-tools-5e/best-dnd-5e-initiative-tracker/)
- Multi-target damage exists in newer trackers: DnDino's damage window "lets you choose one or more targets"; the Obsidian "Roll Initiative" plugin can "tick everyone among several targets" for rolled damage/healing and writes damage, healing, conditions and death saves back to the players' sheets (search summary). — [DnDino](https://diocleziano.github.io/dndino-site/sections/combat/); [Roll Initiative plugin](https://community.obsidian.md/plugins/roll-initiative)
- Swipe VTT (Foundry 13+, phone/tablet module) keeps a short list of always-available controls: "easy access to volume, ruler, template and logout buttons", plus a macro bar ("activate macros from mobile") and a touch template placer ("Touch-friendly spell template positioning"). — [Swipe VTT](https://foundryvtt.com/packages/swipe-vtt)
- TouchVTT adds a GM play/pause button under the Foundry logo and enlarges the left-side tool buttons; removing an area template is a two-step tool flow: "First tap the eraser tool, then tap the template you want to remove." — [TouchVTT on Foundry Hub](https://www.foundryvtt-hub.com/package/touch-vtt)
- Player Pilot lists "Pinging on the map" and chat among the handful of actions worth putting in a simplified phone panel, and lets the GM "finish a player's roll on screen" and toggle player movement on or off. — [Player Pilot](https://foundryvtt.com/packages/player-pilot)
- "Mobile Token Control" is described in search as GM-side, but its page lists only: select among own tokens, a map view centred on the selected token, direction controls, zoom, and "Space to view Initiative tracker at the top". It does not document HP edit, conditions or turn advance. — [Mobile Token Control](https://foundryvtt.com/packages/mobile-token-control)
- For in-person play, a guide recommends a Stream Deck (or Stream Deck Mobile on a phone) via Material Deck to "control the view, open sheets, trigger macros, and move tokens" — i.e. GMs reach for a grid of large dedicated buttons for repeated actions. — [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming)

### Inferences
- The actions tools bother to shortcut on small screens are consistent: damage/heal, roll from a stat line, ruler, template, ping, macro/sound trigger, volume, pause. That is a credible "thumb-reach" shortlist for a GM dock.
- Multi-target damage (pick several, apply once) is treated as a selling point by newer trackers, which implies single-target-only flows are a felt pain.
- A Stream Deck is essentially a soundboard-style grid of big labelled buttons; a phone GM mode can be that grid natively (scene switch, ambience, reveal, add monster).
- D&D Beyond's missing "reorder initiative mid-fight" being called out as a con implies drag-to-reorder/insert is expected.

### Gaps
- No source found measuring frequency of GM actions or tap counts.
- No documentation found for one-tap scene switching, mid-fight monster add, whisper, or soundboard on a phone in any tool. Sly Flourish / The Alexandrian were not searched successfully.
- Game Master 5e, Fight Club 5, Kobold+ and Shieldmaiden: only store/listing-level mentions surfaced; no workflow detail.

## 2. Initiative / turn tracker designs on mobile

### Takeaway
Detailed layout descriptions of the named trackers (tap HP → numeric pad, condition chips, next-turn placement) could not be sourced. What is sourced: the tracker belongs at a screen edge as a compact strip, a separate reduced "player view" by link is standard, and trackers are judged on damage entry without mental arithmetic.

### Cited Findings
- Improved Initiative: apply damage or healing directly to the creature; "you can send players a link so they can see where they are in initiative." Data is tied to one browser unless a paid account sync is used (export/import JSON otherwise). — [Arcane Eye roundup](https://arcaneeye.com/dm-tools-5e/best-dnd-5e-initiative-tracker/)
- Hero Muster puts conditions, notes and stat sheets "on one screen", yet is rated 4/10 for ease of use ("Getting to know the system is pretty tough"). — [Arcane Eye roundup](https://arcaneeye.com/dm-tools-5e/best-dnd-5e-initiative-tracker/)
- A browser tracker's "Player View toggle" hides "sensitive info (HP numbers, actions, dice roller, DM controls)" (search summary). — [DM Dungeon toolbox](https://dnddmtoolbox.netlify.app/initiative)
- DnDino's player window shows current, maximum and temporary HP (search summary). — [DnDino](https://diocleziano.github.io/dndino-site/sections/combat/)
- D&D Battle Tracker installs as a Progressive Web App on mobile; its README lists Shieldmaiden as "previously Harmless Key" (search summary). — [dnd-battle-tracker](https://github.com/Paul-Ladyman/dnd-battle-tracker)
- Encounter+ (iOS/iPadOS) offers "Initiative, health, experience, and condition tracking" free, with combatants also placed as tokens on the map. Reviews praise it ("makes planning and running my games massively easier") but report a learning hump ("it was a little confusing at first"; one asks for a basic guide). Reviews are 2018–2021. — [Encounter+ App Store listing](https://apps.apple.com/us/app/encounter-vtt-for-d-d-5e/id1170693487?l=en-US)
- On a phone controller for Foundry, the initiative tracker is given a reserved strip "at the top", tested with the "combat-tracker-dock" module (a horizontal portrait-card dock). — [Mobile Token Control](https://foundryvtt.com/packages/mobile-token-control)

### Inferences
- A horizontal strip of turn cards at an edge plus a separate, larger GM tracker sheet is the pattern phone tools converge on; a full-height list tracker does not coexist with a map on a phone.
- Feature-complete trackers lose on ease of use (Improved Initiative 6/10, Hero Muster 4/10) while a simpler one wins (D&D Beyond 9/10): fewer visible controls with damage entry as the primary action is the safer design.
- The player view should hide exact enemy HP and GM controls by default.

### Gaps
- Could not verify: Shieldmaiden's layout and multi-target/"apply to all" flow, Game Master 5e's and Fight Club 5's HP keypads, Encounter+'s HP-edit gesture, where each puts "Next turn". Needs hands-on or screenshots.
- No user quotes found about numeric-pad vs stepper HP entry.

## 3. Player-side phone UX

### Takeaway
On phones, players are best served by a reduced "pilot" surface — own character(s), a few actions, a move control and a map centred on their token — rather than the full VTT. Sheets designed for ≥800px are the single biggest structural problem; the fixes are single-column sheets with bottom tabs.

### Cited Findings
- Width mismatch is quantified: the dnd5e sheet "needs a window of at least 800px" while phones are 360–430px wide. Beaver's Mobile responds with one scrolling column (character card with portrait, AC, initiative, speed, HP, hit dice first; then abilities, favourites, then skills/saves/traits) and tabs "under your thumb, instead of outside the window's right edge." — [Beaver's Mobile](https://foundryvtt.com/packages/beavers-mobile)
- Beaver's Mobile v3 keeps "same data, same buttons, same rolls" as the desktop sheet and removed its earlier virtual gamepad, canvas hiding and item-drag blocking. — [Beaver's Mobile](https://foundryvtt.com/packages/beavers-mobile)
- Player Pilot is "mobile-first": items, weapons, spells (cast/upcast/prepare), a "streamlined action flow", targeting, movement, ping, chat. Rolling has three modes: follow the GM's in-person instruction (real dice), tap a button to roll on a shared/GM screen, or show results on the player's device. Players log in with GM-assigned credentials through an invite URL. — [Player Pilot](https://foundryvtt.com/packages/player-pilot)
- Swipe VTT: a "swipeable avatar carousel" of owned characters; the sheet opens as a "compact drawer"; a "Combat Section" gives "Quick access to attacks, saves, and ability checks"; chat is a slide-out drawer; a "second-screen companion mode" gives sheet, saves, skills, attacks and HP updates. — [Swipe VTT](https://foundryvtt.com/packages/swipe-vtt)
- Moving one's own token from a phone: Mobile Token Movement auto-offers a "minimal interface" when screen width is ≤600px and requires an assigned character; Simple Mobile "moves tokens with on-screen buttons, not dragging" and has a performance mode that disables the canvas; Mobile Token Control shows only "part of the map (centered on selected token with field of view)" with direction controls and zoom. — [Mobile Token Movement](https://foundryvtt.com/packages/mobile-token-movement); [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming); [Mobile Token Control](https://foundryvtt.com/packages/mobile-token-control)
- Companion-app route: PocketScroll (sheets, dice, combat, maps on a phone; GM must be logged in for the bridge) and VTT Companion (free tier is read-only live sync; paid adds editing HP and spending spell slots) (search summary). — [PocketScroll](https://foundryvtt.com/packages/pocketscroll-socket); [VTT Companion](https://vttcompanion.github.io/fca-wiki/index.html)
- Roll20's app is deliberately sheet-and-dice only: tokens, maps, voice and video "are not included"; players like it for rolling skills and attacks "without keeping a laptop open" (search summary). — [Roll20 wiki: App](https://wiki.roll20.net/App)
- D&D Beyond Maps runs in the phone browser, not the app; forum users report "the app does not currently support the maps" (search summary). — [D&D Beyond forum](https://www.dndbeyond.com/forums/d-d-beyond-feedback/217129-maps-and-dm-ing/next)

### Inferences
- Three independent Foundry modules chose button/stepwise movement over free drag for phone players, and one of them later dropped its gamepad. Tap-destination or step controls with a preview are the safer default; drag is the contested option.
- "Carousel of my characters → drawer sheet → combat quick actions" is the common information architecture: show the player only what they own.
- Requiring GM-assigned credentials or a running bridge is friction these modules inherit from Foundry; a link/QR join with no account is a differentiator, not table stakes among incumbents.

### Gaps
- No sourced user research on tap-tap vs drag with path preview/confirm.
- No sourced detail on claiming a character at join, or QR flows in Owlbear Rodeo / Alchemy / Quest Portal.
- No direct player complaint quotes from Reddit obtained.

## 4. Documented complaints about VTTs on phones

### Takeaway
The major VTTs say outright that phones are not a supported target; the recurring concrete failures are sheets that do not fit, maps that fail to load or run hot, gesture ambiguity, and iOS Safari quirks.

### Cited Findings
- Roll20: staff say the app and Table-on-Tablet are "intended for iPads and Android tablets, not mobile phones"; a user says "once you get below a certain screen size Roll20 become almost unusable" (around 5–6 inches); mobile browser on phone "isn't officially supported"; long-running reports of the app stuck on the loading screen and rejecting valid passwords (search summary; quote-to-thread mapping not individually verified). — [Roll20 wiki: App](https://wiki.roll20.net/App); [Roll20 forum thread](https://app.roll20.net/forum/permalink/12405851)
- D&D Beyond: "Maps isn't going to be initially optimized for phone and tablet, but you can still use your mobile device"; help text says mobile Maps "is still in development, so your experience may not be ideal"; DMs report players "can't view the maps" on iPhones; a wishlist post notes tools "do not have touch" (search summary). — [Maps launch guide](https://www.dndbeyond.com/posts/1570-d-d-beyond-maps-how-to-start-playing-today); [Navigating the Map](https://dndbeyond-support.wizards.com/hc/en-us/articles/46385088438420-Navigating-the-Map); [Maps bug thread](https://www.dndbeyond.com/forums/d-d-beyond-general/bugs-support/182006-d-d-beyond-maps?comment=23); [Maps wishlist](https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/180944-maps-wishlist)
- Separate D&D Beyond threads exist titled "issues moving zooming map on iPad" and "availability and performance issues of VTT on…" (titles only; not read). — [iPad thread](https://www.dndbeyond.com/forums/d-d-beyond-general/bugs-support/236207-issues-moving-zooming-map-on-ipad?comment=2); [performance thread](https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/242285-availability-and-performance-issues-of-vtt-on?comment=5)
- Foundry: Swipe VTT lists what it has to fix — games too slow or failing to load, low frame rate, "overheating on devices", windows too large for the screen (it scales them down), "iOS Safari quirks", and heavy images (an optimiser to "compress scene backgrounds and tokens for faster loading"). — [Swipe VTT](https://foundryvtt.com/packages/swipe-vtt)
- Gesture ambiguity: TouchVTT "does tend to go a bit 'jittery' when it tries to distinguish between pan and zoom gestures"; workaround is locking one of pan or zoom. One user saw "just a big blank gray space" instead of the map. — [TouchVTT on Foundry Hub](https://www.foundryvtt-hub.com/package/touch-vtt)
- Sheets on tablets: "When I open a character sheet it does not load it up properly and can't be used to function as a sheet at all" (2021 iPad, Forge). Staff: Chrome on Android should work, Safari was not supported at the time. — [Forge forum](https://forums.forge-vtt.com/t/forge-vtt-mobile/14850)
- Module rot: a 2021 guide's phone modules (Simple Mobile, Mobile Improvements) are reported in comments as no longer working on newer Foundry; another page says TouchVTT "is broken using V11" (search summary); Mobile Token Movement was last updated four years ago. — [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming); [Gaming Table](https://foundryvtt.com/packages/gaming-table); [Mobile Token Movement](https://foundryvtt.com/packages/mobile-token-movement)
- Scroll-vs-drag collisions: Beaver's Mobile v2 had to block item drags that duplicated items while scrolling (search summary; the v3 page only records that the blocking was removed). — [Beaver's Mobile](https://foundryvtt.com/packages/beavers-mobile)
- Low-resolution warning: Foundry "may show a warning on screens with low resolution", which a mobile module author tells users to ignore. — [Player Pilot](https://foundryvtt.com/packages/player-pilot)

### Inferences
- Phone support bolted on by third parties breaks with each platform release; first-party phone support is the durable advantage.
- Heat/battery and load time are named alongside layout — render-on-demand and small assets are user-visible features, not just engineering hygiene.
- Any list that both scrolls and supports drag needs an explicit disambiguation (handle, long-press), or it produces data-corrupting accidents.

### Gaps
- No Reddit or app-store quotes on: accidental token moves while panning, keyboard covering inputs, connection drops. These are widely assumed but were not sourced here.
- Owlbear Rodeo on phones: no evidence either way obtained.

## 5. Token interaction patterns on touch

### Takeaway
The de facto touch grammar in the Foundry ecosystem is: tap = select/target, drag = move, double-tap = sheet, long-press = token HUD/context menu, two fingers = camera. The alternative for phones is no drag at all (direction buttons or move-along-measured-path).

### Cited Findings
- Swipe VTT gesture table: single tap "Select token <-> Target Token"; drag "Move token"; double tap "Open character sheet"; long press "Show token HUD"; two-finger pan "Move canvas"; pinch "Zoom in/out". — [Swipe VTT](https://foundryvtt.com/packages/swipe-vtt)
- TouchVTT: long press (0.5 s) replaces right-click; tapping a hostile token targets it; tokens drag "similar to using a mouse"; optional rotate buttons in the token HUD; ruler with waypoints where you "move your token along the measured path using a Touch-Only UI"; two-finger pinch/drag for camera, with optional three-finger pan when two-finger panning is disabled. — [TouchVTT on Foundry Hub](https://www.foundryvtt-hub.com/package/touch-vtt)
- Button-based movement instead of drag: Simple Mobile, Mobile Token Control ("Controls in any directions"), Beaver's Mobile Pawn (walk, turn, open doors from the phone). — [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming); [Mobile Token Control](https://foundryvtt.com/packages/mobile-token-control); [Beaver's Mobile Pawn](https://foundryvtt.com/packages/beavers-mobile-pawn)
- GM can switch player movement controls off entirely. — [Player Pilot](https://foundryvtt.com/packages/player-pilot)
- Sunderfolk (phone-controlled tactics game): "your finger slides dictating where you move and what you target", controls "unexpectedly intuitive", but the reviewer sometimes struggled to select the intended hex. — [Wargamer](https://www.wargamer.com/sunderfolk/impressions-phone-powered-gloomhaven-inspired-rpg)

### Inferences
- "Measure, then move along the measured path" is in effect a path-preview-then-confirm move; it exists because raw drag is imprecise on touch and it doubles as the distance readout.
- Overloading single tap as both select and target (Swipe VTT) hints that touch lacks a spare modifier; an explicit mode or a bottom action bar on select is cleaner than hidden toggles.
- Even a purpose-built phone game shows cell-picking errors; snap, magnified preview and one-step undo are worth having.

### Gaps
- No sources found on multi-select on touch (lasso, tap-to-add), radial menus, or undo-move in mobile VTTs.
- No comparative user feedback on HUD vs bottom bar vs radial.

## 6. Fog of war / vision on touch

### Takeaway
Little phone-specific evidence. What exists: dynamic vision is preferred when set up, but setup is where it fails; shared screens need a "party vision" mode and a GM-controlled player view.

### Cited Findings
- Fog of war "can be cool if the GM has everything setup correctly," but that is "often not" the case. — [EN World thread](https://www.enworld.org/threads/does-anybody-use-vtts-in-person.719680/)
- On a shared screen, default Foundry vision shows only the selected token's view; modules are needed to share vision across the party (Shared Vision, Shared Token Visibility), and "Simple Fog" provides manual fog as the alternative. "Token Drag Vision" is recommended so vision updates smoothly during a move. — [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming)
- Monk's Common Display mirrors/controls a player-facing screen and hides UI; MapTool users control "masking and Line of Sight functionality from a separate screen" (search summary). — [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming); [EN World TV-table thread](https://www.enworld.org/threads/software-for-a-tv-table-battle-map-and-more-uses.678864/page-2)
- Encounter+ offers fog of war, line of sight and dynamic lighting on iPhone and iPad. — [Encounter+ App Store listing](https://apps.apple.com/us/app/encounter-vtt-for-d-d-5e/id1170693487?l=en-US)
- TouchVTT adds touch-friendly wall placement tools. — [TouchVTT on Foundry Hub](https://www.foundryvtt-hub.com/package/touch-vtt)

### Inferences
- Vision that needs no wall-drawing prep (derived from the built scene) removes the stated failure mode.
- A shared-display mode should union the party's sight by default; per-token vision is for personal devices.
- The GM needs a quick "see as players" check and a manual override (reveal/hide region) for when automatic vision is wrong.

### Gaps
- No sourced comparison of reveal brushes vs dynamic sight on phones; no user quotes on finger-painting fog.

## 7. Dice UX

### Takeaway
Very little was sourced. The firm points: rolls should fire from the sheet/stat line, in-person groups often prefer real dice, and tools therefore offer a choice of where a roll happens.

### Cited Findings
- Player Pilot supports three roll paths: real dice per the GM's instruction, a button that rolls on the shared/GM screen, or results shown on the player's own device; the GM can complete a player's roll. — [Player Pilot](https://foundryvtt.com/packages/player-pilot)
- Beaver's Mobile Pawn keeps dice analog by design: players roll real dice and the GM runs initiative. — [Beaver's Mobile Pawn](https://foundryvtt.com/packages/beavers-mobile-pawn)
- The in-person guide calls automation and dice rolling "the weakest part of in-person play"; physical dice are common. — [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming)
- Roll20's phone app is valued chiefly for rolling from the sheet at an in-person table (search summary). — [Roll20 wiki: App](https://wiki.roll20.net/App)
- Encounter+ treats a plain dice roller as free and a "3D dice roller with themes" as a premium feature. — [Encounter+ App Store listing](https://apps.apple.com/us/app/encounter-vtt-for-d-d-5e/id1170693487?l=en-US)
- Flash Token Bar roll requests (GM asks, players get a prompt) are integrated into Swipe VTT's phone UI. — [Swipe VTT](https://foundryvtt.com/packages/swipe-vtt)

### Inferences
- 3D dice are a delight/monetisable feature rather than a necessity; a manual-entry path ("I rolled a 17 on real dice") and a fast/skip-animation path both matter.
- GM-initiated roll requests that pop a single button on each player's phone are the lowest-tap group-roll pattern.
- Rolling on the shared screen from a phone button is a distinct, desirable mode for TV play.

### Gaps
- No sources on shake-to-roll, dice trays, saved rolls, roll history, or "fun vs slow" sentiment; no dice-app reviews obtained.

## 8. Hybrid in-person play (TV/tablet as map, phones as controllers)

### Takeaway
This is a well-documented, under-served use: groups assemble it from many modules. The needs are a chrome-free presenter view the GM steers, phones as small controllers/sheets, party-wide vision, and a guard against everyone staring at their own screen.

### Cited Findings
- Typical Foundry recipe: one GM account plus a single "player" account owning all characters for the TV; individual accounts only for phone sheet access; disable "Pan to Token Speaker"; lock zoom/pan and auto-scale to a 25 mm grid (Lock View); hide UI; keep maps to about 20×35 squares on a 42" TV so no panning is needed. — [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming)
- Physical minis on a flat TV obscure status icons and parts of the map; auras are suggested to compensate. — [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming)
- Beaver's Mobile Pawn: screen on the table shows the map; the phone is "the gamepad for your character" (walk, turn, open doors); sheet on the device, tablet recommended because sheets are too wide for phones. — [Beaver's Mobile Pawn](https://foundryvtt.com/packages/beavers-mobile-pawn)
- Roll20 on a 43" TV: "everyone is staring at their laptops instead of the decades of miniatures on the TV"; workaround is logging one player account into the TV that controls all tokens (search summary). — [Roll20 forum](https://app.roll20.net/forum/permalink/12604184)
- One Foundry group had a single player move all tokens to mirror physical minis and called it a less ideal option (search summary). — [Foundry Hub in-person guide](https://foundryvtt-hub.com/guide/using-foundry-for-in-person-gaming)
- Distraction: "4 of the players are often lost in other devices between actions." Upside: a VTT on a TV avoided "a lot of jumping up and down to manuever things" on a physical map. — [EN World thread](https://www.enworld.org/threads/does-anybody-use-vtts-in-person.719680/)
- Fantasy Grounds users asked for exactly "Move Player Token & Roll Dice from phone/tablet for In-Person/Face-to-Face play on TV"; the community add-on is Windows-only, needs administrator rights, and was only tested on Android (search summary). — [Fantasy Grounds forum](https://www.fantasygrounds.com/forums/archive/index.php/t-45911.html)
- Encounter+ gives "External display support via AirPlay" in its free tier and a built-in web server for remote players in premium. — [Encounter+ App Store listing](https://apps.apple.com/us/app/encounter-vtt-for-d-d-5e/id1170693487?l=en-US)
- A Steam app targets in-person TV play with remote players joining by browser to move tokens (search summary; product name not captured). — [Steam](https://store.steampowered.com/app/3073720)
- Sunderfolk's split: TV carries the shared scene; the phone carries ability choice, shop/equipment, rules lookup, private conversations and "a closer look at the board". Players glance at the phone to pick, then look back up; "The extra screen didn't seem to matter" in combat, but in town the group sat "in silence staring at our phones", and every player needs a charged phone. — [Wargamer](https://www.wargamer.com/sunderfolk/impressions-phone-powered-gloomhaven-inspired-rpg)

### Inferences
- A first-class "table display" role (no chrome, GM-driven camera, party vision, fixed physical scale option) replaces five or six Foundry modules.
- Phone UI in TV mode should be glanceable and short-lived: pick, confirm, eyes up. Long phone-only activities kill table talk.
- Private information on phones is a strength for secrets but should be shareable to the big screen on demand.

### Gaps
- No evidence on a GM running the whole session from a phone while a TV presents (GM-screen-on-phone); appears unserved.
- No data on casting methods (Chromecast/AirPlay vs a second browser join) preferences.

## 9. Onboarding a group in minutes

### Takeaway
Almost nothing citable was obtained on link/QR joining; the evidence is negative: incumbents require accounts, GM-assigned credentials, per-player module switches, or a bridge, and first-use confusion shows up in reviews.

### Cited Findings
- Player Pilot setup: enable the module, enable it per player, grant token ownership, and have players log in with GM-assigned credentials via an invite URL. — [Player Pilot](https://foundryvtt.com/packages/player-pilot)
- Mobile Token Movement requires a pre-assigned character and auto-detects phones (≤600px) to offer its UI in a dialog. — [Mobile Token Movement](https://foundryvtt.com/packages/mobile-token-movement)
- Mobile Token Control activates automatically on joining from Android or iOS. — [Mobile Token Control](https://foundryvtt.com/packages/mobile-token-control)
- Companion apps need the GM online for the bridge (PocketScroll) or a paid tier for two-way edits (VTT Companion) (search summary). — [PocketScroll](https://foundryvtt.com/packages/pocketscroll-socket); [VTT Companion](https://vttcompanion.github.io/fca-wiki/index.html)
- First-run friction in reviews of Encounter+: "It took me a little bit to learn how the app worked"; request for a basics guide. — [Encounter+ App Store listing](https://apps.apple.com/us/app/encounter-vtt-for-d-d-5e/id1170693487?l=en-US)
- In-person first session friction: players "initially had to direct moves because not everyone had their laptops set up yet." — [EN World thread](https://www.enworld.org/threads/does-anybody-use-vtts-in-person.719680/)
- Improved Initiative shares its player view by link. — [Arcane Eye roundup](https://arcaneeye.com/dm-tools-5e/best-dnd-5e-initiative-tracker/)

### Inferences
- Auto-detecting the phone and dropping straight into the reduced player UI (no setting to find) is the pattern that works.
- Joining must tolerate late or absent devices: the GM (or another player) should be able to move anyone's token until its owner arrives.
- A no-account link/QR join plus "pick your character" is a clear gap versus the Foundry/Roll20/D&D Beyond flows documented here.

### Gaps
- Owlbear Rodeo (reputed link-join, no player account), Quest Portal, Alchemy, Role, Tableplop, Shmeppy, Mythic Table: no pages retrieved; claims about them must be verified separately.
- No sources on starter/sample tables or session-zero flows.
