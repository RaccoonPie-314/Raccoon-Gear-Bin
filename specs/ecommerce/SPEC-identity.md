# SPEC-identity — module id `identity`

Phase 1. Depends on `compliance` only for the G1 gate (legal pages live before this deploys), not for
code. Specified in [CAPABILITY-MAP.md](CAPABILITY-MAP.md); global rules in
[SPEC-overview.md](SPEC-overview.md).

## Objective

Customer accounts, in the shape the admin flow already proved: Supabase Auth email + password,
a `profiles` row created server-side, and a session-only route guard. After this module a visitor can
sign up, sign in, sign out, see their account, and be redirected back to where a guard stopped them.

Success criterion in one sentence: **a shopper can create an account, land on `/account` signed in,
see their email, edit a display name and phone (which checkout will prefill), and sign out — with no
admin allowlist involved anywhere.**

## Boundaries

- **Owns**: the auth accounts, the `profiles` table + signup trigger, `/login` `/signup` `/account`
  pages, profile read/update, and the `customer-auth.global.ts` guard.
- **Does not own**: cart merging mechanics (the `cart` module reacts to sign-in; identity exposes only
  the session), order reads (the `orders` module reads its own tables; the account page's order list
  belongs to `orders`), legal copy (`compliance`), password reset / SMTP (deferred, open question).
- The guard is **UX, not security**: RLS remains the authorization boundary
  ([TOUCH_RESTRICTIONS.md](../../docs/rules/TOUCH_RESTRICTIONS.md) "never do these"). The guard only
  decides which page a signed-out visitor sees.

## Schema — `supabase/migrations/<ts>_customer_accounts.sql`

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at_profiles
before update on public.profiles
for each row
execute function public.handle_updated_at();   -- the existing trigger function, reused

-- Server-side profile creation: no client INSERT policy exists at all, so there is no race
-- between signUp and a second request, and no path where an account has no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
on public.profiles for select
using (id = auth.uid());

create policy "Users can update their own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());
```

Decisions encoded above, with reasons:

- **No insert/delete policies** — the trigger inserts; cascade from `auth.users` deletes. A client
  insert policy would add a signed-out-then-signup race and a second write path for nothing.
- **`security definer` + empty `search_path`** on the trigger: it runs as the auth server inserting
  into `public.profiles`; fully-qualified references keep it injection-safe.
- **`phone` is nullable text** — format is the seller's problem at confirmation time, not a schema
  constraint (Cambodian numbers arrive with and without `+855`).

`app/types/database.ts` gains `ProfileRow` (type literal), the `profiles` entry, `Relationships: []`.

## Auth configuration

- **Email confirmation: OFF** (hosted project setting; local config default). Decision and cost
  accepted: without custom SMTP, confirmation emails are rate-limited to the point of being broken,
  and the seller phones every buyer to confirm a COD order anyway — the phone call is the real
  verification. Consequence: a theoretically fake email can register; it cannot receive an order
  without a phone that answers.
- Password rule: minimum 8 characters, validated in the UI (`t()` messages), not schema.
- Local dev: `supabase/config.toml` already serves auth on 54321 with `site_url` localhost:3000; no
  change expected (verify at task I1).

## Composables and pages

`app/composables/useCustomerAuth.ts` — mirrors [useAdminAuth.ts](../../app/composables/useAdminAuth.ts)
(throws on error; typed client; no admin allowlist):

- `user` (from `useSupabaseUser()`), `signUp(email, password)`, `signIn(email, password)`,
  `signOut()`
- `fetchProfile(): Promise<Profile | null>` — `select('id, display_name, phone')` (inline literal)
- `updateProfile({ displayName, phone })` — `update` on own row (RLS enforces ownership)
- `waitForUser()` — a bounded wait for the Nuxt module's **asynchronous** `useSupabaseUser` refresh
  after SIGNED_IN; `/login` and `/signup` await it before navigating into the guarded redirect.
  The first harness run proved the race is real, not theoretical: signup landed on
  `/login?redirect=/account` with a live session cookie because the guard read a still-empty user.

Pages (all strings via `t()`, en + km):

- `app/pages/login.vue` — mirrors `admin/login.vue` structure; honors `?redirect=`; on success
  navigates to the redirect target, or — when no usable redirect exists — to `/` once the profile
  has a display name, and to `/account` until then (that page is the onboarding that sets one;
  amended 2026-10-04 at owner request). A failed profile read keeps `/account`.
  **Redirect validation (open-redirect guard):** accept only same-site paths — value must start with
  a single `/` and must not start with `//` or `/\`; anything else falls back to the landing rule
  above.
- `app/pages/signup.vue` — email, password, confirm; links to `/login`; carries the compliance
  consent line ("By creating an account you agree to Terms and Privacy", links to both pages).
- `app/pages/account/index.vue` — shows email + editable display name/phone; sign-out; entry link to
  order history (page owned by `orders`); entry link to `/cart`.

`app/middleware/customer-auth.global.ts`:

- Guards `to.path.startsWith('/account') || to.path.startsWith('/checkout')`.
- Reads identity as `id || sub` — the documented trap is that SPA navigation re-places user state
  from JWT **claims**, which name the user `sub` (see the comment in
  [admin-auth.global.ts](../../app/middleware/admin-auth.global.ts)).
- Signed out → `navigateTo('/login?redirect=' + encodeURIComponent(to.fullPath))`.
- No DB query in the guard (unlike the admin one): a customer's authorization is purely "is there a
  session", and RLS protects every row regardless.

## i18n keys (new; both locales, inline in [i18n.config.ts](../../i18n.config.ts))

`account`, `myAccount`, `signUp`, `signUpTitle`, `createAccount`, `alreadyHaveAccount`, `noAccountYet`,
`displayName`, `phoneOptional`, `accountSaved`, `accountSaveError`, `accountLoadError`,
`passwordMin`, `passwordsDoNotMatch`, `signUpError`, `emailTaken`, `signOut`, `profile`,
`consentPrefix`, `consentTerms`, `consentPrivacy`, `continueToCheckout`, `loginRequired`,
`backToShop`. Exact wordings authored at task I3; none may collide with the strings
`scripts/verify-ui.mjs` matches literally (the `i18n.config.ts` comments list them).

## Harness extension (same commit as the pages, task I3)

Extends the existing `/auth/v1` interception (already used by the admin login fixtures) with signup
and session fixtures, then asserts:

- Signed-out visit to `/account` and `/checkout` lands on `/login` with a `redirect` param.
- Signup (stubbed success) ends on `/account` with the stub's email visible.
- Sign-out returns to the storefront with no session cookie.
- The account page saves display name + phone and issues exactly one `PATCH /rest/v1/profiles`
  with `id=eq.<uuid>` in the query.

## Success criteria

1. `supabase db reset` clean; RLS checklist recorded: anon `select` on `profiles` → 0 rows; own-row
   select/update → OK; update of another id → 0 rows changed; insert/delete as any role → denied.
2. A new signup produces a `profiles` row in the same transaction (trigger observable in local stack).
3. Harness checks above green; existing admin auth checks untouched and green.
4. Fast gates green on every commit; `bun run verify` green once before the module's G3 merge.
5. No admin path is reachable with a customer account (existing admin guard intact — regression run).

## Open questions

- Password reset / receipts email need custom SMTP (deferred; recovery path is contact-first).
- Signup abuse controls (Turnstile, rate limits) — revisit only if spam appears; Supabase applies
  built-in rate limits meanwhile.

---

## Amendment 2026-10-05 — identity v2: phone signup, Telegram login, login codes

Owner decisions this date: **instant phone signup without SMS** (the seller's delivery call remains
the real verification), **2-week login codes**, **30-day sessions**. This section supersedes v1 where
they disagree; everything above stands otherwise. Tasks:
[plans/004](../../plans/004-auth-identities-implementation-plan.md). Status: **approved** (owner, 2026-10-05) — implementation tracked in the tasks file above.

Objective in one sentence: **a buyer can create an account with their phone number in seconds, sign
back in without a password — by tapping a Telegram bot link or entering a saved code — and stays
signed in for weeks.**

### Capability 1 — phone signup and sign-in

Native Supabase phone auth is OTP-only and requires an SMS provider
([phone-login](https://supabase.com/docs/guides/auth/phone-login)); neither fits a zero-cost v1. The
chosen shape mirrors the v1 email decision — *the seller phones every buyer anyway* — so the account
is created instantly and **the delivery call is the number's proof of ownership**, not a code.
Recorded upgrade path if number disputes appear: native OTP (`signUp({phone})` +
`verifyOtp({type:'sms'})`, a provider, or a custom SMS hook to any Cambodian gateway).

- `POST /api/auth/phone/signup` `{ phone, password }` (service tier):
  1. normalize to E.164 — the shape Supabase requires for phone sign-in — from the spellings
     Cambodia actually produces: `0XXXXXXXX(X)`, `855…`, `+855…`, spaces/dashes stripped; pure
     helper + a unit table.
  2. `admin.createUser({ phone, password, phone_confirm: true, email: <synthetic>, email_confirm: true })`
  3. duplicate number → typed `PHONE_TAKEN`; the UI offers "sign in instead".
- Every v2 account also carries a **synthetic non-deliverable email** —
  `p<digits>@users.raccoongearbin.invalid` (phone) / `tg<id>@users.raccoongearbin.invalid`
  (Telegram) — because the one session-mint path (below) is email-flavored, and
  `generateLink(type:'magiclink')` only *generates*; it never sends
  ([doc](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)). `handle_new_user`
  is amended so these derive a null display name instead of the email's local part.
- Sign-in with phone: native client `signInWithPassword({ phone })` — no server, no SMS.
- `/signup` gains a phone mode beside email; `/login` gains a phone mode. Same password rule (min 8,
  UI-validated) and the same consent line.

### Capability 2 — Telegram login and connect

Chosen over the Login Widget on purpose: the bot deep-link flow needs **no domain binding** (works
from localhost/LAN/preview and on every device), reuses the existing @RGBin_Bot, and has no iframe.
(QR rendering for desktop is deferred; the t.me link opens web.telegram.org.)

Flow — login:

1. `/login` "Continue with Telegram" → `POST /api/auth/telegram/start` → `{ nonce, deepLink:
   https://t.me/RGBin_Bot?start=lg_<nonce>, expiresAt }`; a `telegram_login_requests` row, 10-min TTL.
2. The page opens the deep link and polls `POST /api/auth/telegram/poll` every 2 s (bounded).
3. Tapping Start in Telegram reaches `POST /api/telegram/webhook` on the deployed Worker — verify the
   `X-Telegram-Bot-Api-Secret-Token` header, mark confirmed with the Telegram identity, reply in the
   chat via a `telegram_send_message` RPC (the token stays in **Vault**; Postgres reads it and
   queues `net.http_post` itself — the same secret pg_net uses, and it never reaches the Worker).
   Only `/start lg_<nonce>` is acted on; every other update is a 200 no-op (the order push is
   outbound and unaffected).
4. The next poll finds-or-creates the user (`telegram_links.tg_id` lookup, else `admin.createUser` +
   link + `display_name` = Telegram first name) and mints the session; the request → consumed
   (single-use).

Flow — connect (existing account): `/account` "Connect Telegram" runs the same start/poll with
`mode:'link'` (session-checked); on confirmation the `telegram_links` row is inserted for the
signed-in user and no session is minted. Detach is deferred.

### Capability 3 — login codes

A bearer key for password-less login on a new device: **2 weeks** validity, one active code per user,
regenerate replaces, reusable within its window.

- Format: 12 chars, Crockford-style base32 (no I/L/O/U), shown grouped `XXXX-XXXX-XXXX` (~60 bits);
  stored only as a sha256 hex digest; input normalized (case, separators) before hashing;
  constant-time digest comparison (fixed-length, no early exit).
- `POST /api/auth/code/generate` (session-checked) → the plaintext returned **once**; the UI shows it
  with the existing copy affordance and "save it — it won't be shown again".
- `POST /api/auth/code/verify` `{ code }` → expiry → digest compare → success mints a session.
  **Amended at implementation (2026-10-05):** verification looks the code up by its digest, so a
  miss cannot be attributed to any particular row — the per-code "8 attempts" lock is not
  implementable and is dropped (the `attempts` column stays in the already-pushed schema,
  unused). The guards are ~60 bits of entropy plus a per-IP throttle (20/10 min).

### Session minting (the one mechanism, shared by 2 and 3)

Service tier: `admin.generateLink({ type: 'magiclink', email: <the account's email> })` → return
`properties.hashed_token` to the browser → client `verifyOtp({ token_hash, type: 'magiclink' })` sets
the real session (cookies handled by the module as today) → existing `waitForUser()` + landing rule.
Sources: [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink),
[verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp). Exact property name and
type value: implementation probes (see checklist).

### Session lifetime

The module's cookie carries the session client-side. **Verified in the installed sources during
implementation (2026-10-05):** `@supabase/ssr` rewrites the auth cookie's write `maxAge` to its own
400-day `DEFAULT_COOKIE_OPTIONS` on every set — the module's (or a user's) `maxAge` never binds the
session cookie — and Auth sessions last indefinitely by default server-side (refresh tokens;
[source](https://supabase.com/docs/guides/auth/sessions): "instruct the browser to always store the
cookies indefinitely"). The owner's intent (stay signed in for weeks) therefore holds with **no
config knob**; the v1 nuxt.config comment that claimed an 8 h cookie is corrected to record this
fact, and a hard ceiling, if ever wanted, is the Auth settings' time-box/inactivity controls, not a
cookie option.

### Server tier (second sanctioned surface)

New confined surface, same rules as payments' (that section is the precedent): routes `/api/auth/**`
and `/api/telegram/webhook`. `NUXT_SUPABASE_SERVICE_ROLE_KEY` and the new
`NUXT_TELEGRAM_WEBHOOK_SECRET` are **Worker runtime secrets** — empty-string defaults in
`runtimeConfig`, never inlined, never `runtimeConfig.public`, never logged; the service client is
constructed per-flight with `{ auth: { persistSession: false } }`. The payments P5 audit extends to
both values and to the built output. Rate limits: a small `auth_rate_limits` table + helper guards
the anonymous-facing routes (phone signup, telegram start, code verify) — the admin API does not
inherit GoTrue's own limits, so this surface carries its own.

### Schema — `supabase/migrations/<ts>_auth_identities.sql`

```sql
-- one Telegram account ↔ one auth user; service-tier writes only
create table public.telegram_links (
  tg_id bigint primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  tg_username text,
  created_at timestamptz not null default now()
);  -- RLS on, select-own policy only; no insert/update/delete policies

create table public.telegram_login_requests (
  nonce text primary key,
  user_id uuid references auth.users(id) on delete cascade,   -- link mode only
  status text not null default 'pending' check (status in ('pending','confirmed','consumed')),
  tg_id bigint, tg_username text, tg_first_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);  -- RLS on, no policies (service tier reaches it)

create table public.login_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);  -- RLS on, no policies

create table public.auth_rate_limits (
  key text primary key,          -- '<route>:<ip>'
  window_start timestamptz not null,
  count int not null default 0
);  -- RLS on, no policies
```

`handle_new_user()` amended: null display name when the email sits on the synthetic domain, else the
v1 `split_part` behaviour unchanged. `app/types/database.ts` gains the four row types (type literals,
`Relationships` mirroring these FKs — the AGENTS.md typing rules).

### UI · i18n · harness

- `/login`: mode switch (email | phone | code) + the Telegram button and its polling sheet (pending /
  expired / cancel / error). `/signup`: email | phone. `/account`: "Login code" card
  (generate → show-once → copy) and "Telegram" card (connect / connected @name). No new pages; the
  shared shells, card look and Khmer tracking rules stay; field errors reuse the checkout
  convention.
- i18n keys (en + km) authored at implementation; none may collide with harness-matched strings
  (the `i18n.config.ts` comment lists them).
- Harness: extend the existing fetch stubbing with `/api/auth/**` fixtures; checks: phone signup
  (stub) lands signed in; code login stub + wrong-code hint + attempt-lock copy; the Telegram sheet
  opens the deep link and pending→confirmed completes; the generated code shows once and is gone
  after reload; sign-out unchanged.

### Unit tests

`server/utils/auth.ts` stays dependency-free (the payway pattern): a normalizePhone table, code
generate/normalize/digest, nonce charset/length (must fit Telegram's 64-char start payload),
synthetic-email shapes — `bun test`, same location as the payway tests.

### Success criteria

1. Migration pushed clean; RLS probes: anon → 0 rows/denied on all four tables; profiles behaviour
   regression-probed unchanged.
2. Recorded live smoke on the deployed Worker: phone signup → place-order-capable session; real
   Telegram tap on a phone (fresh account AND connect-to-existing); code login from a second device;
   wrong code → hint; 9th attempt → locked; expired code → typed error; sign-out.
3. Harness fully green (new + existing); fast gates green on every commit; one `bun run verify`
   before the merge tag.
4. No secret value in the built bundle (audit output recorded); `ARCHITECTURE.md` carries this
   amendment in the same commit.

### Verify-at-implementation (UNVERIFIED until probed)

- `generateLink`'s response property name `properties.hashed_token` (public docs show the request
  shape only).
- `verifyOtp` accepts `token_hash` with `type: 'magiclink'` (the docs example shows `'email'`).
- `admin.createUser` accepts phone + email together with both `*_confirm` flags.
- GoTrue accepts the `.invalid` synthetic addresses.
- `@nuxtjs/supabase` v2 honours `cookieOptions.maxAge`; its server user helper is importable in
  server routes.
- Telegram header name and `setWebhook` fields — pin from the Bot API page when implementing.

### Deploy checklist (owner-gated; also the production DB cutover)

1. `supabase db push`. 2. Worker secrets: service role + the new webhook secret. 3. `bun run build &&
   bun run deploy` — **this deploy is also the production switch from RGB-db (Seoul) to RGB-DB-SG**.
4. `setWebhook` with the deployed URL + `secret_token`. 5. The live smoke list above, plus one real
   order to confirm the Telegram order push still delivers (shared bot, outbound path untouched).

### Open questions

- Identity merging (phone / email / Telegram are separate accounts in v1) — trigger: a buyer is
  visibly split across accounts.
- Telegram detach — v2. QR for desktop Telegram login — deferred.

## Amendment 2026-10-07 — admin mode is asked once per navigation (+ the doc says what the code does)

Status: **specified — awaiting your approval (this amendment's G0).** Module ids `admin-identity` and
`doc-truth`, indexed in [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Written against committed HEAD
`1f8dae5` with a clean tree, so every claim below cites code that is in history, not in a diff.

### Objective

1. **`admin-identity`** — the browser asks `/api/admin-check` once per navigation instead of once per
   component that wants to know. Authority is untouched: RLS + `requireAdmin` stay the boundary and
   `isAdminMode` stays a UI affordance, exactly as "the guard is UX, not security" says above.
2. **`doc-truth`** — four passages in [ARCHITECTURE.md](../../ARCHITECTURE.md) describe a system the
   committed code contradicts. AGENTS.md's order of trust makes the code the truth and requires the
   doc to move *in the same change*; that change is this one.

User story: an admin opens the desk and the storefront stops paying a round trip per view to learn a
boolean it already knows; a future agent reading ARCHITECTURE.md is not told that shipped work is parked.

### The defect, as measured (not as suspected)

Six sites ask the same question; only one of them is the guard:

| Site | Form | Cost today |
|---|---|---|
| [admin-auth.global.ts:22](../../app/middleware/admin-auth.global.ts) | inline `$fetch` — does **not** share the answer | 1 GET per `/admin/*` client nav |
| [index.vue:76](../../app/pages/index.vue) | `isAdmin()` on every mount + on `signedIn` change | 1 GET per storefront visit, signed in |
| [admin/login.vue:32](../../app/pages/admin/login.vue) | `isAdmin()` after a password sign-in | 1 GET, correct to ask |
| [admin/orders.vue:11](../../app/pages/admin/orders.vue) · [categories.vue:51](../../app/pages/admin/categories.vue) · [site-info.vue:57](../../app/pages/admin/site-info.vue) | `isAdmin()` in a `watch(user, …, { immediate: true })` | 1 GET per admin page **on top of the guard's** |

So an admin's `/admin/orders → /admin/categories` walk costs 4 GETs of one boolean, and the storefront
costs 1 per visit. The consequence already has a comment in the source: the badge's "known transient"
where the buyer branch runs before `isAdminMode` resolves
([index.vue:83-84](../../app/pages/index.vue)).

### Decisions (all of them, so implementation makes none)

- **D1 — carrier.** `useState<boolean | null>('admin-mode', () => null)`, owned by `useAdminAuth`
  alone. This is not a new idea: [`useSignedIn`](../../app/composables/useSignedIn.ts) already does
  exactly this shape for the *signed-in* seed (`useState('signed-in')`, per-request on the server, a
  plain ref across client navigations) and is the reason this needs no new module, file, or plugin.
- **D2 — only `true` is remembered.** *(Corrected during implementation, 2026-10-07: the version
  approved at the gate said "cache any resolved answer, both `true` and `false`", because
  [admin-check.get.ts:9](../../server/api/admin-check.get.ts) answers **200 `{ admin: false }`** for a
  signed-out caller. That caches a lie. The sequence, read off the shipped code:
  [index.vue:106](../../app/pages/index.vue) fires `refreshAdminMode()` on a `watch(signedIn, …,
  { immediate: true })` → a signed-out visitor asks and gets `false` → they SPA-navigate to
  `/admin/login` (same document, so the state survives) → sign in with real admin credentials →
  [login.vue:32](../../app/pages/admin/login.vue) `await isAdmin()` reads the cached `false` and prints
  "unauthorized" **to a legitimate admin**, until a hard reload. That is the primary door and
  `admin mode turns on` in the harness.)*
  So: cache a resolved `true`; a resolved `false` and any rejection are not stored. Cost: non-admin and
  signed-out traffic asks once per mount exactly as today — no saving, but no new failure mode either.
  The saving lands where the traffic actually is: the desk, and every surface after the answer is known.
- **D3 — invalidation is one line in the existing hook.** `markSignedOut()` clears `'admin-mode'`
  beside `'signed-in'`. Both sign-out paths already call it, which is precisely the bug class the
  harness caught once ("logout clears admin mode", [ARCHITECTURE.md:1163](../../ARCHITECTURE.md)).
  `index.vue`'s local `isAdminMode.value = false` stays — harmless, and it is the page's own ref.
- **D4 — the guard routes through `isAdmin()`** so its round trip becomes the one that answers for the
  page (2 GET → 1 per admin nav). Its server branch is untouched: it still returns after the cookie
  check, because membership is not readable there without crossing the tier (see Deferred).
- **D5 — the five `isAdmin()` call sites do not change.** Same name, same signature, same await.
  Expected diff: **3 files** — `useAdminAuth.ts`, `admin-auth.global.ts`, `useSignedIn.ts`.

### Code style (the whole behaviour, one snippet)

```ts
// useAdminAuth.ts — `true` is the only answer worth remembering: a cached `false` would outlive a
// sign-in and refuse a real admin at the login page. A rejected request is never stored either, so
// the existing fail-closed `catch` retries on the next ask, as it does today.
const adminMode = useState<boolean>('admin-mode', () => false)

const isAdmin = async () => {
  if (adminMode.value) return true
  try {
    adminMode.value = (await $fetch<{ admin: boolean }>('/api/admin-check')).admin
  } catch {
    return false
  }
  return adminMode.value
}
```

Comments follow the house style: they name *why* the line is load-bearing, and cite the measured fact
or the failure it prevents. No new i18n keys — nothing here is user-facing copy.

### Commands

```bash
bun run lint                                                # after every edit (~2 s)
bun run typecheck                                           # after every edit (~4 s, vue-tsc reads .vue templates)
bun run build                                               # after every edit (~7 s)
bun run test                                                # unchanged suite; must stay green (~0.2 s)
bun run verify                                              # ONCE, before claiming it works (~3 m 37 s, needs Chrome)
```

### Structure — files this touches

| File | Change |
|---|---|
| `app/composables/useAdminAuth.ts` | owns `useState('admin-mode')`; `isAdmin()` reads-or-asks per D1/D2 |
| `app/middleware/admin-auth.global.ts` | client branch calls `isAdmin()` instead of its own `$fetch` (D4) |
| `app/composables/useSignedIn.ts` | `markSignedOut()` also clears `'admin-mode'` (D3) |
| `scripts/verify-ui.mjs` | one check per acceptance item below, in the existing admin section |
| `ARCHITECTURE.md` | the four `doc-truth` edits below, **same commit** as the code (G3) |

No new file. No migration, no dependency, no CI change, no schema change.

### Testing strategy

Unit tests: **none added** — the logic is "read state, else fetch, store only on success", which is a
composable against Vue state and the network, not a pure rule. `tests/unit/*` stays as it is.

The harness is the right level, and it already records every request the browser makes
(`allW()` / `writes()`, [verify-ui.mjs:551](../../scripts/verify-ui.mjs)), including
`/api/admin-check`.

1. **The walk, bounded** — `walking the admin desk asks the gate at most once, never once per view`.
   `resetW()` before the desk's `Admin tools` click, then four client navigations between admin views,
   then a count of `/api/admin-check` that must be **≤ 1**. The bound is 1 rather than 0 because the
   answer may already be cached when the walk starts (the storefront's own mount asks once the session
   lands). Measured: **0** with the change, **4** with D4 reverted — which is the decisive half, since
   a guard that keeps its own copy pays it on every navigation.
2. **A refused answer is not remembered** *(pinned 2026-10-07, in the shape that needed no stub
   change)* — on `/admin/login` in one fresh document, submit twice against an unseeded session and
   assert the recorder shows **1 then 2** asks. This pins the D2 correction directly: an implementation
   that stores `false` answers the second submit from the cache and locks the door — and the sabotage
   run proved it, because with the gate-approved D2 the shipped checks `login lands back on the
   catalog` and `admin mode turns on` go red too. A rejection takes the same "do not store" branch, so
   the same assertion covers it; the transport-failure stub flag the plan first proposed is not needed.
3. **Regression, not new.** `login asked the admin gate and wrote no data`, `admin mode turns on` and
   `logout clears admin mode` stay green — the last one is the proof D3 is real.

### Boundaries

- **Always** — fast gates after each edit; one `bun run verify` before any "it works" claim; every
  doc sentence re-derived from a `file:line` in the tree, never copied from the old doc.
- **Ask first** — touching `app/middleware/*.global.ts` beyond D4 (it is on the
  [TOUCH_RESTRICTIONS](../../docs/rules/TOUCH_RESTRICTIONS.md) list of auto-imported surfaces);
  changing the stub's `__admin_session` shape in the harness; any edit to a pushed migration.
- **Never** — no browser read of `admin_users`, no `isAdmin` decision moved into clerk-js state
  (ARCHITECTURE.md's P6 note forbids it and the guard's comment names the race it caused), no broader
  Supabase/Neon client to "fix" a permission error, no `as any`, no cache written on a rejected request.

### `doc-truth` items — what to change and what it must say

| # | Where (HEAD `1f8dae5`) | Claim | Code says |
|---|---|---|---|
| T1 | [ARCHITECTURE.md:1149-1158](../../ARCHITECTURE.md) | "P2 (`server/utils/payway.ts`) is green and imported by nothing. P3–P5 (routes, **Pay-now UI**, sandbox E2E, secret audit) wait on G2" | Routes exist and are called: `/api/payments/payway/{create,verify,return,webhook}.post.ts`, from [payway-checkout.ts:10](../../app/utils/payway-checkout.ts), `useCheckout`'s `payNow`, `checkout/{index,success,pay-result}.vue`, `account/orders/[id].vue`. HEAD *is* the pay-now/pay-later commit. Rewrite as: live loop, plus what genuinely remains (secret audit, the production `G2` account) |
| T2 | [ARCHITECTURE.md:1221-1223](../../ARCHITECTURE.md) | the `/api/**` enumeration omits payments | add `/api/payments/**` |
| T3 | [ARCHITECTURE.md:109-110](../../ARCHITECTURE.md) | "the one page that still [holds a Supabase client] is `admin/login.vue`" | `grep useSupabaseClient` → two holders, neither a page: [useCatalog.ts:55](../../app/composables/useCatalog.ts) (storage URL builder, pending the plans/005 P3 R2 flip) and [useAdminProductEditor.ts:109](../../app/features/admin/composables/useAdminProductEditor.ts) (image upload). `admin/login.vue` holds none |
| T4 | [ARCHITECTURE.md:1159-1163](../../ARCHITECTURE.md) | "one gate and one client question" | true but incomplete: the question is asked six times. Extend with D1–D3 so nobody re-adds a per-page fetch, and record that the answer is per-navigation state, not a decision |

**Finding F1 (recorded, deliberately not in scope).** `mark_payment_refunded` is in the live schema
(`db/migrations/0001_schema.sql`) and typed in [database.ts:375](../../app/types/database.ts), and
SPEC-payments.md's acceptance criterion 5 requires the refund flow — but **no route and no admin
affordance calls it**. That is `payments` module work with an owner decision attached (is v1
portal-only by design, or is an admin refund button owed?), so it is *not* folded into `doc-truth`
quietly. Answer needed; until then T1's rewrite must say "the marker has no handle", not "refunds shipped".

### Success criteria

1. The whole desk walk — four client navigations between admin views — costs **at most one**
   `GET /api/admin-check`, measured **0** because the answer is already known by then. Before the
   change the same walk cost one per view.
2. The door still opens the way it does today: a visitor who arrived signed out, asked, and got `false`
   can sign in as an admin **in the same document** and is let in. (This is the criterion D2's
   correction exists for; it is the one that would fail if `false` were ever cached.)
3. A signed-out or non-admin caller still issues 1 per mount and is still redirected by the guard —
   unchanged behaviour, deliberately not optimised (see the `ponytail:` ceiling).
4. Sign-out clears the cached answer (harness check 3 green) and a rejected request is never cached
   (harness check 2 green).
5. No `app/**` file besides the three in the table changes; `git diff --stat` on the code half ≤ 3 files.
6. `lint` / `typecheck` / `build` / `test` green; `bun run verify` green **once** at the checkpoint.
7. T1–T4 corrected in the same commit as the code, each traceable to a `file:line`, and F1 either
   answered or written as an explicit gap — not left implying refunds work.

**Measured at implementation (full suite):** `bun run verify` → **527/527 checks passed**; the admin
slice alone 97/97. `lint` 0 errors (17 documented pre-existing warnings), `typecheck` exit 0, `build`
exit 0, `bun run test` 52 pass / 0 fail.

### Deferred, with the reason attached

- **SSR membership seed** (so `/admin/*` paints its real affordances server-side and the cold-load
  badge transient at `index.vue:83-84` dies). Two named blockers, neither invented: the read needs
  `appSql`, which is `server/` code, and an app-side global middleware importing it crosses the tier;
  and the harness's fetch stub is browser-level, so SSR reads leave it
  ([ARCHITECTURE.md:1226](../../ARCHITECTURE.md) keeps that note). A Nitro middleware seeding
  `event.context` would fix both but puts a Neon query on every signed-in SSR request. Trigger: a
  measured complaint about the desk's first paint.
- **Stale `false` after a grant.** Gone with the D2 correction: `false` is never stored, so a session
  granted mid-flight is recognised on its very next ask — no reload, and no `ponytail:` comment needed.
  The ceiling that *is* left: a non-admin re-asks per mount, which is today's cost. Keying the answer to
  the session id would remove it, and is the upgrade path if that traffic ever shows in a trace —
  deliberately not done here, because a cache whose key is a session re-invites the clerk-js-state
  decision this module's own note forbids.
- **Nothing else from Known gaps.** The `tel:` digit rule, `SearchDock`'s scroll-rule copy, the three
  headers, the ~80 harness sleeps, `bun run test` in CI, the R2 flip and the `categories: null` fixture
  are all real and all out of the two modules you approved.

### Open questions

1. F1: portal-only refunds (doc says so, RPC stays a door with no handle) or an admin refund button
   (then it is a `payments` amendment, not this one)?
2. Should the storefront's badge (`index.vue`) stop asking `isAdmin()` on every mount even when the
   answer is cached — i.e. keep the `watch`, or gate it on `signedIn` alone? Behaviour-preserving
   either way; I'd keep the watch as-is.
