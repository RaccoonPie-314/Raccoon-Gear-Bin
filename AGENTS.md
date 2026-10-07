# Instructions for AI agents

Operational rules for this repo. Design rationale lives in
[ARCHITECTURE.md](ARCHITECTURE.md) — read that for *why*, this file for *how to work safely*.

## Order of trust

1. **The code** — ground truth.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — hand-maintained boundaries, invariants, known gaps.
3. **`.qoder/repowiki/`** — generated, gitignored, possibly stale or absent. Never treat a
   generated page as evidence that a capability exists. If it disagrees with the code, the code
   wins — and say so rather than silently picking one.

## Deep rules — read before opening any file

Detailed instructions live in `docs/rules/`. Open the matching file for the task:

| File | Open it when |
|---|---|
| [docs/rules/TOUCH_RESTRICTIONS.md](docs/rules/TOUCH_RESTRICTIONS.md) | Editing (or planning to edit) an interaction engine, tuned animation, `app.config.ts`, `db/migrations/**`, or anything auto-imported by `nuxt.config.ts` |
| [docs/rules/TESTING_SPECS.md](docs/rules/TESTING_SPECS.md) | Verifying a change, extending `scripts/verify-ui.mjs`, or making any "it works" claim |
| [docs/rules/GIT_CONVENTIONS.md](docs/rules/GIT_CONVENTIONS.md) | Committing, tagging, pushing, or touching dependencies |

## Hard rules (always in force)

- **Public catalog data is fetched and mapped only in `app/composables/useCatalog.ts`.** No page
  may fetch `/api/catalog/**` directly, map a row, or build a storage URL.
- **Browsing state lives in `app/composables/useCatalogBrowse.ts`** — search, sort, category
  selection, `filteredProducts`. No network, no DOM.
- **`app/components/` stays presentational**: props in, events out, no data composables.
- **Product-detail conversion lives in `app/features/product/`.** `useProductContact` is *handed*
  the `CatalogProduct` and the `SiteInfo`; it issues no query. Sharing is a separate capability
  taking `{ title, text?, url }`. `[id].vue` must not grow channel resolution, message
  construction, clipboard or share code. Copy is explicit: a channel click that navigates away
  never claims the message was copied.
- **The in / low / out band has one owner: `app/utils/product-stock.ts`**, and
  `LOW_STOCK_THRESHOLD` stays the only number. A rule that is neither reactive state nor a browser
  capability belongs in `app/utils/` as a plain function — not in a new composable.
- **Which price applies has one owner: `app/utils/product-pricing.ts`.** `products.price` stays the
  original; the five nullable `promo_*` columns are what `getProductPricing` reads to decide what to
  charge, what to cross out, and which number "Price: low to high" orders by. No page, card or
  message may compare a promo window or a unit cap inline.
- **Authorisation is row-level security in Postgres, reached through the claims path.** The
  browser holds only a Clerk session; server routes write as `userTx` (set claims + `set local
  role`) and never with the owner client. Never "fix" a permission error with a broader client or
  an out-of-band grant — the fix belongs in a new numbered migration (a pushed one is never
  edited), and the `requireAdmin` gate is the clear early answer, not the boundary.
- **Never add `as any` to a Supabase client or query** (the legacy storage client is the only one
  left — see the typing rules below).
- **Every user-facing string goes through `t()`** (en + km). Wide Latin letter-spacing breaks
  Khmer clusters — see the locale-conditional tracking in `index.vue` before adding eyebrows.
- **Update `ARCHITECTURE.md` in the same change that alters the design.** It is hand-maintained
  precisely because generated docs cannot be trusted to carry intent.

## Two Supabase typing rules that fail silently

They bind the legacy storage client and `app/types/database.ts` until the R2 flip retires them
(P3). Both produce **no compile error** — `skipLibCheck` hides the constraint violation and every
query resolves to `never`. They are the reason `as any` existed here.

1. Row shapes are `type X = { … }`, never `interface X { … }` — interfaces get no implicit index
   signature, so `Row extends Record<string, unknown>` fails.
2. `Views` / `Functions` / `Enums` / `CompositeTypes` are `{ [_ in never]: never }`, never
   `Record<string, never>` — a string index lets `from()`'s view overload swallow table names.

Also: select strings stay inline literals (runtime-built strings degrade rows to `any`), and
`Relationships` in `app/types/database.ts` must mirror the migration's foreign keys or embedded
selects collapse to `never`.

## Verification (minimum)

```bash
bun install
bun run build                                                 # compiles (CI)
bun run lint                                                  # eslint app server (CI — fails on new errors; the whole tree since 2026-10-07)
bun run verify                                                # scripts/verify-ui.mjs (CI) — needs Chrome
bun run test                                                  # tests/unit — pure rules, in CI since 2026-10-07, ~0.2 s
./node_modules/.bin/tsc -p .nuxt/tsconfig.app.json --noEmit     # .ts only (add tsconfig.server.json for server/)
bun run typecheck                                              # vue-tsc via `nuxt typecheck` — checks .vue templates too (CI since 2026-10-07)
```

**Budget by cost, not by order.** Measured 2026-10-03 on the M-series dev machine, warm:
`lint` 2 s · `typecheck` 4 s · `build` 7 s · `verify` **3 m 37 s**. The three fast gates are
one command line and change nothing about that, so run them after *every* edit; `verify` is
95 % of the loop and is the gate you run **once**, immediately before you claim something works.
Its two `--only` slices are independent and each owns a scratch dir under `.nuxt/verify/<slice>`,
so they can be run at once — worth ~30 s of the 217 s, because the guest slice is
86 % of the run and `--only` cannot split it further.

`build`, `lint`, `test`, `typecheck` and `verify` all run in CI on every push (`test` and `typecheck` ride
the `lint` job, which needs no Chrome and no `.output`).
A green `build` still means it
compiled, not that it works; the unit suite (`bun run test`) covers the pure rules — pricing parity,
order transitions, PayWay hashing, the Telegram push body — and is the cheapest gate in the pipeline.
`bun run typecheck` (vue-tsc) does
mechanically check template bindings — a mistyped prop or missing variable in a `.vue` template
fails on it, and it has been a CI gate since 2026-10-07 (the wall-time objection was measured and
weighed against the one thing nothing else catches: a template binding compiles and paints wrong). It
exits 0 since 2026-10-03 (the `app.config.ts`
slot classes, the `useHead` meta in `[id].vue` and the dead `nuxt.config.ts` cookie options were
root-caused and fixed), so treat any error it reports as real. `tsc` alone cannot parse `.vue`,
so the remaining backstops for what typecheck misses are `verify`'s painted-geometry asserts and
the IDE language server. What each command actually proves, the harness's coverage and
the CDP measurement traps are in [docs/rules/TESTING_SPECS.md](docs/rules/TESTING_SPECS.md).

## Localhost use for testing

Prefer the local dev server and the existing local harness for validation; use Browser Agent
against localhost when visual/browser interaction is required. Do not use cloud-hosted
application environments for routine UI verification when the workspace and dev server are
available.
