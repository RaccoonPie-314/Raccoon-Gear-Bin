# Instructions for AI agents

Working rules for this repository. Design rationale lives in
[ARCHITECTURE.md](ARCHITECTURE.md) — read that for *why*; read this for *how to work safely*.

## Order of trust

1. **The code itself.** Always the ground truth.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — hand-maintained boundaries, invariants and known gaps.
3. **`.qoder/repowiki/`** — generated, and *not in this repo* (gitignored). It may be stale,
   half-written or entirely absent on any given machine. Never conclude a capability exists
   because a generated page describes it; several pages document realtime, tests, caching and
   monitoring that are not implemented.

If a generated doc and the code disagree, the code wins — and say so rather than silently
picking one.

## Hard rules

- **Public catalog data is fetched and mapped only in `app/composables/useCatalog.ts`.**
  No page may call `.from('products')` / `.from('categories')`, map a row, or build a storage
  URL. A second private copy of that path lived in `index.vue` for months and quietly drifted.
- **Browsing state lives in `useCatalogBrowse.ts`** — search, sort, category selection,
  `filteredProducts`. It must not touch the network or the DOM.
- **Components in `app/components/` stay presentational**: props in, events out, no data
  composables.
- **Product-detail conversion lives in `app/features/product/`.** `useProductContact` is *handed*
  the `CatalogProduct` and the `SiteInfo` the page already fetched and issues no query of its own;
  sharing is a separate capability taking `{ title, text?, url }`. `[id].vue` composes
  `<ProductConversion>` and must not grow channel resolution, message construction, clipboard or
  share code of its own. Copy is an explicit action: a channel click that navigates away never
  claims the message was copied.
- **The in / low / out band has one owner: `app/utils/product-stock.ts`.** The badge and the CTA
  both ask it, and `LOW_STOCK_THRESHOLD` stays the only number. A rule that is neither reactive
  state nor a browser capability belongs in `app/utils/` as a plain function — not in a new
  composable.
- **Never add `as any` to a Supabase client or query.** See the silent-failure rules below.
- **Authorisation is row-level security in Postgres.** The browser holds only the anon key.
  Do not introduce a service-role client to "fix" a permission error — the fix belongs in a
  migration, and migrations must not be edited after they are pushed.
- **Every user-facing string goes through `t()`** (en + km). Wide Latin letter-spacing breaks
  Khmer clusters — see the locale-conditional tracking in `index.vue` before adding eyebrows.

## Hands off (without a specific reason)

These work, are invisible to the compiler, and have no tests protecting them:

| Area | Why |
|---|---|
| `SearchDock.vue` morph/measure logic | two cooperating engines: the overlay FLIP (matrix inversion, settle-token arbitration, per-axis radius compensation) and the scroll-collapse fixed-box rAF flight that re-aims from the live box on a reversal |
| `category/CategoryDesktop.vue` / `CategoryMobile.vue` drag + indicator | tuned input models; desktop and mobile are *deliberately* different |
| `app/assets/css/main.css` select-morph keyframes | `0.24` is trigger-height ÷ panel-height |
| `app/app.config.ts` | single owner of the pill control language (it also emits 3 pre-existing `tsc` errors — do not "fix" as a drive-by) |
| `supabase/migrations/**` | schema + RLS are the security model |

Exact numbers worth not breaking are tabulated in ARCHITECTURE.md → *Interaction invariants*.

## Verifying a change

```bash
bun install
bun run build                                                # what CI runs — the only gate
bun run verify                                               # scripts/verify-ui.mjs — 226 UI checks
./node_modules/.bin/tsc -p .nuxt/tsconfig.app.json --noEmit   # .ts only
```

- **`bun run verify` exists so you do not rebuild a test harness.** It serves `.output`, drives
  headless Chrome over CDP, and asserts the tuned interactions (category drag, indicator snap and
  260ms curve, magnification profile, scroll reveal, spotlight morph, the scroll-collapse
  field↔launcher flight in both directions including a mid-flight reversal, the masthead's two
  levels and emblem height step at five widths, no overflow at five widths, the detail-page photo
  carousel — bounded strip window, one-slot advance on adjacent selection, wrapping arrows,
  hover-gated arrows, and the shared-state lightbox — the stock band on every card (in / low / out,
  each with its label and its colour, read from `data-stock-state` now that the band comes from one
  shared rule), and
  the detail-page header search) plus the **product conversion flow** — CTA wording and prepared
  message per stock band, the channel list against what Site Info actually configures (including
  the edit the admin flow just saved), the clipboard in all three states so a refused write can
  never report success, both share paths and the dismissed-sheet case, the sticky bar's geometry,
  safe area, breakpoint, surface and stacking under the lightbox, Escape handing focus back, no
  horizontal overflow at seven widths in both colour schemes, and the page's canonical and Open
  Graph metadata — plus the
  **entire admin flow** — login, add, image upload, save/update, cancel, delete, the site-info
  editor, logout — against a stubbed Supabase in `scripts/fixtures.json`. No real project is
  contacted and nothing is written. The count above is the full run; `--only=guest` or
  `--only=admin` prints fewer. Build first; add `--only=guest|admin` while iterating.
- To prove a refactor is behaviour-preserving, run it against the pre-change build too (worktree
  from the nearest `backup/*` tag) and diff the `PASS`/`FAIL` lines, including the recorded
  `(method, path, query, body)` write sequence. Phases 3–5 each found real regressions and real
  probe bugs this way — a check that fails on the *unmodified* build is a broken check.
- If Chrome fails to start with `Operation not permitted`, the command is running inside a
  restrictive sandbox; run it from a normal terminal.

- **There is no test suite and no typecheck in CI.** `build` succeeding means it compiled, not
  that it works.
- `tsc` cannot parse `.vue`, so **template bindings are unchecked**. The IDE language server
  does catch them; re-read its diagnostics after editing a `<template>`.
- For anything visual or interactive, **measure instead of eyeballing**: drive headless Chrome
  over CDP at 1440 / 1280 / 1024 / 834 / 640 / 390 and assert geometry (control heights,
  alignment, no horizontal overflow) and animation state (running `getAnimations()`, snap
  delta, settle size). A screenshot cannot prove a 44px control or a snapped bubble.

## Two Supabase typing rules that fail silently

Both produce **no compile error** — `skipLibCheck` hides the constraint violation and every
query just resolves to `never`. They are the reason `as any` existed here.

1. Row shapes are `type X = { … }`, never `interface X { … }` — interfaces get no implicit
   index signature, so `Row extends Record<string, unknown>` fails.
2. `Views` / `Functions` / `Enums` / `CompositeTypes` are `{ [_ in never]: never }`, never
   `Record<string, never>` — a string index lets `from()`'s view overload swallow every table
   name.

Also: select strings must stay inline literals (runtime-built strings degrade rows to `any`),
and `Relationships` in `app/types/database.ts` must mirror the migration's foreign keys or
embedded selects collapse to `never`.

## Git conventions

- Conventional commits (`fix:` / `feat:` / `docs:` / `chore:`) with a body that explains
  *why*, not what the diff already shows.
- Before risky work, make a save point: `git tag backup/<short-description>-working`.
- **Do not commit `.qoder/`** — it is gitignored generated output.
- Dependency changes go through Renovate and must include a regenerated `bun.lock`; CI fails
  on a lockfile mismatch.

## When you change the design

Update `ARCHITECTURE.md` in the same change. It is hand-maintained precisely because generated
docs cannot be trusted to carry intent.

## Localhost use for testing

Prefer the local development server and existing local verification harness for validation. Use Browser Agent against localhost when visual/browser interaction is required. Do not use cloud-hosted application environments for routine UI verification when the local workspace and dev server are available.