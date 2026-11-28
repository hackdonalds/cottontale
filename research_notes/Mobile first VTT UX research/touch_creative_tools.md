# Touch-first UI patterns in mobile creative tools and platform guidelines (state as of 2026)

Reader's note on evidence quality. Pages actually fetched and read in full: Procreate Pocket Handbook (Gestures, Interface), Nomad Sculpt manual (Interface), Apple HIG Sheets (change log shows last update March 24, 2026), NN/g "Bottom Sheets", Hoober's 2013 UXmatters column. Everything else is from search-result summaries only (marked "search summary"); where a summary did not say which of several result links carried a claim, that is stated. The Material 3 bottom-sheet page could not be read (it returned only its title). Items I could not source are in Gaps, never in Cited Findings.

## 1. Tool selection and palettes: fitting dozens of tools on a phone; contextual vs persistent

### Takeaway
The phone versions of serious tools keep only two or three things persistent (current tool, one or two continuous sliders, undo) and collapse everything else behind one expander or swap the bottom bar by selection. The common shape is "one persistent rail + one contextual rail", never a full desktop toolbar shrunk down.

### Cited Findings
- Procreate Pocket (phone) shows only the current painting tool in the top-left bar, plus an ellipsis button that expands the full toolbar; when collapsed, the bar shows whichever painting tool was last used. — [Procreate Pocket Handbook: Interface](https://help.procreate.com/pocket/handbook/interface-gestures/interface)
- The expanded Pocket toolbar holds: Paint, Smudge, Erase, Layers, Colors, Actions, Adjustments, Selections, Transform, and a back arrow to the Gallery (10 items); it is collapsed again by swiping it back up. — [Procreate Pocket Handbook: Interface](https://help.procreate.com/pocket/handbook/interface-gestures/interface)
- Pocket's "tap again to go deeper" rule: tapping a painting tool selects it; tapping it a second time opens the Brush Library for that tool. One slot serves as both tool selector and entry to its options. — [Procreate Pocket Handbook: Interface](https://help.procreate.com/pocket/handbook/interface-gestures/interface)
- Pocket's only always-visible continuous controls are two side sliders (brush size on top; opacity or pressure below), on the left by default, with a left-hand layout switch in Actions > Preferences. — [Procreate Pocket Handbook: Interface](https://help.procreate.com/pocket/handbook/interface-gestures/interface)
- Pocket opens Colors and Layers as cards from the bottom of the screen with a swipe handle to expand or collapse; tapping the canvas closes the card. — [Procreate Pocket Handbook: Interface](https://help.procreate.com/pocket/handbook/interface-gestures/interface)
- Pocket has a "full screen" mode (four-finger tap) that hides all chrome; a small indicator in the top-left restores it, and gestures keep working. — [Procreate Pocket Handbook: Interface](https://help.procreate.com/pocket/handbook/interface-gestures/interface)
- Nomad Sculpt's layout: a tool rail on the right by default that toggles between one long column, a multi-column list, or hidden; resizable by a corner handle; side bars can be mirrored for the other hand. A left side bar holds a few quick tools (Smooth, Mask, Hide, Face Group, Gizmo) that can be reordered by dragging. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- Nomad's bottom bar is a user-configurable shortcut row (Undo, Redo, Solo, X-Ray, Voxel, Grid, Wireframe, Inspect...), with a bindings button to add or remove functions. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- Nomad's top menu bar has an explicit small-screen overflow setting, "Responsive": "Multiline" wraps menus onto several lines, "Scroll" keeps one scrollable line. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- Nomad exposes UI density as user sliders (overall scale, panel width, font scale, vertical spacing, edge offsets), and recommends transparent, low-blur panels on small devices so menus do not hide the model. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- CapCut's bottom bar is context-sensitive (search summary; the summary did not say which guide): with nothing selected it shows global tools (audio, text, stickers, effects); selecting a clip swaps it for clip-level tools (split, trim, speed, volume, filters, adjust). Candidate sources: — [Hollyland guide](https://www.hollyland.com/blog/topics/capcut-video-editing); [Storyblocks CapCut 101](https://www.storyblocks.com/resources/tutorials/how-to-use-capcut)
- CapCut's own help centre acknowledges that feature locations and the UI move between updates, across mobile, desktop and web. — [CapCut help: UI update changes](https://www.capcut.com/help/capcut-ui-update-changes)
- Canva mobile: options appear after an element is selected; more are reached through the floating toolbar's "more" icon or by long-pressing the element; the option row overflows horizontally ("swipe left and tap More"); a close button returns to the main toolbar. In text editing, a toolbar sits above the keyboard with font, colour and size (search summary). — [Canva help: navigate the mobile app](https://www.canva.com/help/navigate-canva-mobile-app/)
- Canva's mobile app navigation was reorganised into five tabs at the bottom of the screen (search summary). — [Canva help: Glow up](https://www.canva.com/help/glow-up/)
- Shapr3D's "adaptive UI" (introduced in iPadOS app version 3.42) suggests tools from what is selected: two intersecting bodies bring Boolean operations forward, a selected face suggests offset. The vendor claims up to 20% faster work. TABLET ONLY evidence, and the 20% is a vendor claim (search summary). — [Shapr3D forum: Adaptive UI](https://discourse.shapr3d.com/t/ipad-adaptive-ui-the-key-to-quick-streamlined-modeling/7942); [Fabbaloo](https://www.fabbaloo.com/2020/07/shapr3d-adds-adaptive-ui-proves-3d-cad-can-be-smarter)
- Shapr3D's later refresh aimed to build the interface "around your implicit and explicit actions rather than around available screen space" (search summary). — [Shapr3D blog: UI refresh](https://shapr3d.com/blog/behind-the-shapr3d-user-interface-refresh)
- Figma's phone app is for viewing, prototypes and comments, not editing (search summary, largely from App Store reviews and forum posts); editing on touch is FigJam on iPad. TABLET ONLY for editing. — [Figma on the App Store](https://apps.apple.com/us/app/figma/id1152747299); [Figma forum request](https://forum.figma.com/suggest-a-feature-11/more-functionality-on-the-ios-and-android-app-36931)
- FigJam on iPad merged the Hand and Select tools into one touch-first mode for navigating the canvas and moving objects, and later added a "Precision select" tool in the bottom toolbar (select by drawing around objects). TABLET ONLY (search summary). — [Figma on the App Store](https://apps.apple.com/us/app/figma/id1152747299)

### Inferences
- Three recurring mechanisms cover "dozens of tools": (a) one slot that shows the current tool and expands on demand (Pocket); (b) a bottom bar that is replaced, not added to, when something is selected (CapCut, Canva); (c) a user-pinnable shortcut row (Nomad). Cottontale's "replace, never stack" dock rule matches (b) directly.
- Persistent across these apps: current tool, undo/redo, one or two continuous parameters. Contextual: everything that needs a selection. Nothing found keeps object-level actions visible with no selection.
- Pocket's "tap the selected tool again to open its options" is a cheap way to get a second level without a second button; it fits a five-or-six-slot dock.
- Both Pocket and Nomad ship a left-hand mirror. A one-handed GM tool should treat handedness as a layout setting, not an afterthought.
- Figma declining to ship phone editing at all, and Shapr3D's evidence being iPad-only, suggest phone-sized full creation is still rare; Pocket, CapCut, Canva and Nomad are the realistic phone references.

### Gaps
- No design teardown of CapCut's editor was found (growth.design, Mobbin or CapCut-team posts); the contextual-toolbar description comes from tutorials, not design sources. Exact slot counts and bar heights are unverified.
- Nothing found on Shapr3D's iPhone UI, or on Prisma3D / Blender-on-tablet attempts; no searches on those returned usable material within budget.
- Notion mobile was not researched (budget).
- Canva's floating toolbar position rules (above/below selection, flip behaviour near edges) were not documented in what I found.

## 2. Bottom sheets: detents, sheets vs pages vs popovers, pitfalls

### Takeaway
Both Apple and NN/g say the same four things: one sheet at a time, sheets for short scoped tasks only, a nonmodal sheet when the user must keep working on the content behind it, and a full-screen page for long or complex flows. Resizable sheets need a grabber that also works by tap, plus an explicit close control.

### Cited Findings
- Apple defines two system detents on iPhone: large (fully expanded) and medium ("about half of the fully expanded height"); sheets can add custom detent values. — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- "In an iPhone app, consider supporting the medium detent to allow progressive disclosure of the sheet's content"; counter-example: Mail and Messages compose sheets are full height only, because content creation needs the room. — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- "Include a grabber in a resizable sheet": it signals resizability, can be tapped to cycle through detents, and works with VoiceOver. — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- A resizable sheet expands when people scroll its contents or drag the grabber (i.e. scroll and resize share one gesture by system design). — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- The SwiftUI medium detent is inactive in compact height (landscape phone) (search summary). — [Apple: PresentationDetent.medium](https://developer.apple.com/documentation/swiftui/presentationdetent/medium)
- On iOS a sheet may be nonmodal: "people use its functionality to affect the parent view without dismissing the sheet"; Apple's example is the Notes format sheet, which stays up while the selection changes. — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- "Display only one sheet at a time from the main interface... If something people do within a sheet results in another sheet appearing, close the first sheet before displaying the new one." — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- "For complex or prolonged user flows, consider alternatives to sheets", such as the full-screen modal style for multistep tasks like document or photo editing. — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- Button rules: always pair Done with Cancel or Back; never show Cancel, Done and Back together; Back moves within a multi-step sheet and "isn't intended to dismiss a sheet". Button placement guidance was updated on March 24, 2026. — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- "Support swiping to dismiss a sheet"; if there are unsaved changes when the swipe starts, confirm with an action sheet. — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- NN/g defines a bottom sheet as "an overlay that is anchored to the bottom edge of a mobile device's screen", a form of progressive disclosure, and notes that because it obscures part of the screen it is unsuited to content or tools users always need. — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- NN/g: sheets are best when users must refer to background information while working in the sheet. — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- NN/g calls the claim that bottom sheets improve reachability "largely incorrect": the middle of the screen is generally the most easily tapped area. — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- NN/g on expandable sheets: "Typically, bottom sheets start off as nonmodal in their minimized state but become modal when expanded." — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- NN/g's three common problems: no clear way to dismiss, stacked sheets, and obscuring relevant background content. — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- NN/g guideline: support the system Back action to dismiss the sheet, since a sheet that looks like a page makes users expect Back to work. — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- NN/g guideline: include a visible Close (X) button "rather than relying exclusively on the grab handle"; the swipe-down is easy to overlook and vertical swipes are ambiguous (they may open the notification drawer or control panel depending on where they start). — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- NN/g guideline: do not stack sheets and do not use them to replace page-to-page flows; a sheet is "a transient UI element". — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- NN/g guideline: use sheets only for short interactions; in long scrollable sheets, accidental swipes can dismiss the sheet and dump the user back. — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- Material distinguishes standard (persistent, same elevation as content, coexists with it) from modal bottom sheets (higher elevation, block the rest); sheets should appear only from a user-initiated action; on larger screens standard bottom sheet content can move to a side sheet (search summary, partly from older Material pages). — [Material: Sheets: bottom](https://material.io/components/sheets-bottom); [Android Developers: Bottom sheets](https://developer.android.com/develop/ui/compose/components/bottom-sheets)
- Nomad's fix for the drag-versus-scroll conflict on phones: "Drag panel" set to Auto lets a finger drag a panel only when the motion is more horizontal than vertical, so vertical drags still scroll content. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- Pocket's bottom cards close when the canvas is tapped. — [Procreate Pocket Handbook: Interface](https://help.procreate.com/pocket/handbook/interface-gestures/interface)

### Inferences
- Cottontale's existing rules (three heights, grab handle is a real button, one sheet at a time, `pushSheetPage` instead of a second sheet, Prep as full-screen pages, back button shared with history) line up with the Apple and NN/g guidance point for point. The clean-slate redesign should keep that skeleton.
- Two places the guidance asks for more than a grabber: an explicit close control on every sheet (NN/g), and system Back dismissing the sheet (NN/g). Worth checking both on the non-Prep sheets.
- "Peek" as a third detent is not an Apple system detent (Apple names only medium and large plus custom values), but NN/g's description of a minimized nonmodal state that becomes modal on expansion is exactly the peek/half/full model: peek and half should leave the table live, full may behave as a page.
- NN/g's reachability point matters for a one-handed GM: a sheet at half height puts its first rows at mid-screen, which is the accurate zone; a peek strip at the very bottom edge is the least accurate place (see section 5). Put the most-used control in the sheet's top row, not its bottom row.
- In landscape phone there is not enough height for a medium detent (Apple disables it in compact height); the Material note about moving sheet content to a side sheet on wider screens is the matching pattern for landscape.
- Pitfall specific to a canvas app: Apple's sheet expands when its content is scrolled, so scroll, resize and dismiss all share one vertical drag. A canvas app that also treats touches outside the sheet as tool input should keep resize on the handle only, or use Nomad's direction-lock idea.

### Gaps
- The Material Design 3 bottom-sheet guidelines page could not be read (it returned only a title), so no M3 numbers (drag-handle size, top margin, max width, scrim values) are cited. I recall from prior knowledge a 32x4dp drag handle and a 640dp maximum width, but did not verify either; treat as unverified.
- No sourced guidance was found on the on-screen keyboard inside sheets (sheet jumping to full on focus, keeping the focused field above the keyboard).
- Google Maps / Apple Maps sheet behaviour was not fetched; no primary source describing their detents was found. NN/g's article uses Apple Podcasts as its expandable-sheet example instead.
- No numeric detent heights (percent of screen for peek/half) were found in any primary source beyond Apple's "about half".

## 3. Gestures: conventions, discoverability, conflicts, accidental touches

### Takeaway
Two-finger tap = undo and three-finger tap = redo is now a cross-app convention (Procreate, Procreate Pocket, Nomad Sculpt, FigJam), but every one of these apps also backs it with a visible button, a setting to turn it off, and visible feedback naming what was undone. Multi-finger taps are also the leading source of accidental edits, so they need thresholds and an off switch.

### Cited Findings
- Procreate Pocket gesture set (phone): pinch to zoom; pinch-twist to rotate; quick-pinch to fit the canvas to the screen (and reverse quick-pinch to return to the previous view); two-finger tap undo; two-finger tap-and-hold rapid undo; three-finger tap redo; three-finger hold rapid redo; three-finger scrub to clear the layer; three-finger swipe down for a Cut/Copy/Paste menu; four-finger tap for full screen. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- Pocket shows a notification naming which action was undone on each two-finger tap. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- The rapid-undo hold delay is user-adjustable (Preferences, Timers); the handbook gives no default number. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- Pocket has a toggle for whether pinch-zoom may also rotate the canvas (search summary). — [Procreate Pocket Handbook: Actions help](https://help.procreate.com/pocket/handbook/actions/actions-help)
- "Draw and hold" (QuickShape): holding at the end of a stroke snaps it to a line or shape; adding a second finger tap while holding snaps to the perfect version. Hold-at-end as a modifier, second finger as a constraint. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- Precise slider control: drag away from the slider before moving along it; the further the finger is from the slider, the finer the adjustment. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- Pocket list gestures in the Layers panel: tap = select primary, swipe right = add to selection, two-finger pinch = merge, two-finger swipe right = alpha lock. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- Nomad Sculpt's "History 2/3" option: two-finger tap undoes, three-finger tap redoes, long press repeats; it is a toggle, and Undo/Redo buttons also sit in the bottom bar. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- Nomad's gesture settings are a matrix: each operation is a row with Finger / Stylus / Mouse toggles (e.g. finger drag moves the camera while stylus drag sculpts); three-finger drags can be assigned to light rotation, tool radius or tool intensity. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- Nomad palm rejection: touches with a contact area above a "Max size threshold" are ignored on phones and tablets; the manual warns it may not work on every device. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- Real-world failure of gesture undo: Nomad users report accidental undos from a resting hand, fixed via Gesture > Palm Rejection / "Use size rejection"; another thread asks how to disable two-finger undo / three-finger redo entirely (search summary). — [Nomad forum: Undo when I rest my hand on the screen](https://forum.nomadsculpt.com/t/undo-when-i-rest-my-hand-on-the-screen/2395)
- FigJam on iPad uses the same two-finger tap undo / three-finger tap redo. TABLET ONLY (search summary). — [Figma forum: FigJam on iPad undo and redo](https://forum.figma.com/archive-21/launched-figjam-on-ipad-undo-and-redo-32542)
- CapCut's own help page lists touch gesture conflicts: fingers lack cursor precision so users tap the wrong clip or drag the wrong keyframe, and swiping to scroll the timeline can trigger pinch-zoom or long-press context menus. The page is about iPad (search summary). — [CapCut help: precise selection on iPad](https://www.capcut.com/help/can-not-select-functions-on-ipad)
- A Figma forum request asks to prevent "select and drag with a single tap" on iPad (accidental moves when the user meant to pan or select), citing FigJam's behaviour as the better model. TABLET ONLY (search summary). — [Figma forum](https://forum.figma.com/suggest-a-feature-11/prevent-select-and-drag-with-a-single-tap-on-ipad-like-figjam-app-42995)
- NN/g: the swipe-down-on-grabber gesture for sheets is "easy to overlook" and some users do not know it exists, which is why a visible button is required alongside it. — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- Luke Wroblewski's maxim "Obvious always wins"; analysis credited to him found that moving common features out of hidden menus into visible bottom bars raised engagement, i.e. hiding features reduced it (search summary; the excerpt did not include the numbers). — [Allen Pike: Navigation Should Be Boring](https://allenpike.com/2019/navigation-should-be-boring); [Google Design: The Obvious UI is Often the Best UI](https://medium.com/google-design/the-obvious-ui-is-often-the-best-ui-7a25597d79fd)
- Canva offers long-press on an element as a second route to the same options the floating toolbar's "more" button opens (the gesture is an accelerator, the button is the tap path) (search summary). — [Canva help: navigate the mobile app](https://www.canva.com/help/navigate-canva-mobile-app/)

### Inferences
- The safe rule visible across all these apps: a gesture is an accelerator for something that also has a visible control. Cottontale already states this for pinning ("long-press pins, but the star in the library is the tap path"); it should hold for undo, multi-select and rotate too.
- Two-finger tap undo is learnable shorthand that Procreate, Nomad and FigJam users already know, and it is compatible with "two fingers = camera" only if a tap is separated from a pinch/pan by movement and duration thresholds. The Nomad forum reports show what happens when it is not: accidental undos. It must be optional and must show what it undid.
- Cottontale's rule "a second finger must never cause an edit" is stricter than Procreate's (QuickShape uses a second finger as a constraint). A two-finger tap undo is technically an edit triggered by a second finger; if adopted, it needs to be the single named exception with a visible toast and redo.
- The Pocket slider trick (move away for precision) transfers well to any dock slider (elevation, brush size, rotation) and costs no screen space.
- Contact-area palm rejection is unreliable across devices by the vendor's own admission; on the web, touch radius data is even less dependable, so do not rely on it. Structural protections (drop sheet to peek on canvas touch, cancel the tool stroke when a second finger lands) are safer.
- Per-input-type gesture mapping (finger = camera, stylus = tool) is a tablet/stylus pattern; on a phone with no stylus the mode has to come from the selected tool.

### Gaps
- No source was fetched for Apple HIG's gestures page or the system three-finger undo/redo swipes, so nothing about them is cited. From prior knowledge (unverified here): iOS has had three-finger swipe left/right for undo/redo since iOS 13, and shake to undo.
- No measured data was found on how many users discover two-finger undo unaided, or on gesture-teaching methods inside Procreate or Nomad (first-run hints, gesture cheat sheets).
- No default timings were found for long-press (the handbook says only "after a moment") or double-tap windows in these apps.
- Whether mobile browsers interfere with three- and four-finger gestures (system gestures, accessibility zoom) was not researched; relevant since Cottontale runs in a browser.

## 4. Selection and direct manipulation with a finger

### Takeaway
Phone tools avoid tiny handles: they select by tap, put the actions in a bar (floating near the selection or swapped into the bottom bar), and offer a second route by long-press. Precision comes from indirect controls (offset sliders, snapping, lasso selection) more than from handles.

### Cited Findings
- Canva mobile: selecting an element reveals its options; a floating toolbar carries the frequent actions with a "more" icon, and long-press on the element opens the same menu; the option row scrolls horizontally with a "More" entry at the end (search summary). — [Canva help: navigate the mobile app](https://www.canva.com/help/navigate-canva-mobile-app/)
- Canva's editor redesign describes a floating object panel with the most relevant tabs for the current design type, and a toolbar that suggests relevant features with the rest under "more" (search summary; described mainly in desktop/general terms). — [Canva newsroom: Glow up](https://www.canva.com/newsroom/news/glow-up/)
- CapCut: tapping a clip opens a secondary bar with clip-specific options (Speed, Trim, Volume, Filters, Adjust) (search summary; guide not identified by the summary). — [Hollyland guide](https://store.hollyland.com/blogs/creator-hub/use-capcut)
- YouTube Create (a comparable editor) slides up a bottom sheet with clip-specific tools (Split, Volume, Speed) instead of navigating to a new page (search summary of a third-party case study). — [Kinetix: Learning from YouTube Create](https://simplearyan.github.io/kinetix/blog/learning-from-youtube-create)
- FigJam's "Precision select" tool selects objects by drawing around them with a finger or Pencil, as an alternative to tapping small objects. TABLET ONLY (search summary). — [Figma on the App Store](https://apps.apple.com/us/app/figma/id1152747299)
- Shapr3D's adaptive UI turns the selection itself into the tool picker (select two bodies, get Booleans). TABLET ONLY (search summary). — [Fabbaloo](https://www.fabbaloo.com/2020/07/shapr3d-adds-adaptive-ui-proves-3d-cad-can-be-smarter)
- Pocket's selection extension in lists: tap selects the primary item, swipe right adds secondary items. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- Touch accuracy varies by screen position: about 7 mm at the centre to about 12 mm at the corners, per Hoober's research (search summary of his 2017 column). — [UXmatters: Design for Fingers, Touch, and People, Part 3](https://www.uxmatters.com/mt/archives/2017/07/design-for-fingers-touch-and-people-part-3.php)
- Hoober's target figures from his slide decks: minimum 6 mm (17 pt), preferred 8 mm (23 pt), maximum useful 15 mm (43 pt); spacing between target centres minimum 8 mm, preferred 10 mm; "if you can only remember one number", 8 to 10 mm (search summary of slides; not checked against his book). — [Hoober slides: Fingers, Thumbs and People](https://www.slideshare.net/slideshow/fingers-thumbs-and-people-s/29154735)
- Platform minimums: Apple 44x44 pt; Material 48x48 dp with at least 8 dp between targets; WCAG 2.2 SC 2.5.8 (AA) 24x24 CSS px, and SC 2.5.5 (AAA) 44x44 CSS px (search summary of several secondary sources). — [Google Accessibility help: Touch target size](https://support.google.com/accessibility/android/answer/7101858); [Ahmad Shadeed: Target size](https://ishadeed.com/article/target-size/)
- CapCut's help page concedes that in dense areas fingers hit the wrong clip or keyframe (iPad page) (search summary). — [CapCut help: precise selection on iPad](https://www.capcut.com/help/can-not-select-functions-on-ipad)

### Inferences
- For Cottontale's tokens and props: tap selects, and the dock (or a small floating bar anchored near the piece but kept inside the thumb zone) is replaced with the piece's actions; long-press on the piece is the accelerator to the same list. This is the Canva/CapCut consensus and fits "replace, never stack".
- A floating bar near the selection puts actions next to the object but can land under the finger or at the top of the screen; a swapped bottom bar is always reachable one-handed. For a one-handed GM the bottom-bar swap is the safer primary, with at most one or two on-object handles (rotate, lift).
- Because accuracy degrades to about 12 mm at corners and edges, pieces near the screen edge are harder to hit than the same piece centred; a "tap cycles through overlapping candidates" rule or a lasso/precision-select mode covers dense scenes better than shrinking hit areas.
- Hoober's 8 to 10 mm centre-to-centre spacing is a stricter and more physical rule than 44 px; on a dock of five or six slots across a ~70 mm wide phone each slot gets about 11 to 14 mm, which is comfortably inside it. Six is close to the practical ceiling.
- A grid already gives Cottontale snapping, which substitutes for most precision aids; the remaining precision need is free-angle rotation and elevation, where the Pocket "drag away for finer control" slider is the pattern to copy.

### Gaps
- No sources were found for loupe/magnifier, offset cursor, nudge buttons or haptic snapping in these apps; no claims are made. (The iOS edit menu and text loupe were not fetched.)
- Handle sizes and hit-slop values in Canva or Figma were not found.
- No phone evidence on 3D gizmo design for fingers; Nomad's gizmo page was not fetched.

## 5. Thumb-zone ergonomics and one-handed use

### Takeaway
The original data says people shift grips constantly (49% one-handed, 36% cradled, 15% two-handed in 2013) and that the centre of the screen is the most accurate area, not the bottom edge. The popular "thumb zone" heat map is a simplification whose own author has told readers to disregard his early heat maps.

### Cited Findings
- Hoober observed 1,333 people in public over two months ending January 8, 2013; 780 were touching the screen. Of those: one-handed 49%, cradled 36%, two-handed 15%. — [UXmatters: How Do Users Really Hold Mobile Devices?](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)
- One-handed use: right thumb 67%, left thumb 33% (well above the roughly 10% left-handed rate). Cradled: thumb 72%, finger 28%; cradling hand left 79%, right 21%. — [UXmatters: How Do Users Really Hold Mobile Devices?](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)
- Two-handed use was 90% portrait, 10% landscape. — [UXmatters: How Do Users Really Hold Mobile Devices?](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)
- The column carries an editor's note that Hoober did further research and updated his guidelines; in 2017 comments he says larger phones changed grip less than expected, and that the touch-location heat maps in the 2013 article were inaccurate and should be disregarded. — [UXmatters: How Do Users Really Hold Mobile Devices?](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)
- Hoober's later finding: accuracy is best at the centre (about 7 mm) and worst at corners (about 12 mm), roughly 9 mm along edges (search summary). — [UXmatters: Design for Fingers, Touch, and People, Part 3](https://www.uxmatters.com/mt/archives/2017/07/design-for-fingers-touch-and-people-part-3.php)
- NN/g, citing the same body of work: the idea that bottom placement improves reachability is "largely incorrect"; the middle of the screen is generally the most easily tapped. — [NN/g: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
- A List Apart's summary of the one-handed thumb zone: only about a third of the screen is effortless, at the bottom on the side opposite the thumb (search summary). — [A List Apart: phone grips figure](https://alistapart.com/1-2-phone-grips-jpg/)
- Tablets are used seated 88% of the time versus 19% for phones (Hoober and Shank, search summary). — [A List Apart: tablet zones figure](https://alistapart.com/1-9-tablet-zones-jpg/)
- The widely repeated "75% of interactions are thumb-driven" is attributed in one source to Josh Clark, not Hoober (search summary). — [Smashing Magazine: The Thumb Zone](https://smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users)
- Wroblewski argues the top-left corner is arguably the worst place for one-handed use and that frequent actions belong at the bottom; bottom bars are easier than a top-left hamburger on large phones (search summary). — [Google Design: The Obvious UI is Often the Best UI](https://medium.com/google-design/the-obvious-ui-is-often-the-best-ui-7a25597d79fd); [Smashing Magazine: one-hand usage](https://smashingmagazine.com/2020/02/design-mobile-apps-one-hand-usage/)

### Inferences
- The two bodies of advice conflict on the surface ("put it at the bottom" vs "the centre is best") but resolve cleanly: the top corners are worst for a one-handed thumb, the centre is most accurate, the bottom edge and bottom corners are reachable but imprecise. So: frequent actions low but not at the very edge, generously sized and spaced; nothing important in top corners; precise work in the middle of the screen, which is where the table is.
- A dock at the bottom edge sits in a low-accuracy band; its slots should be nearer Hoober's preferred 8 to 10 mm than the 44 px minimum, and destructive actions should not sit in bottom corners.
- Since 36% cradle (phone in one hand, other hand taps) and grips shift, do not design solely for a right thumb; two-finger camera gestures are natural in the cradle grip (or with two thumbs) and hard in the pure one-handed grip. A one-handed GM therefore needs a one-finger route to camera moves (a camera tool, or drag on empty space) as well as the two-finger one.
- Handedness is only 67/33 for one-handed use, so a mirrored layout benefits about a third of one-handed moments, not a tenth.
- Landscape was rare in the 2013 two-handed data (10%); a landscape phone layout is an enhancement, not the base, which matches the project rule.

### Gaps
- All grip data is from 2013 on phones around 5 inches; no comparable observational study on 2024 to 2026 phones (6.1 to 6.9 inch) was found. Hoober's own remark that larger phones changed grips less than expected is the only bridge.
- Hoober's book "Touch Design for Mobile Interfaces" was not consulted; the mm figures come from summaries of his columns and slides.
- No data found on how people hold a phone while doing something else with the other hand (dice, pencil, books), which is the GM's actual situation.
- Wroblewski's original posts were not fetched; his position is cited through secondary articles.

## 6. Onboarding: progressive disclosure, empty states, templates, coach marks

### Takeaway
NN/g's measured result is that up-front tutorials did not help: users who read them rated tasks harder and were slower. The supported alternative is to let the interface teach itself, with contextual help shown at the moment of need and at most one hint at a time.

### Cited Findings
- NN/g quantitative test: 70 users, 4 mobile apps with deck-of-cards tutorials. Users who read the tutorial rated task ease lower (SEQ 4.92 vs 5.49 for those who skipped) and took longer (93.49 s vs 85.17 s) (search summary). — [NN/g: Mobile tutorials](https://www.nngroup.com/articles/mobile-tutorials/)
- NN/g's conclusion: tutorials did not improve task performance; for most mobile apps users should be able to learn the interface by using it (search summary). — [NN/g: Mobile tutorials](https://www.nngroup.com/articles/mobile-tutorials/)
- NN/g: tutorials can make an app seem overly complicated, and the same effect was observed with coach marks and instructional overlays; several coach marks in a row strain short-term memory and make the app seem daunting (search summary; this is observation, not a separate controlled test). — [NN/g: Instructional overlays and coach marks](https://www.nngroup.com/articles/mobile-instructional-overlay/)
- NN/g recommends first asking whether formal onboarding is needed at all, and if so using interactive methods such as contextual help, visible without overwhelming detail until the user asks (search summary). — [NN/g: Mobile app onboarding](https://www.nngroup.com/articles/mobile-app-onboarding/)
- One practitioner case study reports coach marks were skipped and overlooked by almost every user (anecdotal; search summary). — [Livefront: Put me in coach (marks)](https://medium.com/livefront/put-me-in-coach-marks-8146c61ca875)
- Apple's sheet guidance uses the medium detent explicitly as progressive disclosure: show the most relevant items at half height, the rest on expand. — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- Pocket's undo notification names the undone action, which teaches what the gesture did at the moment it happens. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)

### Inferences
- For Cottontale: no slideshow, no multi-step coach-mark tour. Start on a generated or themed table (the theme gallery and seeded generators are a templates-first start already) so the first screen is something to poke, not something empty.
- Teach each gesture once, in context, with a single dismissible hint tied to the first relevant moment (first time a second finger lands: "two fingers move the camera"), and let feedback toasts carry the rest ("Undid: place barrel").
- Because coach-mark sequences are skipped, every hidden gesture must also be reachable from a visible control; onboarding cannot be relied on to make a gesture discoverable.
- The NN/g test covered ordinary consumer apps; complex creation tools may be a different case, and NN/g itself hedges with "most mobile apps". Treat the finding as "tutorials are not sufficient", not "never explain anything".

### Gaps
- No Appcues or growth.design teardown was located or read; no vendor statistics on onboarding completion are cited.
- No evidence was found specifically about empty states or templates-first starts in creative tools (Canva is the obvious example but nothing sourced).
- No data on onboarding for complex creation tools specifically, or on how Procreate/Nomad/CapCut teach first-time users.

## 7. Search, command palettes, quick actions, recents and favourites

### Takeaway
Little direct evidence was found. What the sources do show is that the pattern on phones is a user-curated shortcut row plus selection-driven suggestions, not a typed command palette.

### Cited Findings
- Nomad Sculpt lets users build their own shortcut surfaces: a bottom bar with add/remove bindings, a reorderable quick-tool side bar, and named floating toolbars that can be shown or minified. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- Pocket's collapsed toolbar always shows the last-used painting tool, a one-slot "recent". — [Procreate Pocket Handbook: Interface](https://help.procreate.com/pocket/handbook/interface-gestures/interface)
- Canva's toolbar suggests relevant features for the selection with the long tail under "more"; Shapr3D ranks tools from the selection (tablet) (search summaries). — [Canva newsroom: Glow up](https://www.canva.com/newsroom/news/glow-up/); [Shapr3D forum: Adaptive UI](https://discourse.shapr3d.com/t/ipad-adaptive-ui-the-key-to-quick-streamlined-modeling/7942)
- Pocket's three-finger swipe opens a small quick-action menu (Cut, Copy, Copy All, Duplicate, Cut & Paste, Paste) anywhere on the canvas. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)

### Inferences
- Cottontale's Recent/Favourites hotbar plus the `#lib` sheet with search is the phone equivalent of a command palette for pieces. Extending the same search to actions and settings ("fog", "next turn", "theme") would give one entry point for the long tail without adding dock slots.
- Selection-driven ranking (show the three most likely actions for this kind of piece, rest under More) is the phone substitute for a palette and has vendor support from Canva and Shapr3D.

### Gaps
- No sources on mobile command palettes (Notion mobile search, Linear mobile, iOS Spotlight-style in-app search) were researched; budget ran out.
- No data on recents vs favourites usage or optimal counts.

## 8. Undo/redo affordances and history

### Takeaway
Creative apps pair a gesture (two-finger tap / three-finger tap) with visible buttons, name the undone action on screen, support hold-to-repeat, and are explicit about history limits and when history is lost.

### Cited Findings
- Procreate Pocket undoes up to 250 actions; leaving to the Gallery or quitting clears the undo history (search summary for the clearing rule; the 250 limit is in the fetched page). — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- Each Pocket undo shows a notification stating which action was undone. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- Rapid undo/redo: hold two (or three) fingers to step continuously; lift to stop; the start delay is a user preference. — [Procreate Pocket Handbook: Gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)
- Nomad: Undo and Redo are bottom-bar buttons, and the two/three-finger taps are an optional toggle ("History 2/3") with long-press repeat. — [Nomad Sculpt manual: Interface](https://nomadsculpt.com/manual/interface)
- Failure modes reported by Nomad users: accidental undo from a resting hand; undo/redo icons disappearing with an empty history (January 2025 thread, unresolved in the result) (search summary). — [Nomad forum: palm undo](https://forum.nomadsculpt.com/t/undo-when-i-rest-my-hand-on-the-screen/2395); [Nomad forum: history is empty](https://forum.nomadsculpt.com/t/can-t-undo-and-redo-history-is-empty/18960)
- FigJam iPad: two-finger tap undo, three-finger tap redo. TABLET ONLY (search summary). — [Figma forum](https://forum.figma.com/archive-21/launched-figjam-on-ipad-undo-and-redo-32542)
- Apple: when a swipe would discard unsaved changes in a sheet, confirm with an action sheet (the one place the HIG asks for confirmation instead of undo). — [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)

### Inferences
- Minimum viable undo for the redesign: visible Undo (and Redo) reachable in Build mode without opening a sheet, a toast naming the undone action, hold-to-repeat, and optional two-finger tap. In a multiplayer last-writer-wins store, undo should be scoped to this device's own edits and say so in the toast, since Procreate-style linear history assumes one author.
- Undo history that vanishes silently (Pocket on leaving the canvas) is tolerated in a drawing app; for a GM mid-session, losing undo on reload or board switch should be stated or avoided.
- Prefer undo over confirmation for table edits; reserve confirmation for discarding unsaved form input and for irreversible, table-wide actions.

### Gaps
- No evidence found about visual history lists/timelines on phones (Nomad has a history menu; not fetched).
- No sources on undo in collaborative canvases on mobile (FigJam/Canva multiplayer undo semantics).
- Apple HIG's "Undo and redo" page was not fetched.

## 9. Performance-perception patterns for canvas apps

### Takeaway
The durable numbers are NN/g's 0.1 s / 1 s / 10 s limits: direct manipulation has to respond within 0.1 s to feel like the user's own action. Evidence for skeleton screens is contested; nothing sourced was found on optimistic UI.

### Cited Findings
- NN/g's three response-time limits: about 0.1 s feels like a direct result of the user's action; up to about 1 s feels like the computer is producing the result, and the user's flow is uninterrupted but the delay is noticed; about 10 s is the limit of attention (search summary). — [NN/g: The 3 Response Time Limits](https://www.nngroup.com/videos/3-response-time-limits-interaction-design/); [NN/g topic: response time](https://www.nngroup.com/topic/response-time/)
- Operations longer than 10 s need a percent-done indicator and a clear way to cancel (search summary of a secondary source restating NN/g). — [Innovaccer design system: response time](https://design.innovaccer.com/foundations/response-time)
- A common practice is to delay the loading indicator by 300 to 500 ms so fast responses show no loading UI at all (search summary, secondary source). — [AWS Builder Center: loading feedback by wait length](https://builder.aws.com/content/3M2CqltW6KlyigfOOolCKaohj0D/stop-treating-a-spinner-as-a-default-design-loading-feedback-by-how-long-the-wait-is)
- Skeleton screens are commonly recommended for roughly 1 to 10 s waits with a known layout, but one cited study had a skeleton lose to a spinner on every measured metric, so the perceived-speed benefit is contested (search summary; the summary did not say which article reported the study). — [SitePoint: skeleton screens](https://www.sitepoint.com/how-to-speed-up-your-ux-with-skeleton-screens/)
- Canvas-app instances of "show something now, refine later" already in the project's own rules: unknown pieces are drawn as stand-ins and built when first drawn. — project CLAUDE.md (internal, no URL)

### Inferences
- For a 3D table the 0.1 s limit applies to the local echo of a touch: the placed piece, the drag, the sheet movement. Network confirmation over Nostr can take longer provided the local edit is drawn at once; that is optimistic UI in effect, and a last-writer-wins store already makes it the natural model.
- Stand-ins for not-yet-loaded pieces are the canvas equivalent of a skeleton and are better supported than list skeletons, because the layout (where the piece is) is exactly known.
- Uploads, model ingest and generation can exceed 10 s on a phone; they need visible progress and cancel, per the NN/g limit, and should not block the table.

### Gaps
- No primary source on optimistic UI was found; the term is not covered by the NN/g material returned.
- The skeleton-vs-spinner study was not identified or read; treat the claim as unresolved.
- Nothing found on perceived performance specific to WebGL canvases on phones (frame-rate thresholds, render-on-demand perception, haptics as feedback).
