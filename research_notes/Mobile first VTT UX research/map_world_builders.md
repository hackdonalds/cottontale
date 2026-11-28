# Map and world-building tools: UI/UX and building workflows (state as of Nov 2026)

Reader's note on evidence quality. Findings marked **(fetched)** come from a page I read; findings marked **(snippet)** come from a search-result summary of the linked page and were not opened, so wording may be approximate. Reddit could not be reached through search in this session (no r/battlemaps, r/dungeondraft, r/inkarnate, r/DungeonAlchemist or r/talespire thread surfaced), so user-complaint evidence comes from vendor feedback boards, Steam store pages, App Store review snippets and blogs instead. Several tools in the brief returned nothing usable (Wonderdraft, DungeonFog, RPGScenery/FlowScape, Roblox, Block Craft-style apps); they are listed under Gaps, with unverified background knowledge clearly labelled as such.

## 1. What are the core building interactions (room-drag, wall/path tools, paint/scatter, stamp/prefab/slab, auto-tiling/WFC, procedural generation)?

### Takeaway
The fastest tools all split the labour the same way: the user makes one coarse gesture (drag a rectangle, tap a cell, draw an outline) and the software derives everything fiddly (walls, floors, corners, furnishing, lighting). The recurring cost of that speed is loss of control, and each tool that auto-generates is asked for the same thing next: keep my manual edits when I regenerate.

### Cited Findings

**Room-drag with automatic walls, floors, furnishing (Dungeon Alchemist)**
- The workflow is: pick a theme, then start drawing; the app generates walls, floors, objects and lighting automatically. A theme is chosen per room and the app fills in the rest. A randomize button re-runs the same procedural algorithms to produce a new room. Afterwards the user can add, scale, remove and rotate objects, move doors and change floor tiles. **(fetched)** — [Steam store page](https://store.steampowered.com/app/1588530)
- The developer states room generation does not use generative AI or LLMs; it is in-house procedural algorithms over artist-made content. The library is "6000+ objects". Still Early Access, planned exit late 2026. **(fetched)** — [Steam store page](https://store.steampowered.com/app/1588530)
- Changing a room's type currently changes the walls as well as the objects; a user request asks for it to change only the objects. **(snippet)** — [Dungeon Alchemist feature request: consistent flooring and walls](https://dungeonalchemist.upvoty.com/b/feature-requests/consistent-flooring-and-walls)

**Rectangle-room tool, additive and subtractive (Dungeon Map Doodler, Dungeon Scrawl)**
- Dungeon Map Doodler's room tool: click, hold and drag out a rectangle, release to create the room; optional snap to grid; a subtractive mode removes floor instead of adding it. A separate Interior Wall tool "acts like a thin eraser" to draw walls inside a larger room. **(snippet)** — [dungeonmapdoodler.com](https://dungeonmapdoodler.com)
- Dungeon Scrawl (May 2026): the Rectangle tool gained a Corner Radius setting (radius of half a square's width makes a circle); Path, Polygon and Wall tools gained a Smooth mode that joins points with curves, and Smooth overrides Snap. **(fetched)** — [Roll20 blog, Dungeon Scrawl updates May 2026](https://blog.roll20.net/posts/dungeon-scrawl-updates-may-2026/)

**Outline-a-building tool versus separate wall + floor tools (Dungeondraft)**
- Building tool steps: choose Rectangle, Circle or Freeform (click to place points, Shift bends the current line, Delete/Backspace removes the last point); choose a wall style and a floor style together (an X in the wall selector draws floor only); hold Alt and draw to erase an area; an Edit Points mode lets you drag points, click a wall to add a point, and delete points or segments, with the whole building updating live. **(fetched)** — [Dungeondraft Encyclopaedia: Building Tool](https://dungeondraft-encyclopaedia.gitbook.io/guide/all-the-tools/design-tab/building-tool)
- Its limits: one wall type per building; its walls and floor cannot be edited with the Wall or Pattern Shape tools; the floor has built-in randomness and changes every time the building updates; its walls merge with Cave tool walls but not Wall tool walls. The guide's advice is to use Wall + Pattern Shape instead for any map taking more than about ten minutes. **(fetched)** — [Dungeondraft Encyclopaedia: Building Tool](https://dungeondraft-encyclopaedia.gitbook.io/guide/all-the-tools/design-tab/building-tool)
- The Wall tool is point-to-point; the Pattern Shape tool draws floors as rectangle, circle or freeform with rotatable texture and optional outline; a community "Wall Shapes" mod adds closed shapes to the Wall tool to match the Building tool. **(snippet)** — [Dungeondraft Encyclopaedia: Pattern Shape Tool](https://dungeondraft-encyclopaedia.gitbook.io/guide/all-the-tools/design-tab/pattern-shape-tool); [Wall Shapes mod](https://dungeondraft-encyclopaedia.gitbook.io/guide/custom-assets-and-mods/some-useful-mods/wall-shapes)
- A critical blog argues the Building, Water and Material tools are underdeveloped, so users work around them with paths, objects, walls or patterns, and that the Wall tool cannot create rooms. **(snippet; the page itself redirected and could not be read)** — [DnDungeon blog: Thoughts on Dungeondraft](https://blog.dndungeon.com/p/thoughts-on-dungeondraft)

**Scatter / stamp-drag (Dungeon Scrawl, Dungeondraft, Canvas of Kings)**
- Dungeon Scrawl's Stamp tool: pick an image, drag across the canvas to scatter copies, each with randomised scale, rotation, spacing and colour. Settings are Size, Rotation, Colour Variance, Repeat Speed and Snap/Division. Each stamp lands on its own layer so it stays individually editable. **(fetched)** — [Roll20 blog, May 2026](https://blog.roll20.net/posts/dungeon-scrawl-updates-may-2026/)
- Dungeondraft's Scatter tool paints clutter such as rocks and grass with randomised rotation and scale. **(snippet)** — [Groupfinder library: Dungeondraft](https://groupfinder.eu/library/dungeondraft)
- Canvas of Kings defines maps with adjustable paths and plots and places objects along or inside them automatically ("a wall with towers or a whole forest"); object properties can be randomised and objects chosen by category rather than placed one by one. It explicitly does not support fully procedural maps, caves and dungeons, or VTT export. **(fetched)** — [Steam: Canvas of Kings](https://store.steampowered.com/app/2498570/)

**Slab copy/paste and volume selection (TaleSpire)**
- Enter build mode with B; hold X (or press the Slab selection button in the building toolbar) and drag out the width and height of a volume to copy; paste with Ctrl+V; hold Ctrl and move the mouse forward/back to change the height the slab is pasted at. Slabs are shared as text strings; a board shares the whole build. **(snippet)** — [Tales Tavern: Guide to Sharing/Using Slabs and Boards](https://talestavern.com/?p=19480)
- Placement logic (2020 dev log, may have changed): raycast from the camera through the pointer, snap to grid, draw a bounding volume showing where the tile will go on click. If the spot is occupied, the hit surface's normal pushes the tile to a legal position on that surface; failing that, the tile climbs a few units to sit on top. **(fetched)** — [TaleSpire Dev Log 214](https://bouncyrock.com/news/articles/talespire-dev-log-214)

**Auto-tiling / wave function collapse (Townscaper)**
- The player has "a very limited number of interactions": choose where a block is added or removed, and its colour. Everything else is derived. The article calls it a mixed-initiative system. **(fetched)** — [Game Developer: How Townscaper Works](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)
- Mechanism: an irregular quad grid (a hex grid split into quads with points relaxed); marching-cubes-style corner modules rather than whole-cell tiles; WFC picks which modules fit, "optimised for working in real-time"; decoration is a separate later pass, which is why details pop in after a short delay. **(fetched)** — [Game Developer](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)
- Unlike Bad North, generation "is actually allowed to fail silently" rather than restart. Module priorities make rare features (gardens in enclosed areas) appear predictably. Colour is also a rule input (changing house colour can produce stone walls). **(fetched)** — [Game Developer](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)
- Stålberg: "I want the user to feel like they're in control of the large shapes", with small details left to vary; and "what's important is what happens when things change". **(fetched)** — [Game Developer](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)
- PC Gamer frames this as "radically casual" design with a clear division of labour between user and algorithm. **(snippet; article body not retrievable)** — [PC Gamer](https://pcgamer.com/townscapers-developer-on-how-its-radically-casual-design-is-inspiring-a-new-wave-of-low-stress-builders-to-adapt-the-blueprint)

**Draw-and-it-reacts procedural building (Tiny Glade)**
- Started as a procedural wall generator; watching walls rearrange as they are built is described as "tangibly pleasant". Each element has its own generation pipeline. The developers call it "more of a toy box for making dioramas". **(fetched)** — [80.lv interview with Pounce Light](https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games)
- UX iteration was the team's biggest struggle; some features went through "five or six iterations". Players asked for individually placeable doors, which was hard because of the procedural systems underneath. Emergent uses (stairs lined up as machicolations, stacked lanterns as a wooden wall) were promoted into real features. **(fetched)** — [80.lv](https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games)
- Reviewers describe walls you "freeform doodle in any shape" and then snip apart or edit by vertex. **(snippet)** — [PC Gamer: Tiny Glade](https://www.pcgamer.com/games/city-builder/tiny-glade-wont-stop-delighting-me-with-new-discoveries)

### Inferences
- Transferable to a grid of blocks + edge walls: a one-finger rectangle drag that writes floor cells and derives the perimeter edge walls is the Dungeon Alchemist / Map Doodler room tool expressed in this data model. Corner posts already being derived rather than stored matches Townscaper's "derive the fiddly parts".
- A subtractive mode of the same gesture (Map Doodler) and an "interior wall as thin eraser/line" tool cover most dungeon editing with two tools, which suits a five-or-six-slot dock.
- Dungeondraft's Building tool is a cautionary case: a fast tool whose output cannot be touched by the precise tools gets abandoned. Output of a room-drag should be ordinary blocks and walls, editable by every other tool.
- Dungeondraft's floor re-randomising on every edit and Dungeon Alchemist's room-type change rewriting walls are the same defect: regeneration scope wider than the user's intent.
- Scatter-by-drag with per-instance random rotation/scale maps onto drag-painting props; "each stamp stays individually editable" is the property users want.
- TaleSpire's fallback chain (snap to surface via hit normal, else climb on top) is a ready-made rule for one-finger placement in 3D without a height control.

### Gaps
- Dungeon Alchemist's detailed interaction (how the drag is drawn, how doors are auto-placed between adjacent rooms, how merging rooms behaves) was not found in a primary source. Unverified background: rooms drawn adjacent share and open walls, and dragged doors snap to walls.
- No source retrieved for Wonderdraft, DungeonFog, Inkarnate's brush/stamp tools, or RPGScenery/FlowScape. Unverified background: FlowScape is paint-to-scatter 3D foliage with a brush; DungeonFog draws rooms as polygons point-by-point with automatic walls; Wonderdraft is landmass brush + symbol scatter.
- Tiny Glade specifics (handles on objects, no menus, snapping behaviour) were not confirmed by a developer source.

## 2. How are asset libraries organised and searched (categories, tags, favourites, recents, hotbars, eyedropper)?

### Takeaway
Evidence here is thin. What was found: large libraries (thousands of objects) are a selling point but create a findability problem that tools answer with collapsible sections, favourites, tags by pack, and category-based random picking; nothing retrieved documents an eyedropper in the tabletop tools, though Minecraft Bedrock ships "Pick Block" as an optional touch button.

### Cited Findings
- Dungeon Alchemist advertises "6000+ objects to place". **(fetched)** — [Steam store page](https://store.steampowered.com/app/1588530)
- Dungeon Scrawl's Images panel has Favorites, Custom Images and Free Images sections, each collapsible as of May 2026; dropped images now land exactly where released. **(fetched)** — [Roll20 blog, May 2026](https://blog.roll20.net/posts/dungeon-scrawl-updates-may-2026/)
- Dungeon Scrawl: selecting an object on the canvas highlights its layer in the Layers panel and vice versa (the enclosing folder if it is closed); new objects placed while a folder is selected go into that folder. **(fetched)** — [Roll20 blog, May 2026](https://blog.roll20.net/posts/dungeon-scrawl-updates-may-2026/)
- Dungeondraft's library is largely third-party packs; one pack lists 272 objects tagged by colour theme. **(snippet)** — [Cyclopean DnDungeon blueprint assets](https://cyclopean.itch.io/dndungeon-blueprint-assets-for-dungeondraft)
- Canvas of Kings lets the user pick an object *category* and have the tool vary the actual object, rather than choosing each asset. **(fetched)** — [Steam: Canvas of Kings](https://store.steampowered.com/app/2498570/); [80.lv](https://80.lv/articles/this-godot-powered-tool-lets-you-easily-make-hand-drawn-maps)
- Minecraft Bedrock touch: a nine-slot hotbar is the working palette; "Pick Block" is an optional on-screen button that can be toggled on in touch settings. **(fetched)** — [Minecraft Wiki: Controls](https://minecraft.wiki/w/Controls)
- TaleSpire has a building toolbar with a Slab selection button. **(snippet)** — [Tales Tavern](https://talestavern.com/?p=19480)

### Inferences
- "Pick a category, get a varied member" (Canvas of Kings) reduces library trips: one hotbar slot can stand for "a barrel-ish thing" and vary per placement. This fits presets-as-data and seeded generation.
- Pick-from-scene is the cheapest palette on a phone: the scene itself is the library of things already chosen. Minecraft treats it as worth a dedicated optional button on touch.
- Two-way highlight between scene and list (Dungeon Scrawl) is the discoverability pattern for "what is this thing and where does it live".

### Gaps
- No sourced praise or complaints about library search in Dungeondraft, Inkarnate, Dungeon Alchemist or TaleSpire were found; the searches returned none. Unverified background: Dungeondraft filters objects by tag and by pack with a text search; TaleSpire has a searchable asset browser, a hotbar of numbered slots, and a pick-asset shortcut; Inkarnate has a searchable stamp catalog with favourites/collections.
- No data on recents shelves in any of these tools.

## 3. Undo/redo, selection, multi-select, move/rotate/duplicate, layers/floors/height

### Takeaway
Desktop tools lean on modifier keys for exactly the operations a phone lacks (rotate, height, multi-select, erase); the ones that have thought about it are converging on "one modifier + drag" for each axis, which on touch must become a mode toggle or on-screen control. Multi-select and group move are long-standing requests even in mature tools.

### Cited Findings
- TaleSpire (2020 dev log): rotation was middle-mouse, found unreliable across mice; Left-Alt + mouse move sets a tile's facing, chosen to match creature rotation ("one rotation scheme for all objects"). Height was scroll wheel or moving the build plane, both judged cumbersome; replaced by Left-Ctrl + drag up/down, which also moves the build plane (grid). The developer wants building to feel "satisfying" and says many interactions did not. **(fetched)** — [TaleSpire Dev Log 214](https://bouncyrock.com/news/articles/talespire-dev-log-214)
- TaleSpire: copy/delete/paste of volumes was described by the developers in 2020 as "a little slow/clunky". **(snippet)** — [Bouncyrock feature request summary 2020-07-01](https://bouncyrock.com/news/articles/feature-request-summary-2020-07-01)
- Dungeon Alchemist users request drag-select of multiple objects and moving a room as a whole. **(snippet)** — [Feature request: select multiple objects by dragging](https://dungeonalchemist.upvoty.com/b/feature-requests/select-multiple-objects-by-dragging)
- A June 2025 Steam review of Dungeon Alchemist asks for map rotation and buildings at different levels as "two basic things". Another 2025 review complains export only handles flat 2D maps. **(snippet)** — [Dungeon Alchemist on Steam](https://store.steampowered.com/app/1588530)
- Dungeon Scrawl (May 2026): multi-select with Shift/Ctrl+Click on canvas or in the Layers panel; bulk actions; changing a layer setting applies to all selected items of the same type. **(fetched)** — [Roll20 blog](https://blog.roll20.net/posts/dungeon-scrawl-updates-may-2026/)
- Dungeondraft Building tool: erase is Alt + draw; point editing is a separate explicit mode entered by button. **(fetched)** — [Dungeondraft Encyclopaedia](https://dungeondraft-encyclopaedia.gitbook.io/guide/all-the-tools/design-tab/building-tool)
- The Sims Mobile: hold a piece and drag to move it; rotate with a rotate button in the placement menu at the bottom of the screen (tap-to-rotate is disputed in forum replies). Rooms are edited as units: select Room, tap a room, drag one of four tabs on its walls to resize, tap a symbol in the centre to rotate the room; walls cannot be drawn freely. **(snippet)** — [ProGameGuides](https://progameguides.com/the-sims-mobile/how-to-move-furniture-in-the-sims-mobile/); [EA Forums: Building rooms](https://forums.ea.com/discussions/the-sims-mobile-en/re-building-rooms/11343791)
- Animal Crossing: Happy Home Designer (3DS, stylus): drag furniture to move, tap an item to rotate it. **(snippet)** — [Thonky: Home Design Guide](https://www.thonky.com/animal-crossing-happy-home-designer/home-design-guide)

### Inferences
- The Sims Mobile's room-as-object model (four wall-tabs to resize, centre handle to rotate) is the touch answer to Dungeon Alchemist users' "move the room as a whole" request: handles on a selected room, not a marquee over its contents.
- Tap-selected-thing-to-rotate (Happy Home Designer) and a rotate button in a bottom placement bar (Sims Mobile) are the two touch conventions; both avoid a rotation gesture, which would collide with two-finger camera.
- TaleSpire's "height drag also moves the build plane" suggests coupling: the current floor level is a property of the tool, changed by a stepper, and placement lands on it.

### Gaps
- Undo/redo: no source retrieved describes undo behaviour in any of these tools (Townscaper's article does not mention it; TouchArcade notes its only options are a 30 fps cap and anti-aliasing — [TouchArcade](https://toucharcade.com/2021/10/20/townscaper-mobile-review-iphone-android-ipad-icloud-controller-support-raw-fury/)). Unverified background: Townscaper and Tiny Glade have plain undo/redo buttons.
- Floors/levels UI in Dungeon Alchemist, Dungeondraft (levels dropdown) and TaleSpire (cutaway/hide-above) not confirmed from sources.
- Happy Home Paradise (Switch) is controller-driven; its half-unit placement was not confirmed.

## 4. How do procedural generators expose control (seed, sliders, presets, regenerate one room, lock-and-reroll)?

### Takeaway
Generators expose one dominant action (make a new one) and a small set of coarse knobs (tags or three or four sliders); seeds live in the URL. The unmet need across tools is scoped regeneration: reroll one layer or one room while pinning what the user has touched.

### Cited Findings
- Watabou One Page Dungeon: Enter = new dungeon; Tab = Tags dialog; S = Style dialog; 1–5 = preset styles; Shift+Space = reroll notes only; Space = rearrange notes; toggles for grid, water (and Shift+W to raise the water level), props, secrets, legend, monochrome, rotate-to-fit. **(fetched)** — [Watabou devlog: Keyboard shortcuts](https://watabou.itch.io/one-page-dungeon/devlog/491830/keyboard-shortcuts)
- Watabou tags are requests, not guarantees: generation "often fails to get exactly what you were asking for"; the `large` tag is the only way to get a large dungeon. Shared links carry `?seed=…` plus tags and reproduce the dungeon. **(fetched)** — [Watabou devlog](https://watabou.itch.io/one-page-dungeon/devlog/491830/keyboard-shortcuts)
- Watabou on mobile: the author says it is not optimised for mobiles, and the only easily accessible operation there is the most important one, generating a new map; context-menu access on mobile was planned. **(snippet)** — [Watabou One Page Dungeon comments](https://watabou.itch.io/one-page-dungeon/comments)
- Dungeon Scrawl Random Dungeon Generator (beta, May 2026): one panel in the sidebar; default randomised settings or adjust them; regenerate freely, no account; each generation replaces the current map after a warning; the result is an ordinary editable map. **(fetched)** — [Roll20 blog](https://blog.roll20.net/posts/dungeon-scrawl-updates-may-2026/)
- Dungeon Map Doodler: generate a random dungeon then edit it; controls are number of rooms, room size, amount of content, include monsters; can import from donjon. **(snippet)** — [dungeonmapdoodler.com](https://dungeonmapdoodler.com)
- Dungeon Alchemist: a per-room randomize button. Users ask for locking: one request (Nov 2024, 1 vote, no developer reply) wants selected objects or an area fixed "before refreshing" so the generator builds around a pre-placed fireplace or tavern counter; others want to lock walls, doors, windows, or categories such as torches or pillars, because regenerating wipes work when redrawing or expanding a room. **(fetched for the first; snippet for the rest)** — [Fix objects in room before refreshing](https://dungeonalchemist.featurebase.app/p/fix-objects-in-room-before-refreshing); [Item/object/asset locking](https://dungeonalchemist.featurebase.app/p/item-object-asset-locking); [Locking specific features ahead of room creation](https://dungeonalchemist.featurebase.app/p/locking-specific-features-ahead-of-room-creation)
- Townscaper keeps large shapes under user control and predictable, with detail varying; rare features are made predictable via priorities rather than chance. **(fetched)** — [Game Developer](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)

### Inferences
- Watabou separates rerolls by layer (layout / notes / style / water level) with one key each. For a seeded generator with layout engines and data presets, the equivalent is separate "reroll layout" and "reroll furnishing" actions with independent sub-seeds.
- "Anything the user has edited is pinned" is the implied default users want from Dungeon Alchemist; per-room reroll plus automatic pinning of touched pieces would answer the three separate locking requests.
- Whole-map replace with a warning (Dungeon Scrawl) is the weakest form; with undo available the warning could be dropped.
- Watabou's mobile stance (only "new map" is reachable) is a clear floor for a phone generator UI: one big reroll button first, knobs behind it.

### Gaps
- Whether Dungeon Alchemist has shipped any locking by late 2026 is unknown; the request pages show no status.
- Watabou's Medieval Fantasy City Generator and other generators (sliders for size, toggles for walls/river/coast, warp/edit tools) were not retrieved.

## 5. How do voxel/3D mobile builders solve placement precision with a finger?

### Takeaway
Minecraft Bedrock, the reference case, ships both answers and lets the player choose: direct tap on the target (fast, finger occludes) or a fixed crosshair with on-screen action buttons (precise, two-handed). Everything else found is thin; ghost-preview-then-confirm was only weakly evidenced.

### Cited Findings
- Minecraft Bedrock offers three touch schemes: "Joystick & tap to interact", "Joystick & aim crosshair", and "D-pad & tap to interact"; a Split Controls option on the D-pad scheme turns it into crosshair aiming. **(fetched)** — [Minecraft Wiki: Controls](https://minecraft.wiki/w/Controls)
- Tap schemes: tap the target face to place a block; hold a finger on a block to break it, with a progress icon. Crosshair scheme: aim the centre crosshair by dragging the view and use dedicated on-screen Attack and Interact buttons, which appear only in that scheme. With split controls: tap anywhere outside the HUD to place, hold anywhere to break. **(fetched)** — [Minecraft Wiki: Controls](https://minecraft.wiki/w/Controls)
- Button and joystick position, size and opacity are user-adjustable; optional buttons (Pick Block, Perspective) can be switched on. **(fetched)** — [Minecraft Wiki: Controls](https://minecraft.wiki/w/Controls)
- Update 1.19.50 added a "Delayed Block Breaking (Creative Only)" toggle in Touch Settings, removed the action delay from Attack and Interact buttons, and raised the inventory drag dwell time from 120 ms to 180 ms. **(fetched)** — [Player.One on 1.19.50](https://player.one/minecraft-bedrock-touch-controls-mobile-devices-heavily-improved-update-152533)
- Player requests after the redesign: action buttons in the tap-to-interact scheme, customisable button placement, mixing parts of schemes; later comments complain controls moved and ask for the old layout back. **(snippet)** — [Minecraft feedback thread](https://feedback.minecraft.net/hc/en-us/community/posts/4681918652045)
- Townscaper on phones: press release describes "simplistic touch-screen controls"; TapSmart praises simple controls and haptics; Android Police calls touch controls "great" while noting controller support "if you require precision". App Store users complain "I can't just draw, by tap and hold", that camera movement feels awkward, and that controls are "a bit janky". **(snippet)** — [Android Police](https://www.androidpolice.com/townscaper-is-a-charming-citybuilder-and-one-of-the-best-sandbox-games-on-android/); [TapSmart](https://www.tapsmart.com/news/townscaper-review/); [App Store listing](https://apps.apple.com/gb/app/townscaper/id1549531491)
- TaleSpire shows a bounding volume at the snapped position before the click commits. **(fetched)** — [TaleSpire Dev Log 214](https://bouncyrock.com/news/articles/talespire-dev-log-214)
- The Sims FreePlay: tapping an item opens its menu, with a green check icon to leave it where it was. **(snippet)** — [EA Forums: FreePlay building FAQ](https://forums.ea.com/discussions/the-sims-freeplay-en/faq-building-and-renovating-homes-in-the-sims-freeplay/10975941)

### Inferences
- Long-press-to-remove is slow by design in Minecraft (the delayed-breaking toggle exists to prevent accidental destruction in creative). On a tabletop with undo, a dedicated eraser tool or subtractive mode is faster than a hold.
- The Townscaper App Store complaint ("can't just draw by tap and hold") shows that one-tap-one-block feels slow on touch; users expect drag-to-paint along cells. With one finger = tool, drag-to-fill should be the default behaviour of block and wall tools.
- Minecraft's 120→180 ms dwell change shows tap-versus-drag disambiguation thresholds are tuned in tens of milliseconds and matter to feel.
- Haptic tick on each placement (praised for Townscaper on iPhone) is cheap confirmation when the finger hides the cell.
- Because the finger occludes the target, an offset ghost (drawn above the finger) or a crosshair mode is the remaining precision option; no retrieved source documents an offset-ghost design.

### Gaps
- No sources found for Roblox Studio/mobile building, Block Craft-style apps, or Happy Home Paradise touch placement. Unverified background: Block Craft-type apps use tap-to-place with an add/remove mode toggle and on-screen up/down fly buttons; mobile decorating games commonly use a ghost with a confirm tick and rotate button attached to the selected object.
- Exact Townscaper touch mapping (tap to add, how removal is triggered) not confirmed.

## 6. What user complaints recur?

### Takeaway
Across tools the complaints cluster into four: auto-generation overwrites manual work; fast tools are not editable by precise tools; browser tools hit memory/performance limits on large maps; and touch is either unsupported or feels like an afterthought. Reddit evidence could not be gathered, so this is a partial picture.

### Cited Findings
- Regeneration destroys work: Dungeon Alchemist users say regenerating a room wipes what they did when redrawing or expanding it, and ask to lock walls, doors, windows, objects. **(snippet)** — [Item/object/asset locking](https://dungeonalchemist.featurebase.app/p/item-object-asset-locking)
- Missing basics in a mature tool: "Two basic things right of the bat are needed. Rotate map ability and also placing building at different levels." (June 2025 Steam review, as summarised). **(snippet)** — [Dungeon Alchemist on Steam](https://store.steampowered.com/app/1588530)
- Despite this, Dungeon Alchemist sits at about 93% positive on Steam English reviews. **(fetched)** — [Steam store page](https://store.steampowered.com/app/1588530)
- Fast tool, low control: the Dungeondraft guide itself steers users away from the Building tool for any map over about ten minutes. **(fetched)** — [Dungeondraft Encyclopaedia](https://dungeondraft-encyclopaedia.gitbook.io/guide/all-the-tools/design-tab/building-tool)
- Browser performance (Inkarnate): bug reports of Chrome crashing with out-of-memory on save, "Firefox stable but laggy", and maps that never load. **(snippet)** — [Inkarnate feedback: Chrome crashes / Firefox laggy](https://feedback.inkarnate.com/p/browser-chrome-crashes-intermittently-firefox-stable-but-laggy); [maps will not load](https://feedback.inkarnate.com/bugs/p/maps-will-not-load-when-trying-to-view-or-work-on-them)
- Clunky volume operations and unsatisfying interactions were acknowledged by TaleSpire's own developers in 2020. **(fetched/snippet)** — [Dev Log 214](https://bouncyrock.com/news/articles/talespire-dev-log-214); [Feature request summary](https://bouncyrock.com/news/articles/feature-request-summary-2020-07-01)
- Touch: Watabou "not optimised for mobiles"; Roll20's freehand tool reported not to work with finger or Pencil in Mobile Safari on iPad; Townscaper iPad users find camera movement awkward. **(snippet)** — [Watabou comments](https://watabou.itch.io/one-page-dungeon/comments); [Roll20 forum](https://app.roll20.net/forum/permalink/8614368); [App Store listing](https://apps.apple.com/gb/app/townscaper/id1549531491)
- Canvas of Kings' developer on scope: "I underestimated the effort involved over the past few years"; Early Access exit slipped from mid-2025 to mid-2027. 93% positive of 847 reviews. **(fetched)** — [Steam: Canvas of Kings](https://store.steampowered.com/app/2498570/)

**Touch/phone/tablet support per tool (as found)**

| Tool | Touch / phone / tablet | Source |
|---|---|---|
| Dungeon Alchemist | Desktop (Steam); no touch support mentioned | [Steam](https://store.steampowered.com/app/1588530) |
| Canvas of Kings | Windows, macOS, Ubuntu; no touch or Steam Deck mention | [Steam](https://store.steampowered.com/app/2498570/) |
| Dungeon Scrawl | Browser; May 2026 notes do not mention mobile or touch | [Roll20 blog](https://blog.roll20.net/posts/dungeon-scrawl-updates-may-2026/) |
| Dungeon Map Doodler | Browser; developer says built to "work on as many devices as possible"; touch not explicitly confirmed | [dungeonmapdoodler.com](https://dungeonmapdoodler.com) |
| Watabou generators | Browser; author says not optimised for mobile, only "new map" easily reachable | [itch comments](https://watabou.itch.io/one-page-dungeon/comments) |
| Townscaper | Native iOS and Android with touch; also controller support | [TouchArcade](https://toucharcade.com/2021/10/20/townscaper-mobile-review-iphone-android-ipad-icloud-controller-support-raw-fury/) |
| TaleSpire | Desktop; controls documented are keyboard + mouse modifiers | [Dev Log 214](https://bouncyrock.com/news/articles/talespire-dev-log-214) |
| Minecraft Bedrock | Full touch, three schemes, customisable layout | [Minecraft Wiki](https://minecraft.wiki/w/Controls) |
| Deepnight Tabletop RPG Map Editor II | Added touch support with pinch-zoom and two-finger pan | [itch devlog](https://deepnight.itch.io/tabletop-rpg-map-editor/devlog/107906/update-12-tablet-support) |

### Inferences
- None of the dedicated battlemap builders found is phone-first; the touch-capable ones are either toys (Townscaper) or general games (Minecraft). A phone-first scene builder has no direct incumbent in this set.
- Two-finger pan/pinch as the camera is the convention where touch was added (Deepnight), consistent with one finger = tool.

### Gaps
- No Reddit or written Steam review text was retrieved; steep-learning-curve complaints about Dungeondraft/Wonderdraft/Inkarnate and TaleSpire build-time complaints are unverified here.
- Touch status of Dungeondraft, Wonderdraft, Inkarnate, DungeonFog, Tiny Glade and FlowScape was not confirmed. Unverified background: Dungeondraft, Wonderdraft, Tiny Glade and FlowScape are desktop-only; Inkarnate and DungeonFog are browser tools aimed at mouse use.

## 7. World-building wikis: World Anvil vs LegendKeeper vs Kanka

### Takeaway
The "World Anvil is cluttered, LegendKeeper is simple" framing is real but mostly sourced from LegendKeeper's own marketing and light-touch reviews; independent reviewers agree on direction (World Anvil = most features, steeper onboarding; LegendKeeper = smoothest interface; Kanka = quick to set up, good linking, flexible permissions) but none measured it.

### Cited Findings
- LegendKeeper's pitch: "World Anvil is all about features. LegendKeeper is all about flow. In LegendKeeper, there are no forms to fill out." **(snippet)** — [LegendKeeper: best World Anvil alternatives](https://www.legendkeeper.com/best-world-anvil-alternatives/)
- LegendKeeper's comparison page claims offline editing versus World Anvil being "restricted to having to edit online", a "more digestible system for less experienced users", and that World Anvil's many features can be "a lot more confusing" for newcomers. **(fetched; vendor claim)** — [LegendKeeper vs World Anvil](https://legendkeeper.com/world-anvil-alternative)
- An April 2026 field test: LegendKeeper's "interface is the smoothest of any wiki tool I tested" and its templates for D&D entity types "reduce setup time"; but "the polish saves a few minutes per entry but does not generate the entry for you". Kanka: cross-linking between entities "is genuinely good", but "manual writing workload, slow for weekly prep". **(fetched; the site sells a competing product)** — [char-gen.com field test](https://char-gen.com/alternatives/world-anvil)
- A reviewer reported setting up a Kanka campaign in under an hour "compared to World Anvil's steeper onboarding". **(snippet; from a ranking site with paid placements, low reliability)** — [Worldmetrics](https://worldmetrics.org/best/worldbuilding-software/)
- Cannibal Halfling (2023): World Anvil is "focused significantly more towards worldbuilding than straight campaign management", has the "most sophisticated map making and annotation tools of any of these sites by far", but "the free tier is anemic" and its ads are "the worst of all three". Kanka "is designed for free users" and allows permissions "for every single element you create". **(fetched)** — [Cannibal Halfling: Campaign Managers](https://cannibalhalflinggaming.com/2023/03/29/system-split-campaign-managers/)
- Kanka positions itself for tabletop players and World Anvil for writers. **(snippet; vendor)** — [Kanka vs World Anvil](https://kanka.io/kanka-vs-worldanvil)

### Inferences
- The lesson for a tabletop's Prep mode: start in the content (a blank page, a table), not a form; let structure be added later. Forms-first is what gets called cluttered.
- Templates for common entity types are valued precisely because they cut setup time; that argues for themed starter content over empty states.

### Gaps
- World Anvil's own comparison page returned HTTP 403. No independent, quoted user complaint of "cluttered" was retrieved, though it is widely repeated. Mobile UX of all three was not covered by any source found.

## 8. Onboarding: templates, starter scenes, guided first build, empty states

### Takeaway
The tools with the best first minute never show an empty canvas with a toolbox: they either generate a complete thing immediately (Watabou, Dungeon Scrawl's generator), make the first gesture produce a finished-looking result (Dungeon Alchemist, Townscaper), or open on a themed starter scene (Tiny Glade).

### Cited Findings
- Tiny Glade's glades come with different themes, seasons and starting buildings, intended to introduce additional building elements and set a mood. **(fetched)** — [80.lv](https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games)
- Dungeon Alchemist's first step is choosing a theme, then drawing; the first drag yields a lit, furnished room. **(fetched)** — [Steam store page](https://store.steampowered.com/app/1588530)
- Dungeon Scrawl's generator produces a complete dungeon "in seconds", with no account required, from default randomised settings. **(fetched)** — [Roll20 blog](https://blog.roll20.net/posts/dungeon-scrawl-updates-may-2026/)
- Watabou's design centres on one action, a new dungeon on Enter, with a result on screen at load. **(fetched/snippet)** — [Watabou devlog](https://watabou.itch.io/one-page-dungeon/devlog/491830/keyboard-shortcuts); [comments](https://watabou.itch.io/one-page-dungeon/comments)
- Townscaper offers almost no settings (a 30 fps cap and anti-aliasing) and a tiny action set. **(snippet)** — [TouchArcade](https://toucharcade.com/2021/10/20/townscaper-mobile-review-iphone-android-ipad-icloud-controller-support-raw-fury/)
- Canvas of Kings uses templates for lighting/weather and for export settings. **(fetched)** — [Steam: Canvas of Kings](https://store.steampowered.com/app/2498570/)
- LegendKeeper's entity templates reduce setup time; World Anvil's breadth is described as confusing to newcomers. **(fetched)** — [char-gen.com](https://char-gen.com/alternatives/world-anvil); [LegendKeeper](https://legendkeeper.com/world-anvil-alternative)
- The Tiny Glade team judges a tool by "how many stories they can tell" and aims to remove any need to work around the tools. **(fetched)** — [80.lv](https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games)

### Inferences
- A new board should open already populated: theme picked, a generated scene present, and a visible reroll, so the first interaction is editing rather than starting. This combines the Watabou/Dungeon Scrawl and Tiny Glade patterns.
- A starter scene doubles as a tutorial for tools it implicitly demonstrates (Tiny Glade's starting buildings "introduce" elements).

### Gaps
- No source found on explicit guided tutorials, coach marks or empty-state copy in any of these tools.
- No sourced data on time-to-first-map for any tool.
