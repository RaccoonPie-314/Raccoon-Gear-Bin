# E-commerce capability map — Raccoon Gear Bin

Status: **APPROVED** (user, 2026-10-04); amended 2026-10-05 (identity v2 — see [SPEC-identity.md](SPEC-identity.md))
and 2026-10-07 (admin-mode hardening + doc truth — see the same file's last amendment, and
[Hardening amendments](#hardening-amendments) below for the module ids it introduces). Branch: `feat/ecommerce`.
This map is the index of the module specs in this folder. Tasks in
[plans/003](../../plans/003-ecommerce-implementation-plan.md) select work by the module ids below —
nothing is selected by guessing which spec is "active".

## Why this map exists

The repository is a **non-transactional reseller showcase**: catalog only, no personal data
collected, prices "indicative and negotiable via off-platform chat", and an account/cart system
explicitly on hold (project roadmap, September 2026). The promotion migration even records the
consequence: "Nothing decrements it — there is no checkout yet"
([20260930120000_product_promotions.sql](../../supabase/migrations/20260930120000_product_promotions.sql)).

This initiative reverses three of those positions **on purpose**:

1. The site starts collecting personal data (account email, delivery name/phone/address) — the
   privacy stance in `site_settings`-era copy and the (not yet written) legal pages must change in
   the same change that ships accounts.
2. Prices displayed by the cart/checkout become **binding at order placement**. The Contact-to-Order
   channel remains for questions and negotiation, but a negotiated price is not reflectable in the
   cart in v1 (recorded as an accepted limitation in [SPEC-compliance.md](SPEC-compliance.md)).
3. The repo gains its **first server tier** — the payments module (signed provider calls and
   webhooks, parked) and, per the identity v2 amendment of 2026-10-05, the confined auth routes
   (`/api/auth/**`, `/api/telegram/webhook`). Everything else stays browser → Postgres under RLS,
   as today.

## Locked decisions (user, 2026-10-04)

- **Phased build, payments last.** Identity → cart → orders first; payments is fully specified but
  gated on the ABA PayWay merchant account.
- **ABA PayWay** is the payment gateway (hosted checkout; card + KHQR + wallets).
- **Accounts are required** to place an order: Supabase Auth email + password, mirroring the admin
  flow's mechanism; email confirmation off in v1 (the seller's phone confirmation is the real COD
  gate).
- **Fulfilment is delivery + pay on receipt** (cash or bank transfer on delivery): checkout captures
  name/phone/province/address/note; the seller confirms by phone/Telegram and settles the shipping
  cost, which is not free (existing policy).

## Modules

| Module id | Responsibility | Depends on | Ships |
|---|---|---|---|
| `compliance` | Privacy policy + Terms pages (EN/KM), retention + account-deletion policy, consent line at signup | — | Parallel with phase 1; must land **before** identity deploys |
| `identity` | Customer accounts, `profiles` row, `/login` `/signup` `/account`, route guard; v2 (2026-10-05): phone signup, Telegram login, login codes, 30-day sessions | — | Phase 1 |
| `cart` | localStorage-persisted cart, merge on sign-in, live price/stock validation, masthead control, `/cart` | identity (soft — cart works signed-out), `useCatalog` (read-only) | Phase 2 |
| `orders` | Checkout (delivery snapshot), `create_order` RPC (atomic stock/promo decrement + price snapshot), buyer history, admin order management, anonymization RPC | cart, identity | Phase 3 |
| `payments` | ABA PayWay hosted checkout, signed return/webhook routes on the Worker, `payments` table, order payment status, manual refunds | orders | Phase 4 — **gate G2: ABA merchant account + sandbox keys + return-URL whitelist confirmed** |

Dependency direction is one-way; there are no cycles. `cart` names identity as a *soft* dependency
because a signed-out cart must work; the only hard requirement is that the merge path exists when
identity ships (which is why identity is still built first — a cart whose merge is one phase late is
a data-loss bug, a cart one phase early is not).

## Build order

```
compliance ──┐ (must be live before any data collection)
identity ────┼──▶ cart ──▶ orders ──▶ payments (gated)
             │
```

Phase 1: compliance + identity · Phase 2: cart · Phase 3: orders · Phase 4: payments.

## Gates

- **G0** — this map and the spec set are approved (this session). Every later decision that
  contradicts a spec is an amendment to that spec first, then code.
- **G1** — the compliance pages are reviewed by the owner and live **before** the identity module
  deploys to production (accounts start collecting data the day they ship).
- **G2** — before any payments work starts: ABA business account opened, sandbox account registered
  (sandbox.payway.com.kh), `merchant_id` + API key in hand, production domain + return URLs
  whitelisted (PayWay error codes 6 and 81 are exactly this), and the current base URLs +
  check-transaction contract re-retrieved from developer.payway.com.kh (docs move; the retrieval is
  a task, not an assumption).
- **G3** — per module, before merging to `main`: the fast gates green on every commit, `bun run
  verify` green **once** for the module as a whole, and `ARCHITECTURE.md` updated in the same commit
  as the design change it documents.

## Branch and commit strategy

- `feat/ecommerce` is a short-lived integration branch off `main` (this deviates from the repo's
  main-only habit on purpose; the initiative is roadmap-sized). `main` stays deployable throughout.
- Docs and code stay uncommitted until the user says CPC/JCP
  ([GIT_CONVENTIONS.md](../../docs/rules/GIT_CONVENTIONS.md)); commits follow the repo's conventional
  scopes: `feat(account)`, `feat(cart)`, `feat(orders)`, `feat(payway)`, `docs(specs)`.
- Each completed module merges to `main` after its G3 checkpoint and gets a
  `backup/ecommerce-<module>-working` tag.

## Module spec index

| Spec | Module id |
|---|---|
| [SPEC-overview.md](SPEC-overview.md) | all (objective, stack, commands, structure, style, testing, boundaries) |
| [SPEC-compliance.md](SPEC-compliance.md) | `compliance` |
| [SPEC-identity.md](SPEC-identity.md) | `identity` |
| [SPEC-cart.md](SPEC-cart.md) | `cart` |
| [SPEC-orders.md](SPEC-orders.md) | `orders` |
| [SPEC-payments.md](SPEC-payments.md) | `payments` |

## Hardening amendments

Small, already-specified surfaces that need a contract change rather than a new module. They are
indexed here so nothing is selected by guessing which spec is "active", and each traces to a section
of an existing spec file — no separate spec set, because the boundary they touch is already owned there.

| Module id | Responsibility | Spec |
|---|---|---|
| `admin-identity` | `/api/admin-check` asked once per navigation (`useState('admin-mode')`, invalidated by `markSignedOut`); authority stays RLS + `requireAdmin` | [SPEC-identity.md → Amendment 2026-10-07](SPEC-identity.md) |
| `doc-truth` | ARCHITECTURE.md reconciled with the committed code (payments shipped, the two Supabase-storage holders, the `/api/**` list, the admin-question invariant) | same amendment, `doc-truth` items |

Build order: one change, both ids land together (G3 requires the doc to move in the same commit as
the design it documents). Depends on nothing; blocks nothing.

## Explicitly deferred (not in this initiative)

Guest checkout · KHR display at checkout · province-based delivery fees · receipt/confirmation
email · seller Telegram ping (shipped 2026-10-05) · buyer self-service cancellation · wishlist · automated refunds ·
order-price override · password reset / custom SMTP · identity merging across sign-in methods · marketing or analytics
cookies · realtime order feed. Each is listed with its trigger condition in
[plans/003 → Phase 5](../../plans/003-ecommerce-implementation-plan.md).
