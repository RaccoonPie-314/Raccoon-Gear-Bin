# SPEC-payments — module id `payments`

Phase 4 — **gated**. Nothing in this module starts before **G2** ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)):
ABA business account opened, sandbox account registered, `merchant_id` + API key in hand, production
domain + return URLs whitelisted, and the PayWay base URLs + check-transaction contract **re-retrieved
from developer.payway.com.kh** (these docs move; the retrieval is task P0, not an assumption).

**Amended 2026-10-04:** the retrieval half of G2 is done (P0, below) and P1–P2 were built ahead at
the owner's request — migration pushed, utils + unit tests green, everything inert (nothing imports
them; `orders.payment_status` still only ever holds `unpaid`). **The gate itself is NOT cleared**:
the owner has no merchant gateway account yet. Registration is the next step — sandbox
`https://sandbox.payway.com.kh/register-sandbox/` (self-serve, keys arrive by email), production via
`paywaysales@ababank.com`. P3–P5 wait on it.

Specified in [CAPABILITY-MAP.md](CAPABILITY-MAP.md); global rules in
[SPEC-overview.md](SPEC-overview.md). Provider contract below grounded in the official docs captured
2026-10-04 (Purchase API page, developer.payway.com.kh).

## Objective

Let a buyer pay a placed order online through ABA PayWay's hosted checkout (card, ABA PAY/KHQR,
wallets) while cash-on-delivery stays the default and unchanged. One new capability, one new trust
boundary: the repo's first and **only** server tier, confined to `/api/payments/payway/**`, and the
repo's only sanctioned use of a service-role Supabase key.

## The PayWay contract (grounded; re-verify at P0)

- **Endpoint** `POST {base}/api/payment-gateway/v1/payments/purchase`, `multipart/form-data`.
  Production base `https://checkout.payway.com.kh`; **sandbox base corrected at P0 to
  `https://checkout-sandbox.payway.com.kh`** — the `checkout-uat` host this line first carried
  survives only in a stale sample inside the docs (see the P0 amendment below).
- **Fields**: `req_time` (`YYYYMMDDHHmmss` UTC), `merchant_id` (≤30), `tran_id` (**≤20, unique**),
  `amount`, `currency` (`USD` or `KHR`), `items` (base64 JSON `[{name, quantity, price}]`, ≤500
  chars), `firstname`/`lastname`/`email`/`phone` (optional), `type` (`purchase`), `payment_option`
  (omitted → checkout shows every enabled method), `return_url`, `cancel_url`,
  `continue_success_url`, `custom_fields` (base64 JSON — carries `order_id`), `skip_success_page`.
- **Hash**: `base64(hmac_sha512(concat(fields in the documented fixed order), api_key))` — every
  field in the order the docs list, absent fields as empty strings. The fixed order is encoded once
  in `server/utils/payway.ts` and pinned by a test.
- **`tran_id` is ≤20 chars** — order uuids (36) do not fit. Scheme: `RGB` + base36(epoch ms) + 3
  random chars ≈ 14 chars, one per attempt, stored per row. PayWay rejects duplicates (code `4`);
  the create route regenerates once on that code.
- **Error codes to handle**: `1` wrong hash (config bug — fail loudly), `4` duplicate tran_id
  (regenerate), `6` domain whitelist / `81` return_url whitelist (G2 misconfig — surface clearly),
  `12` currency, `13` invalid items, `200`/`201` cancelled/declined, `429` rate limit (back off, do
  not retry inside one request), `503` maintenance. Full table lives in the docs; the utils module
  maps the ones above.
- **Result delivery**: after checkout, PayWay returns the transaction result to the merchant via the
  configured return URL (and/or a server-to-server notification, per merchant profile). Neither is
  trusted alone: the **Check Transaction API** (merchant-side query by tran_id, same hash scheme) is
  the authoritative read, called by the return/webhook handler before any state change. Its exact
  shape is re-retrieved at P0.

## P0 amendment (2026-10-04 — re-retrieved from developer.payway.com.kh)

The retrieval task the gate required. The docs had moved: the sandbox host, the exact hash order,
the checkout-request shape, and the callback contract all differ from the first capture. What was
built from below is pinned by the P2 tests; this section supersedes the contract text above where
they disagree.

- **Sandbox host + onboarding**: sandbox base `https://checkout-sandbox.payway.com.kh` (also the
  OpenAPI `servers` entry; `checkout-uat` appears only in a stale QR sample). Sandbox account:
  `https://sandbox.payway.com.kh/register-sandbox/` — Merchant ID + API key arrive by email.
  Production credentials via the Merchant Acquisition team, `paywaysales@ababank.com`.
- **Exact hash field order** (purchase request; absent fields hash as empty strings):
  `req_time, merchant_id, tran_id, amount, items, shipping, firstname, lastname, email, phone,
  type, payment_option, return_url, cancel_url, continue_success_url, return_deeplink, currency,
  custom_fields, return_params, payout, lifetime, additional_params, google_pay_token,
  skip_success_page` → `base64(hmac_sha512(concat, api_key))`. This order is the thing
  `paywayHash` encodes once and the test pins.
- **The checkout request is a browser form submit, not a server-callable URL.** The documented flow:
  a `multipart/form-data` POST to the purchase endpoint, answered with the checkout **HTML** (render
  it via the plugin `checkout2-0.js` as modal/bottom-sheet, or as hosted view by submitting the
  form). There is no "returns a paymentUrl" mode; our create route therefore **signs the fields**
  and the client submits them (the api_key never leaves the server). `view_type`: the API table says
  `hosted_view` / `popup`, the guide's mobile note says `hosted` — settle at sandbox (v1: hosted
  view). `payment_option` enum now: `cards`, `abapay_khqr`, `abapay_khqr_deeplink`, `alipay`,
  `wechat`, `google_pay` — v1 omits it (show all enabled). `items`: ≤50 line items, docs say no
  character cap (the old ≤500 reading is relaxed); optional `shipping`, `lifetime`,
  `return_deeplink` (mandatory for mobile apps) exist.
- **Return-URL callback** (`POST`, `Content-Type: application/json`): signature arrives in the
  `X-PAYWAY-HMAC-SHA512` header and is verified by recomputing
  `base64(hmac_sha512(values concatenated in ascending key order, api_key))` — **sorted keys, not
  the fixed request order**; arrays are JSON-encoded before concatenation. Body carries `tran_id`,
  `apv`, `status` (`'0'`), `return_params` (string), `original_amount/currency`,
  `payment_amount/currency`, `total_amount`, `discount_amount`, `transaction_date`, payer fields,
  `bank_ref`, `payment_type`, `payer_account`, `bank_name`, `card_source`. **`order_id` rides in
  the request's `return_params`, not `custom_fields`** (that one is dashboard metadata). The
  return-URL value itself is documented as "encrypted with Base64" — confirm at sandbox. Domain must
  be whitelisted (or the profile default applies). The callback is a notification; Check Transaction
  stays the authority before any state change.
- **Check Transaction API (pinned)**: `POST {base}/api/payment-gateway/v1/payments/check-transaction-2`,
  JSON body `{ req_time, merchant_id, tran_id, hash }`, hash over `req_time . merchant_id . tran_id`.
  Response: `data.payment_status_code` (`0` APPROVED/PRE-AUTH, `2` PENDING, `3` DECLINED,
  `4` REFUNDED, `7` CANCELLED) + `payment_status` string + amounts + `apv`; `status.code` **as a
  string** (`'00'` success, `5` invalid hash, `6` not found, `8` profile, `11` internal, `429` rate).
  600 req/s; only transactions within **7 days** (older → Get-a-transaction-details API — deferred).
  Note the type trap: purchase-exception `status.code` is a **number**, check-transaction `status.code`
  is a **string** — the P2 mapper must not conflate them.
- **Workers runtime config** (P0 re-verified against current Nuxt docs): `useRuntimeConfig(event)` —
  the argument is "optional but recommended" to pick up env-var overrides at runtime for server
  routes; our routes always pass it.

## Flow

```
order (pending, unpaid)
  └─ buyer clicks "Pay now"  ──▶ POST /api/payments/payway/create   (session-checked, owner-checked)
        ├─ insert payments attempt row (status 'initiated', service role)
        ├─ sign the purchase fields (the api_key stays server-side)
        └─ respond { action, fields } ──▶ the browser auto-submits the hidden multipart form
                                          ──▶ PayWay renders its checkout page (hosted view; P0 amendment)
                                            │
   buyer pays / cancels                     ▼
   PayWay → browser POST to return_url  ──▶ POST /api/payments/payway/return
   PayWay → server notification (if configured) ──▶ POST /api/payments/payway/webhook
        └─ shared: verify hash → Check Transaction (authoritative) → applyResult (idempotent)
              └─ 303 redirect to /checkout/pay-result?order=<id>
```

COD remains the default: "Pay now" is an *option* on the confirmation/order surfaces while the order
is `pending` and `unpaid`. Paying never changes the fulfilment flow (the seller still calls).

## Schema — `supabase/migrations/<ts>_payments.sql`

```sql
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'payway' check (provider in ('payway')),
  provider_txn_id text not null unique,          -- the tran_id sent to PayWay
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'USD',
  status text not null default 'initiated'
    check (status in ('initiated', 'paid', 'failed', 'cancelled', 'refunded')),
  request_payload jsonb,                          -- what we sent (no secrets)
  result_payload jsonb,                           -- latest provider result (raw)
  paid_at timestamptz,
  refund_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- reuse handle_updated_at trigger; index on payments(order_id)

alter table public.payments enable row level security;
-- select: order owner or admin (nested exists over orders, same shape as order_items)
-- no insert/update/delete policies: the server tier writes; mark_payment_refunded is the only client-callable write.
```

`orders.payment_status` already exists (orders migration, default `unpaid`). Transitions:
`unpaid → paid` only via `applyPaywayResult`; `paid → refunded` only via the admin RPC. A paid order
cannot be re-paid: the create route refuses when `payment_status = 'paid'` or status ≠ `pending`.

Server-side write RPC kept minimal on purpose — the whole server tier is:

```sql
mark_payment_refunded(p_order_id uuid, p_note text) returns void   -- admin-gated inside, SQLSTATE P0001 'NOT_ADMIN'
```

## The server tier (this repo's first)

- `server/utils/payway.ts` — pure/injectable, fully unit-tested:
  - `paywayHash(fields, apiKey)` — WebCrypto HMAC-SHA512 → base64; the documented field order in one
    exported constant.
  - **As built (P2, 2026-10-04):** the module is dependency-free (no `~` imports — `bun test` imports
    it relatively) and DB access injects as a `PaywayResultStore` seam instead of the raw Supabase
    client, so the idempotency cases run against a mutable fake; the routes wire the typed client
    into the store in P3. `buildPurchaseRequest` returns `{ action, fields, tranId }` — the browser
    submits the form (P0 amendment). The payments migration is pushed; anon probes verify the
    table's default-deny and that `mark_payment_refunded` answers 401 before its `NOT_ADMIN` check
    (execute is revoked from `public, anon`).
  - `buildPurchaseFields(order, items, urls)` — composes + hashes the request; `tran_id` generator
    (≤20 chars).
  - `verifyCallback(params, apiKey)` — recompute + constant-time compare; returns typed parse result.
  - `applyPaywayResult(client, { tranId, code, amount, payload })` — idempotent: unknown tran_id →
    recorded + rejected; already `paid` → no-op; `amount` must equal `orders.total` (mismatch → mark
    `failed`, never `paid`); success → `payments.status='paid'`, `paid_at`, `orders.payment_status='paid'`.
    The Supabase client is **injected** so the tests mock it.
- `server/api/payments/payway/create.post.ts` — session user via the Supabase Nuxt module's server
  helper; order must exist, belong to the user, be `pending`, `unpaid`; inserts the attempt row;
  calls PayWay; returns `{ paymentUrl }` (the checkout URL). Errors from the provider map to typed
  responses — no stack traces to the client.
- `server/api/payments/payway/return.post.ts` — receives PayWay's browser return; verifies hash;
  Check Transaction; `applyPaywayResult`; answers a 303 to `/checkout/pay-result?order=<id>`.
- `server/api/payments/payway/webhook.post.ts` — same processing path for the server-to-server
  notification if the merchant profile enables one; 200 `OK` on success **and on replays** (idempotency
  is what makes retries safe).
- **No other server route exists**, and none of them ever log or echo key material.

### Secrets and runtime config

- Worker secrets (never committed, never in `runtimeConfig.public`):
  `NUXT_PAYWAY_MERCHANT_ID`, `NUXT_PAYWAY_API_KEY`, `NUXT_SUPABASE_SERVICE_ROLE_KEY`.
- `nuxt.config.ts` gains server-side `runtimeConfig` entries with **empty-string defaults** (the
  build inlines only the empty defaults; the real values arrive as env bindings at runtime) and a
  comment pointing at the existing `secretKey: ''` reasoning.
- On Workers, `useRuntimeConfig(event)` **must be passed the event** or env bindings are not read
  (nitrojs/nitro#2054 — verified against current nitro + Cloudflare docs at P0); local dev uses
  `wrangler dev`/`.dev.vars` for the keys and `.env` for nuxt dev; `.env.example` documents the
  three names.
- The service-role client is constructed **inside** the payments routes only, with
  `{ auth: { persistSession: false } }`; the browser bundle must never contain the key — asserted by
  a build-output audit task (P5), not by hope.

## UI

- `/checkout/success` (order placed) and `/account/orders/[id]` gain a **Pay now** action, visible
  only when `status = 'pending'` and `payment_status = 'unpaid'`; the order detail also shows the
  payment status chip (`unpaid`/`paid`/`refunded`).
- `app/pages/checkout/pay-result.vue`: renders the final state (paid / failed / cancelled) read from
  the order row after the server round trip; failed/cancelled states offer **Try again** (a fresh
  attempt row + tran_id).
- All copy via `t()` (en + km); no new tuned geometry — these are ordinary page surfaces, so the
  existing overflow/Khmer sweeps apply and no touch-restricted area is touched.

## Testing

- `bun test` (unit, the bulk of the proof): hash field order + determinism (Node `crypto` and
  WebCrypto cross-runtime equality in the same test); `tran_id` length/uniqueness charset; items
  base64 shape ≤500; callback verification accepts good / rejects tampered payloads; error-code
  mapping; `applyPaywayResult` idempotency, amount mismatch, unknown tran_id, double-apply.
- Sandbox end-to-end (manual, recorded at P3 on the G2 environment): create → PayWay sandbox
  checkout → pay with a sandbox method → return lands, Check Transaction confirms, order shows
  `paid`; then replay the same webhook payload by hand and prove the second apply is a no-op.
- Harness (client-side only): "Pay now" visibility rules per state and the `pay-result` page states,
  all with stubbed `/rest/v1`. The server routes are not exercised by the browser harness — by
  design, their logic is what the unit tests cover; the manual sandbox run covers the wiring.
- P5 audit: grep the built `.output` for the secret values and for service-key-shaped strings;
  confirm `runtimeConfig.public` carries none of the three names with values.

## Success criteria

1. A sandbox payment end-to-end on the gated environment, recorded (tran id, before/after order
   rows); a tampered callback rejected; a replayed callback a no-op (single `paid` transition).
2. `bun test` green on the full utils surface above.
3. COD paths and all phases-1–3 checks untouched and green; `bun run verify` green once for the
   module.
4. No secret value and no service-role key reachable from the client bundle (audit output recorded);
   `ARCHITECTURE.md` documents the server-tier exception and the key's confinement in the same
   commit as the routes.
5. Refund flow: `mark_payment_refunded` refuses non-admins (`NOT_ADMIN`) and flips
   `orders.payment_status` → `refunded` + `payments.status` → `refunded` with a note; the refund
   itself is executed manually in the ABA merchant portal (v1 decision — no refund API integration).

## Open questions (recorded for P0)

- KHR: v1 charges USD (stored currency); KHR display at checkout remains deferred.
- Refund API automation — deferred; manual portal flow + DB marker is v1.
- Whether the merchant profile supports webhooks at all, or only return-URL delivery — determined at
  G2; the webhook route ships regardless (harmless if unused) because it is the retry-safe path.
- Paid-then-cancelled orders: money is returned manually; the DB keeps `paid` on the payment and
  `cancelled` on the order — the refund marker is the admin's explicit act.
