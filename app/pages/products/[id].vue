<script setup lang="ts">
const route = useRoute()
const { fetchProduct } = useCatalog()
const product = ref<Awaited<ReturnType<typeof fetchProduct>>>(null)
const isLoading = ref(true)
const loadError = ref('')

const loadProduct = async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    product.value = await fetchProduct(String(route.params.id))
  } catch (error: any) {
    loadError.value = error?.message || 'This product could not be loaded.'
  } finally {
    isLoading.value = false
  }
}

await loadProduct()
useHead(() => ({ title: product.value ? `${product.value.name} | Raccoon Gear Bin` : 'Product | Raccoon Gear Bin' }))
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <header class="border-b border-zinc-200 dark:border-zinc-800"><UContainer class="flex min-h-20 items-center justify-between"><NuxtLink to="/" class="text-sm font-black uppercase tracking-[0.28em]">Raccoon Gear Bin</NuxtLink><NuxtLink to="/products" class="text-sm text-zinc-500">Back to products</NuxtLink></UContainer></header>
    <UContainer class="py-12 sm:py-16">
      <div v-if="isLoading" class="grid gap-10 lg:grid-cols-2"><div class="aspect-square animate-pulse bg-zinc-100 dark:bg-zinc-900" /><div class="space-y-5"><div class="h-10 animate-pulse bg-zinc-100 dark:bg-zinc-900" /><div class="h-24 animate-pulse bg-zinc-100 dark:bg-zinc-900" /></div></div>
      <UAlert v-else-if="loadError" color="error" variant="soft" :title="loadError" />
      <section v-else-if="!product" class="border-y border-zinc-200 py-24 text-center dark:border-zinc-800"><h1 class="text-2xl font-black">Product not found</h1><p class="mt-3 text-sm text-zinc-500">This product may have been removed or is not currently published.</p><UButton to="/products" color="neutral" class="mt-6">Browse products</UButton></section>
      <section v-else class="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div class="space-y-4"><div class="aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-900"><img v-if="product.images[0]" :src="product.images[0].url" :alt="product.images[0].altText || product.name" class="h-full w-full object-cover transition duration-700 ease-out hover:scale-[1.02]" /><div v-else class="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-400">No image</div></div><div v-if="product.images.length > 1" class="grid grid-cols-4 gap-3"><div v-for="image in product.images" :key="image.id" class="aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-900"><img :src="image.url" :alt="image.altText || product.name" class="h-full w-full object-cover transition duration-300 hover:opacity-75" /></div></div></div>
        <div><p class="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">{{ product.categoryName }}</p><h1 class="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{{ product.name }}</h1><p class="mt-5 text-2xl font-bold">{{ product.currency }} {{ product.price.toFixed(2) }}</p><div class="mt-4"><StockStatus :quantity="product.stockQuantity" /></div><p class="mt-8 text-base leading-8 text-zinc-600 dark:text-zinc-300">{{ product.description || product.shortDescription }}</p><div v-if="product.specifications" class="mt-10 border-t border-zinc-200 pt-7 dark:border-zinc-800"><h2 class="text-sm font-bold uppercase tracking-[0.2em]">Specifications</h2><pre class="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-500">{{ product.specifications }}</pre></div></div>
      </section>
    </UContainer>
  </main>
</template>
