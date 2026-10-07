<script setup lang="ts">
/**
 * The checkout page (specs/ecommerce/SPEC-orders.md): the delivery form, the summary the RPC will
 * re-answer under row locks, and one submit. Nothing here computes a price or writes a row —
 * `useCheckout` owns the flow, `create_order` owns the money, and this file is layout, labels and
 * the `data-*` hooks the harness fills.
 *
 * Layout: a locked full-height frame at every width (`h-dvh` — it tracks a phone's URL bar;
 * `lg:h-screen` because `dvh` mis-measures in the harness viewport). On a phone the summary
 * card HUGS its content (`grid-rows-[auto…]` + a `45dvh` cap) instead of stretching over a
 * fixed share of the pane — the old split left a one-item card mostly dead space (live phone
 * report, 2026-10-06) while the form starved. Short carts give the delivery form every
 * remaining pixel; a long cart scrolls inside the capped card. The form pane's fields scroll
 * and the submit block (settlement note, submit, back) rides as `shrink-0`, pinned at the
 * pane's bottom so the button can never fall behind a fold. At `lg` the frame splits into two
 * equal-height columns as before.
 *
 * `index.vue`, not `checkout.vue`, deliberately: Nuxt nests `checkout.vue` + `checkout/` as parent
 * and child routes, and a parent that renders no `<NuxtPage/>` swallows `/checkout/success` — the
 * URL changes while the parent stays on screen (the harness caught exactly that). As an index page
 * the two routes are flat siblings.
 */
const { locale, t } = useI18n()
const localePath = useLocalePath()
const { isLoading, loadError, isSubmitting, errorMessage, name, phone, address, locationLink, note, isLocating, locationError, locate, invalidFields, totals, paymentChoice, load, submit } = useCheckout()

onMounted(load)

// The lines the RPC will actually be handed — the same filter `useCheckout.submit` applies, so
// the summary can never show a number the order would refuse to charge.
const activeLines = computed(() => totals.value.lines.filter(view => view.product && view.quantity >= 1))

const pageTitle = computed(() => `${t('checkoutTitle')} | ${t('appName')}`)
useHead({ title: pageTitle })
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden bg-zinc-50/50 lg:h-screen dark:bg-zinc-950">
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

      <h1 class="mt-4 text-2xl font-black text-zinc-950 sm:mt-5 lg:mt-6 lg:text-3xl dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
        {{ t('checkoutTitle') }}
      </h1>

      <div v-if="isLoading" class="mt-8 h-28 animate-pulse rounded-2xl border border-zinc-200/60 bg-zinc-100 dark:border-zinc-800/60 dark:bg-zinc-900" />

      <div v-else-if="loadError" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
        <p class="text-sm font-medium text-zinc-500">{{ t('catalogLoadError') }}</p>
      </div>

      <div v-else-if="!activeLines.length" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
        <p class="text-sm font-medium text-zinc-500">{{ t('checkoutCartEmpty') }}</p>
        <UButton :to="localePath('/')" color="neutral" class="mt-6 rounded-full px-6 font-semibold text-sm cursor-pointer">
          {{ t('cartEmptyCta') }}
        </UButton>
      </div>

      <Transition name="reveal"><form
        v-if="!isLoading && !loadError && activeLines.length"
        class="mt-4 grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 lg:mt-6 lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] lg:grid-rows-1 lg:gap-8" data-checkout-form @submit.prevent="submit">
        <!-- LEFT: the order summary, shaped like the cart rows the shopper just reviewed. The
             card clips; only the list inside it scrolls, and only when the cart is long. -->
        <section class="flex max-h-[45dvh] min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white lg:max-h-none dark:border-zinc-800/80 dark:bg-zinc-900/40">
          <h2 class="hidden shrink-0 px-5 py-4 text-sm font-bold text-zinc-950 sm:block dark:text-white">{{ t('checkoutSummary') }}</h2>
          <ul class="min-h-0 flex-1 divide-y divide-zinc-200/80 overflow-y-auto dark:divide-zinc-800/80" data-checkout-lines>
            <li v-for="view in activeLines" :key="view.line.productId" class="flex gap-4 px-5 py-2.5 sm:py-4" data-checkout-line>
              <img
                v-if="view.product?.images[0]"
                :src="view.product.images[0].thumbUrl"
                :alt="view.product.name"
                class="h-14 w-14 shrink-0 rounded-2xl border border-zinc-200/60 object-cover sm:h-20 sm:w-20 dark:border-zinc-800/60"
              >
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-zinc-950 dark:text-white">{{ view.product?.name }}</p>
                    <div class="mt-1 text-sm">
                      <ProductPrice v-if="view.product" :product="view.product" />
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="text-xs text-zinc-500">×{{ view.quantity }}</p>
                    <p class="text-sm font-semibold tabular-nums text-zinc-950 dark:text-white">
                      {{ totals.currency }} {{ view.lineTotal.toFixed(2) }}
                    </p>
                  </div>
                </div>
              </div>
            </li>
          </ul>
          <div class="shrink-0 space-y-1.5 border-t border-zinc-200/80 px-5 py-3 sm:space-y-2 sm:py-4 dark:border-zinc-800/80">
            <div class="flex items-center justify-between text-sm text-zinc-500">
              <span>{{ t('cartSubtotal') }}</span>
              <span class="tabular-nums">{{ totals.currency }} {{ totals.subtotal.toFixed(2) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold text-zinc-950 dark:text-white">{{ t('orderTotal') }}</span>
              <span class="text-lg font-black tabular-nums text-zinc-950 dark:text-white">{{ totals.currency }} {{ totals.subtotal.toFixed(2) }}</span>
            </div>
          </div>
        </section>

        <!-- RIGHT: the form. The fields scroll inside their pane; the submit block below is
             `shrink-0`, so it stays pinned at the pane's bottom at every width — a short pane
             scrolls the fields, never the submit away. -->
        <section class="flex min-h-0 flex-col overflow-hidden">
          <h2 class="shrink-0 text-sm font-bold text-zinc-950 dark:text-white">{{ t('deliverySection') }}</h2>
          <!-- The red/hint layer is the library's own error affordance: `error` on the field
               renders the small hint under the input, `color` reds the input itself. Both read
               the live `invalidFields`, so they clear as the buyer types. -->
          <div class="mt-3 grid min-h-0 flex-1 gap-3 overflow-y-auto sm:mt-4 sm:grid-cols-2 sm:gap-4">
            <UFormField
              :label="t('deliveryName')"
              name="checkout-name"
              data-checkout-field="name"
              :error="invalidFields.includes('name') ? t('requiredName') : undefined">
              <UInput
                v-model="name"
                data-checkout-name
                type="text"
                autocomplete="name"
                class="w-full"
                :color="invalidFields.includes('name') ? 'error' : undefined" />
            </UFormField>
            <UFormField
              :label="t('deliveryPhone')"
              name="checkout-phone"
              data-checkout-field="phone"
              :error="invalidFields.includes('phone') ? t('requiredPhone') : undefined">
              <UInput
                v-model="phone"
                data-checkout-phone
                type="tel"
                autocomplete="tel"
                class="w-full"
                :color="invalidFields.includes('phone') ? 'error' : undefined" />
            </UFormField>
            <UFormField
              :label="t('deliveryAddress')"
              name="checkout-address"
              data-checkout-field="address"
              class="sm:col-span-2"
              :error="invalidFields.includes('address') ? t('requiredAddress') : undefined">
              <UInput
                v-model="address"
                data-checkout-address
                type="text"
                autocomplete="street-address"
                class="w-full"
                :color="invalidFields.includes('address') ? 'error' : undefined" />
            </UFormField>
            <!-- The pin is its own required field, not a replacement for the typed address:
                 the shop calls the phone AND the courier follows the map. -->
            <UFormField
              :label="t('deliveryLocation')"
              name="checkout-location"
              data-checkout-field="location"
              class="sm:col-span-2"
              :error="invalidFields.includes('location') ? t('requiredLocation') : undefined">
              <UInput
                v-model="locationLink"
                data-checkout-location
                type="text"
                class="w-full"
                :color="invalidFields.includes('location') ? 'error' : undefined" />
              <!-- The browser's own permission prompt is the ask; the button only ever triggers
                   the read from a real click. `type="button"` — the form's Enter must keep
                   submitting the order, not this. -->
              <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <UButton type="button" data-checkout-locate color="neutral" variant="subtle" size="xs" class="rounded-full px-3 text-xs font-semibold cursor-pointer" :loading="isLocating" @click="locate">
                  {{ t('useMyLocation') }}
                </UButton>
                <p v-if="locationError" data-checkout-location-error role="alert" class="text-xs font-medium text-red-500 dark:text-red-400">
                  {{ locationError }}
                </p>
              </div>
            </UFormField>
            <UFormField :label="t('deliveryNote')" name="checkout-note" class="sm:col-span-2">
              <UInput v-model="note" data-checkout-note type="text" class="w-full" />
            </UFormField>
          </div>

          <div class="mt-3 flex shrink-0 flex-col gap-2.5 sm:mt-4 sm:gap-3">
            <Transition name="reveal">
              <UAlert v-if="errorMessage" data-checkout-error color="error" variant="soft" :title="errorMessage" />
            </Transition>
            <!-- The one choice the submit honours: pay now walks into PayWay the moment the order
                 exists, pay later (the default) just places it — the success page still offers the
                 pay-now hop. -->
            <div class="grid grid-cols-2 gap-2" data-checkout-payment-choice>
              <UButton
                type="button"
                color="neutral"
                :variant="paymentChoice === 'now' ? 'solid' : 'outline'"
                data-checkout-pay-now
                class="h-11 justify-center rounded-full px-4 font-semibold text-sm cursor-pointer"
                @click="paymentChoice = 'now'"
              >
                {{ t('payNow') }}
              </UButton>
              <UButton
                type="button"
                color="neutral"
                :variant="paymentChoice === 'later' ? 'solid' : 'outline'"
                data-checkout-pay-later
                class="h-11 justify-center rounded-full px-4 font-semibold text-sm cursor-pointer"
                @click="paymentChoice = 'later'"
              >
                {{ t('payLater') }}
              </UButton>
            </div>
            <UButton
              type="submit"
              color="neutral"
              data-checkout-submit
              class="h-11 justify-center rounded-full px-8 font-semibold text-sm cursor-pointer"
              :loading="isSubmitting"
              :disabled="isSubmitting"
            >
              {{ isSubmitting ? t('placingOrder') : t('placeOrder') }}
            </UButton>
            <NuxtLink
              :to="localePath('/cart')"
              class="text-center text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-white"
            >
              <span aria-hidden="true">←</span> {{ t('yourCart') }}
            </NuxtLink>
          </div>
        </section>
      </form></Transition>
    </div>
  </main>
</template>
