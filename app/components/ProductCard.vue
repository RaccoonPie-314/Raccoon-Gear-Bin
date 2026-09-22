<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'

defineProps<{ product: CatalogProduct; isAdmin?: boolean }>()
const emit = defineEmits<{ edit: [product: CatalogProduct] }>()
const { t } = useI18n()
</script>

<template>
  <article class="group">
    <div class="relative aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-900">
      <NuxtLink :to="`/products/${product.id}`" class="block h-full w-full">
        <img v-if="product.images[0]" :src="product.images[0].url" :alt="product.images[0].altText || product.name" class="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.03]" />
        <div v-else class="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-400">{{ t('noImage') }}</div>
      </NuxtLink>
      <UButton v-if="isAdmin" icon="i-lucide-pencil" color="neutral" variant="solid" size="sm" class="absolute right-3 top-3 opacity-0 transition group-hover:opacity-100" aria-label="Edit product" @click="emit('edit', product)" />
    </div>
    <div class="flex items-start justify-between gap-4 pt-4">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">{{ product.categoryName }}</p>
        <h2 class="mt-1 font-bold">{{ product.name }}</h2>
        <p class="mt-1 text-sm text-zinc-500">{{ product.shortDescription }}</p>
      </div>
      <p class="shrink-0 font-bold">{{ product.currency }} {{ product.price.toFixed(2) }}</p>
    </div>
    <div class="mt-3 flex items-center justify-between gap-3">
      <StockStatus :quantity="product.stockQuantity" />
      <UButton :to="`/products/${product.id}`" size="xs" color="neutral" variant="link" trailing-icon="i-lucide-arrow-up-right">{{ t('details') }}</UButton>
    </div>
  </article>
</template>
