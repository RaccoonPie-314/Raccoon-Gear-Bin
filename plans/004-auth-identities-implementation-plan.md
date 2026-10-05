# 004 — auth identities v2 implementation plan (phone, Telegram, login codes)

Module: `identity` v2 — spec: [specs/ecommerce/SPEC-identity.md](../specs/ecommerce/SPEC-identity.md)
(amendment 2026-10-05, **owner-approved — implementation in progress**). Branch: `feat/ecommerce-impl`.
Deploy (E3) is owner-gated and is also the production RGB-DB-SG cutover.

Order: A → B → C/D → E. B consumes A's helpers; C builds against B's frozen route contracts (below);
D is independent; E last. Nothing here touches admin auth, checkout, orders, or the parked payments
module. Owner decisions locked: instant phone signup (no SMS), 2-week codes, 30-day sessions.

## Frozen route contracts (C builds against these; B implements)

- `POST /api/auth/phone/signup` `{ phone, password }` → `200 {ok:true}` | `409 PHONE_TAKEN` |
  `400 INVALID_PHONE|WEAK_PASSWORD` | `429 THROTTLED`. Callable signed-out (that is the point).
- `POST /api/auth/telegram/start` `{ mode?: 'login'|'link' }` → `200 {nonce, deepLink, expiresAt}` |
  `401` (link without session) | `429`.
- `POST /api/auth/telegram/poll` `{ nonce }` → `{status:'pending'}` | `{status:'expired'}` |
  `{status:'confirmed', tokenHash}` (login) | `{status:'linked'}` (link mode).
- `POST /api/auth/code/generate` (session) → `{code, expiresAt}`; code returned **once**.
- `POST /api/auth/code/verify` `{ code }` → `{tokenHash}` | `400 BAD_FORMAT|INVALID_CODE` |
  `410 EXPIRED|LOCKED` | `429`.
- `POST /api/telegram/webhook` — Telegram-only; secret header checked; always 200 to Telegram.

## Phase A — schema + pure helpers

### A1 — migration `auth_identities` + types

- What: create the file with `supabase migration new auth_identities` (never invent the name);
  four tables exactly as the spec's Schema section; RLS on all four (select-own policy on
  `telegram_links` only, none elsewhere); amend `handle_new_user()` → null display name for
  `%@users.raccoongearbin.invalid`, unchanged `split_part` otherwise. `app/types/database.ts` gains
  the four row types (type literals, Relationships mirroring the FKs).
- Acceptance: `supabase db push` clean on the linked project; anon probes on all four tables →
  denied/0 rows; a synthetic-email signup yields null display_name, a real-email signup unchanged.
- Verify: push output + recorded SQL probes (old vs new `profiles` behaviour).
- Files: `supabase/migrations/<ts>_auth_identities.sql`, `app/types/database.ts`.

### A2 — `server/utils/auth.ts` + `tests/unit/auth.test.ts`

- What: dependency-free helpers (payway pattern, imported relatively by the test):
  `normalizePhone` (accepts `012 345 678` / `0…` / `855…` / `+855…`, strips spaces+dashes, returns
  `+855…`, null on junk), `generateLoginCode` (12 chars, Crockford-style alphabet, ~60 bits),
  `normalizeCodeInput` (case, separators), `hashCode` (sha256 hex), `generateNonce` (base64url,
  ≤64 chars — Telegram's `/start` payload limit), `syntheticEmail(kind, id)`, and a fixed-length
  constant-time digest compare.
- Acceptance: unit table covers every phone spelling + junk; code/nonce charset and length asserted;
  digest compare has no early exit.
- Verify: `bun test` (with the other `tests/unit/*` suites).
- Files: `server/utils/auth.ts`, `tests/unit/auth.test.ts`.

## Phase B — the auth server tier (confined surface, per the spec)

### B1 — `server/utils/auth-service.ts`

- What: `createServiceClient(event)` — `useRuntimeConfig(event)`, empty-string defaults, per-flight
  client with `{ auth: { persistSession: false } }`, never logged (the payments confinement rules in
  the header comment); `bumpRateLimit(key, limit, windowSeconds)` against `auth_rate_limits`
  (`'<route>:<ip>'`, `cf-connecting-ip`).
- Acceptance: only `server/api/auth/**` + the webhook route import it (grep); no key material in any
  log line.
- Verify: lint + grep; the route probes below exercise it.
- Files: `server/utils/auth-service.ts`.

### B2 — `server/api/auth/phone/signup.post.ts`

- Acceptance: valid input creates an E.164 phone account (probe: `signInWithPassword({phone})` then
  load `/account`); duplicate → 409; password <8 → 400; >limit → 429; no session required.
- Verify: curl probes against the dev server (valid / duplicate / weak / throttled) recorded.
- Files: the route.

### B3 — `server/api/auth/telegram/start.post.ts` + `poll.post.ts`

- Acceptance: start (login) writes a pending row, returns nonce+deepLink+expiry; link mode without a
  session → 401; poll: pending → confirmed (login: find-or-create user + link + `display_name` from
  Telegram + mint tokenHash + consume) or linked; expired/unknown nonce typed; single-use enforced.
- Verify: simulate the webhook with a SQL row-update, then curl the poll — recorded.
- Files: the two routes.

### B4 — `server/api/telegram/webhook.post.ts`

- Acceptance: missing/wrong `X-Telegram-Bot-Api-Secret-Token` → 401 and no row touched;
  `/start lg_<nonce>` confirms + replies via the Bot API (token read from Vault through the service
  client); bare `/start` and every other update → 200 no-op; expired nonce → polite reply, no
  confirmation.
- Verify: local POST replays with/without the header (recorded); live check in E3.
- Files: the route.

### B5 — `server/api/auth/code/generate.post.ts` + `verify.post.ts`

- Acceptance: generate (session) upserts one code row and returns the plaintext once; verify:
  success → tokenHash, unknown → INVALID_CODE, expired → typed, malformed short-circuits before
  any DB read. (Amended at implementation: digest-lookup makes the per-code attempt lock
  impossible to attribute — dropped; the per-IP throttle is the guard. The `attempts` column
  stays unused in the pushed schema.)
- Verify: curl probes incl. the lockout path; recorded.
- Files: the two routes.

## Phase C — UI (no new pages; existing shells)

### C1 — `/signup` + `/login` modes

- What: `/signup` email|phone toggle (phone validated client-side with the same normalize rules);
  `/login` email|phone|code modes + "Continue with Telegram" button and polling sheet
  (pending/expired/cancel/error). `useCustomerAuth` gains `signUpWithPhone`, telegram start/poll
  helpers, `generateLoginCode`, `signInWithCode` (verifyOtp token_hash → `waitForUser()` →
  landing rule unchanged).
- Acceptance: every string via `t()`; Khmer tracking untouched; failures reuse the checkout field
  convention (red + hint); no layout overflow regressions at 390×844 (the one-screen checks do not
  apply to these pages, but the phone sweep does).
- Verify: lint/typecheck/build; manual EN+KM walkthrough on the dev server; E1 covers stubs.
- Files: `app/pages/signup.vue`, `app/pages/login.vue`, `app/composables/useCustomerAuth.ts`.

### C2 — `/account` cards

- Acceptance: login-code card (generate → show once → copy → gone after reload/leave; regenerate
  replaces); Telegram card (connect → polling → connected @username); profile editing and sign-out
  untouched.
- Verify: manual walkthrough; E1.
- Files: `app/pages/account/index.vue`.

### C3 — i18n

- Acceptance: every new key in en + km; no collision with harness-matched literals
  (`i18n.config.ts` comment rule).
- Files: `i18n.config.ts`.

## Phase D — config

### D1 — `nuxt.config.ts` + `.env.example`

- `runtimeConfig`: server-only `supabaseServiceRoleKey` + `telegramWebhookSecret` (empty-string
  defaults — the payments pattern and comment); `.env.example` gains
  `NUXT_SUPABASE_SERVICE_ROLE_KEY` + `NUXT_TELEGRAM_WEBHOOK_SECRET`. Cookie lifetime: **no knob** —
  sources read at implementation show `@supabase/ssr` pins the auth cookie to its 400-day default
  and sessions are indefinite server-side; the nuxt.config comment is corrected to that fact
  instead of the planned `maxAge` override (a value that would never bind).
- Acceptance: built bundle carries only the empty defaults (extend the payments P5 audit); nothing
  new in `runtimeConfig.public`.
- Verify: build + grep `.output`; recorded.
- Files: `nuxt.config.ts`, `.env.example`.

## Phase E — harness, docs, deploy

### E1 — harness (`scripts/verify-ui.mjs`)

- What: stub `/api/auth/**` alongside the existing `/auth/v1` fixtures; checks: phone signup (stub)
  lands signed in; code login success + wrong-code hint; Telegram sheet opens the deep
  link and pending→confirmed completes; the generated code shows once and is gone after reload;
  sign-out regression untouched.
- Verify: full `bun run verify` guest + admin, sequential, **no build concurrent with the dev
  server** (TESTING_SPECS trap 11).

### E2 — docs

- `ARCHITECTURE.md`: the second server surface, the four tables, the mint path, session lifetime.
- Spec status flip to implemented; this plan gets its checkpoint note.
- Files: `ARCHITECTURE.md`, `specs/ecommerce/SPEC-identity.md`.

### E3 — deploy + live smoke (owner-gated) — the spec's checklist

- `supabase db push` → Worker secrets (service role + webhook secret) → `bun run build && bun run
  deploy` (**also the production RGB-DB-SG cutover**) → `setWebhook` → live: real Telegram tap login
  (fresh + connect), code login from a second device, phone signup → checkout, one real order to
  confirm the Telegram push still delivers.
- Checkpoint: merge + tag `backup/auth-identities-working` after the G3-style green.

## Not in this plan

QR rendering · Telegram detach · identity merging · SMS OTP · CAPTCHA · admin auth changes · guest
checkout. Each lives in the spec's open questions with its trigger.
