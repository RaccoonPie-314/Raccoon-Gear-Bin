# 003 — E-commerce: accounts, cart, COD orders, and a gated ABA PayWay module

Status: **DRAFT v1 — implementation plan for the approved spec set.** Origin: user request 2026-10-04;
approved capability map and module specs under [specs/ecommerce/](../specs/ecommerce/CAPABILITY-MAP.md),
branch `feat/ecommerce` (created 2026-10-04). Nothing in this plan is implemented yet.

Severity: feature initiative. The site stays deployable on `main` throughout; each phase merges only
after its G3 checkpoint.

Files (by phase): `supabase/migrations/**`, `app/**`, `server/**`, `tests/**`, `scripts/**`,
`nuxt.config.ts`, `.env.example`, `package.json`, `ARCHITECTURE.md`, `i18n.config.ts`.

## Assumptions (correct me now or implementation proceeds)

1. **Module ids select the work** — `compliance`, `identity`, `cart`, `orders`, `payments` as defined
   in the capability map; each module's spec is the contract, and changing a contract is a spec
   amendment first.
2. **Budgets hold** ([AGENTS.md](../AGENTS.md), measured 2026-10-03): `lint` 2 s · `typecheck` 4 s ·
   `build` 7 s run after every edit; `verify` ≈ 3 m 37 s runs **once per module**, at G3. Dev server
   binds 3000 → 3001; Chrome is available locally for the harness.
3. **No new dependencies in phases 1–3.** The only `package.json` change is the `test` script
   (`bun test tests`). Phase 4 uses platform APIs only (WebCrypto, fetch).
4. **The owner is available for the three owner-gated inputs**: T6 warranty/returns (hard G1
   blocker), retention window, governing law. If not, C1 ships with explicit placeholders and
   **identity does not merge** — G1 is a gate, not a suggestion.
5. **ABA sandbox** is obtainable at G2 (sandbox.payway.com.kh); phases 1–3 do not depend on it.
6. **Migrations are pushed per module** after local verification (`supabase db reset` + checklist),
   never edited afterwards; CI (lint + build + verify) runs on every push.
7. **The two pre-existing working-tree edits** (`AGENTS.md`, `docs/rules/TESTING_SPECS.md`) are not
   part of this initiative; staging discipline keeps them out of every commit below.
8. **Harness changes ship in the same commit as the surface they measure** — the string-contract
   rule ([TOUCH_RESTRICTIONS.md](../docs/rules/TOUCH_RESTRICTIONS.md)).

## Standing rules for every task

- Run `bun run lint && bun run typecheck` and `bun run build` after every edit; targeted harness runs
  during development, one full `verify` per module at G3.
- `t()` for every string (en + km); type-literal rows; inline select literals; no `as any`; pure
  rules in `app/utils/`; presentational components stay prop-in/event-out.
- Touch-restricted areas (masthead, detail conversion area, docks, `SearchDock`) are edited only
  where a task names them, with the harness extended in the same commit.
- Conventional commits with the scopes below; docs (`ARCHITECTURE.md`) land in the committing change,
  not later.

---

## Phase 1 — identity + compliance (parallel tracks)

### I1 — `customer_accounts` migration
- **Acceptance**: `profiles` + signup trigger + RLS exactly as [SPEC-identity.md](../specs/ecommerce/SPEC-identity.md);
  `supabase db reset` clean; RLS checklist recorded (anon 0 rows; own select/update OK; cross-user update 0
  rows; insert/delete denied for every client role); a local signup observably creates the profile row.
- **Verify**: `supabase db reset` + the documented SQL checklist (results pasted into the commit
  message body); fast gates unaffected (no TS yet).
- **Files**: `supabase/migrations/<ts>_customer_accounts.sql`.

### I2 — types wiring
- **Acceptance**: `ProfileRow` as a `type` literal; `profiles` entry with `Relationships: []`;
  `Database` still compiles under the two silent-typing rules.
- **Verify**: `tsc -p .nuxt/tsconfig.app.json --noEmit` + `bun run typecheck`.
- **Files**: `app/types/database.ts`.

### I3 — auth UI, guard, harness
- **Acceptance**: [SPEC-identity.md](../specs/ecommerce/SPEC-identity.md) pages, `useCustomerAuth`,
  `customer-auth.global.ts` (id-or-sub read, open-redirect guard, session-only) done; i18n keys added
  in both locales; harness checks listed there green; existing admin auth checks untouched.
- **Verify**: fast gates; targeted harness run; full `verify` at the phase-1 G3 merge.
- **Files**: `app/composables/useCustomerAuth.ts`, `app/middleware/customer-auth.global.ts`,
  `app/pages/login.vue`, `app/pages/signup.vue`, `app/pages/account/index.vue`,
  `i18n.config.ts`, `scripts/verify-ui.mjs`.

### C1 — compliance pages (parallel with I1–I3)
- **Acceptance**: [SPEC-compliance.md](../specs/ecommerce/SPEC-compliance.md) checklists P1–P7 and
  T1–T8 covered (T6 = owner input, the G1 blocker); pages reachable from footer + signup; consent
  line live; deletion runbook rehearsed once on the local stack and recorded; copy harmonization pass
  decided with the owner.
- **Verify**: fast gates; harness route/consent checks; owner review recorded in the commit body.
- **Files**: `app/pages/privacy.vue`, `app/pages/terms.vue`, footer surface (storefront page),
  `app/pages/signup.vue`, `i18n.config.ts`, `scripts/verify-ui.mjs`.

### Phase-1 checkpoint (G3 + G1)
C1 accepted **before** the phase merges (G1). Full `verify` once; merge to `main`; tag
`backup/ecommerce-identity-working`.

---

## Phase 2 — cart

### K1 — cart core (pure + state + tests)
- **Acceptance**: `cartTotals` and `useCart` exactly as [SPEC-cart.md](../specs/ecommerce/SPEC-cart.md);
  loader is defensive (corrupt payload → empty, no throw); `bun test` green on the cart fixtures
  (normal, promo live, promo window closed, out of stock, missing product, over both caps, empty,
  malformed input); `test` script added.
- **Verify**: `bun run test`; fast gates.
- **Files**: `app/utils/cart-totals.ts`, `app/composables/useCart.ts`,
  `tests/unit/cart-totals.test.ts`, `tests/unit/cart-storage.test.ts`, `package.json`.

### K2 — cart surfaces (masthead + detail add + `/cart`)
- **Acceptance**: the three surfaces in the cart spec; masthead badge survives reload and merges on
  sign-in; clamps written back; no price in storage; TOUCH_RESTRICTIONS respected in masthead and
  detail conversion area (fallback to a floating dock is a named review decision, not silent).
- **Verify**: fast gates; harness: badge/persistence/merge/drift/totals + the masthead and detail
  regression checks stay green; full `verify` at the phase G3.
- **Files**: `app/components/CartControl.vue`, `app/pages/cart.vue`, `app/pages/index.vue` (mount),
  `app/pages/products/[id].vue` + `app/features/product/components/ProductActions.vue` (add control),
  `i18n.config.ts`, `scripts/verify-ui.mjs`.

### Phase-2 checkpoint (G3)
Full `verify` once; merge; tag `backup/ecommerce-cart-working`.

---

## Phase 3 — orders

### O1 — `orders_and_checkout` migration
- **Acceptance**: schema, RLS, `effective_unit_price` (+ self-check fixtures), `create_order`,
  `set_order_status`, `anonymize_customer` exactly as [SPEC-orders.md](../specs/ecommerce/SPEC-orders.md);
  SQLSTATE contract (`AUTH_REQUIRED`, `CART_EMPTY`, `INVALID_DELIVERY`,
  `PRODUCT_UNAVAILABLE:<id>`, `INSUFFICIENT_STOCK:<id>:<n>`, `PROMO_LIMIT:<id>:<n>`,
  `INVALID_QUANTITY:<id>`, `NOT_ADMIN`, `INVALID_TRANSITION:<from>:<to>`); execute grants revoked
  from `public, anon`, granted to `authenticated`; `db reset` runs the self-checks.
- **Verify**: `supabase db reset`; RLS + RPC checklist recorded (deny-by-default writes; owner reads;
  admin reads; non-admin RPC refusal); fast gates.
- **Files**: `supabase/migrations/<ts>_orders_and_checkout.sql`, `ARCHITECTURE.md` (write-path design
  lands here).

### O2 — types, status table, fixtures, parity
- **Acceptance**: `OrderRow`/`OrderItemRow` + `Relationships`; `app/types/orders.ts`; `order-status.ts`
  transition table; `tests/fixtures/pricing-cases.json` with hand-written expectations consumed by
  the TS test **and** matching the migration self-check; `scripts/verify-pricing-parity.mjs` runs
  against the local stack.
- **Verify**: `bun run test`; parity script run recorded once.
- **Files**: `app/types/database.ts`, `app/types/orders.ts`, `app/utils/order-status.ts`,
  `tests/unit/order-status.test.ts`, `tests/unit/pricing-parity.test.ts`,
  `tests/fixtures/pricing-cases.json`, `scripts/verify-pricing-parity.mjs`.

### O3 — buyer flow (checkout, confirmation, history)
- **Acceptance**: [SPEC-orders.md](../specs/ecommerce/SPEC-orders.md) buyer surfaces; error-code →
  `t()` mapping; double-submit guard; cart cleared only on success; guard intercepts signed-out
  visitors.
- **Verify**: fast gates; harness purchase path + error path + history checks green.
- **Files**: `app/composables/useCheckout.ts`, `app/composables/useCustomerOrders.ts`,
  `app/pages/checkout.vue`, `app/pages/checkout/success.vue`, `app/pages/account/orders/index.vue`,
  `app/pages/account/orders/[id].vue`, `app/pages/account/index.vue` (link), `i18n.config.ts`,
  `scripts/verify-ui.mjs`.

### O4 — admin flow
- **Acceptance**: `/admin/orders` list/detail/transitions exactly as the spec; buttons derive from
  `order-status.ts`; cancel restores stock (asserted via the stubbed RPC call).
- **Verify**: fast gates; harness admin checks green; existing admin checks untouched.
- **Files**: `app/pages/admin/orders.vue`, `app/features/admin/components/AdminOrdersPanel.vue`,
  `app/features/admin/composables/useAdminOrders.ts`, `app/components/AdminTabs.vue`,
  `i18n.config.ts`, `scripts/verify-ui.mjs`, `ARCHITECTURE.md` (admin surface note).

### O5 — phase-3 G3
- **Acceptance**: manual local-stack walkthrough recorded (place → decrement; cancel → restore;
  over-cap → precise error, nothing written); full `verify` once; `ARCHITECTURE.md` current.
- **Verify**: the recorded walkthrough + `bun run verify`.
- **Files**: `ARCHITECTURE.md` if the walkthrough exposes drift.

**Phase-3 checkpoint**: merge to `main`; tag `backup/ecommerce-orders-working`.

---

## Phase 4 — payments (GATED on G2)

### P0 — gate + doc retrieval (no code)
- **Acceptance**: G2 items confirmed; current base URLs, check-transaction contract, and any
  return/webhook delivery details re-retrieved and appended to [SPEC-payments.md](../specs/ecommerce/SPEC-payments.md)
  as an amendment if they moved.
- **Verify**: written record in the commit body.
- **Files**: `specs/ecommerce/SPEC-payments.md` (amendment, if any).

### P1 — `payments` migration
- **Acceptance**: schema + RLS + `mark_payment_refunded` (`NOT_ADMIN` for non-admins) as specified;
  `db reset` clean; checklist recorded.
- **Verify**: `supabase db reset` + checklist.
- **Files**: `supabase/migrations/<ts>_payments.sql`, `app/types/database.ts`.

### P2 — `server/utils/payway.ts` + unit tests
- **Acceptance**: hash (documented field order; Node/WebCrypto cross-runtime equality), tran_id
  generator (≤20, charset), callback verify (tampered → reject), error mapping, `applyPaywayResult`
  idempotency/amount-mismatch/unknown-tran cases — all green.
- **Verify**: `bun run test`.
- **Files**: `server/utils/payway.ts`, `tests/unit/payway.test.ts`.

### P3 — server routes + secrets + sandbox E2E
- **Acceptance**: create/return/webhook routes exactly as specified; runtimeConfig server entries with
  empty defaults; `.env.example` updated; sandbox E2E recorded (pay → `paid`; replayed callback →
  no-op); `useRuntimeConfig(event)` mechanism verified against current nitro + Cloudflare docs.
- **Verify**: sandbox run recorded in the commit body; unit tests still green; fast gates.
- **Files**: `server/api/payments/payway/create.post.ts`, `.../return.post.ts`, `.../webhook.post.ts`,
  `nuxt.config.ts`, `.env.example`.

### P4 — pay-now UI + harness
- **Acceptance**: Pay-now visibility rules; `pay-result` page states; retry path; i18n both locales;
  no tuned geometry touched.
- **Verify**: fast gates; harness UI-state checks green.
- **Files**: `app/pages/checkout/success.vue`, `app/pages/account/orders/[id].vue`,
  `app/pages/checkout/pay-result.vue`, `i18n.config.ts`, `scripts/verify-ui.mjs`.

### P5 — secret audit + docs + phase G3
- **Acceptance**: built `.output` contains no secret values and no service-key-shaped strings;
  `runtimeConfig.public` carries none of the three secrets; `ARCHITECTURE.md` documents the server
  tier, the service-role confinement (`server/api/payments/**` only), and the refund flow; full
  `verify` once.
- **Verify**: audit commands + results recorded; `bun run verify`.
- **Files**: `ARCHITECTURE.md`.

**Phase-4 checkpoint**: merge; tag `backup/ecommerce-payments-working`.

---

## Phase 5 — deferred backlog (recorded, not tasked)

| # | Item | Trigger to start |
|---|---|---|
| R1 | Order confirmation / receipt email (Resend skill available) | buyers report missing confirmations, or SMTP is set up anyway |
| R2 | Seller Telegram ping for new orders | seller misses orders between dashboard visits |
| R3 | KHR display at checkout | buyers ask; PayWay already supports KHR |
| R4 | Guest checkout | COD conversion pressure becomes measurable |
| R5 | Province-based delivery fees (`orders_total_matches_v1` relaxes) | shipping disputes or fee inconsistency |
| R6 | Buyer self-service cancellation | request volume justifies the RPC surface |
| R7 | Custom SMTP + password reset | first locked-out account |
| R8 | Order price override (negotiation lands in the cart) | negotiation volume makes the cart price the wrong price |

## What ships first (the direct answer)

**Task I1** — the `customer_accounts` migration — is the first executable step, in parallel with
**C1** (compliance pages, owner-gated). Everything else in this plan hangs off owned accounts: the
cart merge, order ownership, and payment identity all name a user. The first user-visible milestone
is the phase-1 merge (sign up → `/account` works, legal pages live); the first business value is the
phase-3 merge (orders, stock movement, admin order list); revenue-changing, phase 4 waits on G2.
