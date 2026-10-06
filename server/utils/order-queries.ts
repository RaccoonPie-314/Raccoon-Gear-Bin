/**
 * The orders read SQL — server side, claims path (the routes switch into `app_authenticated`, so
 * the RLS policies decide which rows exist for the caller; the buyer routes then re-filter to the
 * caller explicitly, the same double-enforcement the desk's other reads use).
 *
 * The shape is the old `ORDER_WITH_ITEMS_SELECT` embed, on purpose: `OrderWithItemsRow` in
 * `app/utils/orders.ts` is hand-written against exactly this JSON, and the two must move together.
 */
export const ORDERS_WITH_ITEMS = `
select
  o.id, o.status, o.delivery_name, o.delivery_phone, o.delivery_address, o.delivery_location, o.delivery_note,
  o.subtotal, o.total, o.currency, o.payment_status,
  o.confirmed_at, o.delivered_at, o.cancelled_at, o.cancel_note, o.created_at,
  (
    select coalesce(json_agg(json_build_object(
      'id', i.id, 'product_id', i.product_id, 'name_snapshot', i.name_snapshot, 'sku_snapshot', i.sku_snapshot,
      'unit_price', i.unit_price, 'unit_price_original', i.unit_price_original, 'promo_label_snapshot', i.promo_label_snapshot,
      'quantity', i.quantity, 'line_total', i.line_total
    )), '[]'::json)
    from public.order_items i
    where i.order_id = o.id
  ) as order_items
from public.orders o`

/** The masthead badge's light read — the five stamp columns, nothing else (ORDER_STAMPS_SELECT's shape). */
export const ORDERS_STAMPS = 'select o.id, o.created_at, o.confirmed_at, o.delivered_at, o.cancelled_at from public.orders o'

/**
 * The machine code inside a `create_order` / `set_order_status` raise (`P0001` — e.g.
 * `INSUFFICIENT_STOCK:<id>:<n>`), or `UNKNOWN`. The RPCs raise the code as the message prefix and
 * the client maps codes to copy, so the route hands the code through untouched: never a
 * translated sentence, never the raw Postgres context.
 */
const ORDER_ERROR_RE = /(AUTH_REQUIRED|CART_EMPTY|CART_TOO_LARGE|INVALID_DELIVERY|PRODUCT_UNAVAILABLE|INVALID_QUANTITY|INSUFFICIENT_STOCK|PROMO_LIMIT|ORDER_NOT_FOUND|NOT_ADMIN|INVALID_TRANSITION)(?::[^\s]*)?/
export const orderErrorCode = (error: unknown): string => {
  const match = ORDER_ERROR_RE.exec(String((error as { message?: string } | null)?.message || ''))
  return match ? match[0] : 'UNKNOWN'
}
