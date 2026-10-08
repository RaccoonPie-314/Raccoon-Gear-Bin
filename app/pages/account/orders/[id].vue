<script setup lang="ts">
import type { OrderView } from '~/types/orders'
import { useReducedMotion } from 'motion-v'
import { iconPop, pulseScale } from '~/utils/motion'
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES, PAYMENT_STATUS_KEYS } from '~/utils/order-status'
import { formatOrderDate } from '~/utils/orders'
import { getSiteContactChannels } from '~/utils/site-contact'
import { platformLabel } from '~/utils/social-prefill'
import { startPaywayCheckout } from '~/utils/payway-checkout'

/**
 * One order, as its buyer reads it (specs/ecommerce/SPEC-orders.md): the snapshot items, the
 * delivery block, the totals, and the shop's own contact channels for a question about this
 * order. RLS scopes the read; every number on this page is what the RPC wrote, never recomputed.
 * The channel list still comes from its one owner (`getSiteContactChannels`) — this page only
 * supplies the context, exactly like the product page does.
 *
 * The design pass (2026-10-06): the same two-column frame the checkout uses (content left, the
 * money in a right rail), so the page uses the width on a desktop instead of a narrow strip.
 * The reference is the page's identity (hero card), the status chip carries the state at a
 * glance, and the pay action sits under the totals in the rail — the checkout's own convention
 * for a summary column. The timeline reads as a journey: past steps dim, the current one is the
 * only full-weight label. Enter choreography is compositor-only (transform/opacity, `motion-safe:`
 * classes) with one custom moment — the current timeline dot plays the repo's `iconPop` once —
 * because the page is a receipt, not a marquee.
 */
const route = useRoute()
const { locale, t } = useI18n()
const localePath = useLocalePath()
const { fetchOrder } = useCustomerOrders()
// Only the URL builder is borrowed — the image path arrives with the order row (ORDER_WITH_ITEMS
// joins it), and storage-URL construction stays this composable's single job (AGENTS.md).
const { publicImageUrl } = useCatalog()
const { fetchSiteInfo, siteInfo } = useSiteInfo()
const requestUrl = useRequestURL()

const order = ref<OrderView | null>(null)
const isLoading = ref(true)
const loadError = ref(false)

// Pay now (SPEC-payments P4): offered only while the order is pending and unpaid; anything else
// — paid, cancelled, confirmed — has nothing left to charge.
const paying = ref(false)
const payError = ref('')
const payable = computed(() => order.value?.status === 'pending' && order.value?.paymentStatus === 'unpaid')
const payNow = async () => {
  if (paying.value || !order.value) return
  paying.value = true
  payError.value = ''
  try {
    await startPaywayCheckout(order.value.id)
  } catch {
    payError.value = t('payUnavailable')
    paying.value = false
  }
}

// The enter choreography (design pass): sections lift in sequence through `motion-safe:` classes
// — transform/opacity only, so the whole entrance is compositor work — and the timeline's
// current dot gets the one custom moment (`iconPop`, raw WAAPI via the shared driver). Under
// reduced motion the classes disappear and the pulse never fires: the receipt simply exists.
const reduced = useReducedMotion()
const shown = ref(false)
const timelineEl = ref<HTMLElement | null>(null)
let dotPopAt: ReturnType<typeof setTimeout> | undefined
const revealDelay = (index: number) => ({ transitionDelay: `${index * 45}ms` })

// Retries through the handshake settle: this page doubles as the browser's Back target from
// PayWay, and after a multi-minute excursion the first reads can 401 while clerk-js (or the
// server handshake) is still reissuing the session. The page itself is unguarded for the same
// reason — the read is owner-scoped, so a true stranger still gets the not-found state.
const loadOrder = async () => {
  loadError.value = false
  isLoading.value = true
  try {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        order.value = await fetchOrder(String(route.params.id ?? ''))
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1200))
      }
    }
    if (lastError) throw lastError
  } catch {
    loadError.value = true
  } finally {
    isLoading.value = false
  }
  if (order.value && !shown.value) {
    await nextTick()
    requestAnimationFrame(() => { shown.value = true })
    if (!reduced.value) {
      // ~the timeline's arrival in the stagger (90ms delay + the 300ms lift): one shot, then gone.
      dotPopAt = setTimeout(() => {
        pulseScale(timelineEl.value?.querySelector('li:last-child span') as HTMLElement | null, iconPop.keyframes, iconPop.ms)
      }, 320)
    }
  }
}

const { user } = useUser()

// Mobile Back/Forward from the same-tab PayWay excursion restores this page from bfcache, which
// does NOT re-run `onMounted` — the frozen heap is thawed as-is. If the read had exhausted its
// retries while clerk-js was still booting (a multi-minute excursion on a slow radio), the stale
// "order not found" would otherwise stick forever. `pageshow` with `persisted` is the one signal
// that fires on a bfcache restore; re-run the load then, but only from the error state so a page
// that already resolved is left untouched.
const onPageShow = (event: PageTransitionEvent) => {
  if (event.persisted && loadError.value) loadOrder()
}

onMounted(async () => {
  window.addEventListener('pageshow', onPageShow)
  await loadOrder()
  // Auxiliary, the product page's policy: a failed contact read costs the channels, not the order.
  try { await fetchSiteInfo() } catch (error) { console.error('Site info load failed:', error) }
})

onBeforeUnmount(() => {
  clearTimeout(dotPopAt)
  window.removeEventListener('pageshow', onPageShow)
})

// The late-session case — previously a false "order not found" right after returning from
// PayWay: the reads can exhaust their retries while clerk-js is still fresh-loading, and then
// its user lands a beat later. One more load then; cheap, and it clears the dead end.
watch(user, (value) => {
  if (value && loadError.value) loadOrder()
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
    <div class="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
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
        class="group mt-8 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-white"
      >
        <span aria-hidden="true" class="inline-block motion-safe:transition-transform motion-safe:duration-200 group-hover:-translate-x-0.5">←</span>
        {{ t('backToOrders') }}
      </NuxtLink>

      <!-- The loading shape is the page it becomes, two columns included. -->
      <div v-if="isLoading" class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:gap-8" data-order-skeleton>
        <div class="h-80 animate-pulse rounded-3xl border border-zinc-200/60 bg-zinc-100 dark:border-zinc-800/60 dark:bg-zinc-900" />
        <div class="h-56 animate-pulse rounded-2xl border border-zinc-200/60 bg-zinc-100 dark:border-zinc-800/60 dark:bg-zinc-900" />
      </div>

      <div v-else-if="loadError || !order" class="mt-4 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
        <p class="text-sm font-medium text-zinc-500">{{ t('orderNotFound') }}</p>
        <UButton :to="localePath('/')" color="neutral" class="mt-6 rounded-full px-6 font-semibold text-sm cursor-pointer">
          {{ t('cartEmptyCta') }}
        </UButton>
      </div>

      <Transition name="reveal"><div v-if="order && !loadError" class="grid gap-4 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:items-start lg:gap-8">
        <!-- The content column: identity, journey, the goods. -->
        <div class="min-w-0">
        <!-- Hero: the reference is the identity, the chip is the state. -->
        <section
          data-order-detail
          class="mt-4 rounded-3xl border border-zinc-200/80 bg-white p-6 motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out sm:p-7 dark:border-zinc-800/80 dark:bg-zinc-900/40"
          :class="shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'"
          :style="revealDelay(0)"
        >
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-[11px] font-bold text-zinc-400 uppercase dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.18em]'">
                {{ t('orderNumber') }}
              </p>
              <h1 data-order-ref class="mt-1.5 font-mono text-lg font-black break-all text-zinc-950 sm:text-xl dark:text-white">
                {{ order.id }}
              </h1>
              <p class="mt-2.5 text-xs font-medium text-zinc-500">
                {{ t('orderDate') }} · <span class="tabular-nums">{{ formatOrderDate(order.createdAt, locale) }}</span>
              </p>
            </div>
            <UBadge :color="ORDER_STATUS_TONES[order.status]" variant="soft" size="lg" class="shrink-0" data-order-status>
              {{ t(ORDER_STATUS_KEYS[order.status]) }}
            </UBadge>
          </div>
        </section>

        <!-- The canceller's reason/note, when the cancel transition carried one — attached
             directly under the hero, because it is why the chip above says what it says. -->
        <section
          v-if="order.cancelNote"
          class="mt-4 rounded-2xl border border-red-200/70 bg-red-50/50 p-5 motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out dark:border-red-900/40 dark:bg-red-950/20"
          :class="shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'"
          :style="revealDelay(1)"
        >
          <p class="text-[11px] font-bold text-red-500 uppercase dark:text-red-400" :class="locale === 'km' ? '' : 'tracking-[0.18em]'">
            {{ t('cancellationNote') }}
          </p>
          <p data-order-cancel-note class="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">{{ order.cancelNote }}</p>
        </section>

        <!-- The journey: past steps dim, the current one is the only full-weight label. -->
        <section
          class="mt-8 motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out"
          :class="shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'"
          :style="revealDelay(2)"
        >
          <h2 class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('orderStatus') }}</h2>
          <ol ref="timelineEl" class="mt-3 rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-order-timeline>
            <li v-for="(step, index) in timeline" :key="step.key" class="flex gap-3.5">
              <div class="flex flex-col items-center" aria-hidden="true">
                <span
                  class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  :class="index === timeline.length - 1 ? 'bg-zinc-950 dark:bg-white' : 'bg-zinc-300 dark:bg-zinc-600'"
                />
                <span v-if="index < timeline.length - 1" class="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <div class="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2" :class="index === timeline.length - 1 ? '' : 'pb-4'">
                <p
                  class="text-sm font-semibold"
                  :class="index === timeline.length - 1 ? 'text-zinc-950 dark:text-white' : 'text-zinc-500'"
                >
                  {{ t(step.key) }}
                </p>
                <p class="text-xs font-medium tabular-nums text-zinc-500">{{ formatOrderDate(step.at, locale) }}</p>
              </div>
            </li>
          </ol>
        </section>

        <!-- The receipt: quantity rides the name as a chip, prices stay tabular on the right. -->
        <section
          class="mt-8 motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out"
          :class="shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'"
          :style="revealDelay(3)"
        >
          <h2 class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('orderItems') }}</h2>
          <ul class="mt-3 divide-y divide-zinc-200/80 rounded-2xl border border-zinc-200/80 bg-white dark:divide-zinc-800/80 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-order-items>
            <li v-for="item in order.items" :key="item.id" class="flex items-start gap-4 px-5 py-4">
              <!-- 64px, contained — the same framing the product page gives the photo: receipt
                   photos are phone-tall, and any cover-crop shows a meaningless slice of them.
                   When the product still exists the tile is the way back to its full gallery. -->
              <NuxtLink
                v-if="item.productId"
                :to="localePath(`/products/${item.productId}`)"
                :aria-label="item.name"
                class="group block h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-100 dark:border-zinc-800/80 dark:bg-zinc-900"
              >
                <img
                  v-if="item.imagePath"
                  :src="publicImageUrl(item.imagePath, 128)"
                  alt=""
                  width="64"
                  height="64"
                  loading="lazy"
                  decoding="async"
                  class="h-full w-full object-contain motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-105"
                >
              </NuxtLink>
              <div v-else class="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-100 dark:border-zinc-800/80 dark:bg-zinc-900">
                <img
                  v-if="item.imagePath"
                  :src="publicImageUrl(item.imagePath, 128)"
                  alt=""
                  width="64"
                  height="64"
                  loading="lazy"
                  decoding="async"
                  class="h-full w-full object-contain"
                >
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-zinc-950 dark:text-white">
                  {{ item.name }}
                  <span class="ml-2 inline-block rounded-full bg-zinc-100 px-1.5 py-0.5 align-middle text-[11px] font-bold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">×{{ item.quantity }}</span>
                </p>
                <p class="mt-0.5 text-xs text-zinc-500">{{ t('sku') }}: {{ item.sku }}</p>
                <p v-if="item.promoLabel" class="mt-0.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">{{ item.promoLabel }}</p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-xs text-zinc-500">
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

        <!-- The money rail: totals first, then logistics and the shop's channels — the checkout's
             own summary-column convention, pay action included. -->
        </div><div class="min-w-0">

        <section
          class="mt-4 rounded-2xl border border-zinc-200/80 bg-white p-5 motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out dark:border-zinc-800/80 dark:bg-zinc-900/40"
          :class="shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'"
          :style="revealDelay(4)"
        >
          <div class="space-y-2.5">
            <div class="flex items-center justify-between text-sm text-zinc-500">
              <span>{{ t('cartSubtotal') }}</span>
              <span class="tabular-nums">{{ order.currency }} {{ order.subtotal.toFixed(2) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('orderTotal') }}</span>
              <span class="text-xl font-black tabular-nums text-zinc-950 dark:text-white">{{ order.currency }} {{ order.total.toFixed(2) }}</span>
            </div>
            <div class="flex items-center justify-between border-t border-zinc-200/80 pt-3 text-sm dark:border-zinc-800/80">
              <span class="text-zinc-500">{{ t('paymentStatus') }}</span>
              <span class="font-semibold text-zinc-950 dark:text-white">{{ t(PAYMENT_STATUS_KEYS[order.paymentStatus]) }}</span>
            </div>
          </div>
          <div v-if="payable" class="mt-4 border-t border-zinc-200/80 pt-4 dark:border-zinc-800/80">
            <UButton
              color="neutral"
              :loading="paying"
              data-order-pay
              class="w-full justify-center py-2.5 font-semibold text-sm shadow-xs cursor-pointer"
              @click="payNow()"
            >
              {{ t('payNow') }}
            </UButton>
            <p v-if="payError" class="mt-2 text-center text-xs font-semibold text-red-600 dark:text-red-400">{{ payError }}</p>
          </div>
        </section>

        <section
          v-if="order.deliveryName || order.deliveryPhone || order.deliveryAddress || order.deliveryLocation || order.deliveryNote"
          class="mt-8 motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out"
          :class="shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'"
          :style="revealDelay(5)"
        >
          <h2 class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('deliverySection') }}</h2>
          <dl class="mt-3 space-y-2.5 rounded-2xl border border-zinc-200/80 bg-white p-5 text-sm dark:border-zinc-800/80 dark:bg-zinc-900/40">
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

        <section
          v-if="channels.length"
          class="mt-8 motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out"
          :class="shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'"
          :style="revealDelay(6)"
        >
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
        </div>
      </div></Transition>
    </div>
  </main>
</template>
