-- Promotions. One price cut per product, optionally named, time-boxed and quantity-limited:
-- `price` stays the original the storefront crosses out, and every column here is nullable, so a
-- product with no promotion is byte-for-byte the row that existed before this migration.
--
-- The storefront rule that reads these five columns lives in `app/utils/product-pricing.ts`.
alter table public.products
  -- A discount that is not lower than the price it replaces is not a discount: decided here, once,
  -- so no client can write a crossed-out price that equals the price.
  add column promo_price numeric(10,2) check (promo_price is null or (promo_price >= 0 and promo_price < price)),
  -- The campaign's own name ("Khmer New Year Sale"), shown where the storefront would otherwise
  -- say only "Sale". Free text on purpose: a catalogue of campaign types would be a second schema.
  add column promo_label text,
  -- How many units go at the promo price. Nothing decrements it — there is no checkout yet, so the
  -- owner manages it the way they already manage `stock_quantity`. Zero or null is enforced here.
  add column promo_quantity integer check (promo_quantity is null or promo_quantity > 0),
  -- The time window. Either end may be open; the pair is what makes an ordering impossible to write.
  add column promo_starts_at timestamptz,
  add column promo_ends_at timestamptz check (promo_ends_at is null or promo_starts_at is null or promo_ends_at > promo_starts_at);
