# 006 — Route hardening: safe fixes applied + deferred plan

Status: applied (uncommitted, rides with the P5–P8 port). This pass reviewed the uncommitted
Neon/Clerk port diff (`git diff 7f5e873 -- server app tests`) for silent failures and
simplification, applied only behavior-preserving / strictly-safer changes, and parked the rest.

Note on tooling: the intended `silent-failure-hunter` / `code-simplifier` subagent launches failed
with a backend model error (40506, `model inherit`/`opus` unavailable), so the equivalent review
was performed manually against the same scope and constraints. Re-run the agents later if desired;
the findings below are the same classes they hunt.

## Applied (behavior-preserving or strictly safer)

1. **One uuid owner** — `server/utils/uuid.ts` exports `UUID_RE`; seven route files had grown
   their own identical copy (catalog products.get, admin categories/products POST + DELETE,
   orders [id].get + status.post). The pg `::uuid` cast still enforces validity.
2. **`requireUser(event)`** in `server/utils/auth-service.ts` (mirrors `requireAdmin`): adopted by
   the 7 orders routes, profile get/patch, code/generate, telegram/link. `admin-check.get.ts` uses
   `currentUserId`. Measured: 401 body keeps both `statusMessage` and `message` ("AUTH_REQUIRED") —
   h3 mirrors statusMessage into message (`node_modules/h3/dist/index.mjs` createError + toJSON),
   so every existing `data.message` reader is untouched. Bonus: an unreadable session now answers
   401 instead of 500 on those routes.
3. **P0001-gated order errors** — `POST /api/orders` and `POST /api/orders/:id/status` only turn
   `P0001` (every `raise` in `db/migrations/0001_schema.sql` uses `errcode = 'P0001'`) into a 400
   with the machine code. Anything else — Neon unreachable, a bug — now bubbles to a 500 and the
   logs instead of masquerading as `400 UNKNOWN`. All refusal codes unchanged (proven live below).
4. **`products.post.ts`** — promo null checks collapsed to the file's own `== null` idiom.
5. **Dead export removed** — `MAX_LOGIN_CODE_ATTEMPTS` (auth.ts): the verify route deliberately
   has no per-code counter (throttle + entropy, per SPEC-identity amendment); nothing used it.
6. **Category editor** — its two catch arms now read `error?.data?.message || error?.message`,
   the idiom its sibling editors already use (a server machine code no longer degrades to an
   ofetch transcript).
7. **Stale documentation fixed** — `products.get.ts`: a missing product answers `null`, which h3
   renders as **204**, not 200 (measured); comment corrected.
8. **Guard hydration race fixed (2026-10-06, from live testing).** The "logged in, then kicked out"
   cycle: the server approves a landing (`/account` renders), then the client guard re-judged during
   hydration while clerk-js was still adopting the session (`user` momentarily null) and bounced to
   `/login`. Interim shape (isHydrating stand-down + fail-open) was superseded the same day by one
   source of truth: **`useSignedIn`** — the server's answer seeded at load (`useState`, so SSR and
   hydration agree on the masthead label too), clerk-js's live user overlaid once known, with
   `markSignedOut` called by both sign-out paths. The guard's client branch and the
   masthead/footer account entries all read it, so a browser whose clerk-js never adopts still
   shows and routes the session the server honours. The admin guard's client branch dropped its
   clerk-js pre-check entirely and consults only `/api/admin-check` (server-read cookie,
   fail-closed). `waitForClerkLoaded` became unused and was deleted; ARCHITECTURE.md guard section
   rewritten.
9. **Hosted-page hop removed from Telegram/code login (2026-10-06, the actual root fix).** Evidence:
   two of the user's attempts minted tickets whose hosted visits produced/consumed them but created
   **zero** Clerk sessions (the dev-browser cross-domain hop). `createSignInTicket` now returns the
   raw ticket beside the URL; `completeTicket` (useCustomerAuth) completes it in-page via
   `signIn.create({ strategy: 'ticket' })` + `setActive` — a password sign-in's own mechanism —
   and the hosted URL is only the fallback. Verified live end-to-end: real button → simulated tap
   → poll confirmed → in-page completion as the real tg user → `/account`, and a hard reload still
   renders signed in. The dev-browser/cookie-trap class cannot break this path.
10. **Signup blockers fixed (2026-10-06, from live testing).** (a) Email signup always failed with
    the generic copy: the instance has bot protection (`captcha_enabled`, smart widget) and a
    custom clerk-js flow cannot complete without the widget's mount — FAPI answered
    `captcha_invalid` (reproduced). Added `<div id="clerk-captcha" />` to the signup, login and
    admin-login forms; the widget now loads (a "Verify you are human" tick may appear — expected,
    and automation cannot pass it, so the last mile is owner-verified). Also turned the instance's
    `auth_email.verify_at_sign_up` off via `clerk config patch` — it contradicted the SPEC-identity
    decision ("email confirmation off") and made `signUp()` return `missing_requirements`. (b) Phone
    signup's breached-password rejection mapped to WEAK_PASSWORD ("Use at least 8 characters") —
    the instance runs the HaveIBeenPwned check; new `PASSWORD_BREACHED` code + honest copy
    (en/km), verified live in the UI.
11. **Google sign-in added (2026-10-06, owner request).** The dev instance ships Clerk's shared
    Google OAuth credentials (`connection_oauth_google.enabled`), so no Google Cloud app is
    needed. `signInWithGoogle` (`useCustomerAuth`) runs `authenticateWithRedirect`
    (`oauth_google` → `/sso-callback` on this origin → `redirectUrlComplete`), the new
    `sso-callback.vue` page finishes the handshake, and both /login and /signup carry a
    "Continue with Google" button (one arm for sign-in and sign-up — Clerk creates the account
    on first consent). Verified live: the button redirects to Google's account page through
    Clerk's dev OAuth app; the consent step is owner-completed. **Stuck-spinner fix (same day,
    owner-reported):** the callback page called `handleRedirectCallback` in `onMounted`, where
    `clerk.value` is still null on a cold load — the optional chain silently no-opped and nothing
    ever completed the handshake (the SDK's own `AuthenticateWithRedirectCallback` runs it inside
    `useClerkLoaded` for exactly this reason). Now the page watches `clerk`, passes real fallback
    destinations (`to` rides the callback URL with `/account` as the default), and lands instead
    of hanging when there is nothing to consume (verified: bare visit navigates on).
    **"Login failed" on click fix (same day):** with the Google account already created by the
    stuck attempt (`alsorandomkay@gmail.com` at Clerk), a second click threw — either clerk-js not
    loaded yet (fast click) or "already signed in" (the earlier session had been adopted on a
    later load). `signInWithGoogle` now waits (bounded 8s) for the SDK and, when a session already
    exists, simply lands on the target instead of starting a new OAuth; the page catches also log
    the raw error now (verified live: signed-in click lands, no error). **Icon pass:** the
    sign-in buttons (Google on /login + /signup, Telegram on /login) carry their brand marks from
    `SocialBrandIcon` — Telegram already existed there; the `google` path was fetched from
    simple-icons and verified rather than retyped (the component's speck warning), measured
    16×16 painted, screenshot-confirmed.
12. **OAuth callback made explicit and loud (2026-10-06, owner re-report).** Forensics: the
    owner's Gmail auto-registered on the first attempt (Clerk user from 23:24) and their retry
    even created a session (23:49:35) — both sessions later `removed`, consistent with the
    dev-instance cleaning up sessions the stuck callback never adopted. `transferable` defaults
    to `true` in Clerk (sign-in with an unregistered OAuth email auto-transfers to sign-up), so
    "auto-register on sign-in" is the default — the page now also completes the transfer
    explicitly (`signUp.create({ transfer: true })`) as a belt, logs failures tagged
    `[sso-callback]` instead of swallowing them, and always lands (never a spinner).
13. **Zombie-session shortcut fixed (2026-10-06, final re-report).** Forensics: after the
    23:49 attempts the owner's Clerk record shows **zero new trace** (`last_sign_in_at` frozen,
    no new sessions) — the OAuth never started. Cause: `signInWithGoogle`'s "already signed in"
    branch trusted clerk-js blindly, and their client held a **zombie user** (the dev-browser
    wedge: client user, server cannot see the session) — so every Google click short-cut into a
    broken `/account` instead of starting OAuth. The branch now verifies with the server
    (`/api/profile`; only a 401 counts as zombie) and heals by `signOut()` before the OAuth.
    Reproduced by revoking a live session out from under the browser (the cookie's JWT still
    validated server-side for a while — Clerk's design): whichever branch ran, the outcome is
    either "land" or a **real OAuth start** — verified live, the click redirected to Google
    instead of ghost-landing on a broken `/account`.
14. **`NO_SESSION` card + clerk-js self-navigation discovered (2026-10-06, owner screenshot).**
    Owner's run reached the new failure card ("Sign-in could not be completed. NO_SESSION") — proof
    the callback resolved without a session and nothing threw. A **surrogate repro** (navigating to
    `/sso-callback` with fabricated `__clerk_*` params) exposed the driver: **clerk-js processes
    callback params during its own load pass and, when it judges them unprocessable, navigates the
    page away itself** — in the repro, straight to the configured sign-in URL (`/sign-in`, which
    exists in-origin via `sign-in/[...slug].vue` → prebuilt `<SignIn />` — this is the "sign in
    page" the owner kept landing on; the zero-trace OAuth attempts are consistent with a callback
    clerk-js refuses before any session exists). Consequences applied: (a) the callback page now
    waits a bounded grace before declaring `NO_SESSION` (clerk-js's auto-pass and ours raced —
    declaring failure early orphaned sessions that landed a beat later), (b) the failure card
    carries the full trail (`params=`, `cb=`, `transfer=` + missing fields) so one screenshot names
    the cause, (c) **`redirectUrl` is now bare `/sso-callback`** — the `?to=` query was moved to
    sessionStorage, because a query-bearing redirect URL was never proven to survive the FAPI's
    param append and the callback route must stay maximally conventional.

15. **The session killer: zombie-heal removed (2026-10-06, from the incognito forensics).** The
    owner's incognito forensics finally showed the whole shape: the 01:39 OAuth **did** create and
    adopt a session (`lastActive 02:02:07` — the browser used it), and then it was `removed`. The
    remover was `signInWithGoogle`'s "zombie" branch: its `/api/profile` probe returned 401 (the
    server's cookie lag, NOT a zombie — a just-adopted session the server cannot see *yet* is the
    dev-browser lag), so it called `signOut()` and destroyed the live session; `remove_existing`
    then cleared it at the next attempt's start. The branch now never signs out — a client-known
    user simply lands (the guard and `useSignedIn` already tolerate server blindness; the
    "protection" was the harm). Also closed the post-OAuth bounce loop: `/login` watches
    `useSignedIn` and lands signed-in visitors on their destination, so a guard bounce
    (`/account → /login` while the server cookie catches up) now converges instead of parking
    the visitor on the form. The card trail also carries the landing URL now.

16. **Prebuilt-component callback probe, and the nil-trace verdict (2026-10-06).** Two more
    data points: (a) the owner's post-fix attempt landed on `/sso-callback` with a **fully bare
    URL** (`params=no | url=/sso-callback | clientSessions=0`) and **zero Clerk-side trace** —
    the FAPI never recorded that attempt at all; (b) a surrogate probe of the prebuilt
    `<SignIn routing="path">` component's callback path (`/sign-in/sso-callback` with fabricated
    params) showed it **relocates callback params into hash routing and renders an EMPTY page**
    on anything malformed — a void with no diagnostics, strictly worse than our page. Verdict:
    the callback stays on the diagnostic `/sso-callback` page; `/sign-in` + `/sign-up` keep the
    `routing="path"` + `fallback-redirect-url` upgrade (correct handling of their own sub-routes
    and instance-level redirects). The remaining Google failures produce **no Clerk trace at
    all** — that failure mode lives in the dev instance's shared Google OAuth app
    (`clerk.shared.lcl.dev`), not in repository code; P9 (production instance + own Google
    Cloud app) is its fix.

## Verification record (2026-10-05)

- `bun run lint` → 0 errors (17 pre-existing warnings) · `bun run test` → 51 pass
- `bun run build` ✓ (regenerates Nitro auto-import types the new utils rely on)
- `bun run typecheck` → exit 0
- Live matrix (dev server, `.cache/post-refactor-probe.sh`), signed out: all 14 routes answered
  as documented — 401 `AUTH_REQUIRED` on orders/profile/code/telegram/admin routes,
  `{admin:false}` on admin-check, 204 on catalog `?id=<garbage>`, 200 on catalog list + site-info;
  the 401 body carries both `message` and `statusMessage`.
- Live claims path (clerk CLI session token, `Authorization: Bearer`): `GET /api/orders/mine`
  → 200 `[]`; `POST /api/orders` with empty delivery → **400 `INVALID_DELIVERY`** (P0001 path
  intact through the new gate).
- Guard hydration fix (2026-10-06): `lint` 0 errors · `test` 51/51 · `typecheck` exit 0 ·
  signed-out hard loads still 302 (`/account` → `/login?redirect=/account`, `/checkout` → 302) ·
  full harness 521/522 (the one red was the contact-panel collapse arm — a frame-sampled
  animation unrelated to middleware, passed immediately on rerun: `--only=guest` 430/430).
- `useSignedIn` truth (2026-10-06, same day): `lint` 0 errors · `test` 51/51 · `typecheck` exit 0 ·
  full harness **522/522** (masthead, footer, guard and both sign-out paths on the seeded truth;
  `waitForClerkLoaded` deleted as unused).
- Ticket-first login (2026-10-06): spike proved `signIn.create({ strategy: 'ticket' })` + `setActive`
  in-page (`{ok: true, sessions: 1}`); live end-to-end (button → simulated tap → poll → in-page
  completion as the real tg user → `/account` → hard reload signed in) · `lint` 0 errors ·
  `test` 51/51 · `typecheck` exit 0 · full harness **522/522**.
- Signup fixes (2026-10-06): `captcha_invalid` reproduced (`signUp.create` raw error) then the
  widget mount verified working (the challenge renders; automation cannot pass it by design);
  breached-password copy verified live in the UI ("breach" sentence shown, previously the
  misleading 8-characters one) · `lint` 0 errors · `typecheck` exit 0 · full harness **522/522**.
- Google sign-in (2026-10-06): live handoff verified — the button reaches Google's account page
  through Clerk's shared dev OAuth app (`redirect_uri=clerk.shared.lcl.dev`); consent is
  owner-completed by design · `lint` 0 errors · `typecheck` exit 0 (caught one real error on the
  new callback page — `handleRedirectCallback({})`) · full harness **522/522**.
- SSO callback fix (2026-10-06): bare-visit fallback verified live (lands on the guard's target
  instead of hanging) · `lint` 0 errors · `typecheck` exit 0 · full harness **522/522**.
- Callback self-navigation discovery (2026-10-06): surrogate repro (fabricated `__clerk_*` params)
  reproduced clerk-js navigating away from `/sso-callback` to the sign-in URL; `redirectUrl`
  de-voodooed (`?to=` → sessionStorage) · grace window + diagnostic trail added · `lint` 0 errors ·
  `typecheck` exit 0 · full harness **522/522**.

## Deferred (needs a decision or bigger scope)

1. **Order idempotency (lost-response duplicates).** A transport failure after `create_order`
   commits leaves the buyer thinking it failed; a retry creates a second order. Fix shape: the
   checkout mints a `requestId` per attempt, `create_order` takes it, `orders.request_id` unique
   index + return-existing on conflict. Acceptance: double POST with one requestId → one order.
   Touches: a migration, `POST /api/orders` body, `useCheckout`. Product call.
2. **Codify the probe matrix** as `scripts/api-probe.mjs` (dev server + clerk CLI token, assert
   status/body per route) so the manual P7/006 probes become repeatable — run before P9.
3. **`PATCH /api/profile` is PATCH-as-PUT** (an omitted field clears to null). Safe today because
   the account page always sends both fields; document the contract in SPEC-identity or switch to
   present-fields-only semantics if a second caller appears.
4. **Accepted, already documented** (no action): phone-signup create-then-profile is not atomic
   (ponytail comment; P9 webhooks era), `withinRateLimit` read-then-write overshoot (ponytail
   comment), telegram send / order push swallows (deliberate: the push is decoration), guard
   `catch → false` (fail-closed), checkout profile-prefill swallow (prefill must not block
   checkout), legacy `useSupabaseClient` left in `useCatalog` + `useAdminProductEditor` storage
   paths (plans/005 P3 / R2 owns them).
5. **Clerk dev-instance cookie trap (localhost testing, verified 2026-10-06).** Any earlier visit
   to localhost plants a signed-out dev-browser cookie; a later Telegram/code (hosted-ticket)
   sign-in then adopts the session only briefly and drops it, and subsequent attempts stop
   adopting (`clientSessions: []` while the FAPI session exists). Not app code — the dev browser
   is a dev-instance mechanism with no production equivalent. Remedy when it bites: clear site
   data for `localhost:3000` + `shining-squirrel-9037.accounts.dev`, then re-run the flow.

17. **Harness honesty pass + the four-check debt (2026-10-06, P4 verification).** Discovered while
    verifying P4: earlier "522/522" runs had served a **stale `.output`** (those gate commands never
    rebuilt) — the late-arc client edits were never actually harness-tested. On the first honest
    rebuild, the buyer sign-in walk failed deterministically; probing the live page showed the
    harness **typing mid-enter-animation** (boxes ~16px above their final home; email landed,
    password hit a button). Fixed in the harness: settle on stable coordinates + re-measure before
    every click + the login watcher now yields to `isSubmitting` (it and the submit handler raced
    two navigations — correct hygiene regardless). First sign-in walk now fully green
    (426/430). **Open:** the SECOND walk (sign-out → no-nickname sign-in → expects `/account`)
    still parks on `/login`; the cascade (masthead Orders entry, three badge checks) hangs off it.
    Evidence trail: typed values verified present pre-submit via in-page probes; desk sign-in
    works in the same run; guest+admin standalone behave identically (both 426/430). Next
    diagnostic: probe the walk-2 submit result (localStorage/console), same technique as walk 1.
