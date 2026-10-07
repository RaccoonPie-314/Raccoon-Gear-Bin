import type { OrderStatus, PaymentStatus } from '~/types/database'

/**
 * The status machine, written once (specs/ecommerce/SPEC-orders.md): the admin's transition
 * buttons and the buyer's timeline both read it. The SQL `set_order_status` is the authority —
 * its transition table matches this one case for case, and the migration's guard is what actually
 * refuses a bad jump; a control here can only ever *offer* an allowed next state.
 *
 * A plain function, not a composable: it reads nothing reactive and touches no browser API.
 */

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: []
}

export const orderTransitions = (from: OrderStatus): readonly OrderStatus[] => ORDER_TRANSITIONS[from]

/**
 * The label key and the badge tone each state wears — vocabulary beside the machine, not logic:
 * the buyer's list, the buyer's detail and the admin panel must not disagree about what `pending`
 * is called or looks like. (The tones are Nuxt UI colour names; they are the one piece of
 * presentation this otherwise-data-only file carries, because a second copy is a second answer.)
 */
export const ORDER_STATUS_KEYS: Record<OrderStatus, string> = {
  pending: 'statusPending',
  confirmed: 'statusConfirmed',
  delivered: 'statusDelivered',
  cancelled: 'statusCancelled'
}

export const ORDER_STATUS_TONES: Record<OrderStatus, 'warning' | 'primary' | 'success' | 'error'> = {
  pending: 'warning',
  confirmed: 'primary',
  delivered: 'success',
  cancelled: 'error'
}

/** The same, for `orders.payment_status` — `paid` lands via PayWay settlement, `refunded` via the
 * refund marker; `unpaid` is the placed state every order starts in (pay-later orders stay there). */
export const PAYMENT_STATUS_KEYS: Record<PaymentStatus, string> = {
  unpaid: 'paymentUnpaid',
  paid: 'paymentPaid',
  refunded: 'paymentRefunded'
}

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, 'neutral' | 'success' | 'error'> = {
  unpaid: 'neutral',
  paid: 'success',
  refunded: 'error'
}
