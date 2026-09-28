# Testing & verification specs

What counts as evidence in this repo, and how to get it. Read this before claiming a change
works, and before extending `scripts/verify-ui.mjs`.

## The gate reality

| Command | What it actually proves |
|---|---|
| `bun install` | Deps resolve against the committed `bun.lock`. |
| `bun run build` (`nuxt build`) | It compiled. It does not start the app, does not type-check, and says nothing about the tuned interactions or the admin write path. CI runs this **and** `bun run verify` on every push. |
| `bun run verify` (`node scripts/verify-ui.mjs`) | The tuned interactions, the conversion flow and the whole admin flow still behave, measured in a real browser against a stubbed backend. A CI gate since 2026-09-28: `.github/workflows/ci.yml` runs it after Build with `CHROME_PATH=/usr/bin/google-chrome` and Node 24 (the harness needs global `WebSocket`; Bun's bundled Node is older). |
| `./node_modules/.bin/tsc -p .nuxt/tsconfig.app.json --noEmit` | `.ts` files only. `tsc` cannot parse `.vue`, so **template bindings are unchecked** — re-read the IDE language server's diagnostics after editing a `<template>`. |

There is **no test suite and no template typecheck — in CI or anywhere else** (verified
2026-09-28: Nuxt 4.5.2 ships no `typecheck` route and `vue-tsc` is not a dependency — checking
templates would mean adding it). CI runs build + lint + verify on every push; `bun run lint`
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

- **Tuned interactions**: category drag, indicator snap and its 260ms curve, the magnification
  profile, scroll reveal, the spotlight morph, the scroll-collapse field↔launcher flight in both
  directions including a mid-flight reversal, and never more than one interactive search control.
- **Masthead**: its two levels and the emblem height step at five widths; contact line above the
  brand row; phone and location on their own margins; socials stacked under the utility line;
  icon-only socials; no collision; no horizontal overflow.
- **Detail page**: photo carousel (bounded strip window, one-slot advance on adjacent selection,
  wrapping and hover-gated arrows), the shared-state lightbox, the stock band on every card read
  from `data-stock-state` (band, label and colour), header search.
- **Product conversion flow**: CTA wording and prepared message per stock band; the channel list
  against what Site Info actually configures (including the edit the admin flow just saved); the
  clipboard in all three states so a refused write can never report success; both share paths and
  the dismissed-sheet case; the sticky bar's geometry, safe area, breakpoint, surface and
  stacking under the lightbox; Escape handing focus back; no horizontal overflow at seven widths
  in both colour schemes; canonical and Open Graph metadata.
- **Admin flow**: login, add, image upload, save/update, cancel, delete, the site-info editor
  (seed, field edits, link add/toggle/reorder/remove, the singleton upsert body, and the public
  header reflecting it), logout.

### Flags

```bash
bun install
bun run build
bun run lint                                  # eslint app+server; CI fails only on new errors
bun run verify                                # all checks against the existing .output
bun run verify --only=guest                   # or --only=admin (fewer checks than the full run)
node scripts/verify-ui.mjs --build            # build first, in one step
node scripts/verify-ui.mjs --keep             # leave Chrome + profile running to debug
node scripts/verify-ui.mjs --url http://127.0.0.1:PORT/   # point at an already-served build
CHROME_PATH=/path/to/chrome bun run verify    # if no Chrome binary is found (CI pins it to /usr/bin/google-chrome)
```

Build first; use `--only=guest|admin` while iterating.

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

All four have already been paid for once:

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
   `Array.from(...)`. Both mistakes read as "element not found".

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
the matrix, don't assume the utility name.

## Environment

- The build must be **hermetic for fonts**: `nuxt.config.ts` keeps only `@nuxt/fonts`' offline
  `local` provider and the real faces come from the `@fontsource*` devDependencies. A runner that
  cannot reach `fonts.googleapis.com` silently falls back to a wider system sans (locally it is
  invisible — the machine has the font or the cache), and that delta alone trips the harness's
  @320 overflow guards. If a build logs `Could not fetch … fonts.googleapis.com`, fix the
  providers, not the assertions.
- If Chrome fails to start with `Operation not permitted`, the command is running inside a
  restrictive sandbox — run it from a normal terminal.
- The harness has **no dependencies** (raw CDP over WebSocket; Node 24 for global `WebSocket`) —
  keep it that way, and do not add a test framework to "fix" the missing CI gate without a plan.
- Prefer the local dev server and this harness for validation. Use Browser Agent against localhost
  for visual checks; do not use cloud-hosted environments for routine UI verification.

## Before you say "done"

`bun run build` green, `bun run verify` green (the specific `--only` group you touched, then the
full run), `tsc` re-run if you edited `.ts`, IDE diagnostics re-read if you edited a
`<template>`, and — for anything that alters the design — [../../ARCHITECTURE.md](../../ARCHITECTURE.md)
updated in the same change.
