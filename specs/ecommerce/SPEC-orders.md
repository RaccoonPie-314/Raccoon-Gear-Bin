# SPEC-orders — module id `orders`

Phase 3. Depends on `cart` and `identity`. Specified in [CAPABILITY-MAP.md](CAPABILITY-MAP.md);
global rules in [SPEC-overview.md](SPEC-overview.md).

## Objective

Place an order (delivery + pay-on-receipt), keep a buyer-readable record, and give the seller an
admin surface to run the lifecycle. The money path is the point of this module: **one atomic RPC
computes the charged price from the database rows under row locks, snapshots it, and decrements
stock — the client never writes stock, prices, or order rows directly.**

Fulfilment model (locked): checkout captures name / phone / province+address / note; the seller
confirms by phone or Telegram and settles shipping (shipping is not free — existing policy; its cost
is **not** part of `orders.total` in v1, settled at confirmation).

## Boundaries

- **Owns**: `orders`, `order_items`, the `effective_unit_price` SQL rule, `create_order` /
  `set_order_status` / `anonymize_customer` RPCs, checkout page + `useCheckout`, buyer order
  history, admin order management, `/admin/orders`.
- **Does not own**: cart state (`cart`), pricing **display** rule (`getProductPricing` stays the
  only TS owner), stock bands (`getProductStockState`), payment integration (`payments` — it only
  reads/writes `orders.payment_status` via its server tier), legal copy (`compliance`).
- Read side of `profiles` (checkout prefill) goes through `useCustomerAuth` — `orders` depends on
  `identity`, so that direction is declared and allowed.

## Schema — `supabase/migrations/<ts>_orders_and_checkout.sql`

```sql
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Nullable on purpose: account deletion must not destroy the order record; the FK detaches and
  -- the PII columns are anonymized (see anonymize_customer below).
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'delivered', 'cancelled')),
  -- Delivery snapshot. Nullable so anonymization can null them; create_order enforces presence.
  delivery_name text, delivery_phone text, delivery_address text, delivery_note text,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  total numeric(10,2) not null check (total >= 0),
  -- v1: no fees, so they are equal; shipping fees relax this check in a later migration.
  constraint orders_total_matches_v1 check (total = subtotal),
  currency text not null default 'USD',
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded')),   -- only 'unpaid' is reachable until phase 4
  confirmed_at timestamptz, delivered_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  -- Product may be deleted later; the snapshot below survives (set null, not cascade).
  product_id uuid references public.products(id) on delete set null,
  name_snapshot text not null,           -- translation picked for the checkout locale (loc → en → first)
  sku_snapshot text not null,
  unit_price numeric(10,2) not null,     -- what was actually charged
  unit_price_original numeric(10,2),     -- pre-promo price when a promo applied, else null
  promo_label_snapshot text,
  quantity integer not null check (quantity > 0),
  line_total numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_user_created on public.orders(user_id, created_at desc);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_order_items_order on public.order_items(order_id);

create trigger set_updated_at_orders
before update on public.orders
for each row execute function public.handle_updated_at();
```

`order_items` is immutable: no `updated_at`, no trigger, no update policy anywhere.

### RLS (mirrors the existing policy style, inline `admin_users` exists-checks)

- `orders` select: `user_id = auth.uid() OR exists (select 1 from public.admin_users au where au.user_id = auth.uid())`.
- `order_items` select: `exists (select 1 from public.orders o where o.id = order_items.order_id and (o.user_id = auth.uid() or <admin-check>))` — same nested-exists shape as `product_translations`.
- **No insert / update / delete policies on either table.** All writes go through the RPCs below;
  `orders` and `order_items` are read-only tables for every client role. (RLS-enabled tables default
  deny, which is exactly the intent.)

### `effective_unit_price` — the SQL side of the written pricing rule

```sql
-- Mirrors app/utils/product-pricing.ts. Same rule, same inputs, same output:
-- promo applies iff promo_price < price AND cap not exhausted AND window open at p_at.
create or replace function public.effective_unit_price(p_product public.products, p_at timestamptz)
returns numeric
language sql immutable
as $$
  select case
    when p_product.promo_price is not null
     and p_product.promo_price < p_product.price
     and (p_product.promo_quantity is null or p_product.promo_quantity > 0)
     and (p_product.promo_starts_at is null or p_product.promo_starts_at <= p_at)
     and (p_product.promo_ends_at is null or p_product.promo_ends_at > p_at)
    then p_product.promo_price
    else p_product.price
  end;
$$;
```

The migration carries a `do $$ ... $$` **self-check**: it builds `public.products` record variables
field-by-field (no inserts, no FK needed) for four fixtures — no promo; live promo; closed window;
exhausted cap — and raises if the function answers anything but the fixtures' expected values. The
same cases live in `tests/fixtures/pricing-cases.json` with hand-written expectations; the TS side is
asserted by `bun test`, the SQL side by this block, and **both must equal the same written
expectations** ([SPEC-overview.md](SPEC-overview.md) → Testing strategy).

### `create_order` — the only order write path

```sql
create_order(p_items jsonb, p_delivery jsonb, p_locale text) returns uuid
```

Contract, in order:

1. `auth.uid()` must be non-null → else raise `AUTH_REQUIRED`.
2. `p_items` = `[{ "productId": uuid, "quantity": int }]`, 1..50 lines; duplicate `productId`s are
   aggregated (summed); quantity per line 1..999 → else `INVALID_QUANTITY:<productId>`; empty →
   `CART_EMPTY`.
3. Delivery fields (name, phone, address) trimmed, non-empty, length-capped (100/20/300) → else
   `INVALID_DELIVERY`. Note is optional. Phone stays loose (min 8 digits) — the seller confirms by
   calling it.
4. Locks product rows: `select … from public.products where id = any(<ids>) order by id for update`
   (ordered to avoid deadlocks). Missing row or `status <> 'published'` → `PRODUCT_UNAVAILABLE:<id>`.
5. Per line: charge `effective_unit_price(p, now())`; `quantity <= stock_quantity` else
   `INSUFFICIENT_STOCK:<id>:<available>`; when the *promo price* applies and `promo_quantity` is not
   null, `quantity <= promo_quantity` else `PROMO_LIMIT:<id>:<remaining>`. **Reject, never silently
   reprice** — the buyer decides what to reduce.
6. Decrements `stock_quantity -= quantity`; decrements `promo_quantity -= quantity` only on lines
   charged at the promo price.
7. Inserts `orders` (status `pending`, `payment_status 'unpaid'`, `subtotal = total`) and
   `order_items` snapshots: name resolved by locale (`p_locale` → `en` → first), `sku_snapshot`,
   `unit_price`, `unit_price_original` when discounted, `promo_label_snapshot`.
8. Returns the order uuid. Whole function is one transaction — decrement and insert cannot diverge.

Raises use SQLSTATE `P0001` with the machine codes above — plus `CART_TOO_LARGE` (over 50 lines)
and `ORDER_NOT_FOUND` (an admin acting on a missing order), added by the migration's own guards.
**Messages are codes, not copy**: the
client maps prefix → `t()` key and passes the trailing values as params (`INSUFFICIENT_STOCK:<id>:<n>`
→ `Only {n} left…` style keys added in this module).

Auth surface (both RPCs, both security-definer and `set search_path = ''`, fully qualified refs):

```sql
revoke all on function public.create_order(jsonb, jsonb, text) from public, anon;
grant execute on function public.create_order(jsonb, jsonb, text) to authenticated;
```

(Postgres grants EXECUTE to PUBLIC by default — the revoke is part of the contract, not decoration.)

### `set_order_status` — the only status write path

```sql
set_order_status(p_order_id uuid, p_status text, p_note text default null) returns void
```

Admin-gated inside (inline `admin_users` exists-check → raise `NOT_ADMIN` otherwise). Allowed
transitions, the single written table (also mirrored in `app/utils/order-status.ts` for button
visibility):

| From | To allowed |
|---|---|
| `pending` | `confirmed`, `cancelled` |
| `confirmed` | `delivered`, `cancelled` |
| `delivered` | — (terminal) |
| `cancelled` | — (terminal) |

Side effects: entering `confirmed` sets `confirmed_at`; `delivered` sets `delivered_at`; `cancelled`
sets `cancelled_at` **and restores `stock_quantity += quantity` and `promo_quantity += quantity`
for every line** (restoring the cap is correct even if the promo window has since closed — the cap
is a unit count, not a window). Invalid transition → `INVALID_TRANSITION:<from>:<to>`.

Amended 2026-10-04 (owner request): `p_note` is an optional cancellation reason the cancel branch
stores on `orders.cancel_note` (blank/whitespace trims to null; other transitions ignore it) — the
column arrived in `20261004180000_order_cancel_note.sql`, which also clears `cancel_note` in
`anonymize_customer`, because free text can hold personal detail and the deletion runbook owns that
surface. The signature change was a drop-and-recreate with the grant re-issued (a defaulted third
parameter beside the old two-argument function would have made every existing call ambiguous).
Surfaces: the desk's cancel confirmation asks for the reason; the buyer's order detail renders it;
the desk's expanded row shows it.

### `anonymize_customer` — the deletion path `compliance` documents

```sql
anonymize_customer(p_user_id uuid) returns integer   -- count of orders anonymized
```

Admin-gated. Nulls `delivery_name`, `delivery_phone`, `delivery_address`, `delivery_note` on all of
that user's orders (keeps totals/items for accounting). **Run before deleting the auth user**: after
the delete, `user_id` is null and the rows are unfindable. The compliance runbook sequences it.

`app/types/database.ts` gains `OrderRow`, `OrderItemRow`, and both tables' `Relationships`
(`orders.user_id → auth.users` is external and is *not* listed — `Relationships` only mirrors FKs
between tables in this schema, per the existing file's convention; `order_items.order_id` and
`product_id` are). `app/types/orders.ts` adds the mapped shapes (`OrderView`, `OrderItemView`,
`OrderStatus`).

### `notify_telegram_new_order` — the order push (amended 2026-10-05, owner request)

```sql
order_telegram_text(p_order public.orders, p_items jsonb) returns text  -- fixture-pinned format
notify_telegram_new_order() returns trigger                             -- deferred constraint trigger
```

Arrived in `20261005120000_order_telegram_push.sql`. Every new order is POSTed to the shop's
Telegram bot through pg_net. **Deferred to commit** (`deferrable initially deferred`) on purpose:
`create_order` inserts the `orders` row in pass 1 and its items in pass 2, so a plain row trigger
would fire on an empty item list, while a deferred one sees the finished order — and a rolled-back
order never fires it at all. Token + destination chat live in Vault (`telegram_bot_token` /
`telegram_chat_id`); with either absent the trigger is inert, so the feature turns on by creating
the two secrets and nothing in the migration changes. The trigger body is exception-wrapped
because it fires **at commit**, where any unhandled error would roll back the buyer's order; a
failed send raises a warning and stays visible in `net._http_response` (kept 6h). No retry queue,
by design. `order_telegram_text` is pinned by the migration's own `do $$` fixture (the
`effective_unit_price` precedent); the message is plain text (no Telegram markup) so buyer-entered
text can never break it, and it is clipped to 4000 chars before sending (Telegram's limit is
4096).
Amended 2026-10-05 (owner request, second pass): the message is labeled lines — `User:`, `Phone:`,
`Location:`, `Note:`, `Items:` — and each item line carries its line total plus the product's
live-storefront link (`20261005130000_order_telegram_format.sql` `create or replace`s the builder
and the trigger's payload; the link base is pinned to the deployed Workers URL until a custom
domain lands, and a deleted product simply lists without a link).
Amended 2026-10-05 (owner request, third pass): the item line itself is the link — an HTML `<a>`
anchor with `parse_mode: HTML`, replacing the bare URL underneath
(`20261005140000_order_telegram_links.sql`). Because HTML mode makes the message markup-sensitive,
every dynamic field (name, phone, address, note, item text) is escaped through
`order_telegram_escape` (`&` first), and the 4000-char clip cuts at a line boundary — a mid-tag
cut would be an unclosed tag and a 400.

## Buyer surfaces

- `app/composables/useCheckout.ts`: loads fresh products via `useCatalog().fetchProducts()`, resolves
  `cartTotals`, collects delivery input (prefilled from `useCustomerAuth().fetchProfile()`), composes
  the RPC payload (`p_items` from the clamped lines, `p_delivery`, `p_locale` from `useI18n()`),
  calls `supabase.rpc('create_order', …)`, on success clears the cart and navigates to
  `/checkout/success?order=<id>`; on `P0001` maps the code to a `t()` message and surfaces it without
  navigating. Double-submit guarded by an in-flight flag (the RPC itself is not idempotent; two
  deliberate orders are two orders).
  Amended 2026-10-05 (owner request): the delivery form's address gains **use my location** —
  `navigator.geolocation` behind the browser's own permission prompt (the call only ever runs
  from the click; no custom modal), formatted by `app/utils/geolocation.ts` as a Google Maps pin
  URL (`https://maps.google.com/?q=lat,lng`, 5 dp). No reverse-geocoding service on purpose:
  the free ones answer at city level, which cannot route a courier, while the pin is exact — and
  Telegram auto-links bare URLs in the order push. Every click re-asks: the flow consults
  `navigator.permissions.query` first — `granted` reads straight, `prompt` triggers the browser's
  own ask, and a hard `denied` (which no script can ever re-prompt — the browser's anti-nagging
  rule) shows actionable guidance instead: allow Location from the address-bar icon, then click
  again, which reads. `unavailable` / `timeout` render the failed message; a denial or failure
  never replaces a typed address; `useCheckout` owns `isLocating` / `locationError` / `locate`.
  Harness: a denied arm and a granted arm (`Browser.setPermission` +
  `Emulation.setGeolocationOverride`), both on the checkout form in the guest slice — the grant
  between them proves the per-click recovery.
  Amended 2026-10-05 (owner request, fourth pass): the pin is its own field — `delivery_location`
  on `orders` (`20261005150000_delivery_location.sql`) — not a replacement for the typed address,
  and **both are required**: `create_order` validates the location as an `http(s)://` URL through
  the same `INVALID_DELIVERY` answer, so no new error code exists, and `anonymize_customer`
  clears the pin like every other delivery PII. The Telegram message carries it as an anchored
  `Pin:` line between the address and the note (absent on pre-migration orders). Both order
  surfaces (buyer detail, desk expanded row) render it as an `[data-order-location]` link.
  Amended 2026-10-05 (fifth pass, owner request): submit refuses an incomplete delivery
  **locally first** — a module-scope mirror of the RPC's bounds (same limits, one predicate per
  field so the live red state and the refusal can never disagree) marks **every** invalid field
  through the library's own error affordance: `color="error"` reds the input, the form field's
  `error` slot shows the per-field hint (`requiredName` / `requiredPhone` / `requiredAddress` /
  `requiredLocation`). The first offender is scrolled into view and shaken (`shake` in
  `app/utils/motion.ts`, 400 ms, self-guarded under reduced motion), and no request is spent; the
  RPC's `INVALID_DELIVERY` remains the authority for anything the mirror misses. `invalidFields`
  is a computed — the red and the hint clear the moment the field is fixed, no second submit.
  Harness: an empty-address submit shakes, shows the hint and sends nothing, and typing the
  address clears the hint.
  Amended 2026-10-05 (owner request, redesign): the page is a **locked frame at every width**
  (`h-dvh` — it tracks a phone's URL bar; `lg:h-screen` because `dvh` mis-measures in the harness
  viewport). On a phone the summary pane takes 48% of the frame and its title hides below `sm` —
  a real phone is ~715 px tall, not the harness's 844, and dropping the 52 px header is what
  keeps **two item rows** visible there (rows compact to `py-3` + `h-16` thumbs below `sm`) — and
  the form pane's fields scroll while the submit block (settlement note, error, submit, back)
  rides as `shrink-0`, pinned at the pane's bottom so the button can never fall behind a fold.
  At `lg` the frame splits into two columns (summary left, form right). Harness: the one-screen
  arm asserted at 1440×900 **and** 390×844 (no page overflow, `scrollY` 0, submit on-screen).
- `app/pages/checkout/index.vue`: order summary (reuses `cartTotals` output; `ProductPrice` rows),
  delivery form, submit; signed-out visitors never see it (identity guard). **`index.vue`, not
  `checkout.vue`** (amended 2026-10-04): `checkout.vue` + the `checkout/` folder nest as parent and
  child routes, and a parent without `<NuxtPage/>` makes `/checkout/success` render the parent —
  the harness caught it as "URL changed, the page did not".
- `app/pages/checkout/success.vue`: confirmation with order reference and a link to the order page.
  (The payments phase adds a Pay-now entry here; until then it is COD confirmation only.)
- `app/pages/account/orders/index.vue` + `app/composables/useCustomerOrders.ts`: list (newest first,
  status chip, date, total, item count) and detail (items from snapshots, delivery block, status
  timeline, "Contact the shop" link that reuses the existing contact channels).
  Amended 2026-10-04: both reads are explicitly scoped to the signed-in account
  (`.eq('user_id', …)`). The SELECT policy also grants admins every row and the owner's own account
  is an admin, so without the filter "My account → Orders" listed the whole shop — orders appeared
  carried across accounts. The desk keeps the everything-view; the harness asserts the list request
  carries `user_id=eq.<id>`.
  Amended 2026-10-04 (owner request): the catalog masthead's utility row carries an **Orders pill**
  (`app/pages/index.vue`, `v-if="user"`, label `t('orders')`) linking straight to
  `/account/orders` — the account page's entry stays, but checking orders is one click from the
  storefront. Signed-out visitors see no pill (nothing to list; the account pill is the sign-in
  path).
  Amended 2026-10-04 (owner request, notices): the pill's target is the audience's —
  `/account/orders` for a buyer, `/admin/orders` for an admin account (their own account has no
  purchases) — and it wears a badge: for a buyer, the count of orders whose latest lifecycle stamp
  (newest of created / confirmed / delivered / cancelled) is newer than a browser-local seen marker
  raised by every orders fetch (`app/utils/order-notices.ts`, `useCustomerOrders.fetchUnseenCount`);
  for an admin, the desk's pending count (`useAdminOrders.fetchPendingCount`). Badge counts are the
  whole notification — no email/push (no custom SMTP), and the marker is per-browser.

## Admin surface

- `app/pages/admin/orders.vue` + `app/features/admin/components/AdminOrdersPanel.vue` +
  `app/features/admin/composables/useAdminOrders.ts` (the folder is already auto-import registered).
- `AdminTabs.vue` gains `{ id: 'orders', to: '/admin/orders', labelKey: 'orders' }`.
- List: status filter chips (`all` / `pending` / `confirmed` / `delivered` / `cancelled`, newest
  first, pending first within "all"). Detail: items, delivery block, totals, payment status, and
  exactly the transition buttons `order-status.ts` allows for the current state, each calling
  `set_order_status` then refreshing.
  Amended 2026-10-05 (owner request): the desk carries a **search** beside the chips — client-side
  over the loaded list (no extra read), case-insensitive, across the order reference, delivery
  name/phone/address and item name/sku; a leading `#` is stripped so the reference the row prints
  can be pasted back in. No matches → the existing "no orders in this view" note (no new key);
  the input is `t('adminOrderSearch')`.
- New-order awareness: the dashboard, plus the Telegram push above (the between-tasks path); no
  realtime feed in the app.

## `app/utils/order-status.ts`

Pure, no reactivity (same ownership shape as the other two utils):

```ts
export type OrderStatus = 'pending' | 'confirmed' | 'delivered' | 'cancelled'
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = { /* the table above */ }
export const orderTransitions = (from: OrderStatus): readonly OrderStatus[] => ORDER_TRANSITIONS[from]
```

Both the buyer timeline and the admin buttons read it; the SQL transition table remains the
authority — the unit test pins this table to the same written expectations, and the migration
self-check pins the SQL side.

## i18n keys (new; both locales)

Amended 2026-10-04 to the as-built set. New keys: `checkoutTitle`, `deliverySection`, `deliveryName`,
`deliveryPhone`, `deliveryAddress`, `deliveryNote`, `costSettlementNote` (shipping settled at
confirmation), `checkoutSummary`, `checkoutCartEmpty`, `placeOrder`, `placingOrder`,
`orderSuccessTitle`, `orderSuccessBody`, `orderNumber`, `viewOrder`, `orders`, `orderDate`,
`orderTotal`, `orderItems`, `orderStatus`, `statusPending`, `statusConfirmed`, `statusDelivered`,
`statusCancelled`, `orderEmpty`, `ordersLoadError`, `orderNotFound`, `paymentStatus`,
`paymentUnpaid`, `paymentPaid`, `paymentRefunded`, `contactShop`, `contactAboutOrder` ({ref}),
`backToOrders`, `filterAll`, `confirmOrder`, `markDelivered`, `cancelOrder`, `cancelOrderConfirm`,
`transitionError`, `adminFilterEmpty`, `errInvalidDelivery`, `errProductUnavailable`,
`errInsufficientStock` ({n} units), `errPromoLimit` ({n} left at this price), `errInvalidQuantity`,
`errUnknown`.

Reused rather than minted, deliberately: `loginRequired` for AUTH_REQUIRED (the plan's
`errAuthRequired`), `cartEmpty` for CART_EMPTY (the plan's `errCartEmpty`), and `orders` for the
admin desk's heading and tab (the plan's `adminOrders`). Dropped: `order` and `orderPlaced` (the
success page says "Order placed" through `orderSuccessTitle`). `paymentPaid`/`paymentRefunded`
ship now although only `unpaid` is reachable — the label map is complete so the payments phase adds
no keys.

## Harness extension (same commit as each surface)

- Full purchase path with stubbed `/auth/v1` + `/rest/v1`: signed-in cart → checkout → submit →
  the recorded request tuple is exactly one `POST /rest/v1/rpc/create_order` whose body carries the
  clamped items, the delivery fields, and the locale; the cart then reads empty; the success page
  shows the returned order id.
- Error path: the stub answers `P0001 PROMO_LIMIT:<id>:2` → the message renders, the cart is intact,
  no navigation.
- Buyer history: `/account/orders` lists the stubbed order; status chip matches.
- Admin: `AdminTabs` shows the orders tab; a pending order offers exactly `confirmOrder` +
  `cancelOrder`; confirming issues exactly one `POST /rest/v1/rpc/set_order_status`; a cancelled
  order offers no buttons.
- Guard: signed-out `/checkout` redirects to `/login` (identity header) and the cart page CTA still
  routes there.

## Success criteria

1. `supabase db reset` clean — including the pricing self-check block — and the RLS checklist
   recorded: anon/owner/admin select behaviours as specified; insert/update/delete on both tables
   denied for every client role; `create_order` callable by `authenticated` only; the status RPC
   refuses non-admin callers with `NOT_ADMIN`.
2. `bun test` green on: pricing fixtures (TS side), order-status transition fixtures, and the
   `scripts/verify-pricing-parity.mjs` dev run recorded once against the local stack (both sides
   answer the shared expectations identically).
3. A manual walkthrough on the local stack (real rows): place an order → stock and promo caps
   decremented; cancel it → both restored; place with a quantity above the cap → the precise error,
   nothing written.
4. Harness checks above green; all pre-existing checks green.
5. `ARCHITECTURE.md` updated in the same commit as the module's design lands (new write path, RPC
   authorities, the `total = subtotal` v1 check, the anonymization contract).

## Open questions

- Buyer self-service cancellation — deferred (contact-first, matches COD reality).
- Admin editing of delivery details on an order — deferred until asked for; RPC-only writes make it
  a deliberate addition, not an accident.
- Shipping-fee line in totals — deferred; `orders_total_matches_v1` is the named relaxation point.
