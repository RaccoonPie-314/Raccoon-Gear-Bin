<script setup lang="ts">
import type { OrderView } from '~/types/orders'
import { startPaywayCheckout } from '~/utils/payway-checkout'

/**
 * Where PayWay sends the buyer back (and where the cancel/complete URLs point). The ORDER ROW is
 * the truth — the `state` query param only flavours the unpaid copy, because it comes from a
 * redirect, and redirects are not evidence. `paid` is only ever rendered when the row says so.
 */
const route = useRoute()
const { locale, t } = useI18n()
const localePath = useLocalePath()
const { fetchOrder } = useCustomerOrders()

const order = ref<OrderView | null>(null)
const isLoading = ref(true)
const loadError = ref(false)
const paying = ref(false)
const payError = ref('')
// True while the reconciliation read is in flight: the pre-verify row is `unpaid`, and rendering
// that as "not completed" for a second before the check flips it reads as a failure flash.
const verifying = ref(false)
// The payer-capability path: the attempt id rides the return URLs, so the truth can be read with
// NO session — which matters because the arriving session can lag for minutes after the PayWay
// excursion. Status only; the order fetch below remains the richer, session-scoped read.
const tranId = computed(() => typeof route.query.tran === 'string' && /^[A-Za-z0-9]{6,20}$/.test(route.query.tran) ? route.query.tran : '')
const tranStatus = ref<string | null>(null)

onMounted(async () => {
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
  try {
    order.value = await fetchOrderRetrying()
  } catch {
    loadError.value = true
  } finally {
    isLoading.value = false
  }
  // The reconciliation read (SPEC-payments P3): PayWay's success redirect can arrive without its
  // return-URL notification ever reaching us, so an unpaid row asks the server to Check
  // Transaction for the latest attempt. The answer is applied through the one idempotent door;
  // a failure here is silent — the row on screen is already the truth we had.
  //
  // Three attempts, ring held throughout: PayWay settles asynchronously (observed live — an
  // approval stamped ~20s after the browser returned), so a single first read can legitimately
  // say PENDING and would show a false "not completed" for a payment that IS coming through.
  // The catch sits INSIDE the loop so a stale-cookie 401 on one attempt does not abort the rest.
  // With `tran` present the call itself is session-free — the order fetch above then only
  // enriches the card; the status is already known either way.
  const owed = order.value
  if (tranId.value || (owed && owed.paymentStatus !== 'paid')) {
    verifying.value = true
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fresh = await $fetch<{ paymentStatus: string }>('/api/payments/payway/verify', {
          method: 'POST',
          body: tranId.value ? { tranId: tranId.value } : { orderId: owed?.id }
        })
        if (fresh) {
          tranStatus.value = fresh.paymentStatus
          if (owed && fresh.paymentStatus !== order.value?.paymentStatus) {
            order.value = { ...owed, paymentStatus: fresh.paymentStatus as OrderView['paymentStatus'] }
          }
        }
        if ((order.value?.paymentStatus ?? tranStatus.value) === 'paid') break
      } catch { /* settle window: wait and ask again */ }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1500))
    }
    verifying.value = false
  }
})

const paid = computed(() => (order.value?.paymentStatus ?? tranStatus.value) === 'paid')
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
          <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
        </div>
        <h1 class="mt-4 text-2xl font-black text-zinc-950 sm:text-3xl dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'" data-pay-title>
          {{ paid ? t('payPaidTitle') : t('payNotPaidTitle') }}
        </h1>
        <p class="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {{ paid ? t('payPaidBody') : t('payNotPaidBody') }}
        </p>
      </div>

      <div v-if="order && !loadError && !verifying" class="mt-6 space-y-3">
        <p class="text-center font-mono text-xs font-semibold break-all text-zinc-400 dark:text-zinc-500">{{ order.id }}</p>
        <UButton
          v-if="payable"
          color="neutral"
          :loading="paying"
          data-pay-again
          class="w-full justify-center py-2.5 font-semibold text-sm shadow-xs cursor-pointer"
          @click="payNow()"
        >
          {{ t('tryAgain') }}
        </UButton>
        <UButton
          :to="localePath(`/account/orders/${order.id}`)"
          color="neutral"
          variant="soft"
          class="w-full justify-center py-2.5 font-semibold text-sm cursor-pointer"
        >
          {{ t('viewOrder') }}
        </UButton>
        <p v-if="payError" class="text-center text-xs font-semibold text-red-600 dark:text-red-400">{{ payError }}</p>
        <div class="text-center">
          <NuxtLink :to="localePath('/')" class="text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-white">
            {{ t('continueShopping') }}
          </NuxtLink>
        </div>
      </div>
    </div>
  </main>
</template>
