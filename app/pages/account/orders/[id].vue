<script setup lang="ts">
import type { OrderView } from '~/types/orders'
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES, PAYMENT_STATUS_KEYS } from '~/utils/order-status'
import { formatOrderDate } from '~/utils/orders'
import { getSiteContactChannels } from '~/utils/site-contact'
import { platformLabel } from '~/utils/social-prefill'

/**
 * One order, as its buyer reads it (specs/ecommerce/SPEC-orders.md): the snapshot items, the
 * delivery block, the totals, and the shop's own contact channels for a question about this
 * order. RLS scopes the read; every number on this page is what the RPC wrote, never recomputed.
 * The channel list still comes from its one owner (`getSiteContactChannels`) — this page only
 * supplies the context, exactly like the product page does.
 */
const route = useRoute()
const { locale, t } = useI18n()
const localePath = useLocalePath()
const { fetchOrder } = useCustomerOrders()
const { fetchSiteInfo, siteInfo } = useSiteInfo()
const requestUrl = useRequestURL()

const order = ref<OrderView | null>(null)
const isLoading = ref(true)
const loadError = ref(false)

onMounted(async () => {
  try {
    order.value = await fetchOrder(String(route.params.id ?? ''))
  } catch {
    loadError.value = true
  } finally {
    isLoading.value = false
  }
  // Auxiliary, the product page's policy: a failed contact read costs the channels, not the order.
  try { await fetchSiteInfo() } catch (error) { console.error('Site info load failed:', error) }
})

const channels = computed(() => getSiteContactChannels(siteInfo.value, {
  message: order.value ? t('contactAboutOrder', { ref: order.value.id }) : '',
  pageUrl: requestUrl.href,
  phoneLabel: t('phone')
}))

// The reached moments, in order. Future states are absent rather than greyed: a step that has not
// happened is not a step, and the status chip already carries what the order is now.
const timeline = computed(() => {
  if (!order.value) return []
  const steps: Array<{ key: string, at: string }> = [{ key: 'orderDate', at: order.value.createdAt }]
  if (order.value.confirmedAt) steps.push({ key: 'statusConfirmed', at: order.value.confirmedAt })
  if (order.value.deliveredAt) steps.push({ key: 'statusDelivered', at: order.value.deliveredAt })
  if (order.value.cancelledAt) steps.push({ key: 'statusCancelled', at: order.value.cancelledAt })
  return steps
})

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

      <NuxtLink
        :to="localePath('/account/orders')"
        class="mt-8 inline-block text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-white"
      >
        <span aria-hidden="true">←</span> {{ t('backToOrders') }}
      </NuxtLink>

      <div v-if="isLoading" class="mt-4 h-40 animate-pulse rounded-2xl border border-zinc-200/60 bg-zinc-100 dark:border-zinc-800/60 dark:bg-zinc-900" />

      <div v-else-if="loadError || !order" class="mt-4 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
        <p class="text-sm font-medium text-zinc-500">{{ t('orderNotFound') }}</p>
        <UButton :to="localePath('/')" color="neutral" class="mt-6 rounded-full px-6 font-semibold text-sm cursor-pointer">
          {{ t('cartEmptyCta') }}
        </UButton>
      </div>

      <Transition name="reveal"><div v-if="order && !loadError">
        <div class="mt-4 flex flex-wrap items-start justify-between gap-4" data-order-detail>
          <div class="min-w-0">
            <h1 class="text-2xl font-black text-zinc-950 sm:text-3xl dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
              {{ t('orderNumber') }}
            </h1>
            <p class="mt-1 font-mono text-xs font-semibold break-all text-zinc-500" data-order-ref>{{ order.id }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <UBadge :color="ORDER_STATUS_TONES[order.status]" variant="soft" data-order-status>
              {{ t(ORDER_STATUS_KEYS[order.status]) }}
            </UBadge>
          </div>
        </div>

        <section class="mt-8">
          <h2 class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('orderStatus') }}</h2>
          <ol class="mt-3 rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-order-timeline>
            <li v-for="(step, index) in timeline" :key="step.key" class="flex gap-3">
              <div class="flex flex-col items-center" aria-hidden="true">
                <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-950 dark:bg-white" />
                <span v-if="index < timeline.length - 1" class="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <div class="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2" :class="index === timeline.length - 1 ? '' : 'pb-4'">
                <p class="text-sm font-semibold text-zinc-950 dark:text-white">{{ t(step.key) }}</p>
                <p class="text-xs font-medium text-zinc-500">{{ formatOrderDate(step.at, locale) }}</p>
              </div>
            </li>
          </ol>
        </section>

        <!-- The canceller's reason/note, when the cancel transition carried one. -->
        <section v-if="order.cancelNote" class="mt-8">
          <h2 class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('cancellationNote') }}</h2>
          <p class="mt-3 rounded-2xl border border-zinc-200/80 bg-white p-5 text-sm text-zinc-700 dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:text-zinc-300" data-order-cancel-note>
            {{ order.cancelNote }}
          </p>
        </section>

        <section class="mt-8">
          <h2 class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('orderItems') }}</h2>
          <ul class="mt-3 divide-y divide-zinc-200/80 rounded-2xl border border-zinc-200/80 bg-white dark:divide-zinc-800/80 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-order-items>
            <li v-for="item in order.items" :key="item.id" class="flex items-start justify-between gap-4 px-5 py-4">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-zinc-950 dark:text-white">{{ item.name }}</p>
                <p class="mt-0.5 text-xs text-zinc-500">{{ item.sku }}</p>
                <p v-if="item.promoLabel" class="mt-0.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">{{ item.promoLabel }}</p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-xs text-zinc-500">
                  ×{{ item.quantity }} ·
                  <del v-if="item.unitPriceOriginal !== null" class="mr-1 font-medium">{{ order.currency }} {{ item.unitPriceOriginal.toFixed(2) }}</del>
                  <span class="font-medium">{{ order.currency }} {{ item.unitPrice.toFixed(2) }}</span>
                </p>
                <p class="mt-0.5 text-sm font-semibold tabular-nums text-zinc-950 dark:text-white">
                  {{ order.currency }} {{ item.lineTotal.toFixed(2) }}
                </p>
              </div>
            </li>
          </ul>
        </section>

        <section class="mt-6 rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800/80 dark:bg-zinc-900/40">
          <div class="space-y-2">
            <div class="flex items-center justify-between text-sm text-zinc-500">
              <span>{{ t('cartSubtotal') }}</span>
              <span class="tabular-nums">{{ order.currency }} {{ order.subtotal.toFixed(2) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('orderTotal') }}</span>
              <span class="text-lg font-black tabular-nums text-zinc-950 dark:text-white">{{ order.currency }} {{ order.total.toFixed(2) }}</span>
            </div>
            <div class="flex items-center justify-between border-t border-zinc-200/80 pt-3 text-sm dark:border-zinc-800/80">
              <span class="text-zinc-500">{{ t('paymentStatus') }}</span>
              <span class="font-semibold text-zinc-950 dark:text-white">{{ t(PAYMENT_STATUS_KEYS[order.paymentStatus]) }}</span>
            </div>
          </div>
        </section>

        <section v-if="order.deliveryName || order.deliveryPhone || order.deliveryAddress || order.deliveryLocation || order.deliveryNote" class="mt-8">
          <h2 class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('deliverySection') }}</h2>
          <dl class="mt-3 space-y-2 rounded-2xl border border-zinc-200/80 bg-white p-5 text-sm dark:border-zinc-800/80 dark:bg-zinc-900/40">
            <div v-if="order.deliveryName" class="flex justify-between gap-4">
              <dt class="shrink-0 text-zinc-500">{{ t('deliveryName') }}</dt>
              <dd class="min-w-0 text-right font-semibold text-zinc-950 dark:text-white">{{ order.deliveryName }}</dd>
            </div>
            <div v-if="order.deliveryPhone" class="flex justify-between gap-4">
              <dt class="shrink-0 text-zinc-500">{{ t('deliveryPhone') }}</dt>
              <dd class="min-w-0 text-right font-semibold text-zinc-950 dark:text-white">
                <a :href="`tel:${order.deliveryPhone.replace(/[^\d+]/g, '')}`" class="tabular-nums hover:underline">{{ order.deliveryPhone }}</a>
              </dd>
            </div>
            <div v-if="order.deliveryAddress" class="flex justify-between gap-4">
              <dt class="shrink-0 text-zinc-500">{{ t('deliveryAddress') }}</dt>
              <dd class="min-w-0 text-right font-semibold text-zinc-950 dark:text-white">{{ order.deliveryAddress }}</dd>
            </div>
            <div v-if="order.deliveryLocation" class="flex justify-between gap-4">
              <dt class="shrink-0 text-zinc-500">{{ t('deliveryLocation') }}</dt>
              <dd class="min-w-0 text-right">
                <a :href="order.deliveryLocation" data-order-location target="_blank" rel="noopener" class="break-all font-semibold text-zinc-950 hover:underline dark:text-white">{{ order.deliveryLocation }}</a>
              </dd>
            </div>
            <div v-if="order.deliveryNote" class="flex justify-between gap-4">
              <dt class="shrink-0 text-zinc-500">{{ t('deliveryNote') }}</dt>
              <dd class="min-w-0 text-right font-semibold text-zinc-950 dark:text-white">{{ order.deliveryNote }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="channels.length" class="mt-8">
          <h2 class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('contactShop') }}</h2>
          <ul class="mt-3 space-y-1.5">
            <li v-for="channel in channels" :key="channel.key">
              <a
                :href="channel.href"
                :target="channel.external ? '_blank' : undefined"
                :rel="channel.external ? 'noopener noreferrer' : undefined"
                :data-order-channel="channel.key"
                class="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-50 dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:text-white dark:hover:bg-zinc-900/60"
              >
                <span class="truncate">{{ platformLabel(channel.label) }}</span>
                <span v-if="channel.value" class="min-w-0 truncate text-xs font-normal tabular-nums text-zinc-500">{{ channel.value }}</span>
              </a>
            </li>
          </ul>
        </section>
      </div></Transition>
    </div>
  </main>
</template>
