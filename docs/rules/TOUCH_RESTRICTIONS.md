# Touch restrictions

Areas that work, are invisible to the compiler, and have no `build`-time protection. Do not edit
them *without a specific reason* — and if there is a reason, measure the result afterwards
(see [TESTING_SPECS.md](TESTING_SPECS.md)).

Design rationale for everything below lives in
[../../ARCHITECTURE.md](../../ARCHITECTURE.md); this file is the "don't" list, not the "why" list.

## Hands off

| Area | Why it is fragile |
|---|---|
| `app/components/SearchDock.vue` — morph / measure logic | Two cooperating engines: the overlay FLIP (matrix inversion, per-axis radius compensation) and the scroll-collapse fixed-box rAF flight that re-aims from the live box on a mid-flight reversal. Both were tuned by measurement; neither is readable from the diff. Phase E moved ONLY the overlay-FLIP playback to Motion (`app/utils/motion.ts` `spotlight.frame`, settle via `.finished`) — the matrix-inversion measurement stays. Phase E.2 then touched the flight engine on purpose: `flyStep` bends the ease-out-cubic lerp with a `sin(t·π)` parabolic bow (**ARC_BOW_PX=80**) that is **0 at launch and at landing**, so the endpoints stay pixel-exact and the mid-flight reversal re-aim still reads the live box; it also writes a decorative `flyTransform` (3D `scale`+aerodynamic `rotate`) and floating `flyShadow` on top of the drift-free `left/top` box, reset by `endFlight`/`endFieldReturn`; and `endFlight(true)` plays an `arrival` catch recoil (Motion scale spring 1→1.28→0.92→1.05→1, suppressed under reduced motion, with `suppressLauncherMotion` held so Motion is the launcher transform's only writer for it). `updateFieldMorph` and the in-place width scrub remain untouched. Motion writes the panel/flyer inline transform; the reactive `:style` transform refs stay pinned during the spring so Vue never clobbers it. |
| `app/components/category/CategoryDesktop.vue` + `CategoryMobile.vue` — drag + indicator | Tuned input models that are *deliberately* different (mouse Y-axis with `grabOffsetY` vs. touch X-axis with axis-lock detection and `scrollLeft` compensation). Merging them is a regression, not a cleanup. **Which items the docks show is data, not geometry** —
`useCategoryItems` builds the list from the shop's own `categories` rows, and both components iterate it
and measure whatever arrives; changing the list's length therefore does not license touching either
input model. The mobile bar carries `touch-pan-y`, so the browser will not pan it horizontally; the
touch engine pans it itself by writing `scrollLeft` when a drag enters a horizontal edge
(`EDGE_ZONE 40` / `MAX_EDGE_STEP 34`) — that is what makes an off-screen category reachable, and it
is now harness-locked (`dragging a mobile category to the right edge pans the overflowing bar`).
Phase F added tactile motion without touching either engine: buttons are `<motion.button :while-press="press">` (scale 0.97, spring 400/30) gated OFF while dragging (`isDragging` / `isTouchDragging`) and under reduced motion so a grabbed item never stays squished; the active icon plays a one-shot `iconPop` (`animate()` scale [1,1.16,1] on the icon's wrapper div, not the `<svg>`, so it scales from centre); the mobile bar's reveal is now a `<motion.div>` spring on `y` (`dock`) instead of `transition-transform` translate classes, and the bar is frosted glass (`backdrop-blur-xl backdrop-saturate-150` + inset top-specular / soft drop shadow). **The indicator's CSS `transition` string (260ms `cubic-bezier(0.16,1,0.3,1)`) is harness-locked — do not move it onto Motion or retime it.** The desktop fish-eye eases back to 1.0 on pointer-leave through the inner `180ms` transform transition — that IS the damped exit; do not add a rAF damp. **One writer per pill: `updateMobileIndicator` returns early while `isTouchDragging` holds.** The edge auto-scroll writes `scrollLeft`, every `scrollLeft` change fires the `scroll` listener that re-aims the indicator at the *active* item, and the drag is writing the finger's position in the same breath — before the guard the pill alternated between them at touch frequency once a drag reached the last category (frame-sampled: a 264px retreat in one frame on a transform still scaled 1.6 by the drag). Re-aiming on release is `handleTouchEnd`'s and `watch(activeIndex)`'s job, not those frames'. Harness-locked (`the dragged pill does not snap back while the bar pans`). |
| `app/pages/index.vue` — the nav's scroll box | The category list is the shop's to grow, so the desktop rail bounds itself and scrolls. The cap is counted **in rows, not viewport fractions**: a row is 57px and the gap 10px, so 7 whole rows are 459px, plus the nav's 4+4 and the clip's 8+8 = `lg:max-h-[483px]`. `68vh` was the wrong unit — on a shorter window it landed mid-row and drew half an icon at the bottom edge, which `verify` now asserts against. `overflow-y: auto` also clips at the **padding** edge, and the selection pill overhangs its row by ~25px sideways and ~4px while held or dragged (it scales) — the `-mx-7 px-7 -my-2 py-2` is that measured room. Reduce it and the pill's rounded ends get chopped off; put the overflow on the `<aside>` instead and the collapsed search launcher (`SearchDock`, anchored to that element's `top-full`) moves with it. |
| `app/components/ProductGallery.vue` — lightbox zoom | The inline main photo's `<AnimatePresence>` is `:initial="false"` — the FIRST photo renders at rest, it does not slide in. That slide was the fragile path: the photo started at `initial={x:'100%'}` and depended on its enter animation to return, so whenever frames weren't produced (SPA navigation into the page, an interrupted/backgrounded tab) it stayed a full width to the right, clipped by the frame's `overflow-hidden` — a sliver of the photo until a reload (SSR renders at rest). Selection changes still animate (later keyed children are unaffected by `initial`). Do not reintroduce an `initial` transform on the first photo that relies on an animation to undo it. | The lightbox zoom is separate: the magnification is anchored on the point that was clicked, and the pan bound is derived from the *painted* picture (`object-contain` letterboxes it inside the element box), not from the element box. Both were measured; neither reads from the diff. The frame is the `<img>`'s **parent** — wrap the photo in another element and the focal maths silently starts measuring the wrong box. The same overlay also carries the swipe-to-close while contained (axis-locked against the swap's horizontal axis, and the `dragged` flag is what keeps a swipe's trailing click from zooming); its `touch-action: none` now applies in both views. Phase D added Motion to the *presentation* layer only (dialog `<AnimatePresence>` fade, filmstrip slide, inline-main crossfade) — Motion must NOT write the `[data-zoomed]` / `[data-lightbox-main]` transform or wrap it in a transformed ancestor; the zoom engine owns that element's transform outright, and a second writer jitters the focal tracking |
| `app/features/product/components/ProductShareSheet.vue` — placement, teleport and swipe handle | The desktop popover measures the panel once, on the frame it enters, and stays `visibility: hidden` until it has a position (an unpositioned fixed panel paints in the viewport's top-left corner for a frame). The panel teleports to `body` because the mobile sticky bar's `backdrop-blur` would otherwise become its containing block and the "bottom sheet" would sit inside the bar. The sheet's `transform` is now a single Motion `y` (enter/exit, finger-follow, snap-back and dismiss all own it — Phase C.2). Drag starts only from the grabber/header handle via `useDragControls` (`dragListener` off, `dragConstraints {0,0}` + `dragElastic {top:0.15,bottom:1}` — the 0.15 top gives a light logarithmic resistance when pulled upward, Phase G); reordering the `@drag-end` dismiss-vs-snap gate or the `close()` emit breaks where the sheet visually exits from. Phase G made the controls tactile: `data-share-close`, `data-share-copy-link`, `data-share-copy-message`, the `data-share-destination` links and `data-share-close-bottom` are `<motion.button>`/`<motion.a>` with `press` `:while-press` (reduced-motion gated), and the two copy buttons fire a one-shot `copyPop` on `click` — after the press releases, so the same transform is never driven by two writers at once. The sheet's resting `transform` must stay `none`/identity (harness-checked) so a slow pull snaps back cleanly with no stray inline style |
| `app/assets/css/main.css` — select-morph keyframes | `0.24` is trigger-height ÷ panel-height, so the panel grows out of the control. The exit uses an accelerating curve on purpose: a decelerating collapse leaves an opaque remnant under the pill, which reads as a hang. |
| `app/app.config.ts` | Single owner of the pill control language. It emits **3 pre-existing `tsc` errors** (its `base` key belongs under `slots.base` in Nuxt UI 4) — known, unfixed; do not "fix" them as a drive-by. If you touch the file, re-measure the pill styling. |
| `supabase/migrations/**` | Schema + RLS *are* the security model. Migrations are never edited after they are pushed — write a new migration instead. |
| The `backup/*` tags and `.verify-base` worktrees | They are the baseline that proves a refactor is behaviour-preserving. |

## String contracts with no type checking

`tsc` cannot read `.vue`, so these bindings fail at runtime (or silently) only:

- **`[data-search-anchor]`** — `SearchDock` measures this element to decide when to collapse, and
  the scroll-collapse morph animates *this element's own* `width` in place. It also supplies both
  endpoints of the launcher flight (last on-screen rect = collapse origin; live rect = restore
  landing). Rename or move the element **in the same commit** as the change, never across two.
- **The product feature's `data-*` surface** — `[data-share-cta]`, `[data-share-sheet]`,
  `[data-share-backdrop]`, `[data-share-copy-link]`, `[data-share-copy-message]`,
  `[data-share-destination]`, `[data-share-close-bottom]`, `[data-share-drag]`,
  `[data-share-feedback]`, `[data-lightbox-main]`, `[data-lightbox-close]`,
  `[data-zoomed]` — is
  what the harness aims at and scrolls into view. Renaming or moving one is fine; doing it in a
  different commit from the check that reads it is how a regression starts reporting "element not
  found" instead of what actually broke.
- **The detail page's reveal-scroll contracts** — `[data-detail-header]` and `[data-detail-info-col]`
  in `[id].vue` are read by `ProductActions.vue`'s desktop CTA: on open it pins the info column
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
  `[data-admin-tab="site-info"|"categories"]` are what the tab checks aim at. Renaming the button text or
  a `data-admin-tab` id, or moving a page's route, breaks those checks in the same commit.
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
