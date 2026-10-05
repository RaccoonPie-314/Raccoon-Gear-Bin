# SPEC-cart — module id `cart`

Phase 2. Depends on `identity` (soft — the merge path) and reads the catalog through `useCatalog`
only. Specified in [CAPABILITY-MAP.md](CAPABILITY-MAP.md); global rules in
[SPEC-overview.md](SPEC-overview.md).

## Objective

A device-local cart that works signed-out, merges into the account on sign-in, and never stores a
price: every number the shopper sees is resolved live from the catalog rows through the one pricing
rule ([product-pricing.ts](../../app/utils/product-pricing.ts)). The cart is a *list of intents*
(`productId` + quantity); prices, availability, and caps are questions asked at render time, and the
final authority is the `create_order` RPC ([SPEC-orders.md](SPEC-orders.md)).

## Boundaries

- **Owns**: cart state, persistence, guest→user merge, quantity clamps for display, the masthead
  control, `/cart`, and the add-to-cart entry on the product detail page.
- **Does not own**: pricing (`getProductPricing`), stock bands (`getProductStockState`), product
  fetching (`useCatalog.fetchProducts`), order submission (`orders`), auth (`identity`). The cart
  stores **no prices and no product data** — only ids and quantities.
- ponytail: no cross-tab sync, no cross-device sync, no saved-for-later, no coupon codes in v1.
  Each is deferred with a trigger in [plans/003 → Phase 5](../../plans/003-ecommerce-implementation-plan.md).

## State model

- `CartLine = { productId: string; quantity: number }` (quantity ≥ 1).
- Storage key: `raccoon-cart:v1:<scope>`, scope = `guest` or the signed-in user's uuid.
- Payload: `{ version: 1, items: CartLine[] }` — defensively parsed on load (drop malformed entries,
  drop non-string ids, clamp quantities to 1..999); a corrupt payload resets to empty rather than
  throwing.
- `app/composables/useCart.ts` (in `app/composables/`, not a feature folder — masthead, cart page,
  checkout, and the merge watcher all read it):

| Member | Behaviour |
|---|---|
| `items` | reactive `CartLine[]`, backed by `useState('cart:items')` so every consumer sees one list |
| `count` | computed sum of quantities (what the badge shows) |
| `addLine(productId, quantity = 1)` | adds or bumps the line |
| `setQuantity(productId, quantity)` | clamp to 1..999; UI clamps further to the live cap |
| `removeLine(productId)`, `clear()` | obvious |
| merge-on-sign-in | watches `useSupabaseUser()`: on a sign-in transition, reads the guest key, sums quantities into the user key (then clamps to 999), deletes the guest key. Once per transition, client-only |

**SSR and hydration**: all storage access is guarded (`import.meta.client`); on the server the cart
is empty. The masthead badge renders **only after mount** (the count is client state; painting it
during SSR and hydrating a different number is the hydration-mismatch trap). The cart page and
checkout are client-resolved by nature.

## The rule that stays where it is

`app/utils/cart-totals.ts` — one pure function, unit-tested, no reactivity and no DOM (same shape of
ownership as `product-pricing.ts` / `product-stock.ts`):

```ts
export type CartLineIssue = 'ok' | 'unavailable' | 'over-stock' | 'over-promo-cap'

export type CartLineView = {
  line: CartLine
  product: CatalogProduct | null          // null when the row is gone or unpublished
  quantity: number                        // the clamp actually applied
  pricing: ProductPricing | null          // asked of getProductPricing, never recomputed here
  lineTotal: number
  issue: CartLineIssue
}

export const cartTotals = (
  lines: CartLine[],
  products: CatalogProduct[],
  now: number = Date.now()
): { lines: CartLineView[]; itemCount: number; subtotal: number; currency: string } => { /* … */ }
```

Rules it encodes (and nothing else):

- `unavailable`: no matching product in the fresh list (deleted, archived, or unpublished).
- Live cap = `min(stock_quantity, promo_quantity when a promotion is live)`; `quantity` is the
  stored value clamped to that cap; issue `over-stock` / `over-promo-cap` records which cap bit.
- `lineTotal = pricing.price * quantity`; `subtotal` sums valid lines; `currency` comes from the
  products (USD in practice).
- **No price-change detection in v1**: the cart always shows live prices — what is displayed at
  checkout is what the order charges, and `create_order` rejects with a precise error if state moved
  between render and submit. ponytail: an add-time price snapshot for "price changed" banners is
  deferred; the RPC error path already protects the money.

After validation, the page **writes the clamp back** (`setQuantity`) so badge, cart page, and
checkout agree on the same numbers.

## UI surfaces

1. **Masthead control** (`app/components/` — presentational: props in, events out; it reads `count`
   only through the page that mounts it): icon button in the utility row, badge with `count`
   (mounted-only), same control language and 44px single-line height contract as the existing
   utility buttons. **Touch-restricted**: the masthead is harness-measured (two levels, emblem
   heights at five widths, collision, no horizontal overflow) — extend those checks in the same
   commit. If integration proves invasive to the tuned header, the fallback is a floating dock
   (precedent: `ContactDock.vue`); that switch is a K2 review decision, not a silent one.
2. **Product detail add-to-cart**: one control beside the conversion CTA, disabled at `out` band
   (label changes through `t()`), writes the cart only — no network. The tuned conversion area
   (`ProductActions.vue` panel/scroll behaviour) must not change; the existing conversion checks stay
   green and a new check asserts the add control's state per stock band.
   Amended 2026-10-05 (owner request): the add plays a **fly-to-cart** micro-interaction — a ghost
   lifts from the button along a bowed path into the header's cart badge
   (`app/utils/fly-to-cart.ts`, WAAPI on transform/opacity, ~450 ms with a strong ease-out,
   self-removing), while the badge pops once via `iconPop` (owned by `CartControl` on every count
   rise, so every mount gets it). Both are decoration and both skip under `prefers-reduced-motion`;
   cart state and `useCart` are untouched. The ghost is only measured after `nextTick` — the badge
   is `v-if`'d on a non-zero count and does not exist at click time.
   Amended again 2026-10-05 (owner request, second pass): the flight is now the **SearchDock
   engine's own recipe** — the 80px `sin(t·π)` bow (0.6 lateral against the travel, 0.5 lift),
   scale `1 + apex·0.16 − t·0.10`, apex bank, FIELD_FLY_MS 500ms — sampled into a single WAAPI
   path, and the landing plays the engine's `catchLanding`: the shared `arrival` recoil on the
   badge, on a real landing only (a cancelled flight just removes the ghost). The `iconPop` pop
   stays (the tap's instant acknowledgement; the catch is the flight's punctuation). Flight and
   catch both skip under `prefers-reduced-motion`.
3. **`/cart` page** (`app/pages/cart.vue`): line rows (thumb from `thumbUrl`, name,
   `ProductPrice` with the product, `StockStatus` with the live quantity, clamped quantity stepper,
   line total, remove), per-line issue notices, summary (subtotal, item count), CTA to `/checkout`
   (the identity guard intercepts signed-out visitors), empty state, "continue shopping" link.
   Presentational components are reused, never re-implemented here.
   Amended 2026-10-05 (owner redesign): the page is the checkout's locked frame — at every width
   no page scroll (`h-dvh`; `h-screen` from `lg`), the lines card on the left/top (a long cart
   scrolls inside the list; rows compact to `py-3` + `h-16` thumbs below `sm`) taking whatever the
   frame gives, and the money end (subtotal card, then the checkout CTA) **content-sized** — a
   real phone is ~715 px tall, not the harness's 844, and a percentage share squeezed the
   subtotal against the CTA there; content sizing keeps their gap constant (~24 px, inside the
   harness's asserted 8–64 px band) and can never fall behind a fold. Two columns from `lg`. The
   one-screen arm runs at 1440×900 **and** 390×844 (`[data-cart-checkout]` on-screen, no
   overflow, `scrollY` 0).

## i18n keys (new; both locales)

`cart`, `addToCart`, `addedToCart`, `viewCart`, `yourCart`, `cartEmpty`, `cartEmptyCta`,
`cartSubtotal`, `cartItemCount`, `quantity`, `removeFromCart`, `removedFromCart`,
`cartUnavailable`, `cartStockChanged`, `cartPromoChanged`, `checkoutCta`, `continueShopping`,
`cartNoticeSummary`. Wordings at task K2; no collisions with harness-matched strings.

## Harness extension (same commit as each surface)

- Badge: add from the detail page → badge reads 1, then 2 after a second add (same product bumps).
  The same add asserts the full rhythm: the badge's computed scale crosses iconPop's overshoot, the
  ghost appears, banks (a mid-flight `matrix.b ≠ 0` — a straight-line ghost cannot fake it), and
  removes itself, and after the pop's window the badge's scale crosses 1.02 again — the `arrival`
  landing catch, which nothing else can be; a reduced-motion arm on the second add proves no ghost
  flies (the count check beside it is the positive control).
- Persistence: reload keeps the cart; a fresh browser context does not.
- Merge: add signed-out → sign in via stub → same lines, guest key gone.
- Drift: the stub answers a lower `stock_quantity` on the second visit → cart shows the cap notice
  and the write-back (badge equals the clamped count).
- Totals: with the promo fixture live, the cart's subtotal equals `price × quantity` at the promo
  price; with the promo window closed in the fixture, the subtotal shows the original price.
- Overflow sweeps at the five masthead widths and 320/390/640 in both colour schemes stay green
  (masthead edit) plus the detail-page convergence checks stay green (add control).

## Implementation notes (2026-10-04)

- Amended 2026-10-04 (phase 3): the `/cart` checkout CTA now routes to `/checkout`. The earlier
  rule — disabled until the checkout page existed, a live link to a 404 being worse than an
  explained wait — retired when that page landed.
- Amended 2026-10-04 (post-K2, owner request): the masthead control was extracted to
  `CartControl.vue` (`count` prop, badge gated on a client-mounted flag) and is also mounted in the
  **product detail header**, so the cart is reachable from the description page. The harness check
  landed in the same change; both mounts render the one component.
- Amended 2026-10-04 (owner bug report): the per-scope transition watcher must outlive the page
  that first called `useCart` — it runs in a detached `effectScope(true)`. Component-scoped, it
  died at the first client-side navigation and `bound` blocked re-registration, so items in
  `useState` memory followed the next account ("items carried across accounts"). The harness walk
  now signs in client-side on one document and asserts the guest key is consumed into the account.
- The page keeps an `adjusted` line map beside the write-back clamp: the clamp makes the live
  `over-*` issue vanish by construction on the following render, so the notice's reason is sticky
  until the shopper touches the line. The harness asserts the notice survives the write-back.

## Success criteria

1. `bun test` green on `cart-totals` fixtures: normal lines, live promo with cap, closed promo
   window, out-of-stock line, missing product, quantity above both caps, empty cart, malformed line
   input to the loader.
2. Signed-out cart works end-to-end; merge on sign-in loses nothing and never duplicates.
3. No price is ever read from storage — grep `raccoon-cart` payload shape in tests proves ids +
   quantities only.
4. Fast gates green on every commit; `bun run verify` green once before the module's G3 merge.
5. Cart never issues a network call of its own (the only reads are `useCatalog`'s existing fetch on
   storefront pages; asserted by the harness' recorded request tuples).

## Open questions

- Cross-device cart (would need a `carts` table + RLS) — deferred; localStorage is the accepted v1.
- Quick-add from product cards — deferred (card grid hover behaviour is tuned; not worth the
  measurement budget yet).
- Guest-cart expiry — not implemented; a stale guest cart is harmless (prices are live).
