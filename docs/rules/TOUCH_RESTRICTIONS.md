# Touch restrictions

Areas that work, are invisible to the compiler, and have no `build`-time protection. Do not edit
them *without a specific reason* — and if there is a reason, measure the result afterwards
(see [TESTING_SPECS.md](TESTING_SPECS.md)).

Design rationale for everything below lives in
[../../ARCHITECTURE.md](../../ARCHITECTURE.md); this file is the "don't" list, not the "why" list.

## Hands off

| Area | Why it is fragile |
|---|---|
| `app/components/SearchDock.vue` — morph / measure logic | Two cooperating engines: the overlay FLIP (matrix inversion, settle-token arbitration, per-axis radius compensation) and the scroll-collapse fixed-box rAF flight that re-aims from the live box on a mid-flight reversal. Both were tuned by measurement; neither is readable from the diff. |
| `app/components/category/CategoryDesktop.vue` + `CategoryMobile.vue` — drag + indicator | Tuned input models that are *deliberately* different (mouse Y-axis with `grabOffsetY` vs. touch X-axis with axis-lock detection and `scrollLeft` compensation). Merging them is a regression, not a cleanup. |
| `app/components/ProductGallery.vue` — lightbox zoom | The magnification is anchored on the point that was clicked, and the pan bound is derived from the *painted* picture (`object-contain` letterboxes it inside the element box), not from the element box. Both were measured; neither reads from the diff. The frame is the `<img>`'s **parent** — wrap the photo in another element and the focal maths silently starts measuring the wrong box. The same overlay also carries the swipe-to-close while contained (axis-locked against the swap's horizontal axis, and the `dragged` flag is what keeps a swipe's trailing click from zooming); its `touch-action: none` now applies in both views |
| `app/features/product/components/ProductShareSheet.vue` — placement, teleport and swipe handle | The desktop popover measures the panel once, on the frame it enters, and stays `visibility: hidden` until it has a position (an unpositioned fixed panel paints in the viewport's top-left corner for a frame). The panel teleports to `body` because the mobile sticky bar's `backdrop-blur` would otherwise become its containing block and the "bottom sheet" would sit inside the bar. The phone handle drags with pointer capture and hands the exit to a WAAPI flick whose `fill: 'forwards'` deliberately outranks the CSS leave classes — reordering the reset/emit/close sequence breaks where the sheet visually exits from |
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
