<script setup lang="ts">
import type { ProductStockState } from '~/utils/product-stock'
import { getProductStockState } from '~/utils/product-stock'

const props = defineProps<{ quantity: number }>()
const { t } = useI18n()

// The band is asked for, not calculated: this component used to hold the `<= 0` / `<= threshold`
// rule itself, and the contact CTA held a second copy of it. The presentation below is keyed by
// the band instead of re-testing the quantity, so the badge cannot drift from the rule.
const PRESENTATION: Record<ProductStockState, { labelKey: string, className: string, dotClass: string }> = {
  out: { labelKey: 'outOfStock', className: 'text-zinc-950 dark:text-white', dotClass: 'bg-zinc-950 dark:bg-white' },
  low: { labelKey: 'lowStock', className: 'text-zinc-500 dark:text-zinc-300', dotClass: 'bg-zinc-500 dark:bg-zinc-300' },
  in: { labelKey: 'inStock', className: 'text-zinc-400 dark:text-zinc-500', dotClass: 'bg-zinc-400 dark:bg-zinc-500' }
}

// Resolved here rather than in the template so `status.label` stays the string it has always been.
// `state` travels with it: the band the quantity fell into is what `verify` reads, so a threshold
// that moved would fail a check instead of quietly re-colouring a badge.
const status = computed(() => {
  const state = getProductStockState(props.quantity)
  const presentation = PRESENTATION[state]
  return { state, label: t(presentation.labelKey), className: presentation.className, dotClass: presentation.dotClass }
})
</script>

<template>
  <!-- `data-stock-status` / `data-stock-state` are measurement hooks, not style hooks: nothing in
       this file reads them, and the labels and colours are byte-identical to the ones from before
       the band rule was shared out of this component. -->
  <span
    class="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide"
    :class="status.className"
    data-stock-status
    :data-stock-state="status.state"
  >
    <span class="h-1.5 w-1.5 rounded-full shrink-0" :class="status.dotClass" />
    <span>{{ status.label }}</span>
  </span>
</template>
