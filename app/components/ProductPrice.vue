<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'
import { getProductPricing } from '~/utils/product-pricing'

/**
 * One product's price, as the storefront says it: what it costs now and — only while a promotion
 * runs — the price it came down from, crossed out.
 *
 * The card and the detail page used to interpolate `product.price` themselves, which was fine until
 * a second number existed. Both now hand over the product and inherit their own typography through
 * the root, so a size change stays where it was decided. The number is asked of
 * `getProductPricing`, never worked out here: four surfaces show a price and a fifth sorts by it, and
 * that many copies of one rule is how a card and the message sent from its page start disagreeing.
 */
const props = defineProps<{ product: CatalogProduct }>()
const { t } = useI18n()
const pricing = computed(() => getProductPricing(props.product))
</script>

<template>
  <!-- `data-product-price` is a measurement hook, not a style hook: it is what `verify` aims a card
       and a detail page at to read the pair of numbers this component decides together. -->
  <div class="min-w-0" data-product-price>
    <p class="tabular-nums">
      <span>{{ product.currency }} {{ pricing.price.toFixed(2) }}</span>
      <!-- `<del>` says "this price no longer applies" to a screen reader as well as to an eye,
           which a `line-through` alone does not. -->
      <del v-if="pricing.originalPrice !== null" class="ml-2 text-[0.75em] font-medium text-zinc-400 dark:text-zinc-500">{{ product.currency }} {{ pricing.originalPrice.toFixed(2) }}</del>
    </p>
    <!-- Deliberately neither `tabular-nums` nor `uppercase`: `verify` counts one
         `main article p.tabular-nums` per card to prove the sort read the right column, and an
         uppercase eyebrow here would need the locale-conditional tracking guard. What the campaign
         is *called* is the ribbon's job (`ProductSaleRibbon`), so the two never say it twice. -->
    <p v-if="pricing.remainingUnits !== null" class="mt-1 text-[10px] sm:text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
      {{ t('promoRemaining', { count: pricing.remainingUnits }) }}
    </p>
  </div>
</template>
