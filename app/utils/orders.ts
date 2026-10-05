import type { OrderItemRow, OrderRow } from '~/types/database'
import type { OrderItemView, OrderView } from '~/types/orders'
import type { OrderStamps } from '~/utils/order-notices'

/**
 * The one row → view mapper for orders, shared by the buyer's pages (`useCustomerOrders`) and the
 * admin's panel (`useAdminOrders`). Two readers of one shape is exactly the case where a second
 * mapping lets a label and the thing it describes disagree; there is no third implementation.
 *
 * Plain functions, not a composable: no reactivity, no browser API — the same shape of ownership
 * as the catalog's mappers, but outside its composable because two features share this one.
 */

/** The input shape: an `orders` row with its `order_items` embedded by the select. */
export type OrderWithItemsRow = Pick<
  OrderRow,
  | 'id' | 'status' | 'delivery_name' | 'delivery_phone' | 'delivery_address' | 'delivery_location' | 'delivery_note'
  | 'subtotal' | 'total' | 'currency' | 'payment_status'
  | 'confirmed_at' | 'delivered_at' | 'cancelled_at' | 'cancel_note' | 'created_at'
> & {
  order_items: Pick<
    OrderItemRow,
    'id' | 'product_id' | 'name_snapshot' | 'sku_snapshot' | 'unit_price' | 'unit_price_original'
    | 'promo_label_snapshot' | 'quantity' | 'line_total'
  >[]
}

/**
 * The select both order readers hand to PostgREST (`useCustomerOrders`, `useAdminOrders`). It
 * lives beside the row type it must produce: `mapOrder` checks the result against
 * `OrderWithItemsRow`, so a column dropped from this string cannot fall out of sync silently —
 * the query stops compiling instead.
 */
export const ORDER_WITH_ITEMS_SELECT = 'id, status, delivery_name, delivery_phone, delivery_address, delivery_location, delivery_note, subtotal, total, currency, payment_status, confirmed_at, delivered_at, cancelled_at, cancel_note, created_at, order_items(id, product_id, name_snapshot, sku_snapshot, unit_price, unit_price_original, promo_label_snapshot, quantity, line_total)'

/**
 * The masthead badge's light read: five columns, no embeds. The same pairing rule as the heavy
 * select — the row type sits beside the string `mapOrderStamp` consumes.
 */
export const ORDER_STAMPS_SELECT = 'id, created_at, confirmed_at, delivered_at, cancelled_at'

export type OrderStampsRow = Pick<OrderRow, 'id' | 'created_at' | 'confirmed_at' | 'delivered_at' | 'cancelled_at'>

/** PostgREST hands numerics back as strings; absent means null, never `NaN` (the catalog's rule). */
const num = (value: number | string | null | undefined): number => Number(value ?? 0)
const numOrNull = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value)

export const mapOrderItem = (item: OrderWithItemsRow['order_items'][number]): OrderItemView => ({
  id: item.id,
  productId: item.product_id,
  name: item.name_snapshot,
  sku: item.sku_snapshot,
  unitPrice: num(item.unit_price),
  unitPriceOriginal: numOrNull(item.unit_price_original),
  promoLabel: item.promo_label_snapshot,
  quantity: item.quantity,
  lineTotal: num(item.line_total)
})

export const mapOrder = (row: OrderWithItemsRow): OrderView => ({
  id: row.id,
  status: row.status,
  deliveryName: row.delivery_name,
  deliveryPhone: row.delivery_phone,
  deliveryAddress: row.delivery_address,
  deliveryLocation: row.delivery_location,
  deliveryNote: row.delivery_note,
  subtotal: num(row.subtotal),
  total: num(row.total),
  currency: row.currency,
  paymentStatus: row.payment_status,
  confirmedAt: row.confirmed_at,
  deliveredAt: row.delivered_at,
  cancelledAt: row.cancelled_at,
  cancelNote: row.cancel_note,
  createdAt: row.created_at,
  items: (row.order_items || []).map(mapOrderItem)
})

export const mapOrderStamp = (row: OrderStampsRow): OrderStamps => ({
  id: row.id,
  createdAt: row.created_at,
  confirmedAt: row.confirmed_at,
  deliveredAt: row.delivered_at,
  cancelledAt: row.cancelled_at
})

/**
 * A placed-at timestamp as a short date in the visitor's own locale. The locale arrives as an
 * argument for the same reason the site-contact channels' labels do: `app/utils` reads no locale
 * of its own, so the caller's view of it — here, the Intl tag — is handed in.
 */
export const formatOrderDate = (iso: string, locale: string): string =>
  new Date(iso).toLocaleDateString(locale === 'km' ? 'km' : 'en-US', { dateStyle: 'medium' })
