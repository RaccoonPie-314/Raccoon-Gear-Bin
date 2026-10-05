<script setup lang="ts">
import { useReducedMotion } from 'motion-v'
import { iconPop, pulseScale } from '~/utils/motion'

/**
 * Order confirmation (specs/ecommerce/SPEC-orders.md). This page reads one thing — the order id
 * the RPC returned, carried in the query string — and never fetches: the order row is the detail
 * page's read, and a success screen that can fail its own read is a worse screen. The payments
 * phase adds a Pay-now entry here; until then this is COD confirmation only.
 */
const { locale, t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()

const orderId = computed(() => typeof route.query.order === 'string' ? route.query.order : '')

// The funnel's one delight-budget moment (rare tier): the tick acknowledges a placed order just
// after the page's own enter transition has landed — `iconPop`'s one-shot pulse, the repo's
// "acknowledged, not bouncing" shape. Reduced motion skips it entirely; the page fade stays.
const reduced = useReducedMotion()
const tick = ref<HTMLElement | null>(null)
let popAt: ReturnType<typeof setTimeout> | undefined
onMounted(() => {
  if (reduced.value || !tick.value) return
  popAt = setTimeout(() => { if (tick.value) pulseScale(tick.value, iconPop.keyframes, iconPop.ms) }, 260)
})
onBeforeUnmount(() => clearTimeout(popAt))

const pageTitle = computed(() => `${t('orderSuccessTitle')} | ${t('appName')}`)
useHead({ title: pageTitle })
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-zinc-50/50 px-4 py-12 dark:bg-zinc-950">
    <div class="w-full max-w-md rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-2xl sm:p-8 dark:border-zinc-800/80 dark:bg-zinc-950">
      <div class="flex items-center justify-between gap-4">
        <NuxtLink :to="localePath('/')">
          <BrandLogo />
        </NuxtLink>
        <div class="flex items-center gap-2">
          <ColorModeToggle />
          <LanguageSwitcher />
        </div>
      </div>

      <div class="mt-8 text-center">
        <div ref="tick" class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <h1 class="mt-4 text-2xl font-black text-zinc-950 sm:text-3xl dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
          {{ t('orderSuccessTitle') }}
        </h1>
        <p class="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">{{ t('orderSuccessBody') }}</p>
      </div>

      <div v-if="orderId" class="mt-6 rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
        <p class="text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.25em]'">
          {{ t('orderNumber') }}
        </p>
        <p class="mt-1.5 font-mono text-xs font-semibold break-all text-zinc-950 dark:text-white" data-order-number>{{ orderId }}</p>
      </div>

      <div class="mt-6 space-y-3">
        <UButton
          v-if="orderId"
          :to="localePath(`/account/orders/${orderId}`)"
          color="neutral"
          data-order-view
          class="w-full justify-center py-2.5 font-semibold text-sm shadow-xs cursor-pointer"
        >
          {{ t('viewOrder') }}
        </UButton>
        <div class="text-center">
          <NuxtLink :to="localePath('/')" class="text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-white">
            {{ t('continueShopping') }}
          </NuxtLink>
        </div>
      </div>
    </div>
  </main>
</template>
