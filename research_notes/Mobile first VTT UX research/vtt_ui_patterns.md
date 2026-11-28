# UI/UX patterns of popular virtual tabletops (state as of late 2026)

Reader notes on evidence quality (applies to every section):

- Research date: 2026-11-28. Primary sources (vendor blogs, release notes, docs, store pages) were fetched and read directly unless a finding is tagged **[snippet]**, which means it comes from a search-result summary and the underlying page was not opened.
- Reddit could not be read directly in this session (no direct fetches succeeded; only aggregator or mirror snippets). Reddit-derived claims are tagged and should be treated as weak.
- Several roundup articles are written by vendors with a stake (StoryRoll, CZEPEKU/Alchemy). They are marked **[interested party]**.
- Coverage is uneven. Well sourced: Roll20, Foundry, Owlbear Rodeo, D&D Beyond Maps/Sigil, TaleSpire (store page and reviews), Fantasy Grounds, Shmeppy (partly). Thin or nearly unsourced: Tableplop, Bag of Mapping, Tabletop Playground, Tabletop Simulator, Let's Role (VTT side), Alchemy (independent views), One More Multiverse. The Gaps subsections say exactly what is missing.
- Items I recall from general knowledge but could not source in this session are listed only under Gaps, labelled "unverified recollection". Do not cite them as findings.

## 1. How does each product separate (or merge) GM build/prep and live play?

### Takeaway
Three models exist: (a) layers plus a tool rail in one always-editable canvas (Roll20, Foundry, Owlbear Rodeo, D&D Beyond Maps, Shmeppy), (b) an explicit build mode a GM can enter at any moment without stopping play (TaleSpire), and (c) a physics sandbox with no real prep/play split (Tabletop Simulator, Tabletop Playground). No mainstream product was found that puts prep and play behind separate full-screen modes designed for a phone; almost all assume a desktop pointer, right-click, and keyboard modifiers.

### Cited Findings

**Roll20 (Jumpgate)**
- Layers are the prep/play separator: the redesigned toolbar "kept the old layers (Token, Map, GM, and Dynamic Lighting)" and layers were "placed directly on the Toolbar for easier access" **[snippet]** — [Roll20 forum permalink](https://app.roll20.net/forum/permalink/11719367), [Roll20 2024 Change Log](https://help.roll20.net/hc/en-us/articles/34086640235927-2024-Change-Log)
- The new toolbar became the only option for all users on 16 January 2024; other redesign work sat behind an "Experimental Features" flag later renamed "Beta Features" **[snippet]** — [Roll20 forum permalink](https://app.roll20.net/forum/permalink/11761789)
- December 2024: the Jumpgate left toolbar was changed so that Layer buttons collapse before tool buttons when space runs out, matching the original behaviour **[snippet]** — [Roll20 2024 Change Log](https://help.roll20.net/hc/en-us/articles/34086640235927-2024-Change-Log)
- Token actions live in a right-click context menu. Jumpgate redesigned it, added group actions (select several tokens, lock them all at once) and mixed-selection handling (Add Turn on a selection that includes a drawing adds turns for the tokens only). Roll20: "We're also taking this opportunity to consider what options should be shown at what times." — [Roll20 blog, "Jumpgate Update: Filling Feature Gaps", 24 Jan 2024](https://blog.roll20.net/posts/roll20-jumpgate-redo-context-and-touch)
- Prep safety: Jumpgate added redo (previously only basic undo) with a per-page undo stack that survives switching pages within a session. "The better our support for undo and redo is, the more confidently you can work on your game prep." — [Roll20 blog, 24 Jan 2024](https://blog.roll20.net/posts/roll20-jumpgate-redo-context-and-touch)

**Foundry VTT (v13)**
- One canvas, with tool groups in a left "scene controls" rail and documents in a right sidebar. In v13 "the sidebar is now more of a 'cabinet' style which occupies the complete vertical space"; "the previous scene navigation bar is now a collapsed navigation menu instead"; "the canvas controls are now a little smaller but more visually distinct by way of additional spacing"; "the macro hotbar is now more centralized, balanced on each side with additional controls." — [Foundry VTT release 13.341](https://foundryvtt.com/releases/13.341)
- Token HUD: "can be viewed by right clicking on a token at any time". It carries resource-bar inputs (typing a signed number adjusts the value: "adding a positive or negative number allows you to quickly increase or decrease"), status effects, elevation, target toggle, Toggle Combat (adds or removes the token from the combat tracker), and a gear icon to open token configuration. — [Foundry VTT, Tokens article](https://foundryvtt.com/article/tokens/)
- v13 added movement type selection to the Token HUD ("Tokens can now have their 'type' of movement configured from the Token HUD"). — [Foundry VTT release 13.341](https://foundryvtt.com/releases/13.341)
- Many prep and play operations depend on keyboard modifiers: Ctrl/Cmd+click for waypoints, right-click to remove a waypoint, Escape to cancel, Alt held by the GM to hide the movement ruler from players, Shift+WASD or mouse wheel to rotate, double right-click to open token configuration. — [Foundry VTT release 13.341](https://foundryvtt.com/releases/13.341), [Foundry VTT, Tokens article](https://foundryvtt.com/article/tokens/)

**Owlbear Rodeo 2**
- Structure is Rooms (permanent, cloud-stored; replaced 1.0 "games") containing Scenes (replaced "maps"). Simple and custom rooms were later merged because "having two separate types of rooms leads to a lot of confusion" **[snippet]** — [Owlbear Rodeo docs, migrating 1.0 to 2.0](https://docs.owlbear.rodeo/docs/migration/migrate-from-1-to-2/), [Owlbear Rodeo blog](https://blog.owlbear.rodeo/owlbear-rodeo-2-0-launch-patch/)
- No build mode: everything stays editable in place. In 2.0 "every drawing can be moved, selected and edited once it has been created", including fog shapes **[snippet]** — [Owlbear Rodeo docs, migrating 1.0 to 2.0](https://docs.owlbear.rodeo/docs/migration/migrate-from-1-to-2/)
- Tool-specific top bar: for Fog, "On the left are the modes and on the right are the actions." Selecting a fog shape opens a context menu; a Cut button makes the shape togglable **[snippet]** — [Owlbear Rodeo docs, Fog](https://docs.owlbear.rodeo/docs/fog/)
- Selection-driven context menu is the token HUD equivalent: attachments are reached through a tab that appears only when the underlying token is selected, replacing 1.0's always-visible attachment handle. Stated goals: scale to multiple attachments and cut clutter by showing options only when needed. — [Owlbear Rodeo 2.0 Dev Log 1](https://blog.owlbear.rodeo/owlbear-rodeo-2-0-dev-log-1/)
- Item categories (Characters, Props, Mounts, Attachments) were promoted to first-class types replacing a generic "Tokens" type, and a Scene layer sits above maps and tokens to support multiple maps in one scene. — [Owlbear Rodeo 2.0 Dev Log 1](https://blog.owlbear.rodeo/owlbear-rodeo-2-0-dev-log-1/)

**TaleSpire**
- Build mode can be entered at any time by one or more GMs "to change the world without interrupting play"; changes sync in real time. There is a "specialized mode for managing things hidden from players", a cutscene mode, and a turn-based initiative tracker. — [TaleSpire on Steam](https://store.steampowered.com/app/720620/TaleSpire/)
- Mode switches are keyboard-driven: B enables build mode, F8 loads builder or GM mode, Tab enables GM Overlay, Space opens assets and dice, F7 is the player camera (beginner guide, likely April 2021, so possibly outdated). — [PlayerAssist beginner's guide](https://playerassist.com/talespire-beginners-guide/)
- Slabs: sections of a board "can be copied as text and pasted back into TaleSpire to summon them". — [TaleSpire on Steam](https://store.steampowered.com/app/720620/TaleSpire/)
- A radial menu is the creature/context interaction; the developers agreed that toggling hide-volume visibility should close the radial menu, and discussed a modifier key to lock the cursor to straight lines when placing copied slabs (2020, outdated but shows the pattern) **[snippet]** — [Bouncyrock feature request summary, 1 Jul 2020](https://bouncyrock.com/news/articles/feature-request-summary-2020-07-01)

**D&D Beyond Maps**
- Single view with DM-only controls: hide/show tokens, rename, coloured borders, fog of war, AoE templates, measure/mark/ping. A Spectator mode shows the map on a TV or projector without hidden content, and the map can open in its own browser window. — [D&D Beyond, "Navigating Maps", 29 Oct 2024](https://www.dndbeyond.com/posts/1816-the-official-d-d-vtt-navigating-maps-on-d-d-beyond)
- Prep is shortcut by content: "Quickplay Maps" ship with adventures (Adventures in Faerun includes over 50), and the product lead said he is "definitely" looking into expanding Quickplay. — [D&D Beyond, "The Road Ahead", 10 Dec 2025](https://www.dndbeyond.com/posts/2120-the-road-ahead-join-our-journey-to-improve-the)

**Fantasy Grounds**
- Until v4.7.0 the only context menu was a radial menu; it was replaced by a list-style context menu with icons and labels (page last updated 23 Apr 2025). — [Fantasy Grounds v4.7.0 Feature Showcase](https://fantasygroundsunity.atlassian.net/wiki/spaces/FGCP/pages/3077701648/v4.7.0+Feature+Showcase)

**Shmeppy**
- GM/player split is by role, not mode: the creator of a game is its GM; GMs hide areas with fog of war and add GM-only token labels; players move tokens and use a Laser pointer. A "View as Player" button previews the player view **[snippet]** — [Shmeppy forum, Getting Started](https://forum.shmeppy.com/t/getting-started-with-shmeppy/1719), [Shmeppy forum, Fog of War walkthrough](https://forum.shmeppy.com/t/how-to-use-the-fog-of-war-tool-on-desktop/1509)

**Tabletop Simulator / Tabletop Playground**
- Both are physics sandboxes with a shared interface style; Tabletop Playground's controls "are similar to TTS" with smoother object movement and a hotkey pop-up on hover that helps newcomers **[snippet]** — [Meeple Mountain, Learn How to Use Tabletop Playground](https://www.meeplemountain.com/articles/learn-how-to-use-tabletop-playground/)

### Inferences
- The dominant separator is the layer (map / token / GM-hidden / lighting), not a mode. Layers are cheap on desktop but cost a tap and a mental model on a phone; Owlbear's "everything is an item, select it to see its options" is the variant that needs the least chrome.
- TaleSpire is the only product found that makes build an explicit, re-enterable mode during live play. That matches a 3D product where placing geometry and moving minis need different one-finger behaviours.
- The context menu or token HUD is consistently opened by right-click. Every product in this set therefore needs a touch substitute (long-press or tap-to-select), and Roll20 explicitly called context menu activation on touch a problem to solve.
- Two vendors (Owlbear, Roll20) independently converged on "show options only when they apply to the selection" as their clutter remedy.
- Fantasy Grounds abandoning radial menus for labelled lists is direct evidence against icon-only radials for discoverability, even though TaleSpire still uses one.

### Gaps
- Owlbear Rodeo's docs returned HTTP 403, so the exact toolbar contents, the full token context menu, and layer names in 2.x are unverified. Unverified recollection: a left vertical tool rail (select, move, measure, drawing, fog, text, pointer), a floating context menu near the selection with lock/hide/layer/duplicate, and scenes opened from a scenes panel.
- TaleSpire's hotbar, brush-style tile placement, hide volumes and line-of-sight UI could not be sourced in detail. Unverified recollection: a number-key hotbar of recently used or pinned assets at the bottom of the screen, an asset library split into tiles/props/creatures, drag-to-paint placement, and box-shaped "hide volumes" the GM toggles to reveal regions.
- Foundry's individual scene-control groups (tokens, templates, tiles, drawings, walls, lighting, sounds, regions, notes) were not confirmed from a fetched page.
- Nothing was found on how Alchemy, Let's Role, Tableplop, Bag of Mapping, or One More Multiverse separate prep and play.
- No UX teardown or case-study article on VTT build/play separation was found.

## 2. Information architecture and number of steps for common actions

### Takeaway
The recurring desktop layout is a tool rail on the left, a multi-tab sidebar on the right (chat, combat, scenes, actors, items, journal, compendium, settings), a hotbar at the bottom centre, and scene navigation at the top, with token actions on a HUD or context menu attached to the selection. Published per-action step counts do not exist; the only hard data are vendor descriptions of specific flows, summarised below.

### Cited Findings

**Where things live**
- Foundry v13: full-height right "cabinet" sidebar; collapsed scene navigation menu; centred macro hotbar; chat input "remains displayed regardless of what tab of the sidebar you are on"; when the sidebar is collapsed "a minimalist chat notifications tray will show the previous few messages for a short period of time"; roll mode selection changed from a dropdown to "four handy icons". — [Foundry VTT release 13.341](https://foundryvtt.com/releases/13.341)
- Foundry v13: the sidebar "always starts collapsed and Foundry does not provide a built in option to change that" (module author complaint) **[snippet]** — [Foundry package: Nore's Interface Enhancements](https://foundryvtt.com/packages/nores-interface-enhancements)
- Owlbear Rodeo 2: dice were merged into the party (players) sidebar. "This allows us to visually tie dice rolls to a player in a natural way" and supports several dice trays at once. Seeing everyone's rolls was "one of our most requested features to date." — [Owlbear Rodeo blog, "Towards Owlbear Rodeo 2.0"](https://blog.owlbear.rodeo/towards-owlbear-rodeo-2-0-2/)
- Owlbear Rodeo has no built-in character sheets, stat blocks or initiative tracker; these come from extensions **[interested party]** — [StoryRoll, Best VTTs 2026, 14 Mar 2026](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026)
- D&D Beyond Maps: the initiative order is shown to players at the top of the screen; the Game Log receives rolls made on character sheets; sheet HP changes appear in the Maps initiative tracker; rolls can be made from monster stat blocks; the DM sees who is connected and controls which map players see. — [D&D Beyond, "Navigating Maps", 29 Oct 2024](https://www.dndbeyond.com/posts/1816-the-official-d-d-vtt-navigating-maps-on-d-d-beyond)
- TaleSpire: dice are rolled directly on the board; Space opens the asset and dice panel; the turn tracker is a dedicated mode. — [TaleSpire on Steam](https://store.steampowered.com/app/720620/TaleSpire/), [PlayerAssist beginner's guide](https://playerassist.com/talespire-beginners-guide/)
- Roll20 Characters (2026) puts sheets, dice and a compendium in a mobile-browser hub separate from the tabletop; a GM can keep 5 to 10 NPC sheets open in browser tabs and switch between them, where the retired app showed one character at a time. — [Roll20 blog, 18 Feb 2026](https://blog.roll20.net/posts/were-retiring-the-roll20-mobile-app-to-build-something-better-heres-why/)

**Documented flows (the closest thing to step counts)**
- Move and measure in one gesture. Foundry v13: "allowing you to drag a token around the canvas and have the distance of that drag measured as you go" (one drag; token moves on drop). Owlbear Rodeo: Measure has a movement mode where "you can click and drag on a character. When you do this the character will be moved and a ruler will be created at the same time." — [Foundry VTT release 13.341](https://foundryvtt.com/releases/13.341), [Owlbear Rodeo docs, Measure](https://docs.owlbear.rodeo/docs/measure/) **[snippet for Owlbear]**
- Damage a token in Foundry: right-click the token (opens HUD), type a signed number such as -7 into the bar input, confirm. Two pointer actions plus typing. — [Foundry VTT, Tokens article](https://foundryvtt.com/article/tokens/)
- Add a token to combat in Foundry: right-click token, click Toggle Combat (two actions). Clicking again removes it and loses its initiative score. — [Foundry VTT, Tokens article](https://foundryvtt.com/article/tokens/)
- Add to initiative in D&D Beyond Maps: all tokens on the map can be added at once from the encounter builder, or several enemies selected and added together; monsters can stay hidden until they join. — [D&D Beyond, "Navigating Maps", 29 Oct 2024](https://www.dndbeyond.com/posts/1816-the-official-d-d-vtt-navigating-maps-on-d-d-beyond)
- Add to turn order in Roll20: select tokens, right-click, Add Turn (works on a multi-selection). — [Roll20 blog, 24 Jan 2024](https://blog.roll20.net/posts/roll20-jumpgate-redo-context-and-touch)
- Reveal fog in D&D Beyond Maps: pick the fog erase tool, choose a brush size, paint. Users report this "slows play down a little having to get the right brush size and not accidentally reveal something", ask for the tool to remember the last selection, and want an area-select reveal instead of brushing **[snippet for the first two]** — [D&D Beyond, "The Road Ahead" comments](https://www.dndbeyond.com/posts/2120-the-road-ahead-join-our-journey-to-improve-the), [D&D Beyond forum, Maps VTT 101](https://www.dndbeyond.com/forums/d-d-beyond-general/general-discussion/238791-maps-vtt-101-guide-for-total-idiots-wanted-er)
- Reveal fog in Owlbear Rodeo: pre-drawn fog shapes marked with Cut become togglable, so a room reveal is a single toggle on a prepared shape **[snippet]** — [Owlbear Rodeo docs, Fog](https://docs.owlbear.rodeo/docs/fog/)
- Fog in Shmeppy: tokens are hidden only when the whole token is inside fog; partly fogged tokens stay visible **[snippet]** — [Shmeppy forum, Fog of War walkthrough](https://forum.shmeppy.com/t/how-to-use-the-fog-of-war-tool-on-desktop/1509)

### Inferences
- "Prepared, togglable regions" (Owlbear cut shapes, TaleSpire hide volumes) turn a live reveal into one action, where brush-based fog (D&D Beyond Maps) costs three or more and risks over-revealing. On a phone, where a finger hides what it paints, region toggles are the safer pattern.
- Merging the ruler into the drag (Foundry v13, Owlbear) removed a tool switch from the most common live action. Both vendors did this recently, which suggests tool switching for movement was a known cost.
- Foundry's persistent chat input and transient notification tray show a way to keep a collapsed panel useful: keep the input and the last few events visible, hide the history.
- Numeric entry of signed deltas on a token HUD is the fastest documented damage flow but depends on a keyboard; a phone needs a stepper or keypad sheet.

### Gaps
- No source gives measured clicks or taps for move, roll, reveal, damage, advance turn, or switch scene in any product. The flows above are reconstructed from vendor descriptions only.
- Scene switching flows (Foundry navigation menu and "activate", Roll20 page toolbar and player ribbon, Owlbear scene picker) were not documented from fetched pages.
- Where character sheets live in Alchemy, Let's Role (VTT), Tableplop and Fantasy Grounds was not verified.
- Advance-turn controls were not documented for any product beyond the existence of trackers.

## 3. Interaction patterns praised as fast or convenient

### Takeaway
Praise concentrates on time-to-table rather than feature depth: a link and a map image (Owlbear Rodeo), drawing a room in seconds (Shmeppy), content that arrives pre-built (D&D Beyond Quickplay Maps, TaleSpire community boards and pasteable slabs), and actions attached to the selected thing (Foundry Token HUD, Owlbear context menu). Each has a specific mechanism that can be copied.

### Cited Findings
- Owlbear Rodeo: "Drop in a map image, add some tokens, share a link"; a battlemap "running in under two minutes"; interface intuitive for non-technical players **[interested party]** — [StoryRoll, 14 Mar 2026](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026)
- Owlbear Rodeo: "Extremely fast to set up — shareable room link in seconds"; "Clean, uncluttered interface"; "Works well on tablets." — [TTRPG Stack, Best Virtual Tabletop 2026](https://www.ttrpgstack.com/best/virtual-tabletop/)
- Owlbear Rodeo: "No need to create an account or learn a tutorial"; starting a game takes you straight to the tabletop. — [StartPlaying, comprehensive VTT list, updated Aug 2026](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops)
- Owlbear Rodeo rated easiest of four for ease of use, but lowest for features, customisation and aesthetics ("Simple, Feature-Light") **[interested party]** — [CZEPEKU, updated 23 Oct 2026](https://www.czepeku.com/blog/choosing-your-ideal-virtual-tabletop)
- Owlbear Rodeo 2.4 (May 2026) added automatic fog detection, later made "faster and more reliable" for paid tiers. — [Owlbear Rodeo blog](https://blog.owlbear.rodeo/owlbear-rodeo-2-0-release-date-announcement/) (sidebar teasers on that page)
- Shmeppy: "the fastest VTT to learn and the fastest to use in the moment"; drawing a room takes seconds; coloured tiles mark terrain; tokens are coloured circles with labels; fog is erased as players explore **[interested party]** — [StoryRoll, 14 Mar 2026](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026)
- Shmeppy's own positioning: "Your wet erase mat. Online." — [Shmeppy](https://shmeppy.com/about)
- TaleSpire: "The tools for building maps are intuitive and quick to use"; "very quick and easy to set up a basic scenario"; building tools "robust" (Steam reviewers) **[snippet]** — [TaleSpire Steam reviews](https://steamcommunity.com/app/720620/reviews/?l=english)
- TaleSpire: slabs copied as text and pasted to "summon" them; boards shareable; community repositories (TalesBazaar, Talestavern) reduce building work; "Active community sharing pre-built boards." — [TaleSpire on Steam](https://store.steampowered.com/app/720620/TaleSpire/), [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026), [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)
- TaleSpire: 90% positive of about 3,339 English Steam reviews; recent 30 days 81% of 38. — [TaleSpire on Steam](https://store.steampowered.com/app/720620/TaleSpire/)
- D&D Beyond Maps: users call it simple and easy to learn; uploading and scaling custom maps made running games easier; "This simple interface allows you to put 2D maps and tokens in front of your players." — [D&D Beyond, "The Road Ahead" comments](https://www.dndbeyond.com/posts/2120-the-road-ahead-join-our-journey-to-improve-the), [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops)
- Foundry: Token HUD gives bars, status, elevation, target, combat toggle and config from one right-click on the token. — [Foundry VTT, Tokens article](https://foundryvtt.com/article/tokens/)
- Foundry v13: tokens "automatically rotate to face their movement direction when being moved"; drag measures as it goes. — [Foundry VTT release 13.341](https://foundryvtt.com/releases/13.341)
- Alchemy: "designed to be both intuitive and beautiful"; "a cinematic experience"; rated second easiest of four **[interested party: CZEPEKU promotes Alchemy]** — [CZEPEKU, updated 23 Oct 2026](https://www.czepeku.com/blog/choosing-your-ideal-virtual-tabletop)
- Alchemy: "scene-first design" combining audio, video and atmosphere; low learning curve for GM and players per a user blog **[snippet]** — [Alchemy RPG](https://alchemyrpg.com/), [Medium, "Play Your Game Not the VTT"](https://yourgmchandler.medium.com/play-your-game-not-the-vtt-0a2f3882df9f)
- Let's Role: praised for "intuitive UI and customizability for GMs". — [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops)
- Tableplop: "Its user-friendly interface makes it simple and easy to use"; minimal setup. — [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops)
- Fantasy Grounds: "Best rules automation of any mainstream VTT"; published adventures need "minimal manual setup". — [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)
- Digital Tabletops VTT (not in the brief, relevant as a phone pattern): the GM drives a big shared screen while players move their own tokens from Android phones after entering only a session code: "There's no complex setups needed, just a code and players have their virtual tokens ready." — [Wargamer, updated 19 Apr 2026](https://www.wargamer.com/digital-tabletops-vtt-mobile-update)

### Inferences
- Speed praise maps onto four mechanisms: (1) zero ceremony before the canvas, (2) a tiny fixed vocabulary of tools, (3) prefabs that paste in (slabs, Quickplay maps, community boards), (4) actions anchored on the selected object.
- For a 3D product, TaleSpire's evidence cuts both ways: reviewers call the tools quick, while roundups call build time its main cost. Prefab reuse (slabs, shared boards) is how its community closes that gap, which supports investing in generators and pasteable chunks over finer manual tools.
- Shmeppy shows that removing art entirely (colour tiles, labelled circles) is accepted when it buys speed. A 3D VTT can offer the same "sketch first, dress later" path.

### Gaps
- No direct user quotes about TaleSpire's hotbar or brush were found; the "praised" status of those specific mechanisms is unverified.
- The Medium article on Alchemy versus Foundry returned HTTP 403; its specific arguments are unread.
- No independent source for praise of Bag of Mapping, One More Multiverse, or Tabletop Playground UX beyond single snippets.
- Whether Foundry's Token HUD is praised as such (rather than just documented) was not confirmed with user quotes.

## 4. Most frequent UI/UX complaints

### Takeaway
Complaints cluster into five themes: dated or cluttered interfaces (Roll20, Fantasy Grounds), steep learning curve and configuration time (Foundry, Fantasy Grounds, TaleSpire building), slow or fiddly live tools (brush fog in D&D Beyond Maps, TaleSpire object manipulation), feature thinness in the simple tools (Owlbear Rodeo, Shmeppy), and weak phone support nearly everywhere. Project Sigil, the most ambitious 3D attempt, was cancelled outright.

### Cited Findings

**Dated look, clutter**
- Roll20: "Older interface feels dated compared to newer VTTs"; performance drops on large maps. — [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)
- Roll20: interface feels dated and canvas tools clunky; "the learning curve for advanced features (macros, API scripting, dynamic lighting) is steep"; "The mobile experience is limited." **[interested party]** — [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026)
- Roll20 aesthetic rated "Weak" **[interested party]** — [CZEPEKU](https://www.czepeku.com/blog/choosing-your-ideal-virtual-tabletop)
- Fantasy Grounds: "Dated UI that has a steep learning curve"; desktop only. — [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)
- Fantasy Grounds' own admission: "at the top of every feedback list whenever we've heard that the Fantasy Grounds UI is 'dated' has been the use of radial menus" **[snippet]**; "The former radial menu didn't have sufficient room for button labels", raising cognitive load "even for experienced users". — [Fantasy Grounds v4.7.0 Feature Showcase](https://fantasygroundsunity.atlassian.net/wiki/spaces/FGCP/pages/3077701648/v4.7.0+Feature+Showcase)
- Tabletop Simulator: interface called clunky and slow, like a game-engine tool rather than standard UI; physics-based controls are the bigger hurdle than game rules **[snippet]** — [Hacker News thread](https://news.ycombinator.com/item?id=24906634)
- Tabletop Playground: "less fiddly and more polished" than TTS but not enough to justify relearning; another reviewer says its UI needs improvement **[snippet]** — [Steam reviews, Tabletop Playground](https://steamcommunity.com/app/838410/reviews/?browsefilter=toprated)
- Let's Role (older forum post, desktop): character sheet "very...large...and not as easy to pop around and find stuff on as the Roll20 sheet"; tutorial videos did not match the interface **[snippet]** — [RPG Pub thread](https://www.rpgpub.com/threads/role-vtt-anybody-use-it.7391/)

**Learning curve and prep time**
- Foundry: "a learning curve that is steeper than any of the other VTTs on this list"; ease of use rated lowest of four **[interested party]** — [CZEPEKU](https://www.czepeku.com/blog/choosing-your-ideal-virtual-tabletop)
- Foundry: "Initial scene setup is time-intensive for new GMs"; "Self-hosting requires some technical knowledge"; "No official mobile app for GM use." — [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)
- Foundry: new GMs can spend sessions on configuration **[interested party]** — [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026)
- Foundry v13 UI overhaul broke third-party UI (unreadable context menu styles, misplaced pause overlay, combat trackers needing rewrites for ApplicationV2) **[snippet]** — [Conan 2d20 issue 486](https://gitlab.com/fvtt-modiphius/foundryvtt-conan2d20/-/issues/486), [pause-icon issue 17](https://gitlab.com/Freeze020/pause-icon/-/issues/17)
- A "Classic UI" module exists to restore the pre-v13 look, which indicates some users rejected the redesign **[snippet; page not opened]** — [Foundry package: Classic UI](https://foundryvtt.com/packages/classic-ui)
- TaleSpire: "Building a simple room takes significantly longer than dropping a 2D map image into Owlbear Rodeo" **[interested party]**; "Steep build time to create custom scenes from scratch." — [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026), [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)

**Fiddly live tools**
- TaleSpire Steam reviews: "very tedious to use building maps"; cannot group-move objects; keybinds poor; weak tutorials; build mode exits on its own; Escape deletes a selected object instead of returning it; "You often can't place tiles where your mouse is pointing at"; for running play "there's no tools to help you" and GM tooling "currently trash"; no offline use **[snippet; review dates mixed]** — [TaleSpire Steam reviews](https://steamcommunity.com/app/720620/reviews/?l=english)
- D&D Beyond Maps: brush fog is tedious (users want area select); eraser once too small with no size or shape option; requests for HP bars, status rings, snap-to-grid, notes, a DM screen, random names for generic tokens, automatic vision, music, and tools usable without a map. — [D&D Beyond, "The Road Ahead" comments](https://www.dndbeyond.com/posts/2120-the-road-ahead-join-our-journey-to-improve-the), [ENWorld, Maps on D&D Beyond](https://www.enworld.org/threads/maps-on-dndbeyond.699942/) **[snippet for the eraser]**

**Too thin**
- Owlbear Rodeo: "a battlemap tool, not a full VTT platform"; no sheets, stat blocks, or initiative without extensions; no dynamic lighting **[interested party]** — [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026)
- Shmeppy: no image uploads, assets, dice roller, or sheets; "will feel like a downgrade from literally any other option on this list" for groups that value visuals; slow development by a solo developer **[interested party]** — [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026)
- Alchemy: "Weaker tactical map support than Roll20 or Foundry." — [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)

**3D ambition failing: Project Sigil**
- Sigil development was "sunsetted" in March 2025 with roughly 90% of the team (about 30 people) laid off; Wizards later confirmed the end. It stays usable until the end of October 2026, after which servers go offline and content made in it is no longer accessible. Maps is the continuing VTT **[snippet; GamesRadar article body could not be fetched]** — [ENWorld, "Project Sigil 3D Virtual Tabletop Finally Laid To Rest"](https://www.enworld.org/threads/project-sigil-3d-virtual-tabletop-finally-laid-to-rest.715907/post-9786241), [D&D Beyond, "Closing the chapter on Sigil"](https://www.dndbeyond.com/posts/2086-closing-the-chapter-on-sigil-and-thanking-the?page=5), [GamesRadar](https://www.gamesradar.com/tabletop-gaming/project-sigil-is-officially-dead-and-i-cant-believe-d-and-d-fumbled-its-best-idea-in-years)
- As of this research date (28 Nov 2026) the announced October 2026 shutdown date has passed; that the servers actually went offline was not independently confirmed.

**Sustainability of small VTTs**
- One More Multiverse announced a shutdown in May 2024 (90 days' notice), then reversed in July 2024 and moved GM access to Patreon from 5 August 2024 with a two-person team. Current 2026 status unconfirmed **[snippet]** — [Bell of Lost Souls](https://www.belloflostsouls.net/2024/05/one-more-multiverse-the-virtual-ttrpg-platform-is-shutting-down.html), [OMM on X](https://x.com/OMMultiverse/status/1816165846680756258)

### Inferences
- The market punishes both extremes: full platforms for prep cost and clutter, minimal ones for missing a turn tracker, HP and sheets. The requests on D&D Beyond Maps (HP bars, status rings, notes, area-reveal fog, random names) read as the minimum "run a fight" kit that a simple VTT is expected to have built in.
- TaleSpire's complaint list is mostly about manipulating things after placement (group move, cancel versus delete, precise placement) and about live GM tooling, not about the placement brush. For a 3D phone VTT, selection, group move and a safe cancel deserve as much design effort as placement.
- Sigil's cancellation and TaleSpire's "everyone must buy it and own a decent GPU" barrier suggest that 3D only succeeds when the cost to join is near zero. A browser 3D VTT that loads on a phone removes exactly the barrier those two could not.
- Foundry's v13 shows the cost of redesigning chrome in a product with an extension ecosystem: the redesign itself generated complaints and a "classic" restore module.

### Gaps
- No direct Reddit threads (r/VTT, r/rpg, r/dndnext, r/FoundryVTT, r/Roll20) were read. Frequency claims ("most frequent") rest on roundup articles and store reviews, not on a count of threads.
- The reasons for Sigil's failure as given by Wizards or reviewers (hardware demands, prep time, monetisation) were not obtained; the GamesRadar body was truncated.
- No independent complaints found for Tableplop, Bag of Mapping, or Alchemy's mobile experience.
- Tabletop Simulator complaints specific to RPG use (sheets, hidden information, fog) were not found; the Hacker News source is from 2020 and likely outdated.

## 5. Onboarding for a new GM and for a player joining by link

### Takeaway
The products praised for onboarding require no player account and open straight onto the table (Owlbear Rodeo, Shmeppy, Foundry for players); those criticised require accounts, purchases or installs for every participant (Roll20, D&D Beyond Maps, TaleSpire, Tabletop Simulator, Fantasy Grounds). No vendor publishes a time-to-first-token figure; the only number found is a reviewer's "under two minutes" for Owlbear Rodeo.

### Cited Findings

| Product | Player needs | GM needs | Source |
|---|---|---|---|
| Owlbear Rodeo | Link only; no account | Reviewers say no account or tutorial needed; rooms are permanent via cloud storage | [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026), [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops), [CZEPEKU](https://www.czepeku.com/blog/choosing-your-ideal-virtual-tabletop) |
| Shmeppy | Shared URL; no account | Creator of the game is GM; paid tier for full features | [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026), [Shmeppy forum](https://forum.shmeppy.com/t/getting-started-with-shmeppy/1719) |
| Foundry VTT | Browser, no purchase; reviewers list no player account | One-time purchase plus self-hosting, port forwarding, or a paid host | [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026), [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/) |
| Roll20 | Account required; free to play | Free tier; browser only | [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026), [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops) |
| D&D Beyond Maps | Free D&D Beyond account and membership of a campaign | Account and campaign; sources conflict on whether a subscription is needed (see below) | [D&D Beyond, "Navigating Maps"](https://www.dndbeyond.com/posts/1816-the-official-d-d-vtt-navigating-maps-on-d-d-beyond) |
| TaleSpire | Purchase on Steam (about $25 each); a separate "Guest Edition" listing exists, rated Mixed (56% of 25 reviews) | Same purchase; Windows 10 or Apple-silicon macOS 13; internet required | [TaleSpire on Steam](https://store.steampowered.com/app/720620/TaleSpire/), [TaleSpire Guest Edition on Steam](https://store.steampowered.com/app/2881860/TaleSpire_Guest_Edition/) **[snippet for Guest Edition]** |
| Tabletop Simulator | Everyone needs their own Steam copy | Same | [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops) |
| Fantasy Grounds | Desktop install; software announced as free for all users from November 2025 **[snippet, via Wikipedia]** | Desktop install | [Wikipedia, Fantasy Grounds](https://en.wikipedia.org/wiki/Fantasy_Grounds), [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/) |
| Alchemy RPG | Browser; free account tier | Browser; paid tier for advanced features | [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/), [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops) |
| Digital Tabletops VTT | Android app plus session code | Steam app on a big screen | [Wargamer](https://www.wargamer.com/digital-tabletops-vtt-mobile-update) |

- Conflict on D&D Beyond Maps access: the official October 2024 guide says no subscription is required, while StartPlaying (updated August 2026) says it requires a Master Tier subscription. — [D&D Beyond, "Navigating Maps"](https://www.dndbeyond.com/posts/1816-the-official-d-d-vtt-navigating-maps-on-d-d-beyond); contradicted by [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops)
- Owlbear Rodeo time-to-table: a battlemap running "in under two minutes" **[interested party]**; "shareable room link in seconds". — [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026), [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)
- Roll20's own mobile onboarding is admittedly rough: new characters start unconnected; the user presses + on the character tab and picks a game; characters imported from the VTT become standalone copies that must be reconnected. Roll20 says this flow needs major work. — [Roll20 blog, 18 Feb 2026](https://blog.roll20.net/posts/were-retiring-the-roll20-mobile-app-to-build-something-better-heres-why/)
- Roll20 recommends installing its web hub to the phone home screen (Android "Add to Home screen", iOS "Add to Home Screen" with "Open as Web App") instead of a store app. — [Roll20 blog, 18 Feb 2026](https://blog.roll20.net/posts/were-retiring-the-roll20-mobile-app-to-build-something-better-heres-why/)
- D&D Beyond is recruiting DMs for interviews, prototype tests and sketch reviews, with outreach focused on DMs because upcoming projects are DM-focused; a forum thread titled "MAPS VTT 101 Guide for Total Idiots Wanted (er, Needed!)" indicates onboarding documentation was felt to be lacking. — [D&D Beyond, "The Road Ahead"](https://www.dndbeyond.com/posts/2120-the-road-ahead-join-our-journey-to-improve-the), [D&D Beyond forum](https://www.dndbeyond.com/forums/d-d-beyond-general/general-discussion/238791-maps-vtt-101-guide-for-total-idiots-wanted-er)
- TaleSpire: weak tutorials cited in Steam reviews **[snippet]** — [TaleSpire Steam reviews](https://steamcommunity.com/app/720620/reviews/?l=english)
- Tabletop Playground: a hotkey pop-up on hover is credited with helping newcomers **[snippet]** — [Meeple Mountain](https://www.meeplemountain.com/articles/learn-how-to-use-tabletop-playground/)

### Inferences
- "Player joins by link with no account" is now the baseline expectation for the lightweight tier and is the most repeated reason those tools are recommended for pickup games and conventions.
- Content-led onboarding (Quickplay Maps, community boards) substitutes for tutorials: a GM's first session starts from a finished scene rather than an empty one.
- The Digital Tabletops pattern (GM on a shared screen, players on phones by code) is the mirror image of the target here (GM on a phone). Both treat the phone as a thin, single-purpose client, which is evidence that a phone screen should carry one role's controls at a time.

### Gaps
- Whether an Owlbear Rodeo 2 GM must create an account is uncertain: roundups say "no accounts", but 2.0 rooms are permanent and cloud-stored, which implies a GM account. Unverified recollection: the GM signs in, players join by link without one.
- No time-to-first-token measurements for any product other than the single Owlbear claim.
- First-run flows (empty states, tutorials, sample scenes) were not documented for any product.
- Join flows for Let's Role, Tableplop, Bag of Mapping and One More Multiverse were not found.

## 6. Published redesign rationales, and phone/touch support per product

### Takeaway
Three vendors published reasons for UI change: Roll20 (performance, modern context menus, undo/redo, touch as first class, then a mobile-browser-first strategy that retired its native app in February 2026), Foundry (ApplicationV2 migration with a stated aim of not losing approachability), and Owlbear Rodeo (compact layout to scale to phones, fewer always-visible controls). On phones, no surveyed product claims a full GM experience: Roll20 explicitly assigns phones to players and tablets to GMs, and Foundry officially targets mouse and keyboard at 1366x768 or larger.

### Cited Findings

**Roll20: rationale**
- Goal: "modernize the Roll20 VTT and get it ready for the next decade of online tabletop gaming." The legacy renderer was over a decade old and relied on software rendering; code was split across three or four libraries. — [Roll20 blog, "Project Jumpgate: Building a Better VTT", 29 Nov 2023](https://blog.roll20.net/posts/building-a-better-vtt/)
- Stress test with 100 animated tokens: legacy about 400% CPU and 4 GB memory; Jumpgate about 50% combined CPU/GPU and 1.5 GB (early figures, "subject to change"). Smooth zoom toward the cursor became possible. — [Roll20 blog, 29 Nov 2023](https://blog.roll20.net/posts/building-a-better-vtt/)
- New UI is built in Vue; targets named for redesign were "the right-click context menus, token bars, and more." — [Roll20 blog, 29 Nov 2023](https://blog.roll20.net/posts/building-a-better-vtt/)
- Timeline: Jumpgate beta opened to all users on 1 August 2024; it became the default for new games in December 2024 with "improved mobile touch support" listed among its benefits **[snippet for December]** — [Roll20 blog, 29 Nov 2023 (update note)](https://blog.roll20.net/posts/building-a-better-vtt/), [Roll20 on X](https://x.com/roll20app/status/1867330521614750001)

**Roll20: phone and touch**
- Touch goals in Jumpgate: two-finger pinch zoom and two-finger pan; text placement and context menu activation on touch were "being examined"; "we want to support GMs and players using any device they have access to wherever they are"; no separate app needed. — [Roll20 blog, 24 Jan 2024](https://blog.roll20.net/posts/roll20-jumpgate-redo-context-and-touch)
- September 2024 marketing addressed tablets specifically ("Tablet users, we support you") **[snippet]** — [Roll20 on X](https://x.com/roll20app/status/1833930013307023683)
- The native mobile app was delisted in February 2026. It mainly delivered character sheets, did not support the new D&D sheet, and "didn't meet the standards we've committed to". Roll20 is going "all-in on mobile browser first" with one codebase ("Build once, improve everywhere"; "Ship updates instantly" without store approval). — [Roll20 blog, 18 Feb 2026](https://blog.roll20.net/posts/were-retiring-the-roll20-mobile-app-to-build-something-better-heres-why/), [Roll20 on X](https://x.com/roll20app/status/2026463912091123891)
- Device split stated by Roll20: players use phones for dice and sheets, while GMs manage scenes and maps from a tablet **[snippet]** — [Roll20, "Is Roll20 Mobile Ready for Your Next D&D Campaign?"](https://pages.roll20.net/dnd-roll20-mobile-tools)
- Phone status in 2026: phone version 1 of the new D&D sheet shipped March 2026; the D&D Combat Tab is responsive on phones; custom and community sheets are not supported on mobile; a May 2026 change "improved some touch regions for the new navbar on mobile devices" **[snippet for May]** — [Roll20 blog, 18 Feb 2026](https://blog.roll20.net/posts/were-retiring-the-roll20-mobile-app-to-build-something-better-heres-why/), [Roll20 Change Log](https://help.roll20.net/hc/en-us/articles/360037772613-Change-Log)
- A third-party Chrome extension (touch20) existed to add touchscreen support to legacy Roll20 (outdated; shows the gap that existed) **[snippet]** — [GitHub, Oromis/touch20](https://github.com/Oromis/touch20)

**Foundry VTT: rationale**
- v13 was "a complete overhaul of user interface in order to update to the new Application V2 underlying framework"; "it was also important to us that we not make the new UI less approachable and intuitive"; "we think we've managed to hit the sweet spot here!"; animations added "without sacrificing performance". — [Foundry VTT release 13.341](https://foundryvtt.com/releases/13.341)
- Interface follows the OS or browser light/dark setting, with a world-level override; styling moved to CSS Layers. — [Foundry VTT release 13.341](https://foundryvtt.com/releases/13.341)

**Foundry VTT: phone and touch**
- Official requirements: "A monitor no smaller than 1366x768. At this minimum resolution many aspects of the UI will feel cramped."; "You can use the software with a touchpad but the current software is designed for mouse and keyboard." Phones and tablets are not mentioned. — [Foundry VTT requirements](https://foundryvtt.com/article/requirements/)
- v13 touch fix: "we've corrected some issues with multitouch interfaces and pinching should now zoom in and out". — [Foundry VTT release 13.341](https://foundryvtt.com/releases/13.341)
- Community view (Reddit mirror, mid-2025): official touch support "still not viable yet"; a thread asks whether mobile support has been abandoned **[snippet; weak]** — [r/FoundryVTT mirror](https://redlib.ssps.io/r/FoundryVTT/comments/1kt0vs5/v14_feature_article/mtsa5p6/?context=3)
- Phone use depends on third-party modules: Mobile Improvements ("touch-friendly layout for phones and tablets"), Mobile Sheet, Swipe VTT, VE Mobile **[snippet]** — [Foundry package: mobile-improvements](https://foundryvtt.com/packages/mobile-improvements), [mobile-sheet](https://foundryvtt.com/packages/mobile-sheet), [swipe-vtt](https://foundryvtt.com/packages/swipe-vtt), [ve-mobile](https://foundryvtt.com/packages/ve-mobile)
- A v14 already exists (a module listing shows "Verified 14.362"), so v13 details may be superseded **[snippet]** — [Foundry package: crlngn-ui](https://foundryvtt.com/packages/crlngn-ui)

**Owlbear Rodeo: rationale and phone**
- 2.0 was "a complete re-write of the original Owlbear Rodeo" with a UI redesign, an extension SDK and better rich text; beta from 19 July 2022; 1.0 closed 18 July 2023 and 2.0 launched at owlbear.rodeo on 19 July 2023; 1.0 lives on as self-hosted "Owlbear Rodeo Legacy". — [Owlbear Rodeo blog, 2.0 release date announcement](https://blog.owlbear.rodeo/owlbear-rodeo-2-0-release-date-announcement/)
- "The new design is also a lot more compact horizontally which will help the UI scale better on phones"; the redesign "will touch almost every part of the app". — [Owlbear Rodeo blog, "Towards Owlbear Rodeo 2.0"](https://blog.owlbear.rodeo/towards-owlbear-rodeo-2-0-2/)
- A ruler option was designed without a settings menu or keyboard shortcut because those "wouldn't be supported on mobile devices" **[snippet; exact post not identified]** — [Owlbear Rodeo blog](https://blog.owlbear.rodeo/owlbear-rodeo-2-0-beta-patch-7/)
- Third-party ratings: mobile "Good" **[interested party]**; "Works well on tablets" (phones not described). — [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026), [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)

**Other products: phone and touch**
- D&D Beyond Maps: per a forum reply (about April 2026 by relative date), the D&D Beyond mobile app did not support Maps. In a mobile browser, the paint or erase fog tools lock out map movement, so the user must switch back to Pan to zoom or pan; one user could not paint fog by finger with no map displayed **[snippet]** — [D&D Beyond forum, Maps VTT 101](https://www.dndbeyond.com/forums/d-d-beyond-general/general-discussion/238791-maps-vtt-101-guide-for-total-idiots-wanted-er)
- TaleSpire: Windows and Apple-silicon macOS only; no mobile. — [TaleSpire on Steam](https://store.steampowered.com/app/720620/TaleSpire/)
- Fantasy Grounds: desktop only. — [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/)
- Shmeppy: mobile rated "Good" in one comparison table, with no supporting detail **[interested party]**; no official statement on touch found. — [StoryRoll](https://storyroll.app/blog/best-virtual-tabletops-dnd-2026)
- Tableplop: "As a browser-based application, Tableplop can be run on phones, laptops, and tablets"; elsewhere "works great on mobiles and computers" **[snippet for the second]** — [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops), [alternativeto, Tableplop](https://alternativeto.net/software/tableplop/?p=2)
- Bag of Mapping: one Reddit commenter (via aggregator) calls it "quite mobile friendly to boot" **[snippet; weak]** — [GummySearch VTT reviews aggregator](https://gummysearch.com/tools/best-products/vtt/)
- Let's Role: an Android app covers character sheets and dice only (create, use and share sheets; roll 3D dice in app or show the formula for physical dice; rolls shared with the table across mobile and desktop). It is not the tabletop **[snippet]** — [Let's Role blog, mobile app launch](https://lets-role.com/blog/mobile-app-launch-113)
- Alchemy RPG: browser-based, platform listed as Web; no evidence of a native mobile app or of phone-specific design **[snippet]** — [TTRPG Stack](https://www.ttrpgstack.com/best/virtual-tabletop/), [alternativeto, Alchemy](https://alternativeto.net/software/alchemy-vttrpg)
- Quest Portal (not in the brief): marketed for desktop and mobile with iOS and Android apps. — [StartPlaying](https://startplaying.games/blog/posts/a-comprehensive-list-of-virtual-tabletops), [App Store, Quest Portal](https://apps.apple.com/us/app/quest-portal/id1588540503)

### Inferences
- The phone-GM position is unoccupied. The largest vendor draws the line at tablets for GMs; the most capable one targets desktop monitors; the 3D ones are desktop-only or cancelled. A phone-first GM tool does not have an incumbent pattern to copy and can treat the surveyed products as sources of mechanisms, not layouts.
- The D&D Beyond Maps fog report is a concrete touch anti-pattern: a paint tool that captures all touches forces a tool switch just to pan. Keeping two fingers for the camera in every tool avoids it, which is the rule this project already has.
- Roll20's move from a native app to a mobile browser with home-screen install validates a browser-first approach for reach and release speed; its stated reasons were codebase unity and avoiding store approval delays.
- Mobile "support" in this market usually means the sheet and dice, not the table (Roll20 Characters, Let's Role app). Designs that put the table itself on a phone are rare, so there is little prior art for one-finger tool versus two-finger camera on a tabletop beyond Owlbear Rodeo.
- Vendors that designed controls without settings menus or keyboard shortcuts (Owlbear's ruler) did so explicitly for mobile, a useful rule: any feature reachable only through a modifier key needs an on-screen equivalent from the start.

### Gaps
- No published rationale found for TaleSpire, Alchemy, D&D Beyond Maps (beyond process statements), Shmeppy, Tableplop, or Let's Role UI decisions.
- The Owlbear Rodeo migration guide (which reportedly explains 2.0 design decisions) and the Bell of Lost Souls article on Roll20's phone update both returned HTTP 403 and were not read.
- Whether Owlbear Rodeo 2 is fully usable by a GM on a phone (not just tablets) is unconfirmed; sources mention phones only as a layout goal.
- Shmeppy, Tableplop and Bag of Mapping touch behaviour (gestures, long-press, target sizes) is undocumented in the sources found.
- Foundry v14 UI changes were not researched; the v13 description may already be outdated.
- Tabletop Simulator and Tabletop Playground mobile or touch status was not found. Unverified recollection: both are desktop and VR only.
- No source describes any VTT's gesture grammar on a phone in detail (what one finger does per tool, how context menus open on touch).
