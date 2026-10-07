# 010 — review hardening: headers, throttles, deploy guard, money-path logging, doc truth

Status: **applied, uncommitted** (2026-10-07, same session as the review). All seven changes
landed; measured results are at the bottom. Source: whole-project review 2026-10-07 (this working tree).
Review findings map to changes below (S = security, I = infra, P = performance, St = state):

| Review | Change |
|---|---|
| S1 | C1 — baseline security headers + a harness assert |
| S2 | C2 — throttle order create, PayWay create, and the unauthenticated verify branch |
| I2 | C3 — log PayWay amount mismatches at the one door |
| I1 | C4 — refuse to deploy a non-Workers `.output` |
| I3 | C5 — doc-truth batch (`NUXT_DATABASE_URL`, stale comments, dead env keys) |
| P2 | C6 — checkout `load()` stops serialising two independent reads |
| St1 | C7 — cart hydration surface (repro-gated: fix only if it reproduces) |

## Why

The review found no Critical issues — the RLS/claims-path model, webhook HMACs and secret
confinement verified sound. What it found is operational: the app ships no security headers, the
rate limiter that already exists is not wired to the three money-path entry points, a tamper signal
(amount mismatch) vanishes without a log line, and nothing stops `wrangler deploy` from uploading
the node-server `.output` the local loop leaves on disk. C6/C7 are the cheap P1 leftovers.

## Changes and acceptance

### C1 — Baseline security headers

`nuxt.config.ts`, a new root-level `routeRules` beside the `nitro` block (nitro applies it to SSR
documents and `/api/**` — assert both):

```ts
routeRules: {
  '/**': {
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000'
    }
  }
},
```

- HSTS is inert on `workers.dev` and correct the day a custom domain lands — keep it.
- **CSP is deliberately not here.** It needs an allowlist study (Clerk's CDN script, Nuxt's inline
  payload) and a report-only rollout; a wrong CSP breaks auth silently in production. Own change.
- Static assets served by the CF ASSETS layer bypass the Worker and keep platform defaults — noted,
  accepted (they are same-origin images/fonts with correct types).

`scripts/verify-ui.mjs`: one new check, **no CDP** — a plain Node `fetch(appUrl)` before the browser
work, asserting all four headers on the document response. (Do **not** fetch an `/api` path from
Node: the harness runs without a database and the stub lives in the browser.) Name:
`the document response carries the baseline security headers`.

Acceptance: `curl -sI http://127.0.0.1:3000/` and `curl -sI .../api/catalog/products` both show the
four headers with the dev server running (nitro emits routeRules in dev too); the new harness check
passes in `bun run verify`.

### C2 — Throttle the money-path writes

Reuse `withinRateLimit` (`server/utils/auth-service.ts` — auto-imported in `server/` like the other
utils), mirroring `code/verify.post.ts`'s shape: `if (!await withinRateLimit(sql, key, limit, window)) throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })`.

| Route | Key | Limit/window | Placement |
|---|---|---|---|
| `server/api/orders/index.post.ts` | `orders-create:${userId}` | 10 / 60 s | after `requireUser`, **before** the profiles bootstrap (move `const sql` up) |
| `server/api/payments/payway/create.post.ts` | `payway-create:${userId}` | 5 / 60 s | after the `UUID_RE` shape check, **before** the first `userTx` |
| `server/api/payments/payway/verify.post.ts` | `payway-verify:${tranId}` | 60 / 60 s | inside the tranId branch, **after** the payments row exists, **before** `check(tranId)` |

Numbers, why: 10 orders/min is far above any buyer; 5 PayWay creates/min covers placement + retry +
order-detail pay; **60/60 per tran, not per IP** — the pay-result page polls the tranId branch
(2 s × 30 s ≈ 15 calls) and Cambodian CGNAT would make an IP bucket punish strangers. Each create
mints one tran, and create is itself throttled, so per-tran is the honest amplifier cap. Shape-invalid
input (400) is rejected before the limiter — cheap checks shouldn't consume quota.

Acceptance: with a dev session token (the CLI-mint method already used for curl checks), 12 ×
`POST /api/orders` → requests 11–12 answer 429 `THROTTLED`; same for 7 × payway create with a
well-formed uuid; a fresh `pay-result` poll sequence never 429s.

### C3 — Log the amount mismatch at the one door

`server/utils/payway.ts`, the mismatch branch (`:240-243`) gains one line before `markPayment`:

```ts
console.warn('[payway] amount-mismatch', { tranId: result.tranId, orderTotal: total, paidAmount: result.amount })
```

All four call sites (verify ×2, return, webhook) route through `applyPaywayResult`, so the one door
covers them. `tests/unit/payway.test.ts` — the existing `an amount mismatch marks the attempt failed
and never the order` test gains a `spyOn(console, 'warn')` assertion (fires on mismatch, stays quiet
on `paid`). Not logged: `declined`/`cancelled` (buyer-normal volume) and `unknown-tran` (already
warned in the webhook). No secrets or payloads in the log line.

Acceptance: `bun run test` shows the spy assertions pass; a tampered verify against sandbox shows one
`[payway] amount-mismatch` line in `wrangler tail` (live check; the unit test is the CI gate).

### C4 — Deploy guard

New `scripts/check-deploy-preset.mjs` (~12 lines, header comment explaining the trap):

```js
import { readFileSync } from 'node:fs'
const { preset } = JSON.parse(readFileSync('.output/nitro.json', 'utf8'))
if (preset !== 'cloudflare_module') { console.error(`[deploy] refusing: .output preset is "${preset}" — run \`bun run deploy\`, not \`wrangler deploy\` directly`); process.exit(1) }
```

`package.json` deploy script becomes
`NITRO_PRESET=cloudflare_module nuxt build && node scripts/check-deploy-preset.mjs && bunx wrangler deploy`.
Residual risk is documented, not automated: a deliberate raw `wrangler deploy` still bypasses the
script (wrangler has no pre-deploy hook) — one comment line in `wrangler.jsonc` says deploy only via
`bun run deploy`.

Acceptance: against the current node-server `.output` the script exits 1 with the message; after
`NITRO_PRESET=cloudflare_module nuxt build` it exits 0. (Stop the dev server first — trap 11.)

### C5 — Doc truth batch (drift found by the review, all zero-risk)

| File | Fix |
|---|---|
| `ARCHITECTURE.md:1117` | `DATABASE_URL` → `NUXT_DATABASE_URL` in the Worker secrets list (the runtime reads `NUXT_DATABASE_URL`; following the doc today 500s every DB route) |
| `ARCHITECTURE.md:1183` + `app/composables/useAdminAuth.ts:23` | "Only `true` is stored" → the true sentence: `false` is stored but never trusted (only a truthy value short-circuits; rejections stay uncached) |
| `server/utils/payway.ts:9`, `:200-201` | drop the stale "typed Supabase client" wiring comments (it is `appSql` + `storeFor` now) |
| `.env.example` | remove `SUPABASE_SERVICE_ROLE_KEY` (the runtime deliberately kills it via the `secretKey: ''` pin) and `NEON_API_KEY` (read by no code); add the one-line comment distinguishing `DATABASE_URL` (migrator scripts) from `NUXT_DATABASE_URL` (runtime) |
| local `.env` | the two `NUXT_PUBLIC_CLERK_SIGN_IN_URL` / `SIGN_UP_URL` keys are inert (`@clerk/nuxt` reads `options.signInUrl` from module config, no env mapping — grepped 2026-10-07); drop them locally, document nothing |

Acceptance: `rg 'DATABASE_URL' ARCHITECTURE.md` no longer names the wrong secret; `rg 'NEON_API_KEY|SUPABASE_SERVICE_ROLE_KEY' .env.example` is empty; `bun run lint`/`typecheck` unchanged.

### C6 — Checkout `load()` parallelises (P1)

`app/composables/useCheckout.ts:101-104` — two independent reads in series:

```ts
const [profile] = await Promise.all([
  fetchProfile().catch(() => null),
  fetchProducts()
])
```

(`fetchProducts` rejecting still lands in the outer catch → `loadError`; the profile keeps its
auxiliary-failure policy.) Acceptance: a network trace of `/checkout` shows `/api/profile` starting
with `/api/catalog/products`, not after it; `bun run verify --only=guest` green (checkout flow).

### C7 — Cart hydration surface (repro-gated, P1)

Reproduce first: with the dev server, add a product to the guest cart, hard-reload `/cart` and
`/checkout` with the console open — `useCart`'s bind block runs `load()` in the first caller's setup
(`app/composables/useCart.ts:52-60`) while SSR rendered the empty branch; the badge dodges via its
mounted gate, the cart list does not. **If the mismatch (warning or visible flash) reproduces:**
defer only the first `load()` into `onMounted` inside the bind block (the merge stays sync — it
touches storage keys, not reactive state; the watcher is unchanged). **If it does not reproduce:**
no code change, record the observation in this plan and move on. Acceptance: console clean on hard
load with a pre-seeded cart, list renders the stored lines, and the existing cart checks in
`bun run verify` stay green.

**Outcome (2026-10-07): not reproduced — no code change.** Hard-loading `/cart` on the dev server
with a seeded guest cart gives a clean console (no hydration warning) and the stored line renders
after mount. Reason: `isLoading` starts `true` on both sides, so SSR and hydration both paint the
skeleton branch (`cart.vue` renders the list only under `!isLoading && …`) — the localStorage seed
never reaches the hydrated DOM. `/checkout` sits behind the customer guard (302 when signed out) and
shares the same gate.

## Order and verification

Work order: C1 → C2 → C3 → C4 → C5 → C6 → C7 (C5 can ride any commit boundary; it is docs-only).

- Per edit: `bun run lint` · `bun run test` · `tsc -p .nuxt/tsconfig.app.json --noEmit` (all safe
  beside the running dev server; the repo's fast-three).
- Before claiming green: **stop the dev server** (trap 11) → `bun run build` → `bun run verify`
  full run once (≈3 m 37 s), then `bun run typecheck`.
- ARCHITECTURE.md updates ride the same commits: a "Baseline security headers" line in Deployment,
  the preset bullet gains the check script, one throttle sentence in the orders section, one
  log/throttle sentence in the payments bullet.
- Commits: one atomic scoped commit per C-item (`fix(security):` / `fix(api):` / `fix(payments):` /
  `chore(deploy):` / `docs:` / `perf(checkout):`), **only on JCP/CPC** — the tree stays uncommitted
  during the work (GIT_CONVENTIONS). The tree currently carries the uncommitted 008/009 work; stage
  only this plan's files.
- CI is the acceptance backstop: `gh run watch` after any push.

## Results (2026-10-07, applied)

- C1: `curl -sI` on `/` and `/api/catalog/products` both carry all four headers; the new harness
  check passes (`the document response carries the baseline security headers :: {"missing":[]}`).
- C2: live curl against the dev server, Clerk dev session minted via the CLI — orders
  `400×10 → 429 429`; payway create `404×5 → 429 429` (fresh limiter keys).
- C3: `bun test` 53 pass / 0 fail — the mismatch test now asserts the warn fires and the paid test
  that it stays quiet (expect() calls 1122 → 1124).
- C4: guard exits 1 on the node-server `.output`, exits 0 on the CF build. The first CF arm caught
  a self-bug: nitro records `cloudflare-module` (hyphen) while `NITRO_PRESET` spells it
  `cloudflare_module` — the check normalizes before comparing.
- C5: greps clean; the local `.env` also lost the two service-role keys (nothing reads them — the
  `secretKey: ''` pin is what keeps them out of the bundle).
- C6: checkout exercises in `verify`'s guest slice; network-order measured in the plan's
  acceptance when a session is next available.
- C7: outcome above — no change made.
- Full gate set on the applied tree: lint 0 errors (17 known warnings) · test 53/53 · tsc 0 ·
  verify **535/535** · typecheck 0 · CF build 0.

## Not doing (triggers recorded)

- **CSP** — own change (allowlist study + report-only first). Trigger: the headers above have landed.
- **Index candidates** (`products(status, created_at)`, `orders(created_at)`, `categories(is_active,
  sort_order)`) — need `EXPLAIN (ANALYZE, BUFFERS)` on the literal queries first; an index that does
  not move the plan is a write-cost tax.
- **Admin desk LIMIT / patch-instead-of-reload** — measure with a seeded ≥500-order desk first.
- **Catalog ETag/304, 200 px thumb tier, font `.woff` trimming, supabase-js bundle trim** — on
  growth or after the R2 flip (P3), whichever comes first.
- **`bun audit` advisories** — build-toolchain only; Renovate carries them.
- **Logging `declined`/`cancelled`** — buyer-normal events; revisit only if fraud review says so.
