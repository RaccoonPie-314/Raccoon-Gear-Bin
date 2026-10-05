# SPEC-overview — E-commerce initiative (module ids: `compliance`, `identity`, `cart`, `orders`, `payments`)

Global spec for the initiative described in [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Each module's own
file carries its schema, contracts, and success criteria; this file carries what is shared: objective,
stack, commands, structure, style, testing strategy, and boundaries.

## Objective

Turn the reseller showcase into an **account-based store with cash-on-delivery orders**, and prepare
(in specification, gated in build order) online payment via ABA PayWay.

- **Who**: shoppers in Cambodia browsing the catalog (EN/KM, USD prices) who currently leave the
  site to order via Telegram/WhatsApp/phone; and the shop owner, who today manages everything by
  hand.
- **Why now**: the order conversation exists off-platform and produces no record; a cart + order
  record removes the copy-paste and gives the seller an order list with statuses and stock movement.

## Success criteria

Initiative level (module criteria are in each spec):

1. A signed-in shopper can go product → cart → checkout → order, and the seller sees the order in
   `/admin/orders` with correct items, totals, and delivery details.
2. `stock_quantity` and `promo_quantity` decrement atomically at order placement and restore on
   cancellation — the "nothing decrements it" gap in the promotions migration is closed.
3. The charged price is computed server-side from the same written pricing rule that the UI
   displays; a `bun test` fixture and a migration self-check pin both to the same expectations.
4. The privacy/terms pages state what is now collected, why, and how it is deleted — live before
   accounts deploy (gate G1).
5. No legal-pages, Khmer-typography, or tuned-interaction regression: the existing `verify` checks
   stay green, and new surfaces extend them in the same commits.
6. Phases 1–3 add **no new dependencies** (Bun's built-in test runner; browser-native APIs only).
7. The payments module, when its gate opens, charges in a PayWay sandbox end-to-end, rejects
   tampered signatures, is idempotent on webhook replay, and keeps the service-role key out of the
   client bundle — verified, not asserted.

## Tech stack (as it exists; do not change without amending this spec)

| Layer | Choice | Notes |
|---|---|---|
| Framework | Nuxt ^4.5 (SSR, `cloudflare_module` Nitro preset) | [nuxt.config.ts](../../nuxt.config.ts) |
| UI | Tailwind v4 + Nuxt UI ^4.11, motion-v ^2.4 | presentational components under `app/components/` |
| i18n | `@nuxtjs/i18n` ^10.6, locales `en` + `km`, `prefix_except_default` | all strings in [i18n.config.ts](../../i18n.config.ts), both locales, inline |
| Data | `@nuxtjs/supabase` ^2.0.10 + `@supabase/supabase-js` ^2.116 | browser → Postgres under RLS; anon key only |
| DB | Supabase Postgres 15 (local stack on 54322; migrations in [supabase/migrations/](../../supabase/migrations/)) | pushed migrations are never edited |
| Runtime | Bun (package manager + scripts), Node 24 for the verify harness | CI: [ci.yml](../../.github/workflows/ci.yml) |
| Deploy | Cloudflare Worker (`bun run deploy`), free plan currently sufficient | [wrangler.jsonc](../../wrangler.jsonc) |
| Payments (phase 4) | ABA PayWay Purchase API (HMAC-SHA512 signed, hosted checkout) | contract in [SPEC-payments.md](SPEC-payments.md) |

## Commands

Existing (unchanged):

```bash
bun install
bun run dev                        # dev server; 3000, falls back to 3001
bun run build                      # compile (CI)
bun run lint                       # eslint app (CI)
bun run verify                     # scripts/verify-ui.mjs, headless Chrome (CI)
bun run typecheck                  # vue-tsc via `nuxt typecheck`
./node_modules/.bin/tsc -p .nuxt/tsconfig.app.json --noEmit
supabase db reset                  # apply migrations to the local stack
supabase migration new <slug>      # new migration (ISO timestamp prefix is added)
supabase db push                   # push to the linked project (after local verification)
```

Added by this initiative (phase 2, task K1):

```bash
bun run test                       # → bun test tests   (Bun's built-in runner; no new dependency)
```

Cost discipline ([AGENTS.md](../../AGENTS.md), measured 2026-10-03): `lint` 2 s · `typecheck` 4 s ·
`build` 7 s — run those three after **every** edit; `verify` is ~3 m 37 s and is the gate run
**once** per module immediately before any "it works" claim.

## Project structure (new paths)

No new auto-import directories: `app/features/admin` is already registered in
[nuxt.config.ts](../../nuxt.config.ts), and everything else lands in existing scan roots. Adding a
feature folder would mean editing `components.dirs`/`imports.dirs` — the trap where naming `dirs`
replaces Nuxt's own scan (see [TOUCH_RESTRICTIONS.md](../../docs/rules/TOUCH_RESTRICTIONS.md)) — and
comes with its own feature-completeness budget.

| Path | Owner module | Notes |
|---|---|---|
| `supabase/migrations/<ts>_customer_accounts.sql` | identity | profiles + signup trigger + RLS |
| `supabase/migrations/<ts>_orders_and_checkout.sql` | orders | orders, order_items, `effective_unit_price`, `create_order`, `set_order_status`, `anonymize_customer`, RLS |
| `supabase/migrations/<ts>_payments.sql` | payments (gated) | payments table, `mark_payment_refunded`, RLS |
| `app/types/database.ts` | shared | new `*Row` **type literals** + `Database` entries + `Relationships`, per the two silent-typing rules |
| `app/types/orders.ts` | orders | mapped view types (`OrderView`, `OrderItemView`, `OrderStatus`) |
| `app/composables/useCustomerAuth.ts` | identity | mirrors [useAdminAuth.ts](../../app/composables/useAdminAuth.ts) shape |
| `app/composables/useCart.ts` | cart | localStorage state; no network, no pricing rules |
| `app/composables/useCheckout.ts` | orders | drift re-validation + `create_order` RPC + redirect |
| `app/composables/useCustomerOrders.ts` | orders | buyer reads (list/detail) |
| `app/utils/cart-totals.ts` | cart | pure fn: lines × fresh products × `getProductPricing` |
| `app/utils/order-status.ts` | orders | pure fn: status → allowed transitions + display key |
| `app/middleware/customer-auth.global.ts` | identity | session-only guard for `/account/**`, `/checkout/**` |
| `app/pages/login.vue`, `signup.vue`, `account/index.vue`, `account/orders/index.vue`, `account/orders/[id].vue` | identity / orders | buyer pages |
| `app/pages/cart.vue`, `checkout/index.vue`, `checkout/success.vue` | cart / orders | storefront flow (`checkout.vue` would nest `checkout/success` as a child route — see SPEC-orders) |
| `app/pages/privacy.vue`, `terms.vue` | compliance | EN/KM via route prefix |
| `app/pages/admin/orders.vue` + `app/features/admin/components/AdminOrdersPanel.vue` + `app/features/admin/composables/useAdminOrders.ts` | orders | follows the [AdminTabs.vue](../../app/components/AdminTabs.vue) pattern |
| `server/utils/payway.ts`, `server/api/payments/payway/{create,return,webhook}.post.ts` | payments (gated) | the repo's **only** server tier; the only place a service-role key may exist |
| `tests/unit/*.test.ts` | shared | Bun test runner (cart totals, order status, pricing parity) |
| `specs/ecommerce/**`, `plans/003-*.md` | docs | this spec set |

## Code style

The repo's existing rules apply unchanged and are the style: `t()` for every user-facing string
(en + km, inline in `i18n.config.ts`); row shapes as `type` literals, never `interface`; select
strings as inline literals; pure non-reactive rules as plain functions under `app/utils/`; components
under `app/components/` stay presentational; feature components may use their own feature composable
and nothing else's; errors thrown, not returned as values.

Representative snippet — a new composable in the established shape (throws; typed client):

```ts
import type { Database } from '~/types/database'

export const useCustomerAuth = () => {
  const supabase = useSupabaseClient<Database>()
  const user = useSupabaseUser()

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return data
  }

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  return { user, signUp, signIn }
}
```

Representative snippet — a migration in the established shape (uuid PK, timestamptz pair, text +
check, policies inline like [20260922000002_storage_and_rls.sql](../../supabase/migrations/20260922000002_storage_and_rls.sql)):

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
on public.profiles for select
using (id = auth.uid());

-- insert/delete have no policy on purpose: the signup trigger inserts, admin deletion cascades.
```

Naming: SQL snake_case; TS camelCase functions, `PascalCase` types, `*Row` for table shapes and
`*View` for mapped shapes; composables `use*`; module ids kebab-case as in the capability map.

## Testing strategy

Four tiers, each with a distinct job — and deliberately no framework beyond what the repo has:

| Tier | Tool | Covers | When |
|---|---|---|---|
| Unit | `bun test tests` (built-in) | pure logic only: `cart-totals`, order-status transition table, PayWay hash/field-building/result-parsing, idempotent `applyResult` against a mocked client | every edit; fast |
| Migration self-checks | `do $$ ... $$` asserts **inside** the migration that defines the rule (pricing fixtures for `effective_unit_price`; transition accept/reject fixtures for `set_order_status`) | the SQL charging/state rules, executed on every `supabase db reset` | on migration change |
| RLS verification | documented SQL checklist per migration task (exact `set local role` queries + expected rows), run against the local stack | policies, ownership, default-deny writes | once per migration task, results recorded in the task |
| Browser harness | `scripts/verify-ui.mjs` (raw CDP, stubbed `/rest/v1`, `/auth/v1`, `/storage/v1`) | flows, geometry, exact request tuples — extended per module: auth stub fixtures, cart badge/persistence/merge, checkout submit payload, admin order transitions, payment UI states | once per module (G3) |

**Pricing parity** (`orders`, amended 2026-10-04 to what was built): the written rule table exists
in [SPEC-orders.md](SPEC-orders.md). The TS rule (`getProductPricing`) and the SQL function
(`effective_unit_price`) are pinned to the **same four hand-written fixtures** — no-promo, live
promo, closed window, exhausted cap: `tests/unit/pricing-parity.test.ts` asserts the TS side, the
migration's `do $$` block asserts the SQL side, and each side's comment points at the other. The
planned `pricing-cases.json` + `verify-pricing-parity.mjs` were dropped: the script would need a
local Supabase (Docker) to be meaningful and would duplicate exactly what `db reset` already runs,
and a JSON file shared by two runtimes still needed the same hand-kept copy.

**Payments testing** (`payments`, phase 4): the route shells stay thin; the logic lives in
`server/utils/payway.ts` as pure/injectable functions covered by `bun test` (hash vector, concat
order, error mapping, replay idempotency with a mocked Supabase client). The sandbox end-to-end is a
manual, recorded run (G2 environment) — the harness covers only the client-side UI states.

**Not done**: no pgTAP/`supabase test db` rig, no CI job for the parity script (it needs a local
Supabase). Both are upgrade paths if the checks flake, not day-one infrastructure.

## Boundaries

- **Always**: run the fast gates after every edit; `t()` everything (en + km); type-literal row
  shapes + inline select literals; update `ARCHITECTURE.md` in the same commit as the design change;
  keep `.env.example` in sync with any new env var; extend the harness in the same commit as the
  surface it measures.
- **Ask first** (i.e., record an amendment in the owning spec before doing it): adding any
  dependency; touching tuned geometry (masthead, detail-page conversion area, category docks,
  `SearchDock`) beyond what the module specs name; any migration beyond the three listed above;
  putting a service-role key anywhere outside `server/api/payments/**`; editing an assertion that
  already exists in `verify`.
- **Never**: `as any` on a Supabase client or query; a service-role client in `app/`; secrets in
  `runtimeConfig.public` or committed env files; editing a pushed migration; client-side writes to
  `stock_quantity`, `promo_quantity`, `orders`, or `order_items` outside the RPCs; committing `.env`,
  `.claude/`, `.qoder/`.

## Open questions (recorded, not invented answers)

1. **Shipping-fee mechanics** — "shipping is not free" is existing policy; v1 settles the amount by
   phone at confirmation and keeps it out of `orders.total`. Province-based fees are deferred
   (`orders` spec).
2. **Warranty / returns** — undecided in project records; the Terms page ships with explicit
   placeholder sections that must be filled before launch (G1).
3. **KHR display** — prices are stored in USD; PayWay supports both currencies; v1 charges USD.
4. **Account deletion retention** — the retention window (how long anonymized order records are
   kept) is the owner's legal call; the mechanism ships regardless.
5. **Password reset / receipts email** — needs custom SMTP; deferred, recovery path is contact-first.
6. **"Negotiable prices" copy** — product pages currently invite negotiation; with a cart charging
   list prices, that copy needs a harmonizing pass (owner review, `compliance`).
