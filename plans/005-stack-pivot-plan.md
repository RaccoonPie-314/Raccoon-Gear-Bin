# 005 — stack pivot plan: Clerk + Neon + R2 (Resend deferred)

Status: **pre-spike**. Owner approved the direction (discussion 2026-10-05); the go/no-go is P0's
outcome. Items marked `[P0]` are pinned during the pilot before their phase starts — this file is
updated with the pins, not re-guessed later.

Basis: **all catalog/account data is test data** — there is no data migration; the new stack starts
clean. The current implementation (branch `feat/ecommerce-impl`, Supabase era) stays as the
behavioral reference, and [specs/ecommerce/](specs/ecommerce/) remains the source of truth for WHAT
the app does — only its stack/doctrine sections change. plans/004's identity C-phase (the UI) is
**carried into P6 here** and never built on Supabase.

## Why now

Staying costs $25/mo from production forever (or free with the 7-day pause ritual); porting costs a
one-time bounded pass. The port is at its **smallest surface ever right now** — no real users, no
payments module built yet, C-phase UI unbuilt — and every future Supabase-shaped feature would
enlarge it. Nothing is live, so the blast radius is zero and the port can go module-by-module.

## Target stack

| Layer | Now | After |
|---|---|---|
| Runtime | Nitro on Cloudflare Workers | **unchanged** |
| DB | Supabase Postgres (Singapore) | **Neon Postgres, Singapore region**; `@neondatabase/serverless` (HTTP driver, Workers-native) `[P0]` |
| Auth | Supabase Auth | **Clerk** (`@clerk/nuxt`): phone+password accounts created server-side (backend numbers are auto-verified — no SMS), Telegram + login codes via `createSignInToken` |
| Data access | PostgREST from the browser (anon key + RLS) | **`/api/**` Nitro routes**; raw SQL via tagged templates + the existing hand-written row types. Decision: no ORM — Drizzle/new DSL rejected, it reproduces what hand types already do |
| Authorization | RLS with `auth.uid()` | Route-layer checks **plus** claims-per-request RLS for user-scoped tables through ONE helper (`withClaims`) — public catalog reads are role-agnostic. Policies' `auth.uid()` → `app.current_user_id()` reading `request.jwt.claims` (mechanics proven 2026-10-05) |
| Storage | Supabase Storage bucket | **Cloudflare R2 via the Worker binding** (no S3 keys, no presigning — `put()` directly) |
| Telegram push | pg_net + Vault RPC | Worker fetch with its own secret (simpler — the Vault indirection existed only because the token lived in the DB); the webhook route ports as-is |
| Email | none (confirmations off by decision) | **Resend later** — trigger: receipts land on the roadmap |

## Non-negotiables carried over (repo doctrine, adapted)

- No blanket-admin DB access in routes: user-scoped queries go through `withClaims()`; ownership is
  enforced twice (route check + RLS policy) exactly where the current repo does it once.
- The client never talks to the DB directly (no public DB endpoint exists at all now).
- Every user-facing string via `t()`; the harness stays behavior-level (assertions survive — the
  stub layer changes).
- Numbered `db/migrations/*.sql`, applied by a script that records versions; a pushed migration is
  never edited.

## What survives untouched (scope reassurance)

UI components + motion system, i18n, `app/utils/*` pure logic (pricing, stock, phone, codes,
safe-redirect), the harness's assertion layer, cart's localStorage model, the Telegram webhook's
logic, the deploy pipeline, CI shape. The port replaces **wiring**, not craft.

## P0 — pilot spike (go/no-go; needs the two accounts)

Against live free instances, inside the existing dev server:

1. **Clerk**: create app; `createUser(phone_number + password)` → auto-verified; sign-in with
   phone+password (Clerk test number `424242`, no SMS); `createSignInToken` → complete a session;
   `@clerk/nuxt` SSR session read from a Nitro route.
2. **Neon**: Singapore project; sample table + a claims-based policy; `withClaims()` transaction
   shape (set local claims + role → policy filters rows) with the serverless driver.
3. Pin versions + exact APIs into this file; record anything that contradicts the table above.

**Any hard blocker → stop and revisit.** Scratch files only (`/.nuxt/spike/**`); no app code.

### P0 result — Clerk half (2026-10-05, live on the dev instance)

- **Clerk does not support Cambodian phone numbers as identifiers** — backend `createUser` with
  `+855…` answers "Phone numbers from this country (Cambodia) are currently not supported".
  Platform policy, not config. **Design adjustment: the phone UX rides on a username alias** —
  Clerk sees `p<e164>` (e.g. `p855960000001`), the real number stays in our own
  `profiles.phone` (where it already lives in today's schema). Buyer-facing screens never
  mention the alias; signup/sign-in forms take the phone number, routes normalize (the existing
  `normalizePhone` util is the single owner of the mapping).
- **Live-proven:** `POST /users {username: "p855…", password}` → 200, username on file ✓;
  `POST /sign_in_tokens` → 200 returning the hosted completion URL
  `/sign-in?__clerk_ticket=…` (this is the Telegram + code-login mint) ✓; probe user deleted ✓.
- **Deferred to the P6 browser walkthrough:** raw-fetch password sign-in — Clerk's client
  handshake needs clerk-js's cookie dance, not the API (instance config for it is on; low
  residual risk, it is the standard username+password path).
- **Instance config applied via `clerk config patch` (re-apply on PRODUCTION at P9 — scripted):**
  `auth_username.used_for_sign_up/used_for_sign_in = true`; `auth_email.required_for_sign_up = false`;
  `auth_password.min_length = 8` (spec's rule; Clerk's default is 15). `auth_phone` was toggled
  during the spike then reverted — it stays off.

### P0 result — Neon half (2026-10-05, live on `hidden-feather-83634473`, Singapore)

The production shape is proven end to end on the real project via `@neondatabase/serverless@1.2.0`
(pooled `DATABASE_URL` now in `.env`): a NON-owner role, a policy reading
`nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'`, and one transaction per
request (`set_config` claim → `set local role` → read) returning disjoint views — u1 saw only its
row, u2 only theirs, no-claims saw zero rows (the `nullif` is the production trap: an empty claims
setting must mean "no rows", never a cast error). The admin connection sees everything — the role
switch is what filters. Probe objects dropped.

Pins: `@neondatabase/serverless@1.2.0`; neon CLI v8 auths via its stored OAuth profile (scripts
later read `NUXT_NEON_API` from `.env` — rename to the plain `NEON_API_KEY` convention at P2);
region `aws-ap-southeast-1`.

**P0 verdict: GO** — Clerk alias flows + Neon claims-RLS both green; the two deferred browser
checks (clerk-js password sign-in, ticket completion) ride along in P6.

## P1 — checkpoint commit (owner, minutes)

`feat/ecommerce-impl` committed and pushed as the reference implementation — **before any port
code**. Supabase stays fully runnable until P8.

## P2 — foundation

**Done (2026-10-05).** `db/migrations/0001_schema.sql` (90 statements, one transaction, applied:
`bun scripts/db-migrate.mjs`) — the full port with its deltas documented in the file header;
the pricing fixture DO block runs on every migrate and aborts on drift. `server/utils/db.ts`
(`appSql` owner context + `userTx` claims path). Acceptance, live: 16 tables / 19 policies; u2 saw
exactly own rows, u1 (admin) saw both orders via the policy's admin branch, no-claims returned
0 rows with no cast error; probes self-cleaned. Migrator findings worth keeping: the HTTP endpoint
refuses multi-statement strings and `transaction()` only accepts `sql.query(...)` raw objects —
hence the `$$`-aware splitter in `scripts/db-migrate.mjs`. Seed script deferred to P4 (written
when the catalog routes exist to need it). Also applied: `NUXT_DATABASE_URL` + `NEON_API_KEY`(empty
— the CLI rides its OAuth profile) in `.env`; `.env.example` carries the port-era names.

<details><summary>original task text</summary>

- Deps: `@clerk/nuxt`, `@neondatabase/serverless` (pinned; `supabase` CLI dep removable at P8).
- Env + `runtimeConfig`: `DATABASE_URL`, Clerk keys (server-only discipline, empty defaults, same
  comment pattern as today); `.env.example` updated.
- `db/migrations/0001_schema.sql` — the fresh schema, ported from the 20 Supabase migrations minus
  Supabase-isms: `auth.users` FKs gone (user ids are Clerk text ids), `profiles` created by app
  code (no trigger on an auth schema that no longer exists), functions (`create_order`,
  `set_order_status`, `anonymize_customer`, `mark_payment_refunded`) survive with `auth.uid()` →
  `app.current_user_id()`, storage/vault/pg_net objects dropped.
- `scripts/db-migrate.mjs` (~40 lines: runs `db/migrations/*.sql` via the neon driver, records
  versions) + `scripts/db-seed.mjs` (the current test catalog as a fixture — dev + harness need it).
- `server/utils/db.ts` — client factory + `withClaims(event, fn)` `[P0 shape]`.
- Acceptance: clean migrate+seed on a Neon branch; claims probe passes; fast gates green.

</details>

## P3 — R2 + storage (early, so image URLs flip once)

Upload/delete routes for the admin editor (Worker binding), public URL builder (`R2_PUBLIC_BASE`),
port the 23 test images (one script). `[P0]` r2.dev vs custom-domain behavior noted then.

## P4 — catalog + site info read path

`server/utils/{catalog,site-info}-queries.ts` + `/api/catalog/**`, `/api/site-info`; `useCatalog` /
`useSiteInfo` become `$fetch` wrappers with **unchanged public shapes** (`CatalogProduct` etc.).
Harness: catalog/site-info stubs swap; those checks return green.

**Done (2026-10-05).** `server/utils/catalog-queries.ts` + four routes: `/api/catalog/products`
(`?id=` → one row or null, garbage id → null, list = published newest-first), `/api/catalog/categories`,
`/api/catalog/category-drafts` (the admin-scoped one — route-layer 401/403 against `admin_users`),
`/api/site-info`. All answer in the old PostgREST row shapes on purpose, so every mapper in
`useCatalog`/`useSiteInfo` stayed untouched — only the fetch calls became `$fetch`, and the
select-derived row types became hand-written ones beside the mappers. Live-probed on the dev server:
8 products/8 categories with embeds, garbage id → `null`, drafts without a session → 401, and the
product page's SSR renders from Neon. `scripts/seed-catalog.json` (the live test catalog, exported
over anon REST) + `scripts/db-seed.mjs` (idempotent, read-back self-check) — Neon carries the same
shelf the Supabase project showed. Harness: the stub layer answers `/api/catalog/**` +
`/api/site-info` from the same fixtures, the four read-path assertions re-pointed, green **430/430
guest · 94/94 admin**. Finding worth keeping: the harness's `.output` server reads only real process
env and the Clerk middleware refuses to start without a key pair — dev-form keys additionally 307
every document navigation into Clerk's dev-browser handshake (a real FAPI round trip), so the
harness now spawns the server with its own fixed production-form fake pair and merges `.env` when it
exists; the console gate allowlists exactly that load-failure class plus the hydration warning.

## P5 — cart / checkout / orders

`create_order` function + route; order reads via `withClaims`; admin order routes; account order
pages; cart merge hooks onto Clerk session events (localStorage model untouched).

## P6 — Clerk integration + identity flows (the C-phase, born here)

`@clerk/nuxt` wiring; customer + admin guards; email sign-in/up preserving current copy/flows; the
`/login` /signup modes UI from the identity v2 spec; phone signup route → **username-alias shape** proven in P0 (`p<e164>` username + password,
real number in `profiles.phone`; rate-limit table ports as-is); Telegram login (start/poll/webhook; mint = `createSignInToken` → the `/sign-in?__clerk_ticket` URL — completion mechanics
seen live in P0); login codes (same mint); `/account` cards (code + Telegram connect). The Supabase-era
`/api/auth/**` routes are deleted as their replacements land.

## P7 — admin remaining

Category/product/site-info editors route-by-route; admin_users keyed by Clerk ids; guard verified
against RLS + route checks.

## P8 — harness full re-baseline + docs

`verify-ui.mjs` stub layer replaced route-by-route (the tedious one — assertions unchanged);
AGENTS.md + ARCHITECTURE.md rewritten to the new doctrine; SPEC-overview stack sections amended.

## P9 — deploy + retire

Worker secrets (DB URL, Clerk keys, R2 binding) → deploy → smoke (order → Telegram push → login
flows). Supabase projects stay untouched as cold backup during a soak; then `supabase/` leaves the
repo (git history keeps it). Payments (parked) gets specified Clerk-native when un-parked.

## Estimates (agent sessions; owner cost = review/verify)

P0 1 · P2 1 · P3 0.5 · P4 1 · P5 1–2 · P6 2 · P7 1–2 · P8 2–3 · P9 0.5 → **≈ 10–13 sessions**.

## `[P0]` pins to collect (live-verified, not guessed)

- `@clerk/nuxt` module API; session read + `clerkClient` inside Nitro routes.
- `createSignInToken` completion UX mechanics (the "land on a completion URL" step).
- Neon driver transaction shape for `withClaims`; text user-ids everywhere.
- R2 binding in dev vs deployed; public URL behavior.
- Clerk dashboard config for phone+password strategy on the free tier (production terms).
