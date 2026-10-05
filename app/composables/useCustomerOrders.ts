import type { Database } from '~/types/database'
import type { OrderView } from '~/types/orders'
import { bumpOrdersSeen, readOrdersSeen, unseenOrderCount } from '~/utils/order-notices'
import { mapOrder, mapOrderStamp, ORDER_STAMPS_SELECT, ORDER_WITH_ITEMS_SELECT } from '~/utils/orders'

/**
 * The buyer's order reads (specs/ecommerce/SPEC-orders.md). RLS scopes *access* — own rows for a
 * customer, every row for an admin — but access is not ownership: without the `user_id` filter an
 * admin's own account (the shop owner's) would list the whole shop under "My account → Orders",
 * which is the desk's view, not this page's. The reads are therefore scoped to the signed-in user
 * explicitly; the row → view conversion stays the shared one in `app/utils/orders.ts`.
 *
 * Fetching the orders area is also what marks it seen: `fetchOrders` / `fetchOrder` raise the
 * browser-local notice marker (only ever forward — see `bumpOrdersSeen`), and `fetchUnseenCount`
 * is the masthead badge's light read against that marker.
 */

export const useCustomerOrders = () => {
  const supabase = useSupabaseClient<Database>()
  const user = useSupabaseUser()

  // `id` on a hard load, `sub` after the module re-places state from JWT claims — the recurring
  // spelling trap; both name the same uuid.
  const currentUserId = () => {
    const identity = user.value as { id?: string, sub?: string } | null
    return identity?.id || identity?.sub || null
  }

  const fetchOrders = async (): Promise<OrderView[]> => {
    const userId = currentUserId()
    if (!userId) return []
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_WITH_ITEMS_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw error
    const views = (data ?? []).map(mapOrder)
    bumpOrdersSeen(userId, views)
    return views
  }

  // The masthead badge's read: stamps only, compared against the marker the fetches above raise.
  const fetchUnseenCount = async (): Promise<number> => {
    const userId = currentUserId()
    if (!userId) return 0
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_STAMPS_SELECT)
      .eq('user_id', userId)
    if (error) throw error
    return unseenOrderCount((data ?? []).map(mapOrderStamp), readOrdersSeen(userId))
  }

  const fetchOrder = async (id: string): Promise<OrderView | null> => {
    const userId = currentUserId()
    if (!userId) return null
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_WITH_ITEMS_SELECT)
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    const view = data ? mapOrder(data) : null
    if (view) bumpOrdersSeen(userId, [view])
    return view
  }

  return { fetchOrders, fetchOrder, fetchUnseenCount }
}
