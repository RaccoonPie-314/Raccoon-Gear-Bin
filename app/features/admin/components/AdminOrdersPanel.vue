<script setup lang="ts">
import type { OrderStatus } from '~/types/database'
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES, PAYMENT_STATUS_KEYS, orderTransitions } from '~/utils/order-status'
import { formatOrderDate } from '~/utils/orders'

/**
 * The admin order desk's view (specs/ecommerce/SPEC-orders.md): filter chips over the list, one
 * row per order that expands into the detail — items, delivery, totals and the transition buttons
 * `order-status.ts` allows. It owns the feature composable, so the page keeps only the admin-mode
 * flag; `isAdminMode` arrives as a prop for the same reason it does in the product editor —
 * authorisation itself is row-level security and the RPC re-checks admin in SQL.
 */
const props = defineProps<{ isAdminMode: boolean }>()

const { locale, t } = useI18n()
const { orders, visibleOrders, isLoading, loadError, actionError, filter, search, busyOrderId, loadOrders, setStatus }
  = useAdminOrders({ canMutate: () => props.isAdminMode })

onMounted(loadOrders)

const FILTERS: Array<'all' | OrderStatus> = ['all', 'pending', 'confirmed', 'delivered', 'cancelled']

// One row open at a time: the expanded body is the only place a write can start, so "which order
// is being acted on" stays a single unambiguous answer.
const openRowId = ref('')
const toggleRow = (id: string) => { openRowId.value = openRowId.value === id ? '' : id }

// Cancel restores stock, so it confirms first — same modal idiom the product editor's delete uses.
// The confirmation carries an optional reason/note, which the cancel transition stores on the
// order for the buyer and the desk to read.
const cancelTarget = ref('')
const cancelNote = ref('')
const requestStatus = (orderId: string, status: OrderStatus) => {
  if (status === 'cancelled') {
    cancelTarget.value = orderId
    cancelNote.value = ''
    return
  }
  void setStatus(orderId, status)
}
const confirmCancel = async () => {
  const orderId = cancelTarget.value
  const note = cancelNote.value.trim()
  cancelTarget.value = ''
  if (orderId) await setStatus(orderId, 'cancelled', note || null)
}

const transitionLabel = (status: OrderStatus) =>
  status === 'confirmed' ? t('confirmOrder') : status === 'delivered' ? t('markDelivered') : t('cancelOrder')

const shortRef = (id: string) => id.slice(0, 8).toUpperCase()
</script>

<template>
  <div>
    <UAlert v-if="actionError" class="mt-8" color="error" variant="soft" :title="actionError" />

    <div v-if="isLoading" class="mt-8 h-40 animate-pulse rounded-2xl border border-zinc-200/60 bg-zinc-100 dark:border-zinc-800/60 dark:bg-zinc-900" />

    <div v-else-if="loadError" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
      <p class="text-sm font-medium text-zinc-500">{{ t('ordersLoadError') }}</p>
    </div>

    <Transition name="reveal"><div v-if="!isLoading && !loadError">
      <div class="mt-8">
        <UInput v-model="search" data-admin-orders-search type="search" :placeholder="t('adminOrderSearch')" :aria-label="t('adminOrderSearch')" class="w-full sm:max-w-xs" />
      </div>

      <div class="mt-4 flex flex-wrap gap-2" data-order-filters>
        <button
          v-for="value in FILTERS"
          :key="value"
          type="button"
          :data-order-filter="value"
          class="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors"
          :class="filter === value
            ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950'
            : 'bg-zinc-100 text-zinc-600 hover:text-zinc-950 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-white'"
          @click="filter = value"
        >
          {{ value === 'all' ? t('filterAll') : t(ORDER_STATUS_KEYS[value]) }}
        </button>
      </div>

      <p v-if="!visibleOrders.length" class="mt-6 rounded-2xl border border-dashed border-zinc-200 py-16 text-center text-sm font-medium text-zinc-500 dark:border-zinc-800">
        {{ orders.length ? t('adminFilterEmpty') : t('orderEmpty') }}
      </p>

      <ul v-else class="mt-6 space-y-3" data-admin-orders>
        <li
          v-for="order in visibleOrders"
          :key="order.id"
          class="rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-900"
          data-admin-order-row
        >
          <button
            type="button"
            class="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 text-left"
            :aria-expanded="openRowId === order.id"
            :data-order-toggle="order.id"
            @click="toggleRow(order.id)"
          >
            <span class="font-mono text-xs font-semibold text-zinc-500">#{{ shortRef(order.id) }}</span>
            <span class="text-xs font-medium text-zinc-500">{{ formatOrderDate(order.createdAt, locale) }}</span>
            <span v-if="order.deliveryName" class="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-950 dark:text-white">{{ order.deliveryName }}</span>
            <span class="ml-auto flex shrink-0 items-center gap-3">
              <UBadge :color="ORDER_STATUS_TONES[order.status]" variant="soft" data-order-status>{{ t(ORDER_STATUS_KEYS[order.status]) }}</UBadge>
              <span class="text-sm font-semibold tabular-nums text-zinc-950 dark:text-white">{{ order.currency }} {{ order.total.toFixed(2) }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-zinc-400 transition-transform duration-200"
                :class="openRowId === order.id ? 'rotate-180' : ''" aria-hidden="true"
              ><path d="m6 9 6 6 6-6" /></svg>
            </span>
          </button>

          <div v-if="openRowId === order.id" class="border-t border-zinc-200/80 px-4 py-4 dark:border-zinc-800/80" :data-order-body="order.id">
            <ul class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
              <li v-for="item in order.items" :key="item.id" class="flex items-center justify-between gap-4 py-1.5 text-sm">
                <span class="min-w-0 truncate text-zinc-700 dark:text-zinc-300">{{ item.name }} ×{{ item.quantity }}</span>
                <span class="shrink-0 font-semibold tabular-nums text-zinc-950 dark:text-white">{{ order.currency }} {{ item.lineTotal.toFixed(2) }}</span>
              </li>
            </ul>

            <dl class="mt-3 space-y-1.5 border-t border-zinc-200/80 pt-3 text-sm dark:border-zinc-800/80">
              <div v-if="order.deliveryName" class="flex justify-between gap-4">
                <dt class="text-zinc-500">{{ t('deliveryName') }}</dt>
                <dd class="text-right font-semibold text-zinc-950 dark:text-white">{{ order.deliveryName }}</dd>
              </div>
              <div v-if="order.deliveryPhone" class="flex justify-between gap-4">
                <dt class="text-zinc-500">{{ t('deliveryPhone') }}</dt>
                <dd class="text-right font-semibold text-zinc-950 dark:text-white">
                  <a :href="`tel:${order.deliveryPhone.replace(/[^\d+]/g, '')}`" class="tabular-nums hover:underline">{{ order.deliveryPhone }}</a>
                </dd>
              </div>
              <div v-if="order.deliveryAddress" class="flex justify-between gap-4">
                <dt class="text-zinc-500">{{ t('deliveryAddress') }}</dt>
                <dd class="text-right font-semibold text-zinc-950 dark:text-white">{{ order.deliveryAddress }}</dd>
              </div>
              <div v-if="order.deliveryLocation" class="flex justify-between gap-4">
                <dt class="text-zinc-500">{{ t('deliveryLocation') }}</dt>
                <dd class="break-all text-right">
                  <a :href="order.deliveryLocation" data-order-location target="_blank" rel="noopener" class="font-semibold text-zinc-950 hover:underline dark:text-white">{{ order.deliveryLocation }}</a>
                </dd>
              </div>
              <div v-if="order.deliveryNote" class="flex justify-between gap-4">
                <dt class="text-zinc-500">{{ t('deliveryNote') }}</dt>
                <dd class="text-right font-semibold text-zinc-950 dark:text-white">{{ order.deliveryNote }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-zinc-500">{{ t('paymentStatus') }}</dt>
                <dd class="text-right font-semibold text-zinc-950 dark:text-white">{{ t(PAYMENT_STATUS_KEYS[order.paymentStatus]) }}</dd>
              </div>
              <div v-if="order.cancelNote" class="flex justify-between gap-4">
                <dt class="shrink-0 text-zinc-500">{{ t('cancellationNote') }}</dt>
                <dd class="min-w-0 text-right font-semibold text-zinc-950 dark:text-white">{{ order.cancelNote }}</dd>
              </div>
            </dl>

            <!-- Exactly the transitions the written table allows — a terminal state renders no
                 buttons at all, because none exist. -->
            <div v-if="orderTransitions(order.status).length" class="mt-4 flex flex-wrap gap-2" data-order-actions>
              <UButton
                v-for="next in orderTransitions(order.status)"
                :key="next"
                type="button"
                size="sm"
                :color="next === 'cancelled' ? 'error' : 'neutral'"
                :variant="next === 'cancelled' ? 'outline' : 'solid'"
                :data-order-action="next"
                :loading="busyOrderId === order.id"
                :disabled="!!busyOrderId"
                @click="requestStatus(order.id, next)"
              >
                {{ transitionLabel(next) }}
              </UButton>
            </div>
          </div>
        </li>
      </ul>
    </div></Transition>

    <!-- Cancelling restores stock, so it is the one transition that confirms first. Same `modal`
         transition and shape as the product editor's delete confirmation. -->
    <Transition name="modal"><div
      v-if="cancelTarget"
      class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      @click.self="cancelTarget = ''"
    >
      <section
        class="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800/80 p-6 sm:p-8"
        role="alertdialog"
        aria-modal="true"
      >
        <h2 class="text-xl font-black text-zinc-950 dark:text-white">{{ t('cancelOrder') }}</h2>
        <p class="mt-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{{ t('cancelOrderConfirm') }}</p>
        <UFormField :label="t('cancelReason')" name="cancel-reason" class="mt-4">
          <UInput v-model="cancelNote" data-order-cancel-note type="text" class="w-full" />
        </UFormField>
        <div class="mt-6 flex justify-end gap-3">
          <UButton color="neutral" variant="ghost" size="sm" @click="cancelTarget = ''">
            {{ t('cancel') }}
          </UButton>
          <UButton color="error" size="sm" :loading="!!busyOrderId" data-order-cancel-confirm @click="confirmCancel">
            {{ t('cancelOrder') }}
          </UButton>
        </div>
      </section>
    </div></Transition>
  </div>
</template>
