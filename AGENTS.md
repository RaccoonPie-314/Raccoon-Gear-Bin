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
| [docs/rules/TOUCH_RESTRICTIONS.md](docs/rules/TOUCH_RESTRICTIONS.md) | Editing (or planning to edit) an interaction engine, tuned animation, `app.config.ts`, `supabase/migrations/**`, or anything auto-imported by `nuxt.config.ts` |
| [docs/rules/TESTING_SPECS.md](docs/rules/TESTING_SPECS.md) | Verifying a change, extending `scripts/verify-ui.mjs`, or making any "it works" claim |
| [docs/rules/GIT_CONVENTIONS.md](docs/rules/GIT_CONVENTIONS.md) | Committing, tagging, pushing, or touching dependencies |

## Hard rules (always in force)

- **Public catalog data is fetched and mapped only in `app/composables/useCatalog.ts`.** No page
  may call `.from('products')` / `.from('categories')`, map a row, or build a storage URL.
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
- **Authorisation is row-level security in Postgres.** The browser holds only the anon key. Never
  add a service-role client to "fix" a permission error — that fix belongs in a migration, and a
  pushed migration is never edited.
- **Never add `as any` to a Supabase client or query** (see the typing rules below).
- **Every user-facing string goes through `t()`** (en + km). Wide Latin letter-spacing breaks
  Khmer clusters — see the locale-conditional tracking in `index.vue` before adding eyebrows.
- **Update `ARCHITECTURE.md` in the same change that alters the design.** It is hand-maintained
  precisely because generated docs cannot be trusted to carry intent.

## Two Supabase typing rules that fail silently

Both produce **no compile error** — `skipLibCheck` hides the constraint violation and every query
resolves to `never`. They are the reason `as any` existed here.

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
bun run build                                                 # what CI runs — the only gate
bun run verify                                                # scripts/verify-ui.mjs — needs Chrome
./node_modules/.bin/tsc -p .nuxt/tsconfig.app.json --noEmit     # .ts only
```

`build` succeeding means it compiled, not that it works: there is no test suite and no typecheck
in CI, and `tsc` cannot parse `.vue`, so **template bindings are unchecked**. What each command
actually proves, the harness's coverage and the CDP measurement traps are in
[docs/rules/TESTING_SPECS.md](docs/rules/TESTING_SPECS.md).

## Localhost use for testing

Prefer the local dev server and the existing local harness for validation; use Browser Agent
against localhost when visual/browser interaction is required. Do not use cloud-hosted
application environments for routine UI verification when the workspace and dev server are
available.
