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
