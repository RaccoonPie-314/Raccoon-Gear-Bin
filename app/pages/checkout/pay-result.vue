<script setup lang="ts">
import type { OrderView } from '~/types/orders'

/**
 * Where PayWay sends the buyer back (the cancel and continue URLs are byte-identical, so the
 * browser return carries no cancel-vs-pending signal — `verify` answers `unpaid` for both a
 * declined/abandoned attempt AND an approved-but-still-settling one). The ORDER ROW is the truth:
 * `paid` is rendered only when the row says so. Anything else is the honest "still confirming"
 * state, never a false "not completed" — and the result page issues no new charge, so a slow
 * settle can never be double-paid from here. A real retry lives on the order-detail page.
 */
const route = useRoute()
const { locale, t } = useI18n()
const localePath = useLocalePath()
const { fetchOrder } = useCustomerOrders()
const { user } = useUser()

const order = ref<OrderView | null>(null)
const isLoading = ref(true)
const loadError = ref(false)
// True while the reconciliation read is in flight: the pre-verify row is `unpaid`, and rendering
// that as a verdict for a second before the check flips it reads as a failure flash.
const verifying = ref(false)
// The payer-capability path: the attempt id rides the return URLs, so the truth can be read with
// NO session — which matters because the arriving session can lag for minutes after the PayWay
// excursion. Status only; the order fetch below remains the richer, session-scoped read.
const tranId = computed(() => typeof route.query.tran === 'string' && /^[A-Za-z0-9]{6,20}$/.test(route.query.tran) ? route.query.tran : '')
const tranStatus = ref<string | null>(null)

onMounted(async () => {
  window.addEventListener('pageshow', onPageShow)
  await load()
})

onBeforeUnmount(() => window.removeEventListener('pageshow', onPageShow))

// The late-session case, mirroring the order-detail page: the reads can exhaust their retries
// while clerk-js is still fresh-loading after the excursion, and its user lands a beat later.
// One more load then clears the dead end.
watch(user, (value) => {
  if (value && loadError.value && !order.value) load()
})

async function load() {
  // The reads on this page retry through the post-excursion boot window: after minutes on PayWay
  // the `__session` JWT arrives stale, and this page mounts BEFORE clerk-js has booted and
  // refreshed it (and before @clerk/nuxt's handshake reissued cookies) — so early attempts can
  // answer 401 legitimately. Three attempts over ~2s; the ring holds while they run. A truly
  // signed-out visitor exhausts them and gets the honest not-found state.
  const fetchOrderRetrying = async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fetchOrder(String(route.query.order ?? ''))
      } catch (error) {
        lastError = error
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    throw lastError
  }
  isLoading.value = true
  loadError.value = false
  try {
    order.value = await fetchOrderRetrying()
  } catch {
    loadError.value = true
  } finally {
    isLoading.value = false
  }
  await reconcile()
}

// The reconciliation read (SPEC-payments P3): PayWay's success redirect can arrive before its
// return-URL notification reaches us, so an unpaid row asks the server to Check Transaction for
// the latest attempt and applies the answer through the one idempotent door.
//
// A bounded poll, not three quick tries. PayWay settles asynchronously (observed live — an
// approval stamped ~20s after the browser returned), so a single first read legitimately says
// PENDING, and a short budget showed a false "not completed" for a payment that WAS coming
// through. Poll every 2s up to ~30s and break the instant the row flips paid; the `verifying` ring
// holds the whole window. The catch sits inside the loop so a stale-cookie 401 on one attempt does
// not abort the rest. `tran` makes the call session-free; then the order read above only enriches
// the card. Shared by mount and the buyer's "check again", so a page opened before the settle can
// be re-run without a reload.
async function reconcile() {
  if (!(tranId.value || (order.value && order.value.paymentStatus !== 'paid'))) return
  verifying.value = true
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const fresh = await $fetch<{ paymentStatus: string }>('/api/payments/payway/verify', {
        method: 'POST',
        body: tranId.value ? { tranId: tranId.value } : { orderId: order.value?.id }
      })
      if (fresh) {
        tranStatus.value = fresh.paymentStatus
        const current = order.value
        if (current && fresh.paymentStatus !== current.paymentStatus) {
          order.value = { ...current, paymentStatus: fresh.paymentStatus as OrderView['paymentStatus'] }
        }
      }
      if ((order.value?.paymentStatus ?? tranStatus.value) === 'paid') break
    } catch { /* settle window: ask again until the deadline */ }
    if (Date.now() + 2_000 >= deadline) break
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
  verifying.value = false
}

// Mobile Back/Forward from the same-tab PayWay excursion restores this page from bfcache, which
// does NOT re-run `onMounted`. If the read had exhausted its retries while clerk-js was still
// booting, the stale "order not found" would otherwise stick. `pageshow` with `persisted` is the
// one signal that fires on a bfcache restore; re-run the load then, but only from the empty/error
// state so a page that already resolved is left untouched.
function onPageShow(event: PageTransitionEvent) {
  if (event.persisted && !order.value && !verifying.value) load()
}

const paid = computed(() => (order.value?.paymentStatus ?? tranStatus.value) === 'paid')
// The unpaid terminal is "still confirming", never a failure verdict, and the result page issues
// no new charge — so there is no pay-again here (that hazard lives on the order-detail page, where
// the row is freshly read and can't be confused with a payment still settling). "Check again"
// re-reads the row and re-runs the bounded poll for a buyer who arrived before the settle.
const checkAgain = () => { if (!verifying.value && !isLoading.value) load() }

const pageTitle = computed(() => `${t('payResultTitle')} | ${t('appName')}`)
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

      <div v-if="isLoading || verifying" class="mt-8 flex flex-col items-center gap-4 py-6" data-pay-checking>
        <div
          class="h-12 w-12 rounded-full border-[3px] border-zinc-200 border-t-zinc-950 motion-safe:animate-spin motion-reduce:animate-pulse dark:border-zinc-800 dark:border-t-white"
          aria-hidden="true"
        />
        <p class="text-sm font-semibold text-zinc-500 dark:text-zinc-400">{{ t('checkingPayment') }}</p>
      </div>

      <div v-else-if="(loadError || !order) && !tranStatus" class="mt-8 text-center">
        <p class="text-sm font-medium text-zinc-500">{{ t('orderNotFound') }}</p>
        <UButton :to="localePath('/account/orders')" color="neutral" class="mt-6 w-full justify-center py-2.5 font-semibold text-sm cursor-pointer">
          {{ t('backToOrders') }}
        </UButton>
      </div>

      <div v-else class="mt-8 text-center" data-pay-result>
        <div
          class="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
          :class="paid ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'"
          aria-hidden="true"
        >
          <svg v-if="paid" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><path d="M20 6 9 17l-5-5" /></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        </div>
        <h1 class="mt-4 text-2xl font-black text-zinc-950 sm:text-3xl dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'" data-pay-title>
          {{ paid ? t('payPaidTitle') : t('payConfirmingTitle') }}
        </h1>
        <p v-if="!paid" class="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {{ t('payConfirmingBody') }}
        </p>
        <p v-if="paid && order" class="mt-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300" data-pay-summary>
          {{ order.items.length }} {{ t('orderItems') }} · {{ order.currency }} {{ order.total.toFixed(2) }}
        </p>
      </div>

      <div v-if="order && !loadError && !verifying" class="mt-6 space-y-3">
        <p class="text-center font-mono text-xs font-semibold break-all text-zinc-400 dark:text-zinc-500">{{ order.id }}</p>
        <UButton
          v-if="!paid"
          color="neutral"
          variant="subtle"
          data-pay-check-again
          class="w-full justify-center py-2.5 font-semibold text-sm cursor-pointer"
          @click="checkAgain()"
        >
          {{ t('payCheckAgain') }}
        </UButton>
        <UButton
          :to="localePath(`/account/orders/${order.id}`)"
          color="neutral"
          variant="soft"
          class="w-full justify-center py-2.5 font-semibold text-sm cursor-pointer"
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
