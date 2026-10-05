# Testing & verification specs

What counts as evidence in this repo, and how to get it. Read this before claiming a change
works, and before extending `scripts/verify-ui.mjs`.

## The gate reality

| Command | What it actually proves |
|---|---|
| `bun install` | Deps resolve against the committed `bun.lock`. |
| `bun run build` (`nuxt build`) | It compiled. It does not start the app, does not type-check, and says nothing about the tuned interactions or the admin write path. CI runs this **and** `bun run verify` on every push. |
| `bun run verify` (`node scripts/verify-ui.mjs`) | The tuned interactions, the conversion flow and the whole admin flow still behave, measured in a real browser against a stubbed backend. A CI gate since 2026-09-28: `.github/workflows/ci.yml` runs it after Build with `CHROME_PATH=/usr/bin/google-chrome` and Node 24 (the harness needs global `WebSocket`; Bun's bundled Node is older). |
| `./node_modules/.bin/tsc -p .nuxt/tsconfig.app.json --noEmit` | `.ts` files only. `tsc` cannot parse `.vue`. |
| `bun run typecheck` (`nuxt typecheck` → vue-tsc) | Template bindings too: a mistyped prop or missing variable in a `.vue` template fails on it (verified 2026-09-30 by mistyping `<StockStatus :quantity>` — caught as `ProductCard.vue(60,8)`). Not a CI gate (it adds wall time). Exits 0 since 2026-10-03 — the script-side errors in `app.config.ts`, `nuxt.config.ts` and `[id].vue`'s `useHead` meta were root-caused and fixed (behavior-preserving; `verify` green after) — so treat every error it reports as real. |

There is **no test suite**. Template bindings ARE mechanically checked by `bun run typecheck`
(vue-tsc, added 2026-09-30 — the 2026-09-28 note that no route existed is obsolete: `nuxt
typecheck` works once `vue-tsc` is a devDependency). CI runs build + lint + verify on every
push; `bun run lint`
fails only on new hard errors (the pre-existing debt — 17 `any` casts, custom-class warnings — is
documented in `eslint.config.mjs`; the `no-explicit-any` rule being off does **not** relax
AGENTS.md's Supabase `as any` prohibition, which stays a review rule). Run `bun run verify`
locally while iterating so you are not waiting on a push.

## `bun run verify` — the CDP harness

`scripts/verify-ui.mjs` serves `.output`, drives headless Chrome over raw CDP, and asserts
geometry, animation state and the exact `(method, path, query, body)` tuple of every Supabase
call. It exists so you do not rebuild a test harness.

It answers `/rest/v1`, `/auth/v1` and `/storage/v1` **inside the browser** from
`scripts/fixtures.json` — synthetic rows shaped exactly like the `PRODUCT_SELECT` /
`CATEGORY_SELECT` embeds and the `SITE_INFO_SELECT` row. **No real project is contacted and
nothing can be written.** If a select string changes shape, the harness fails loudly.

Covered (this list is the shape of the run, not its check count — the run prints
`N/M checks passed` itself, and hand-kept totals in docs drift out of date):

- **Tuned interactions**: category drag, indicator snap and its 260ms curve, the mobile bar's
  edge auto-scroll (a long list overflows the phone-width bar and dragging into the right edge must
  move `scrollLeft` — the in-view drag-select check never reaches an edge so it cannot cover this),
  the magnification
  profile, scroll reveal, the spotlight morph, the scroll-collapse field↔launcher flight in both
  directions including a mid-flight reversal, and never more than one interactive search control.
- **Masthead**: its two levels and the emblem height step at five widths; contact line above the
  brand row; phone and location on their own margins; socials stacked under the utility line;
  icon-only socials; no collision; no horizontal overflow.
- **Detail page**: photo carousel (bounded strip window, one-slot advance on adjacent selection,
  wrapping and hover-gated arrows), and — reached by **clicking a card from the storefront**, not a
  direct URL, because every other gallery check mounts the page in isolation and an isolated mount
  never exercises the SPA enter path — the **first main photo is asserted on-frame** (its rect inside
  the frame, `transform: none`): it used to start at `x:'100%'` and lean on its enter animation to
  return, so a skipped/interrupted frame left it clipped to a sliver until reload. The fix is
  `:initial="false"`; note the interrupted-frame path itself is not forceable in CI, so this locks the
  settled invariant rather than reproducing the glitch. The detail page also carries the shared-state lightbox and its **click-to-zoom** (the enlarged
  photo is the control: the clicked point stays anchored, two different points give two different
  focal points, the pan stops at the photo's own bound, and the zoom resets on photo change and on
  close — measured with a mouse and with touch), the stock band on every card read
  from `data-stock-state` (band, label and colour), header search.
- **Product conversion flow**: CTA wording and prepared message per stock band; the channel list
  against what Site Info actually configures (including the edit the admin flow just saved); the
  clipboard in all three states so a refused write can never report success; the **custom Share
  Sheet** — desktop popover and mobile bottom sheet from one component, its product context, its
  destinations resolved from the shop's *visible* links rather than its contactable ones, Copy link
  and Copy message, Escape / backdrop / keyboard dismissal, its geometry at 320 / 390 / 640, and the
  assertion that `navigator.share()` is never reached for; the Contact panel's enter and leave
  transitions, frame-sampled with and without reduced motion; the sticky bar's geometry, safe area,
  breakpoint, surface and stacking under the lightbox; Escape handing focus back; no horizontal
  overflow at seven widths in both colour schemes; canonical and Open Graph metadata.
- **Accessibility floors**: every element whose own text contains a Khmer codepoint must compute **no
  letter-spacing at all** (`|letterSpacing / font-size| <= 0.005`). Wide Latin tracking pulls a cluster
  apart, `tracking-tight` crowds it together, and even the 0.08em hairline these labels once carried
  lands between the codepoints of a cluster — which is what painted បណ្តុំផលិតផល as
  "ប ណ្តុំ ផ លិ ត ផ ល". Swept across the Khmer home and detail page *and* across the English
  routes with a Khmer-only product (the case a `locale === 'km'` guard cannot see, because
  `pickTranslation` falls back to whichever translation row exists), and across both admin editors.
  Each sweep reports how many Khmer runs it judged, an English control on the same card elements must
  read wide (2px), and the home check additionally crowds one Khmer run inline to prove the bound can
  fire — "nothing is spaced" and "the sweep cannot see spacing" are the same green line otherwise. A second sweep asks the font for its
  own ink box (`measureText().fontBoundingBox*`) wherever a Khmer run sits inside an `overflow: hidden`
  element, which is how the Sale ribbon's 14px band is known to hold 12px of Khmer ink rather than
  assumed to; and `prefers-reduced-transparency` leaves the sticky bar and detail header with
  `backdropFilter: 'none'` and a fully opaque `backgroundColor`.
- **A static scan before the browser starts**: the `km` block of `i18n.config.ts` is read from disk and
  must contain nothing outside Khmer script, its own digits, ASCII and the few typographic marks the
  file uses deliberately. Thai consonants once sat inside a Khmer sentence and every browser check
  stayed green — the run still read as Khmer, so only a source scan can catch that class.
- **Promotions** (`app/utils/product-pricing.ts`, one rule with five call sites): a live window
  paints the discounted price with the original crossed out on the detail page, the same pair on the
  card, and the discounted number inside the prepared contact message; a closed window and a spent
  unit cap each paint the original with nothing crossed out. On the admin side the switch is what
  reveals the five fields, and the product PATCH is read for their values. The red corner ribbon is
  measured, not looked at: exactly one across the six cards, its clip box anchored at the photo frame's
  corner (`inX`/`inY` under 2 — the card's frame has a 1px border and the gallery's does not), rotated
  -45° with its centre on the corner diagonal, its bounding box far taller than its layout height (a
  horizontal band would report 22px against the tilted one's 106px), its ends overhanging the box so the
  cut is real, never overlapping the gallery's prev arrow, and `pointer-events: none` with a hit-test at
  its centre landing on what sits under it. A card that grew a second
  `p.tabular-nums` would break the sort check's selector, so the pair count is asserted alongside.
- **Categories**: on the storefront side, categories appended to the stub's own `window.__CATEGORIES`
  before the app boots must join the dock, draw their marks (`getBBox`, not DOM presence) and filter
  the grid to their own empty state — the check that proves the dock is built from the rows and not a
  hardcoded list, and it appends **two** unknown-slug rows on purpose: they share the one fallback
  glyph, so a list keyed on the glyph instead of the row collapses them into one button. Eighteen
  categories then have to stay reachable — the nav must be a scroll box that can bring the last row
  into the viewport once the rail is stuck, with no horizontal overflow at 320 / 390 / 640. On the
  admin side, the editor seeds every stored row (both names, the slug, the visibility switch), one
  save issues a PATCH per stored row plus one INSERT for the new one, the translations POST carries
  both locales, `sort_order` comes out as the row's position in the list, the trash button is exactly
  one `DELETE …?id=eq.…` that also removes the row, erasing a stored Khmer name issues the matching
  `DELETE …&locale=eq.km`, and a duplicate slug is refused with **zero** writes and its own message —
  asserting only the empty write list let an off-by-one row index trip the *other* guard and still pass.
- **Tab icon**: the two `media="(prefers-color-scheme: …)"` logo `<link rel="icon">` tags are asserted
  present in the head — the theme swap is native config with no JS, so a typo in an `href` or `media`
  would render the wrong icon silently.
- **The rail's scroll box and the admin rail**: with eighteen categories the desktop nav must scroll the
  last row into view once the sticky rail is stuck, must rest on **whole rows** (7 crossing the window,
  7 fully inside — a row half in is a half-drawn icon), and the selection pill must stay fully inside the
  clip box **while held and dragged** (it scales ~25px past its row — this is what caught the first
  version of the scroll box chopping the pill's rounded ends). On the admin side, one header button opens
  the tools, each `[data-admin-tab]` moves to its own page, only the tab whose route is on screen carries
  `aria-current="page"`, and on **both** tool pages the rail is measured as a sidebar: the two entries
  stacked vertically, entirely to the left of the form.
- **Admin flow**: login, add, image upload, save/update, cancel, delete, the site-info editor
  (seed, field edits, link add/toggle/reorder/remove, the singleton upsert body, and the public
  header reflecting it), logout.

### Flags

```bash
bun install
bun run build
bun run lint                                  # eslint app; CI fails only on new errors
bun run verify                                # all checks against the existing .output
bun run verify --only=guest                   # or --only=admin (fewer checks than the full run)
bun run verify --only=guest & bun run verify --only=admin & wait   # both at once: independent, own scratch dir each
node scripts/verify-ui.mjs --build            # build first, in one step
node scripts/verify-ui.mjs --keep             # leave Chrome + profile running to debug
node scripts/verify-ui.mjs --url http://127.0.0.1:PORT/   # point at an already-served build
CHROME_PATH=/path/to/chrome bun run verify    # if no Chrome binary is found (CI pins it to /usr/bin/google-chrome)
```

Build first; use `--only=guest|admin` while iterating.

### What the loop costs

Measured 2026-10-03, M-series dev machine, warm, against one commit: `lint` **2 s** ·
`typecheck` **4 s** · `build` **7 s** · `verify` **3 m 37 s**. So the three fast gates are free
enough to run after every edit and `verify` is the gate you run once before claiming anything.

Within `verify`, only ~52 s is literal `sleep()` and the process sits at 6 % CPU — it is
wait-bound on sequential CDP round-trips, not computing. That is why the two `--only` slices
run concurrently (`.nuxt/verify/<slice>` keeps each one's Chrome profile, log and upload probe
apart, and a shared dir meant whichever slice exited first `rmSync`ed the profile the other was
still using): **3 m 06 s** total wall against **3 m 37 s** for the full run. Take the ~30 s, but
do not expect half — the guest slice alone is 86 % of the run and `--only` cannot subdivide it,
which is the remaining lever if this ever needs more than that.

### Proving a refactor is behaviour-preserving

Run the harness **twice** and diff the `PASS`/`FAIL` lines *and* the recorded request sequence:

```bash
git worktree add .verify-base <nearest backup/* tag>
cd .verify-base && bun install && bun run build
node scripts/verify-ui.mjs --url <base-build-url> > before.txt
node scripts/verify-ui.mjs > after.txt
diff before.txt after.txt
```

Phases 3–5 each found real regressions *and* real probe bugs this way. **A check that fails on the
unmodified build is a broken check, not a regression** — fix the check before believing it.

## Traps when extending the harness

All ten have already been paid for once:

1. **The stub exists only in the browser.** Nuxt's SSR fetches run on the server, un-stubbed, so a
   hard reload into a fake session yields a genuine hydration mismatch and unverifiable reads.
   Log in, then stay in the SPA (`navigateTo`, not `Page.navigate`).
2. **Assert async state by polling, never a fixed sleep.** `isAdminMode` resolves after two
   round-trips, and a scheduled tab activation costs seconds, not frames.
3. **`innerText` cannot see `hidden sm:inline-flex` affordances**, and a modal's footer button sits
   below its own scroll fold: use `textContent` for visibility-independent assertions and
   `scrollIntoView()` before reading a click target's rect. Touch points sent below the viewport
   are silently dropped, so a translated-off-screen dock must be brought back before it is aimed
   at.
4. **CDP responses all wrap their payload in `result`**, and `Runtime.evaluate` with
   `returnByValue: true` only serialises JSON-safe values — a `Set` arrives as `{}`, so return
   `Array.from(...)`.
5. **A `touchStart` + `touchEnd` pair is not guaranteed a `click`, and the failure looks exactly like
   an app that ignored the tap.** After a touch *pan* on the lightbox zoom control, `ubuntu-latest`
   delivered `pointerdown` + `pointerup` with no click on two runs in a row and delivered the click on
   the third, at the same point, with the same timings. Nothing in the app can act on an event that
   never arrived, so a touch-only assertion is intermittently red for a reason the code does not own.
   Hand the gesture to a logged probe: record the events the control receives, and when the platform
   offered pointer events but no click, press and release the same point as a mouse pair — then print
   which path proved the rule (`how: touch` vs `touch-then-mouse`) so the fallback stays visible.
6. **`nav()` takes an absolute URL, not a path.** It hands its argument straight to `Page.navigate`,
   so `nav('/')` aborts the whole run with `Cannot navigate to invalid URL` — long before any check
   reports it. Build the URL the way the existing calls do (`new URL('/', appUrl).href`,
   `appUrl + 'admin/login'`).
7. **A Khmer visit stays Khmer on the root path.** `detectBrowserLanguage.redirectOn: 'root'` means
   the locale cookie set by a `/km/` navigation redirects an unprefixed `/` straight back to `/km/`.
   Any control that must read the *English* branch of a locale-conditional style has to run before the
   Khmer navigation, not after it. (Unprefixed deep paths are fine — that is why the run returns to
   `/products/…` and gets English back.)
8. **The printed total is not a number to diff.** `N/M checks passed` moves between runs of one
   unchanged commit, because the `DIAG …` lines are counted as checks and how many appear depends on
   which widths and decode branches fired (observed 430 / 433 / 435, with the real `PASS`/`FAIL` name
   set identical and zero failures each time). When proving a refactor preserved behaviour, diff the
   check **names** with the `  ::  ` detail stripped, not the totals — and never compare a two-slice
   `--only` sum against a full run: `no exceptions or console errors …` and the Khmer source scan are
   per-run tail checks, so running both slices reports them twice.
9. **A rect read mid-smooth-scroll is stale, and the press lands on whatever drifts under it.**
   `html { scroll-behavior: smooth }` keeps a `scrollIntoView()` + fixed-sleep + read sequence in
   flight: paid for twice in opposite runs on 2026-10-04, as a press probe reading `scale: none` and
   as a footer click that silently no-oped while the catalog grid was still landing (content growing
   under the aim moves the target too). Aim-only scrolls pass `behavior: 'instant'`, the aim is
   accepted only once `document.elementFromPoint()` at the point returns the element or a descendant,
   and the post-state is polled (the 0.97 press scale arrives through a 150 ms transition). Wait for
   async content that changes page height before aiming below it, and assert each departure in a walk
   — an unasserted miss cascades into failures under names that blame the wrong step. For a
   navigation link, prefer a programmatic `el.click()`: aiming a real click at the masthead of a
   freshly-arrived page starts a smooth scroll under the aim's own feet (observed 2026-10-04 as a
   link click that never navigated — the walk stayed on the arrival page, `accountHop: false`),
   while a programmatic click is position-independent and the router still handles it.
10. **The machine's power state is part of the rig.** macOS auto-enables Low Power Mode under ~20%
   battery, and the throttled renderer doubles the per-frame distances every glide and settle check
   measures: on 2026-10-04 the share-collapse check's max step flipped from 78 to 135 — identically,
   across four runs — until the machine was back on AC, while settle reads caught panels mid-enter
   and aimed clicks landed early. Before debugging a cluster of frame-step or settle-timing failures,
   check `pmset -g ps`; those checks are measuring the machine as much as the code, and the frame-step
   thresholds assume a ~60 Hz cadence.
11. **Never build while the dev server is running — and never overlap a build with a verify.**
   `bun run build` and `nuxt dev` both rewrite `.nuxt`, and a build racing a live dev server can
   hand the harness a torn `.output`: on 2026-10-05 a guest slice run that way failed 29 checks
   from the signup arm down (`auth:[]` — zero stubbed traffic, the stubbed auth flow never
   reached the page), while a clean rebuild and rerun was 430/430 twice. The failure reads like a
   dozen unrelated app regressions. Stop the dev server (or at least the build) first; `verify`
   itself is safe beside a running dev server as long as no build overlaps it.

## Measure, don't eyeball

For anything visual or interactive, assert numbers at
**1440 / 1280 / 1024 / 834 / 640 / 390** (the conversion page and the no-overflow checks go to
seven widths, and both colour schemes):

- **Geometry**: control heights (single-line controls are 44px), alignment, insets, no horizontal
  overflow, stacking order via `elementFromPoint`.
- **Animation state**: running `getAnimations()`, snap delta, settle size, mid-flight values.
  A screenshot cannot prove a 44px control or a snapped bubble.
- **Painted area, not DOM presence**: SVG brand marks are asserted with `getBBox()` covering at
  least half the 24-unit viewBox — one truncated `C` argument rendered a glyph as a 1.4px speck
  while it was still a single filled `path` in a 16px box. Existence proves nothing.
- **Both colour schemes** for anything with an icon or a surface.
- **Reduced motion / interrupted flights**: sample *mid-flight* and at the cancellation frame,
  not just at rest — an animation can be numerically running and still read as instant or stuck.

Note that Tailwind v4 `translate` / `scale` utilities are invisible to
`getComputedStyle().transform` when they are composed in ways the harness does not expect; read
the matrix, don't assume the utility name. v4 `rotate-45` is worse than invisible: it writes the
standalone `rotate` property, so the computed `transform` stays a plain identity matrix and a ribbon
that looks tilted reads as `matrix(1, 0, 0, 1, 0, 0)`. Ask `getComputedStyle(el).rotate` for the angle,
or measure the axis-aligned bounding box against `offsetHeight` — the only evidence that survives
however the utility was written.

## Environment

- **Fonts are the platform's own, and that is a measurement fact, not a detail.** Latin text is set in
  the native system UI stack (`app/assets/css/main.css`); the only bundled face is Noto Sans Khmer,
  imported from the `@fontsource/noto-sans-khmer` devDependency, because Windows and the runner ship no
  Khmer font and a missing cluster is broken rendering rather than a missing glyph. `@nuxt/fonts`'
  network providers stay disabled in `nuxt.config.ts`, so there is no `fonts.googleapis.com` step to
  fail. The consequence: text width differs between this machine and the runner by design, so a new
  assertion must be about overflow, control height, inset or a bound — never about where a particular
  word ends. When a font stack changes, re-run the responsive sweep (320 / 390 / 640 and up): the
  narrow-screen guards are the ones that move.
  The rule is not theoretical: the masthead used to require the phone to stop left of the centre line
  and the location to start right of it, and that went red on `ubuntu-latest` for nothing worse than a
  wider UI font — the pair was still pinned to both margins with nothing ellipsised. A text line is now
  measured as pinning plus clipping (`scrollWidth > clientWidth` on the label), and the clip probe has
  a control that squeezes a span on purpose, because "never fires" and "nothing is wrong" look
  identical in a passing run. Note what was traded: `fix(ci): self-host the fonts so the verify gate
  measures the same text everywhere` bought runner parity by bundling a Latin face, and Phase 1.3 gave
  that back on purpose. Khmer stays bundled, so the locale with no system fallback is still the one
  measured identically on every runner.
- If Chrome fails to start with `Operation not permitted`, the command is running inside a
  restrictive sandbox — run it from a normal terminal. This is the harness working as designed, not
  a broken browser or a broken check: an agent's shell is sandboxed the same way (Mach/crashpad calls
  denied, writes outside the workspace denied), so the response is to re-run with the sandbox lifted,
  never to "fix" `chromePath()`, the flags or a check because of it.
- The harness has **no dependencies** (raw CDP over WebSocket; Node 24 for global `WebSocket`) —
  keep it that way, and do not add a test framework to "fix" the missing CI gate without a plan.
- Prefer the local dev server and this harness for validation. Use Browser Agent against localhost
  for visual checks; do not use cloud-hosted environments for routine UI verification.

## Before you say "done"

`bun run build` green, `bun run verify` green (the specific `--only` group you touched, then the
full run), `tsc` re-run if you edited `.ts`, IDE diagnostics re-read if you edited a
`<template>`, and — for anything that alters the design — [../../ARCHITECTURE.md](../../ARCHITECTURE.md)
updated in the same change.
