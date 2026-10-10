# Touch restrictions

Areas that work, are invisible to the compiler, and have no `build`-time protection. Do not edit
them *without a specific reason* — and if there is a reason, measure the result afterwards
(see [TESTING_SPECS.md](TESTING_SPECS.md)).

Design rationale for everything below lives in
[../../ARCHITECTURE.md](../../ARCHITECTURE.md); this file is the "don't" list, not the "why" list.

## Hands off

| Area | Why it is fragile |
|---|---|
| `app/components/SearchDock.vue` — morph / measure logic | Two cooperating engines: the overlay FLIP (matrix inversion, per-axis radius compensation) and the scroll-collapse fixed-box rAF flight that re-aims from the live box on a mid-flight reversal. Both were tuned by measurement; neither is readable from the diff. Phase E moved ONLY the overlay-FLIP playback to Motion (`app/utils/motion.ts` `spotlight.frame`, settle via `.finished`) — the matrix-inversion measurement stays. Phase E.2 then touched the flight engine on purpose: `flyStep` bends the ease-out-cubic lerp with a `sin(t·π)` parabolic bow (**ARC_BOW_PX=80**) whose lateral and lift are **drawn independently per flight** — `drawBow()`, a magnitude in **[0.5, 1.6] with a random sign**, called twice in `startFly` beside the `flyT0` reset and read in `flyStep` as `flyBowX`/`flyBowY`. Two facts make this the only safe place for the draw: the **per-axis** ratio is what reads as the angle (one shared factor would only scale the same arc, which is invisible), and the draw lands on the frame where `sin(t·π)` is **already 0** — so a new arc cannot displace the box the mid-flight reversal re-aim just read. Move either draw into `flyStep` and both properties go: the path becomes a walk and the reversal jumps. Two guards come with it: the **[0.5 floor]** keeps the apex bank at 5° (`matrix.b` 0.087 against the harness's `> 0.02`) because a draw reaching zero flies straight and reads as broken, and the **lift is bounded by `headroom = min(from.top, to.top) - 4`** because a collapse starts with the field's top at `0` — an unbounded lift sends the flying icon above the viewport, so it vanishes mid-flight and reappears. The `rotate` bank rides `flyBowX`, never `flyBowY`, so the box banks INTO whichever turn it drew. The bow stays **0 at launch and at landing whatever it drew**, so the endpoints remain pixel-exact; it also writes a decorative `flyTransform` (3D `scale`+aerodynamic `rotate`) and floating `flyShadow` on top of the drift-free `left/top` box, reset by `endFlight`/`endFieldReturn`; and `endFlight(true)` plays an `arrival` catch recoil (Motion scale spring 1→1.28→0.92→1.05→1, suppressed under reduced motion, with `suppressLauncherMotion` held so Motion is the launcher transform's only writer for it). `updateFieldMorph` and the in-place width scrub remain untouched. Motion writes the panel/flyer inline transform; the reactive `:style` transform refs stay pinned during the spring so Vue never clobbers it. **What was later added to this file, and how far it may go:** the spotlight field's clear disc (`[data-search-clear]`, `v-if="canClearQuery"`) is template + focus-list only — it sits in DOM order between the input and the close button and is a member of that keydown handler's `focusables` array, because the array doubles as the Tab membership test and a focused button left out of it gets its Tab swallowed back to the input. It reads no geometry, sets no timing constant, and must stay that way. |
| `app/components/category/CategoryDesktop.vue` + `CategoryMobile.vue` — drag + indicator | Tuned input models that are *deliberately* different (mouse Y-axis with `grabOffsetY` vs. touch X-axis with axis-lock detection and `scrollLeft` compensation). Merging them is a regression, not a cleanup. **Which items the docks show is data, not geometry** —
`useCategoryItems` builds the list from the shop's own `categories` rows, and both components iterate it
and measure whatever arrives; changing the list's length therefore does not license touching either
input model. The mobile bar carries `touch-pan-y`, so the browser will not pan it horizontally; the
touch engine pans it itself by writing `scrollLeft` when a drag enters a horizontal edge
(`EDGE_ZONE 40` / `MAX_EDGE_STEP 34`) — that is what makes an off-screen category reachable, and it
is now harness-locked (`dragging a mobile category to the right edge pans the overflowing bar`).
Phase F added tactile motion without touching either engine: buttons are `<motion.button :while-press="press">` (scale 0.97, spring 400/30) gated OFF while dragging (`isDragging` / `isTouchDragging`) and under reduced motion so a grabbed item never stays squished; the active icon plays a one-shot `iconPop` (played by `pulseScale` — raw WAAPI; motion-v's imperative shorthand keys are a measured no-op, see ARCHITECTURE's imperative-pulses row — on the icon's wrapper div, not the `<svg>`, so it scales from centre); the mobile bar's reveal is now a `<motion.div>` spring on `y` (`dock`) instead of `transition-transform` translate classes, and the bar is frosted glass (`backdrop-blur-xl backdrop-saturate-150` + inset top-specular / soft drop shadow). **The indicator's CSS `transition` string (260ms `cubic-bezier(0.16,1,0.3,1)`) is harness-locked — do not move it onto Motion or retime it.** The desktop fish-eye eases back to 1.0 on pointer-leave through the inner `180ms` transform transition — that IS the damped exit; do not add a rAF damp. **One writer per pill: `updateMobileIndicator` returns early while `isTouchDragging` holds.** The edge auto-scroll writes `scrollLeft`, every `scrollLeft` change fires the `scroll` listener that re-aims the indicator at the *active* item, and the drag is writing the finger's position in the same breath — before the guard the pill alternated between them at touch frequency once a drag reached the last category (frame-sampled: a 264px retreat in one frame on a transform still scaled 1.6 by the drag). Re-aiming on release is `handleTouchEnd`'s and `watch(activeIndex)`'s job, not those frames'. Harness-locked (`the dragged pill does not snap back while the bar pans`). |
| `app/pages/index.vue` — the nav's scroll box | The category list is the shop's to grow, so the desktop rail bounds itself and scrolls. The cap is counted **in rows, not viewport fractions**: a row is 57px and the gap 10px, so 7 whole rows are 459px, plus the nav's 4+4 and the clip's 8+8 = `lg:max-h-[483px]`. `68vh` was the wrong unit — on a shorter window it landed mid-row and drew half an icon at the bottom edge, which `verify` now asserts against. `overflow-y: auto` also clips at the **padding** edge, and the selection pill overhangs its row by ~25px sideways and ~4px while held or dragged (it scales) — the `-mx-7 px-7 -my-2 py-2` is that measured room. Reduce it and the pill's rounded ends get chopped off; put the overflow on the `<aside>` instead and the collapsed search launcher (`SearchDock`, anchored to that element's `top-full`) moves with it. |
| `app/components/ProductGallery.vue` — lightbox zoom | The inline main photo's `<AnimatePresence>` is `:initial="false"` — the FIRST photo renders at rest, it does not slide in. That slide was the fragile path: the photo started at `initial={x:'100%'}` and depended on its enter animation to return, so whenever frames weren't produced (SPA navigation into the page, an interrupted/backgrounded tab) it stayed a full width to the right, clipped by the frame's `overflow-hidden` — a sliver of the photo until a reload (SSR renders at rest). Selection changes still animate (later keyed children are unaffected by `initial`). Do not reintroduce an `initial` transform on the first photo that relies on an animation to undo it. | The lightbox zoom is separate: the magnification is anchored on the point that was clicked, and the pan bound is derived from the *painted* picture (`object-contain` letterboxes it inside the element box), not from the element box. Both were measured; neither reads from the diff. The frame is the `<img>`'s **parent** — wrap the photo in another element and the focal maths silently starts measuring the wrong box. The same overlay also carries the contained swipe (axis-locked: vertical closes, horizontal cycles the swap on the shared `SWIPE_CYCLE_*` gates, and the `dragged` flag is what keeps a swipe's trailing click from zooming); its `touch-action: none` now applies in both views. Phase D added Motion to the *presentation* layer only (dialog `<AnimatePresence>` fade, filmstrip slide, inline-main crossfade) — Motion must NOT write the `[data-zoomed]` / `[data-lightbox-main]` transform or wrap it in a transformed ancestor; the zoom engine owns that element's transform outright, and a second writer jitters the focal tracking |
| `app/features/product/components/ProductShareSheet.vue` — placement, teleport and swipe handle | The desktop popover measures the panel once, on the frame it enters, and stays `visibility: hidden` until it has a position (an unpositioned fixed panel paints in the viewport's top-left corner for a frame). The panel teleports to `body` because the mobile sticky bar's `backdrop-blur` would otherwise become its containing block and the "bottom sheet" would sit inside the bar. The sheet's `transform` is now a single Motion `y` (enter/exit, finger-follow, snap-back and dismiss all own it — Phase C.2). Drag starts only from the grabber/header handle via `useDragControls` (`dragListener` off, `dragConstraints {0,0}` + `dragElastic {top:0.15,bottom:1}` — the 0.15 top gives a light logarithmic resistance when pulled upward, Phase G); reordering the `@drag-end` dismiss-vs-snap gate or the `close()` emit breaks where the sheet visually exits from. Phase G made the controls tactile: `data-share-close`, `data-share-copy-link`, `data-share-copy-message`, the `data-share-destination` links and `data-share-close-bottom` are `<motion.button>`/`<motion.a>` with `press` `:while-press` (reduced-motion gated), and the two copy buttons fire a one-shot `copyPop` on `click` — after the press releases, so the same transform is never driven by two writers at once. The sheet's resting `transform` must stay `none`/identity (harness-checked) so a slow pull snaps back cleanly with no stray inline style |
| `app/plugins/locale-decode.client.ts` | The observer is armed *only* between `i18n:beforeLocaleSwitch` and 250ms of quiet, and it writes `node.nodeValue` on text nodes it collected. Widen either half and it starts animating typing, filtering and re-renders; drop the `childList` record type and it animates nothing (Vue replaces the node rather than editing it); collect only `nodeType === 3` from `addedNodes` and a control whose subtree is rebuilt — the `USelect` sort trigger — stays static while its neighbours decode; drop the `attributes` record type and the search field's `placeholder` never moves. `placeholder` is the *only* animated attribute on purpose: `aria-label` and `title` are accessible names, and flickering one makes an AT read noise as the label of a control. Drop the quiet timeout and it never detaches — and the quiet timeout alone is not enough either: a switch that remounts a page keeps re-arming it, so `MAX_WINDOW_MS` (1200) is the absolute deadline on top (measured without it: a product heading still cycling long after the switch that armed it). Its `STAGGER_MS` is measured (84ms → 50ms worst main-thread gap on a 4x-throttled phone), not styled — see ARCHITECTURE → Locale switch |
| `app/composables/useCatalog.ts` / `useSiteInfo.ts` mapping computeds, and the two storefront pages' `definePageMeta({ key, scrollToTop })` | These three move together and only together. The rows are cached and mapped in a `computed` that reads `locale.value`; the page key ignores the locale prefix; `scrollToTop` declines for a prefix-only navigation. Flatten `pickTranslation` back to fetch time (return the mapped array instead of the rows) and the *same* pages stop updating their text on a language switch, because nothing re-runs the mapping and nothing remounts to fetch it — silently stale copy, in both directions, green in `build`. The harness locks are the whole safety net (`… without leaving the page`, `… asks the server for nothing it already has`, `… keeps the place the visitor was reading`, `the whole page decodes, not one label`, `an ordinary text change after the settle is not decoded`, `a product navigation rebuilds the page and reads again`) |
| `app/assets/css/main.css` — select-morph keyframes | `0.24` is trigger-height ÷ panel-height, so the panel grows out of the control. The exit uses an accelerating curve on purpose: a decelerating collapse leaves an opaque remnant under the pill, which reads as a hang. |
| `app/app.config.ts` | Single owner of the pill control language. The pill classes live under `slots.base` — the typed Nuxt UI 4 form (a top-level `base` is tailwind-variants' legacy key: same merged slot at runtime, but it fails the app.config type; moved 2026-10-03, pills re-measured green). If you touch the file, re-measure the pill styling. |
| `supabase/migrations/**` | Schema + RLS *are* the security model. Migrations are never edited after they are pushed — write a new migration instead. |
| The `backup/*` tags and `.verify-base` worktrees | They are the baseline that proves a refactor is behaviour-preserving. |

## String contracts with no type checking

`tsc` cannot read `.vue`, so these bindings fail at runtime (or silently) only:

- **`[data-search-anchor]`** — `SearchDock` measures this element to decide when to collapse, and
  the scroll-collapse morph animates *this element's own* `width` in place. It also supplies both
  endpoints of the launcher flight (last on-screen rect = collapse origin; live rect = restore
  landing). Rename or move the element **in the same commit** as the change, never across two.
- **The product feature's `data-*` surface** — `[data-share-cta]`, `[data-share-sheet]`, `[data-panel-caret]`,
  `[data-share-backdrop]`, `[data-share-copy-link]`, `[data-share-copy-message]`,
  `[data-share-destination]`, `[data-share-close-bottom]`, `[data-share-drag]`, `[data-share-slide]`,
  `[data-share-feedback]`, `[data-lightbox-main]`, `[data-lightbox-close]`,
  `[data-zoomed]` — is
  what the harness aims at and scrolls into view. Renaming or moving one is fine; doing it in a
  different commit from the check that reads it is how a regression starts reporting "element not
  found" instead of what actually broke.
- **The detail page's reveal-scroll contracts** — `[data-detail-header]` and `[data-detail-info-col]`
  in `[id].vue` are read by `ProductActions.vue`'s desktop panels (the contact panel and the inline
  share panel share the slot): on open it pins the info column
  `static`, scrolls the panel to sit under the header's live height, and restores on close. They
  carry no type and no harness assert currently; rename one in the same commit as the scroll, or
  the panel silently stops landing under the header (it still opens — which is why nothing catches it).
- **The price surfaces' two data hooks** — `[data-product-price]` (the discounted/original pair on a
  card and the detail page) and `[data-sale-ribbon]` (the red corner ribbon over both photos) — are what
  `verify` reads for the promotion checks, including the ribbon's rect against the photo frame. The
  ribbon clips *itself* in a 112px box, so it does not need the surface to clip it and must not be
  moved inside `ProductGallery` — that component owns its frame's geometry for the zoom maths, and a
  wrapper-level `overflow-hidden` would shave the frame's shadow. What the ribbon does need from the
  `relative mx-auto w-full min-w-0 max-w-md` wrapper in `[id].vue` is the corner itself: drop `min-w-0`
  and the page gains 8px of horizontal overflow at 320px (the grid item's `min-width: auto` becomes the
  filmstrip's min-content), which the overflow sweep catches.
- **The admin entry's one button and the rail's hooks** — the storefront header carries a single
  `Admin tools` button (its English text is what `verify` clicks), and `[data-admin-tabs]` /
  `[data-admin-tab="site-info"|"categories"|"orders"|"stock"]` are what the tab checks aim at, and the stock
  desk's checks aim at its hooks the same way: `[data-stock-form]`, `[data-stock-row]`, `[data-stock-sku]`,
  `[data-stock-input]`, `[data-stock-save]` and `[data-stock-search]`. Renaming the button text or
  a `data-admin-tab` id, or moving a page's route, breaks those checks in the same commit.
- **`[data-switch-caption]`** and **`[data-language-switcher]`** — measurement hooks, not style hooks.
  `[data-switch-caption]` sits on each `max-w-[6.5rem]` switch caption in the two admin editors, because
  the caption is not the switch's CSS next sibling: a fall-through `data-*` on `<USwitch>` lands on the
  inner `data-slot="base"` button, and `Switch.vue` wraps that button in its own `data-slot="container"`
  `div`, so `[data-social-enabled] + span` matches nothing and a Khmer caption too wide for its box would
  be measured as "no captions at all". `verify` reads the captions for `scrollWidth - clientWidth` on the
  Khmer editors, and squeezes one on purpose to prove the read works. `[data-language-switcher]` exists
  because the switcher's own `aria-label` is translated (`Language` → ភាសា), so a test that aims at
  `div[aria-label="Language"]` silently matches nothing once the page is Khmer — which is exactly how a
  locale switch stops happening and a run keeps passing.
- **The locale decode's two hooks, and the node it writes** — `verify` measures the page-wide decode
  through `aside p.uppercase` (the rail eyebrow: a `t()` string, so it changes script in both
  directions) and counts noise across every text node with a TreeWalker. Both reads depend on the
  plugin writing `node.nodeValue` on **text nodes** rather than replacing elements: swap that for
  `el.textContent = …` on the parent and the card markup inside a label is destroyed, and swap the
  observer's `childList` for `characterData` alone and it collects nothing at all — Vue sets text by
  replacing the node, which is a `childList` mutation, and that mistake shipped green once already.
  Renaming `aside p.uppercase` or restructuring the rail breaks the check in the same commit, not in
  the next one. And the **pinned box** is part of this contract: a decoded string may not move the
  page, so `freezeBox`'s box — the tightest ancestor of the words that lays out as a box of its own,
  skipping inline *and* transformed elements (a transformed box's rect is the bounds of the transform,
  and sizing from it deforms the element: the `-rotate-45` sale band became a stub) — is held at its
  final width, plus `white-space: nowrap` when the string sits on one line and a pinned height only
  when it already wraps, from the batch's one read pass until its last node settles — and it CLIPS
  rather than ellipsising: the box takes `data-decode-pin`, and one unlayered `main.css` rule turns that
  into `text-overflow: clip` for the box and everything inside it, because these labels are mostly
  `truncate` and a noise string wider than the word would paint a "…" the word never needed. Never pin height
  on everything: that version stopped the jump and broke the look, because a one-line button holding a
  two-line height grows and its text breaks all over the place. Drop the pin and a phone's sticky
  header jumps ~44px at the end of a decode and a desktop's catalog rows shift mid-noise;
  harness-locked as `the header reaches its final row before the words finish decoding`,
  `the decode holds the shape of the box its words sit in` (counts the pins, so a fixture with nothing
  to cross cannot pass by idleness), `a pinned box clips instead of trailing an ellipsis` and
  `the rotated sale ribbon is never sized from its own
  transformed rect`. And **never call `useI18n()` from a plugin**: it throws during app initialisation
  (NUXT_E1005), which is not a warning you can miss — the whole client fails to boot and every
  storefront check goes red at once.
- **The editor's two entry points** — `index.vue` types its `adminEditor` ref against
  `openAddEditor()` / `openEditEditor(product)` from the feature's `defineExpose`. Nothing in CI
  proves the names still match; the IDE language server and the harness do.
- **`useAdminProductEditor`'s ten exposed names** (`editorForm`, `editorOpen`, `deleteTarget`,
  `isSaving`, `actionError`, `openAddEditor`, `openEditEditor`, `handleImageSelection`,
  `saveProduct`, `confirmDelete`) — kept identical to the moved markup for exactly this reason.
- **`CategoryMobile` teleports itself to `body`** — DOM order ≠ visual order.

## Auto-import trap

`app/features/**` is invisible to Nuxt's auto-import until `nuxt.config.ts` registers it:
composables in `imports.dirs`, components in `components.dirs`. **Naming `components.dirs`
replaces Nuxt's own scan**, so `~/components` must stay in that list or every shared component
silently stops resolving — the build stays green and the page renders without them. Adding a second
feature means adding its two dirs and keeping `~/components`.

## Never do these as a side quest

- Add `as any` to a Supabase client or query — it re-hides the two silent typing failures
  documented in [../../AGENTS.md](../../AGENTS.md).
- Introduce a service-role client to fix a permission error. Authorisation is RLS in Postgres; the
  browser holds only the anon key, and the fix belongs in a new migration.
- Treat `useAdminProductEditor`'s `canMutate` argument as a security boundary. It is a UI guard;
  RLS is the boundary.
- Move browsing state, a catalog read, or a row mapping into a component in `app/components/`.
- Extract a shared abstraction from the two category drag engines, or from the indicator geometry
  scaffolding (observers, `fonts.ready`, watches): they observe different elements and write
  different geometry — only the *shape of the code* looks alike.
- Consolidate `SearchDock`'s duplicate of the scroll-direction rule (`60` / `6`) into
  `useScrollReveal`. Its scroll pass is interleaved with the morph/collapse logic in a hands-off
  component; migrating it is a separate change with its own measurement budget.
- Edit the duplicated `tel:` digit rule (`phone.replace(/[^\d+]/g, '')`) in `SiteInfoContact.vue`
  as part of an unrelated pass. It is duplicated on purpose; one owner under `app/utils/` is a
  dedicated site-info change.
- Trust `.qoder/repowiki/`. It is gitignored, generated, and has overwritten hand edits three
  times; several of its pages document realtime, tests, caching and monitoring that are **not**
  implemented.

## Tuned numbers

The exact numbers worth not breaking — morph durations and easings, hysteresis thresholds,
magnification profile, indicator curve, emblem heights and insets, the `44px` single-line control
height, the two dark surface rungs (`zinc-950` vs. Nuxt UI's `--ui-bg` `zinc-900`) — are tabulated
in [../../ARCHITECTURE.md](../../ARCHITECTURE.md) → **Interaction invariants** and **Control
language**. Changing one is a design decision, not a refactor.
