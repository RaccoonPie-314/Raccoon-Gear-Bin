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

**Done (2026-10-05).** `server/utils/order-queries.ts` (the shared embed + the machine-code
 extractor) and seven routes: `POST /api/orders` (create_order inside `userTx`; raises become 400s
carrying the RPC's code), `GET /api/orders` (desk list, policy-scoped), `/mine`, `/stamps`,
`/pending`, `/:id` (the buyer trio re-filters to the caller explicitly — access is not ownership),
and `POST /:id/status` (set_order_status, admin re-checked in SQL). Client: `useCheckout` /
`useCustomerOrders` / `useAdminOrders` swapped to `$fetch`, shapes and mappers untouched
(`OrderWithItemsRow`/`OrderStampsRow` now name `order-queries.ts` as their pairing counterpart);
the PostgREST select strings are gone. Live-verified against a real Clerk dev session (Bearer
session token → middleware → claims path): create qty 2 → stock 5→3, mine/stamps/pending/single
reads, garbage and missing ids → null, non-admin transition → 400 `NOT_ADMIN`, confirm → desk list
shows `confirmed_at`, cancel-with-note → note recorded + stock back to 5, illegal transition →
`INVALID_TRANSITION`, probe order deleted. Harness: orders stubs + seven assertion groups
re-pointed; green **430/430 guest · 94/94 admin**, one run. Deferred to P6: the cart's identity
scope — it still keys off the Supabase user until the Clerk session flips there (the key is the
account id, so stored carts and the seen-marker survive that change). Dev fixture left for
P6/P7: Clerk user `p855960000001` (+855 96 000 0001) with a profiles row and an admin_users row
(password resettable via the clerk CLI).

## P6 — Clerk integration + identity flows (the C-phase, born here)

`@clerk/nuxt` wiring; customer + admin guards; email sign-in/up preserving current copy/flows; the
`/login` /signup modes UI from the identity v2 spec; phone signup route → **username-alias shape** proven in P0 (`p<e164>` username + password,
real number in `profiles.phone`; rate-limit table ports as-is); Telegram login (start/poll/webhook; mint = `createSignInToken` → the `/sign-in?__clerk_ticket` URL — completion mechanics
seen live in P0); login codes (same mint); `/account` cards (code + Telegram connect). The Supabase-era
`/api/auth/**` routes are deleted as their replacements land.

**Done (2026-10-05, session 2 of 2) — the client flip.** The harness auth slice rides to P8 as
planned. What landed: `useCustomerAuth` rebuilt on Clerk's client SDK (signIn/signUp/signUpWithPhone/
phoneIdentifier/signOut/completeOnHosted/waitForUser/telegram+code calls; `useAdminAuth` + both global
guards on `useUser`); cart scope and `useCustomerOrders` keyed by the Clerk user id; `/login` with
email|phone|code modes + a Telegram button, `/signup` with email|phone, `/account` with the login-code
card and the Telegram connect card; ~25 i18n keys in both locales; `/sign-in` + `/sign-up` catch-alls
(already wired to `.env`'s Clerk URL vars) now render the real prebuilt components. New routes
`/api/auth/phone/identifier` (alias lookup, no existence oracle) and `/api/auth/telegram/link`.

**Guard shape decided in the walkthrough:** the signed-out bounce is a **server-side 302** — the
request's Clerk cookies are verified by the module's Nitro middleware, so `event.context.auth()`
answers on the server; the client branch (bounded `waitForClerkLoaded` wait) is for SPA navigations
only. Reasons, both discovered live: (a) a hydration-phase client redirect ran before clerk-js booted,
so `/account` mounted with `fetchProfile()` resolving to `null` — empty fields that never refilled;
(b) after the guard started awaiting the SDK, the client hydrated *with* the user known while SSR had
rendered empty — a hydration text mismatch — fixed by `<ClientOnly>` on the account identifier
(matching @clerk/vue's documented pattern). Known-wrong intermediate states gone with the 302: no
flash of the guarded page, locale links stay correct (`/km/account` → `/km/login?redirect=…`).

**Walkthrough (browser, live dev instance):** phone sign-in end-to-end (mode tab → alias → landing /
when a nickname exists), account page (identifier `p855960000001`, profile fields, cards), generate
login code (shown once), sign-out → `/`, signed-out hard loads 302 (en + km arms), signed-in hard load
200 (server verified the session cookie), admin hard load → `/admin/login`, Telegram connect: deep
link captured → simulated webhook tap → 2 s poll → **"Connected as @verifybot"**; test rows deleted
after (links 0). Admin login page (rewritten this phase) verified both arms: non-admin gets the
"not authorized" sentence and **keeps** the session — the earlier `signOut()` there was a defect:
clerk's default `afterSignOutUrl: '/'` navigated away and swallowed the message, and it logged the
visitor out of the storefront too; admin lands on `/` with ADMIN MODE and `/admin/orders` renders.
The identifier field is `type="text"` now — the alias usernames aren't email-shaped and native
validation would block them. One render bug found and fixed: `telegramConnected: 'Connected as
@{name}'` — vue-i18n compiles `@{…}` as linked-message syntax and *throws in the render function*
the moment the linked branch paints; the fix uses the file's existing `{'@'}` literal idiom.

**Blocked external:** the code-login *hosted completion* — `verify → signInUrl` mints and the browser
lands on `accounts.dev/sign-in?__clerk_ticket=…&redirect_url=…` correctly (proven twice), but Clerk's
dev-instance host answered **522/timeouts** all evening, so the ticket never completed; retest when the
host recovers (a fresh code, the old ones were consumed at mint). Dev-instance-only nuance to re-check
in P8: the post-ticket landing can arrive before the dev-browser handshake sets a session cookie, so
the 302 bounces it to `/login`; on production keys the session cookie rides the same request.

**Harness now red by design** (`bun run verify`, 2026-10-05): catalog/legal checks green; everything
downstream of a harness sign-in fails (the stub layer still answers the Supabase shape, and Clerk's
test keys never authenticate) — the checkout slice reads `url: /login` for the same reason; the admin
slice aborts early on a missing element. P8 owns the re-baseline.


## P7 — admin remaining

Category/product/site-info editors route-by-route; admin_users keyed by Clerk ids; guard verified
against RLS + route checks.

**Done (2026-10-05).** The three editors' data ops left the Supabase client: five routes —
`/api/admin/site-info` (upsert), `/api/admin/categories` (the whole list in **one transaction**;
the editor used to write row-by-row over PostgREST), `/api/admin/categories/[id]` DELETE,
`/api/admin/products` (product + translation + image rows, one transaction; promo columns written
only when the client sent them, so a product that never had one is never touched), and
`/api/admin/products/[id]` DELETE. A shared `requireAdmin` (401 / 403) gates them all and now also
carries the category-drafts read's check. Client-generated uuids for new rows keep every statement
independent inside the transaction.

**Found live, fixed:** (a) every admin write died as "permission denied for table …" — 0001 granted
`app_authenticated` SELECT only, so the admin policies were unreachable; migration
**0003_admin_write_grants** opens the six tables (the policies stay the boundary). (b) Supabase's
`on delete restrict` FK refusals answer **SQLSTATE 23001** (restrict_violation), not 23503 —
PostgREST used to translate for the old client; the delete route does now (409 CATEGORY_IN_USE →
the "products are still filed here" sentence, verified). (c) The product editor's uploads still go
to the legacy bucket from the browser — attempted live: storage RLS refuses the Clerk session
("new row violates row-level security policy"), and because uploads now run **before** the route
call, the failure leaves no partial rows (confirmed: no stray product). R2 (P3) replaces that arm.

**Live-verified:** 401 × 6 / 403 × 5 with CLI-minted tokens (admin vs non-admin); site-info saved
and restored through Neon; categories create → 9 rows public → delete → 8; the FK-refusal arm on
`keyboards`; product create (9) → edit price → delete (8); no-op round trips answer 204. All test
rows cleaned (products 8, categories 8; site-info restored). Fast gates green. Harness untouched
(P8 owns the re-baseline).

## P8 — harness full re-baseline + docs

`verify-ui.mjs` stub layer replaced route-by-route (the tedious one — assertions unchanged);
AGENTS.md + ARCHITECTURE.md rewritten to the new doctrine; SPEC-overview stack sections amended.

**Done (2026-10-05).** The stub layer is the **new** stack now: the browser `fetch` stub answers
`/api/**` (catalog, site-info, orders, admin, profile, admin-check) plus the legacy storage upload
— the Supabase trio branches are gone — and a **scripted clerk-js** (served over CDP Fetch, beside
the photo generator; ~35 lines implementing exactly the surface `@clerk/vue` + the app touch:
`load`/`addListener`/`setActive`/`signOut` + minimal sign-in/sign-up resources, session in one
cookie) makes signed-in state deterministic offline. The auth-dependent check mechanics were
re-pointed (signup/login drive the same forms; `__harness_clerk` replaces the `auth-token`
signals; profile writes assert on `/api/profile`; the desk write sequences assert the P7 contracts:
upload → one transactional POST, path-shaped deletes, payload-carried image lists and name
deletion intents). **522/522 checks in one combined run** (guest 430 · admin 94, twice verified
across runs), fast gates green.

**Three findings worth keeping:** (a) the harness's admin-ness must be session-scoped — a
`--only`-baked flag answered admin to the guest walk in combined runs; restored the old
`sessionStorage.__admin_session` seed shape, and the stub's `/api/admin-check` also requires the
scripted session to be signed in, or a signed-out admin mode re-lights after logout ("logout
clears admin mode" caught both). (b) The fixture categories carry readable pseudo-ids (`…c01`),
not UUIDs — check regexes must accept them (the real route validates UUIDs; the stub is a
stand-in). (c) The account sign-out click is aim-drift-flaky like the other departures near
freshly-settled pages; it got the file's standard one-retry idiom. Docs: AGENTS.md re-scoped to
the claims path (typing rules now bind the legacy storage client until P3; the unit suite enters
the command list), SPEC-overview stack table/snippets/harness row amended, ARCHITECTURE P8 note.

## P9 — deploy + retire

Worker secrets (DB URL, Clerk keys, R2 binding) → deploy → **set the bot webhook**: `setWebhook` to
`https://raccoon-gear-bin.alsorandomkay.workers.dev/api/telegram/webhook` with `secret_token` =
the Worker's `NUXT_TELEGRAM_WEBHOOK_SECRET` (verified missing 2026-10-06: `getWebhookInfo.url`
empty, so Telegram login's `/start` went nowhere — local testing uses `.cache/tg-bridge.py` until
then) → smoke (order → Telegram push → login flows). Supabase projects stay untouched as cold
backup during a soak; then `supabase/` leaves the repo (git history keeps it). Payments (parked)
gets specified Clerk-native when un-parked.

## Estimates (agent sessions; owner cost = review/verify)

P0 1 · P2 1 · P3 0.5 · P4 1 · P5 1–2 · P6 2 · P7 1–2 · P8 2–3 · P9 0.5 → **≈ 10–13 sessions**.

## `[P0]` pins to collect (live-verified, not guessed)

- `@clerk/nuxt` module API; session read + `clerkClient` inside Nitro routes.
- `createSignInToken` completion UX mechanics (the "land on a completion URL" step).
- Neon driver transaction shape for `withClaims`; text user-ids everywhere.
- R2 binding in dev vs deployed; public URL behavior.
- Clerk dashboard config for phone+password strategy on the free tier (production terms).
