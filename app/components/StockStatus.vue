<script setup lang="ts">
import { LOW_STOCK_THRESHOLD } from '~/constants/catalog'

const props = defineProps<{ quantity: number }>()

const status = computed(() => {
  if (props.quantity <= 0) return { label: 'Out of Stock', className: 'text-red-600 dark:text-red-400' }
  if (props.quantity <= LOW_STOCK_THRESHOLD) return { label: 'Low Stock', className: 'text-amber-600 dark:text-amber-400' }
  return { label: 'In Stock', className: 'text-emerald-600 dark:text-emerald-400' }
})
</script>

<template>
  <span class="inline-flex items-center gap-2 text-xs font-semibold" :class="status.className">
    <span class="h-1.5 w-1.5 rounded-full bg-current" />
    {{ status.label }}
  </span>
</template>
