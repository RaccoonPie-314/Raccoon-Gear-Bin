import type { OrderStatus, PaymentStatus } from '~/types/database'

/**
 * The order shapes the pages render (snake_case rows → camelCase views, the same split `catalog.ts`
 * makes). The mapping itself lives in `app/utils/orders.ts`, because the buyer's pages and the
 * admin's panel read the same row shape and must not map it twice.
 */

export type OrderItemView = {
  id: string
  productId: string | null
  name: string
  sku: string
  /** The product's first image as read now (storage path or absolute URL), or null when none resolves — the item row renders a placeholder tile then. */
  imagePath: string | null
  unitPrice: number
  /** The pre-promo price when a promotion was applied, else `null`. */
  unitPriceOriginal: number | null
  promoLabel: string | null
  quantity: number
  lineTotal: number
}

export type OrderView = {
  id: string
  status: OrderStatus
  deliveryName: string | null
  deliveryPhone: string | null
  deliveryAddress: string | null
  /** The map pin behind the address, as a URL — required at checkout, cleared by anonymization. */
  deliveryLocation: string | null
  deliveryNote: string | null
  subtotal: number
  total: number
  currency: string
  paymentStatus: PaymentStatus
  /** Lifecycle moments, each set by the transition that entered its state; null until then. */
  confirmedAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  /** The reason/note the canceller left — written only by the cancel transition, free text. */
  cancelNote: string | null
  createdAt: string
  items: OrderItemView[]
}
