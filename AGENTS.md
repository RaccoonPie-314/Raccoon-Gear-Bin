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
| `SearchDock.vue` morph/measure logic | FLIP engine: matrix inversion, settle-token arbitration, per-axis radius compensation |
| `category/CategoryDesktop.vue` / `CategoryMobile.vue` drag + indicator | tuned input models; desktop and mobile are *deliberately* different |
| `app/assets/css/main.css` select-morph keyframes | `0.24` is trigger-height ÷ panel-height |
| `app/app.config.ts` | single owner of the pill control language (it also emits 3 pre-existing `tsc` errors — do not "fix" as a drive-by) |
| `supabase/migrations/**` | schema + RLS are the security model |

Exact numbers worth not breaking are tabulated in ARCHITECTURE.md → *Interaction invariants*.

## Verifying a change

```bash
bun install
bun run build                                                # what CI runs — the only gate
./node_modules/.bin/tsc -p .nuxt/tsconfig.app.json --noEmit   # .ts only
```

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
