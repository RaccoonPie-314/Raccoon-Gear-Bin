<script setup lang="ts">
import { cartTotals, type CartLineIssue, type CartLineView } from '~/utils/cart-totals'

const { locale, t } = useI18n()
const localePath = useLocalePath()
const { items, setQuantity, removeLine } = useCart()
const { fetchProducts, products } = useCatalog()

const isLoading = ref(true)
const loadError = ref(false)

onMounted(async () => {
  try {
    await fetchProducts()
  } catch {
    loadError.value = true
  } finally {
    isLoading.value = false
  }
})

const totals = computed(() => cartTotals(items.value, products.value))

// The clamp is written back so the badge, this page and checkout agree on the same numbers — and
// the *reason* is kept in `adjusted`, because the write-back itself makes the live issue vanish
// (the stored line equals its clamp on the next render). The notice stays until the shopper touches
// the line. Lines that vanished from the catalog keep their row — removing is the shopper's call.
const adjusted = ref<Record<string, CartLineIssue>>({})
watch(totals, (value) => {
  for (const view of value.lines) {
    if (view.product && view.quantity >= 1 && view.quantity !== view.line.quantity) {
      adjusted.value[view.line.productId] = view.issue
      setQuantity(view.line.productId, view.quantity)
    }
  }
}, { flush: 'post' })

const noticeFor = (view: CartLineView): CartLineIssue | null => {
  const sticky = adjusted.value[view.line.productId]
  return sticky || (view.issue === 'ok' ? null : view.issue)
}

// Rebuilt rather than key-deleted: `no-dynamic-delete` rightly flags a computed delete, and a
// fresh record keeps the change visible to Vue either way.
const clearAdjusted = (productId: string) => {
  adjusted.value = Object.fromEntries(Object.entries(adjusted.value).filter(([id]) => id !== productId))
}

const changeQuantity = (productId: string, next: number) => {
  clearAdjusted(productId)
  setQuantity(productId, next)
}

const removeFromCart = (productId: string) => {
  clearAdjusted(productId)
  removeLine(productId)
}

/** The live ceiling for a stepper: stock, or the promo cap while a promotion runs. */
const lineCap = (view: CartLineView) => {
  if (!view.product) return 0
  const remaining = view.pricing?.remainingUnits
  return remaining === null || remaining === undefined
    ? view.product.stockQuantity
    : Math.min(view.product.stockQuantity, remaining)
}

const pageTitle = computed(() => `${t('yourCart')} | ${t('appName')}`)
useHead({ title: pageTitle })
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden bg-zinc-50/50 lg:h-screen dark:bg-zinc-950">
    <!-- The checkout's locked frame, mirrored — at every width: `h-dvh` is the frame (it tracks
         a phone's URL bar; `lg` switches to `h-screen` because `dvh` mis-measures in the harness
         viewport). The lines pane takes whatever the frame gives and scrolls inside; the money
         pane is **content-sized** — a real phone is ~715 px tall, not the harness's 844, and a
         percentage share squeezed the subtotal against the CTA there. Content sizing keeps the
         gap constant (~24 px) at any height: close, never touching, never hollow. Two columns
         and the original 55/45 from `lg`. -->
    <div class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pt-5 pb-5 sm:px-6">
      <header class="flex items-center justify-between gap-4">
        <NuxtLink :to="localePath('/')">
          <BrandLogo />
        </NuxtLink>
        <div class="flex items-center gap-2">
          <ColorModeToggle />
          <LanguageSwitcher />
        </div>
      </header>

      <h1 class="mt-5 text-2xl font-black text-zinc-950 lg:mt-6 lg:text-3xl dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
        {{ t('yourCart') }}
      </h1>

      <div v-if="isLoading" class="mt-8 h-28 animate-pulse rounded-2xl border border-zinc-200/60 bg-zinc-100 dark:border-zinc-800/60 dark:bg-zinc-900" />

      <div v-else-if="loadError" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
        <p class="text-sm font-medium text-zinc-500">{{ t('catalogLoadError') }}</p>
      </div>

      <div v-else-if="!totals.lines.length" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
        <p class="text-sm font-medium text-zinc-500">{{ t('cartEmpty') }}</p>
        <UButton :to="localePath('/')" color="neutral" class="mt-6 rounded-full px-6 font-semibold text-sm cursor-pointer">
          {{ t('cartEmptyCta') }}
        </UButton>
      </div>

      <Transition name="reveal"><div
        v-if="!isLoading && !loadError && totals.lines.length"
        class="mt-4 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 lg:mt-6 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:grid-rows-1 lg:gap-8">
        <section class="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-900/40">
          <ul class="min-h-0 flex-1 divide-y divide-zinc-200/80 overflow-y-auto dark:divide-zinc-800/80" data-cart-lines>
            <li v-for="view in totals.lines" :key="view.line.productId" class="flex gap-4 px-5 py-3 sm:py-4" data-cart-line>
              <img
                v-if="view.product?.images[0]"
                :src="view.product.images[0].thumbUrl"
                :alt="view.product.name"
                class="h-16 w-16 shrink-0 rounded-2xl border border-zinc-200/60 object-cover sm:h-20 sm:w-20 dark:border-zinc-800/60"
              >
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <NuxtLink
                      v-if="view.product"
                      :to="localePath(`/products/${view.product.id}`)"
                      class="font-semibold text-zinc-950 hover:underline dark:text-white"
                    >
                      {{ view.product.name }}
                    </NuxtLink>
                    <div v-if="view.product" class="mt-1 flex flex-wrap items-center gap-3 text-sm">
                      <ProductPrice :product="view.product" />
                      <StockStatus :quantity="view.product.stockQuantity" />
                    </div>
                    <p v-if="noticeFor(view)" data-cart-issue class="mt-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      {{ t(noticeFor(view) === 'unavailable' ? 'cartUnavailable' : noticeFor(view) === 'over-promo-cap' ? 'cartPromoChanged' : 'cartStockChanged') }}
                    </p>
                  </div>
                  <p class="shrink-0 text-sm font-semibold tabular-nums text-zinc-950 dark:text-white">
                    {{ totals.currency }} {{ view.lineTotal.toFixed(2) }}
                  </p>
                </div>

                <div class="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    data-cart-minus
                    class="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200/80 bg-zinc-100/90 text-zinc-700 transition-[background-color,scale] duration-150 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800/80 dark:bg-zinc-900/90 dark:text-zinc-200"
                    :disabled="!view.product || view.quantity <= 1"
                    :aria-label="t('quantity')"
                    @click="changeQuantity(view.line.productId, view.quantity - 1)"
                  >
                    −
                  </button>
                  <span data-cart-qty class="min-w-6 text-center text-sm font-semibold tabular-nums">{{ view.quantity }}</span>
                  <button
                    type="button"
                    data-cart-plus
                    class="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200/80 bg-zinc-100/90 text-zinc-700 transition-[background-color,scale] duration-150 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800/80 dark:bg-zinc-900/90 dark:text-zinc-200"
                    :disabled="!view.product || view.quantity >= lineCap(view)"
                    :aria-label="t('quantity')"
                    @click="changeQuantity(view.line.productId, view.quantity + 1)"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    data-cart-remove
                    class="ml-2 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-white"
                    @click="removeFromCart(view.line.productId)"
                  >
                    {{ t('removeFromCart') }}
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </section>

        <section class="flex min-h-0 flex-col overflow-y-auto">
          <div class="rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-cart-summary>
            <div class="flex items-center justify-between">
              <p class="text-sm text-zinc-500">{{ t('cartSubtotal') }}</p>
              <p class="text-lg font-black tabular-nums text-zinc-950 dark:text-white" data-cart-subtotal>
                {{ totals.currency }} {{ totals.subtotal.toFixed(2) }}
              </p>
            </div>
          </div>
          <div class="mt-6 flex flex-1 flex-col justify-end gap-3">
            <UButton :to="localePath('/checkout')" color="neutral" data-cart-checkout class="h-11 justify-center rounded-full px-8 font-semibold text-sm cursor-pointer">
              {{ t('checkoutCta') }}
            </UButton>
            <NuxtLink
              :to="localePath('/')"
              class="text-center text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-white"
            >
              {{ t('continueShopping') }}
            </NuxtLink>
          </div>
        </section>
      </div></Transition>
    </div>
  </main>
</template>
