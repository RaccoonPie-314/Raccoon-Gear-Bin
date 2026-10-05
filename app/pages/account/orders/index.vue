<script setup lang="ts">
import type { OrderView } from '~/types/orders'
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from '~/utils/order-status'
import { formatOrderDate } from '~/utils/orders'

/**
 * The buyer's order list (specs/ecommerce/SPEC-orders.md). The read is scoped by RLS alone —
 * `useCustomerOrders` holds no ownership logic — and the row vocabulary (label key, tone, date
 * format) comes from the same owners the detail page reads, never re-derived here.
 */
const { locale, t } = useI18n()
const localePath = useLocalePath()
const { fetchOrders } = useCustomerOrders()

const orders = ref<OrderView[]>([])
const isLoading = ref(true)
const loadError = ref(false)

onMounted(async () => {
  try {
    orders.value = await fetchOrders()
  } catch {
    loadError.value = true
  } finally {
    isLoading.value = false
  }
})

// Glanceable by design: the full reference lives on the detail page and in the contact message.
const shortRef = (id: string) => id.slice(0, 8).toUpperCase()

const pageTitle = computed(() => `${t('orders')} | ${t('appName')}`)
useHead({ title: pageTitle })
</script>

<template>
  <main class="min-h-screen bg-zinc-50/50 dark:bg-zinc-950">
    <div class="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <header class="flex items-center justify-between gap-4">
        <NuxtLink :to="localePath('/')">
          <BrandLogo />
        </NuxtLink>
        <div class="flex items-center gap-2">
          <ColorModeToggle />
          <LanguageSwitcher />
        </div>
      </header>

      <div class="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-3xl font-black text-zinc-950 dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
          {{ t('orders') }}
        </h1>
        <NuxtLink
          :to="localePath('/account')"
          class="text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-white"
        >
          {{ t('myAccount') }}
        </NuxtLink>
      </div>

      <div v-if="isLoading" class="mt-8 h-28 animate-pulse rounded-2xl border border-zinc-200/60 bg-zinc-100 dark:border-zinc-800/60 dark:bg-zinc-900" />

      <div v-else-if="loadError" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
        <p class="text-sm font-medium text-zinc-500">{{ t('ordersLoadError') }}</p>
      </div>

      <div v-else-if="!orders.length" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
        <p class="text-sm font-medium text-zinc-500">{{ t('orderEmpty') }}</p>
        <UButton :to="localePath('/')" color="neutral" class="mt-6 rounded-full px-6 font-semibold text-sm cursor-pointer">
          {{ t('cartEmptyCta') }}
        </UButton>
      </div>

      <Transition name="reveal"><ul v-if="!isLoading && !loadError && orders.length" class="mt-8 divide-y divide-zinc-200/80 rounded-2xl border border-zinc-200/80 bg-white dark:divide-zinc-800/80 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-orders-list>
        <li v-for="order in orders" :key="order.id">
          <NuxtLink
            :to="localePath(`/account/orders/${order.id}`)"
            data-order-row
            class="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
          >
            <div class="min-w-0">
              <p class="text-sm font-semibold text-zinc-950 dark:text-white">
                {{ t('orderNumber') }}
                <span class="ml-1 font-mono text-xs font-semibold text-zinc-500">#{{ shortRef(order.id) }}</span>
              </p>
              <p class="mt-1 text-xs font-medium text-zinc-500">{{ t('orderDate') }} · {{ formatOrderDate(order.createdAt, locale) }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-3">
              <UBadge :color="ORDER_STATUS_TONES[order.status]" variant="soft" data-order-status>
                {{ t(ORDER_STATUS_KEYS[order.status]) }}
              </UBadge>
              <p class="text-sm font-semibold tabular-nums text-zinc-950 dark:text-white">
                {{ order.currency }} {{ order.total.toFixed(2) }}
              </p>
            </div>
          </NuxtLink>
        </li>
      </ul></Transition>
    </div>
  </main>
</template>
