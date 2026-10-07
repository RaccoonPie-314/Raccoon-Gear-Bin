# 007 — Admin mode is asked once per navigation + ARCHITECTURE.md truth pass

Status: **applied, uncommitted (rides the tree per repo convention).** Every task below is done and
`bun run verify` is green at **527/527**. One design decision changed on the way — D2, see the note at
the bottom; the spec carries the corrected version.

Original gate record: spec
[SPEC-identity.md → Amendment 2026-10-07](../specs/ecommerce/SPEC-identity.md) (approved this session);
module ids `admin-identity` and `doc-truth` indexed in
[CAPABILITY-MAP.md → Hardening amendments](../specs/ecommerce/CAPABILITY-MAP.md).
Baseline: `feat/ecommerce-impl` @ `1f8dae5`, clean tree. Defaults taken on the spec's two open
questions: **F1 = portal-only, documented as a door with no handle** (no refund button in this change),
**D2 = `false` is cached** (a mid-session grant costs one hard reload).

Severity: small, behaviour-preserving for every permission decision. Nothing here can widen or narrow
what a caller may read — that stays RLS + `requireAdmin`.

Files (whole change): `app/composables/useAdminAuth.ts`, `app/composables/useSignedIn.ts`,
`app/middleware/admin-auth.global.ts`, `scripts/verify-ui.mjs`, `ARCHITECTURE.md`.

## Rules this touches (read before editing, per AGENTS.md)

- [TOUCH_RESTRICTIONS.md](../docs/rules/TOUCH_RESTRICTIONS.md) — `app/middleware/*.global.ts` is a
  surface invisible to the compiler. T3's edit is the *only* licensed change there; the server branch
  and the redirect stay byte-identical.
- [TESTING_SPECS.md](../docs/rules/TESTING_SPECS.md) — the harness is the evidence, and its
  `N/M checks` print is the count of record. No new unit tests for this change (the spec says why).
- `bun run verify` is 95 % of the loop: iterate on `--only=admin` (the guest slice is 86 % of the run
  and is independent), run the **full** suite exactly once at the checkpoint.

## Order and dependency

T1 → T2 → T3 → T4 → T5 → T6. T1/T2 are one logical change; T3 is what makes the saving real; T4 is the
only new assertion; T5 is the doc half and must ride in the **same commit** as T1–T3 (G3).

## Tasks

- [x] **T1 — `useAdminAuth` owns the answer** (`admin-identity`, D1/D2)
  - Own `useState('admin-mode', () => false)`; `isAdmin()` short-circuits on a cached `true`, otherwise
    asks once and stores the answer **only when it is `true`** (see the D2 note below — the approved
    version stored `false` too and locked the door). Keep the existing `catch { return false }`.
  - Acceptance: `index.vue` + the three admin pages + `admin/login.vue` are untouched and still compile
    (same name, same signature, still awaited).
  - Verify: `bun run lint && bun run typecheck && bun run build && bun run test`.
  - Files: `app/composables/useAdminAuth.ts`.

- [x] **T2 — sign-out clears it** (D3)
  - One line in the existing `markSignedOut()` beside `useState('signed-in')`.
  - Acceptance: both sign-out paths invalidate without naming the new key (that is the point of reusing
    the hook). `index.vue`'s local `isAdminMode.value = false` stays.
  - Verify: `--only=admin` → `logout clears admin mode` green (it was the check that caught a real
    version of this bug).
  - Files: `app/composables/useSignedIn.ts`.

- [x] **T3 — the guard stops keeping its own copy** (D4)
  - In the **client branch only**, replace the inline `$fetch` with `useAdminAuth().isAdmin()`, called
    after the `import.meta.server` early return so nothing clerk-shaped is constructed during SSR.
  - Acceptance: admin nav `/admin/orders → /admin/categories` issues 0 additional `GET /api/admin-check`;
    a non-admin is still redirected to `/admin/login`; the fail-closed catch is unchanged.
  - Verify: T4's assertion (below) + `logout clears admin mode` + `guest sees no admin affordance`.
  - Files: `app/middleware/admin-auth.global.ts`.

- [x] **T4 — the count assertion** (harness)
  - In the admin slice: `resetW()` before the desk's `Admin tools` click, then four client navigations
    between admin views, then assert `/api/admin-check` was asked **≤ 1** time in the whole window.
  - Plus the D2 pin, at the top of the slice: two submits on one fresh `/admin/login` document against
    an unseeded session, counted 1 then 2.
  - **Trap that reshaped the bound:** the walk was expected to cost 1 question and measured 0 — the
    storefront's mount already asked after the login, so the guard needed nothing. Assert *growth over a
    walk*, never an absolute count for a document, and never a total that a hard load legitimately resets.
  - Acceptance: both checks fail on a reverted implementation — proven by two sabotage runs, recorded
    in the "What changed after the gate" section below.
  - Files: `scripts/verify-ui.mjs`.

- [x] **T5 — `doc-truth` edits T1–T4**
  - Per the spec's table: payments is a **live loop** not "imported by nothing" (and say plainly that
    `mark_payment_refunded` has **no caller** — the marker is a door with no handle); add
    `/api/payments/**` to the `/api/**` enumeration; replace "the one page that still holds a Supabase
    client is `admin/login.vue`" with the two real holders (`useCatalog.ts` URL builder pending the
    plans/005 P3 R2 flip, `useAdminProductEditor.ts` upload); extend the "one gate, one client question"
    invariant with D1–D3 so nobody re-adds a per-page fetch.
  - Acceptance: every changed sentence traceable to a `file:line` at this commit; no sentence copied from
    the doc it replaces.
  - Files: `ARCHITECTURE.md`.

- [x] **T6 — checkpoint**
  - Fast gates, full `bun run verify` once, record the `N/M` line. Commit shape per
    [GIT_CONVENTIONS.md](../docs/rules/GIT_CONVENTIONS.md): one commit, `fix(admin)` or
    `perf(admin)` for T1–T4 + `docs` for T5 in the same commit (G3 requires it), staged by scope.
  - No deploy. This rides the next `feat/ecommerce-impl` → `main` merge.

## Deviation taken (resolved: pinned, and cheaper than proposed)

The plan proposed skipping the permanent check on "a rejected `admin-check` is retried". You said pin
it — and the pin turned out to need **no stub flag at all**, because the interesting property is
"a refused answer is not remembered", which a real `false` from the route demonstrates on its own. Two
submits on one fresh document, counted from the recorder. Shipped as
`a refused gate is not remembered — the second attempt asks again`.

## What changed after the gate: D2 was wrong

The approved D2 said "cache any resolved answer, `true` and `false` alike" — the route answers
200 `{ admin: false }` for a signed-out caller, so that looked authoritative. It is not, and the
sequence is in the code today: `index.vue:106` asks on a `watch(signedIn, …, { immediate: true })`, so a
visitor who arrived signed out stores `false`, SPA-navigates to `/admin/login` in the same document,
signs in for real, and `login.vue:32`'s `await isAdmin()` hands back the stale `false`.

**Proven, not argued.** The sabotage run held the gate-approved D2 and printed:

```
FAIL  a refused gate is not remembered — the second attempt asks again  ::  ["GET /api/admin-check"]
FAIL  login lands back on the catalog
FAIL  admin mode turns on
```

i.e. the new check catches it *and* the shipped admin login really does lock. So `true` alone is
stored. Side effects, all in the good direction: the D1 cache is simpler (a boolean, no tri-state), the
"stale `false` after a grant" deferral disappeared entirely, and non-admin traffic keeps today's cost.

The other sabotage run proves the walk check's teeth (D4 reverted):

```
FAIL  walking the admin desk asks the gate at most once, never once per view
      ::  ["GET /api/admin-check", …, "GET /api/admin-check", …, "GET /api/admin-check", …, "GET /api/admin-check", …]
96/97 checks passed
```

One criterion was corrected by measurement rather than sabotage: the walk was expected to cost **1**
gate question and measured **0**, because the storefront's mount already asked after the login. The
bound is `<= 1` — 1 for a cold cache, 0 for the walk this run actually performs, 4 for either revert.

## Result

- Full harness: **527/527 checks passed** (three of them new). Admin slice alone: 97/97, green twice
  in a row before the count assertion was tightened.
- `lint` 0 errors · `typecheck` exit 0 · `build` exit 0 · `bun run test` 52 pass / 0 fail.
- Code diff: `app/composables/useAdminAuth.ts`, `app/composables/useSignedIn.ts`,
  `app/middleware/admin-auth.global.ts`. Doc/spec/harness: `ARCHITECTURE.md`, this file,
  `specs/ecommerce/{SPEC-identity,CAPABILITY-MAP}.md`, `scripts/verify-ui.mjs`.
- Not committed, not deployed — say JCP or CPC when you want it landed.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | A cached `false` from the guard suppresses admin affordances for a session granted mid-flight | **Resolved before it shipped** — the D2 correction means `false` is never stored, so a mid-session grant is recognised on its next ask. See the section below for the sabotage that proves the old design locked the login |
| R2 | `useAdminAuth()` in middleware constructs clerk composables in SSR | Call site sits *after* the `import.meta.server` return; `build` + `--only=admin` both load `/admin/login` cold |
| R3 | T4 asserts on painted DOM instead of recorded traffic and passes by idleness | It asserts the recorder's growth, not an element; and it is hand-broken against a reverted T3 before it is trusted |
| R4 | The harness stub answers `admin-check` from `__admin_session` + the cookie, so it can hide a real-server regression | Same as today — this change moves *when* we ask, not what the answer means. `requireAdmin` still guards every write; the desk's write checks are untouched |
