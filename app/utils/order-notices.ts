import type { OrderView } from '~/types/orders'

/**
 * Order notices — the badge counts on the masthead's Orders pill, and the browser-local seen
 * marker behind the buyer's one. Not a notifications table: the buyer's count is "orders whose
 * latest lifecycle stamp is newer than the last time the orders area was fetched", the orders
 * view itself is the notification body, and the marker is raised by those same fetches
 * (`useCustomerOrders`). The admin's count is not here at all — it is the desk's pending queue,
 * counted by `useAdminOrders`, because "awaiting action" needs no marker to clear.
 *
 * Stamps are the row's own server timestamps — created / confirmed / delivered / cancelled — so
 * no client clock ever enters a comparison. The marker lives in localStorage per account: a
 * second browser re-notifies each time, which is the accepted ceiling — a server-side cursor is
 * a schema change for a badge.
 */

export type OrderStamps = Pick<OrderView, 'id' | 'createdAt' | 'confirmedAt' | 'deliveredAt' | 'cancelledAt'>

/** The row's latest activity: whichever lifecycle stamp is newest. */
export function latestOrderStamp(order: OrderStamps): string {
  return [order.createdAt, order.confirmedAt, order.deliveredAt, order.cancelledAt]
    .filter((stamp): stamp is string => stamp !== null)
    .sort()
    .pop() as string
}

const seenKey = (userId: string) => `raccoon-orders-seen:v1:${userId}`

export function readOrdersSeen(userId: string): string {
  try {
    return localStorage.getItem(seenKey(userId)) ?? ''
  } catch {
    return ''
  }
}

/**
 * Raise the marker; it never travels back — a list visit and a detail visit both call this, and a
 * detail read of one old order must not un-see an update the list visit already showed.
 */
export function bumpOrdersSeen(userId: string, orders: OrderStamps[]) {
  if (!orders.length) return
  const next = [...orders.map(latestOrderStamp), readOrdersSeen(userId)].sort().pop() as string
  try {
    localStorage.setItem(seenKey(userId), next)
  } catch {
    // Private mode: storing fails and the next fetch re-notifies — the safe direction for a badge.
  }
}

export function unseenOrderCount(orders: OrderStamps[], seen: string): number {
  return orders.filter(order => latestOrderStamp(order) > seen).length
}
