import type { OrderView } from '~/types/orders'
import { bumpOrdersSeen, readOrdersSeen, unseenOrderCount } from '~/utils/order-notices'
import type { OrderStampsRow, OrderWithItemsRow } from '~/utils/orders'
import { mapOrder, mapOrderStamp } from '~/utils/orders'

/**
 * The buyer's order reads (specs/ecommerce/SPEC-orders.md). The `…/mine`, `…/stamps` and single
 * endpoints are the self-scoped ones — the server filters to the caller inside the claims path,
 * which is where the old explicit `user_id` filter went; the desk's unscoped list is never asked
 * for from these pages. The row → view conversion stays the shared one in `app/utils/orders.ts`.
 *
 * Fetching the orders area is also what marks it seen: `fetchOrders` / `fetchOrder` raise the
 * browser-local notice marker (only ever forward — see `bumpOrdersSeen`), and `fetchUnseenCount`
 * is the masthead badge's light read against that marker.
 *
 * Identity is still the Supabase session — the Clerk flip is P6 of plans/005, and the marker's key
 * is the account id either way, so the stored marker survives that change untouched.
 */

export const useCustomerOrders = () => {
  const { user } = useUser()

  const currentUserId = () => user.value?.id ?? null

  const fetchOrders = async (): Promise<OrderView[]> => {
    const userId = currentUserId()
    if (!userId) return []
    const data = await $fetch<OrderWithItemsRow[]>('/api/orders/mine')
    const views = (data ?? []).map(mapOrder)
    bumpOrdersSeen(userId, views)
    return views
  }

  // The masthead badge's read: stamps only, compared against the marker the fetches above raise.
  const fetchUnseenCount = async (): Promise<number> => {
    const userId = currentUserId()
    if (!userId) return 0
    const data = await $fetch<OrderStampsRow[]>('/api/orders/stamps')
    return unseenOrderCount((data ?? []).map(mapOrderStamp), readOrdersSeen(userId))
  }

  const fetchOrder = async (id: string): Promise<OrderView | null> => {
    const userId = currentUserId()
    // A not-yet-loaded clerk-js user is NOT "no such order": returning null here is how the
    // order page's post-PayWay reload flashed "order could not be found" — the silent null
    // skipped the API entirely, and both the settle-retry loop and the late-session watch
    // treated it as success. Throwing routes it through the callers' retry instead.
    if (!userId) throw new Error('SESSION_NOT_READY')
    const data = await $fetch<OrderWithItemsRow | null>(`/api/orders/${id}`)
    const view = data ? mapOrder(data) : null
    if (view) bumpOrdersSeen(userId, [view])
    return view
  }

  return { fetchOrders, fetchOrder, fetchUnseenCount }
}
