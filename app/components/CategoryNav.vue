<script setup lang="ts">
import type { CatalogCategory } from '~/types/catalog'

const props = withDefaults(
  defineProps<{
    modelValue: string
    categories?: CatalogCategory[]
  }>(),
  {
    categories: () => []
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div>
    <!-- Desktop: left-side vertical nav (lg and above) -->
    <CategoryDesktop
      class="hidden lg:flex"
      :model-value="modelValue"
      :categories="categories"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <!-- Mobile: fixed bottom bar (below lg) — breakpoint guard is inside CategoryMobile.vue -->
    <CategoryMobile
      :model-value="modelValue"
      :categories="categories"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>
