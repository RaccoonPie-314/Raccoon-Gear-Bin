<script setup lang="ts">
import { LOW_STOCK_THRESHOLD } from '~/constants/catalog'

const props = defineProps<{ quantity: number }>()
const { t } = useI18n()

const status = computed(() => {
  if (props.quantity <= 0) return { label: t('outOfStock'), className: 'text-zinc-950 dark:text-white', dotClass: 'bg-zinc-950 dark:bg-white' }
  if (props.quantity <= LOW_STOCK_THRESHOLD) return { label: t('lowStock'), className: 'text-zinc-500 dark:text-zinc-300', dotClass: 'bg-zinc-500 dark:bg-zinc-300' }
  return { label: t('inStock'), className: 'text-zinc-400 dark:text-zinc-500', dotClass: 'bg-zinc-400 dark:bg-zinc-500' }
})
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide" :class="status.className">
    <span class="h-1.5 w-1.5 rounded-full shrink-0" :class="status.dotClass" />
    <span>{{ status.label }}</span>
  </span>
</template>
