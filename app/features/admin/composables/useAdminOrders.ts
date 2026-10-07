import type { OrderStatus } from '~/types/database'
import type { OrderView } from '~/types/orders'
import type { OrderWithItemsRow } from '~/utils/orders'
import { mapOrder } from '~/utils/orders'

/** Which chip is on. `all` is a view, not a status — the type says so. */
export type OrderFilter = 'all' | OrderStatus

/**
 * The admin order desk (specs/ecommerce/SPEC-orders.md): the list read — the claims policy is what
 * makes it *every* order — the transition writes through `set_order_status`, and the filter.
 * The RPC re-checks admin and legality in SQL, so `canMutate` here only keeps a button honest
 * before the server has to say no, the same split as the other admin composables.
 */
export const useAdminOrders = (options: { canMutate?: () => boolean } = {}) => {
  const canMutate = options.canMutate ?? (() => false)
  const { t } = useI18n()

  const orders = ref<OrderView[]>([])
  const isLoading = ref(true)
  const loadError = ref(false)
  const actionError = ref('')
  const filter = ref<OrderFilter>('all')
  // The desk's text search: order reference, delivery details and item names/skus — whatever a
  // phone call gives you. Client-side like the status chips; the desk already holds every order.
  const search = ref('')
  // Which order has a write in flight — one at a time, so two transition buttons on one row can
  // never race each other.
  const busyOrderId = ref('')

  const loadOrders = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      orders.value = (await $fetch<OrderWithItemsRow[]>('/api/orders')).map(mapOrder)
    } catch {
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  // A work queue before it is a log: inside `all` the pending orders come first, newest first
  // within each group. A single-status view keeps the server's newest-first order. The search
  // narrows whatever the chips left — case-insensitive, over the fields a visitor would quote —
  // and a `#` is stripped so the reference the row itself prints can be pasted back in.
  const matchesSearch = (order: OrderView, query: string) =>
    [order.id, order.deliveryName ?? '', order.deliveryPhone ?? '', order.deliveryAddress ?? '',
      ...order.items.flatMap(item => [item.name, item.sku])]
      .some(value => value.toLowerCase().includes(query))

  const visibleOrders = computed(() => {
    const query = search.value.trim().toLowerCase().replace(/^#+/, '')
    const bySearch = (order: OrderView) => !query || matchesSearch(order, query)
    if (filter.value !== 'all') return orders.value.filter(order => order.status === filter.value && bySearch(order))
    const pendingFirst = (order: OrderView) => order.status === 'pending' ? 0 : 1
    return orders.value.filter(bySearch).sort((first, second) =>
      pendingFirst(first) - pendingFirst(second) || second.createdAt.localeCompare(first.createdAt))
  })

  // `note` rides only the cancel transition (the SQL writes it in that branch alone); confirm and
  // deliver send null.
  const setStatus = async (orderId: string, status: OrderStatus, note: string | null = null) => {
    if (!canMutate() || busyOrderId.value) return
    busyOrderId.value = orderId
    actionError.value = ''
    try {
      await $fetch(`/api/orders/${orderId}/status`, { method: 'POST', body: { status, note } })
      await loadOrders()
    } catch {
      actionError.value = t('transitionError')
    } finally {
      busyOrderId.value = ''
    }
  }

  // The refund marker — the payment half of the desk, deliberately not one of `setStatus`'s
  // transitions (see `canRefund`): a paid order is refundable whether it is open, delivered or
  // cancelled. Same one-write-at-a-time guard and same reload-after, so a refund can never race a
  // status change on the same row.
  const refundOrder = async (orderId: string, note: string | null = null) => {
    if (!canMutate() || busyOrderId.value) return
    busyOrderId.value = orderId
    actionError.value = ''
    try {
      await $fetch(`/api/orders/${orderId}/refund`, { method: 'POST', body: { note } })
      await loadOrders()
    } catch {
      actionError.value = t('refundError')
    } finally {
      busyOrderId.value = ''
    }
  }

  // The masthead badge's read: the desk's work queue, counted without the heavy select. It clears
  // by being worked (confirm, cancel), not by being looked at — which is why it needs no marker.
  const fetchPendingCount = async (): Promise<number> => {
    return await $fetch<number>('/api/orders/pending')
  }

  return { orders, visibleOrders, isLoading, loadError, actionError, filter, search, busyOrderId, loadOrders, setStatus, refundOrder, fetchPendingCount }
}
