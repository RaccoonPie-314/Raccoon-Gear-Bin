<script setup lang="ts">
const { fetchProducts, fetchCategories } = useCatalog()
const products = ref<Awaited<ReturnType<typeof fetchProducts>>>([])
const categories = ref<Awaited<ReturnType<typeof fetchCategories>>>([])
const isLoading = ref(true)
const search = ref('')
const selectedCategory = ref('all')
const sortOrder = ref('newest')
const loadError = ref('')

const loadCatalog = async () => {
  isLoading.value = true
  try {
  products.value = await fetchProducts()
  categories.value = await fetchCategories()
  } catch (error: any) {
  loadError.value = error?.message || 'The catalog could not be loaded.'
  } finally {
    isLoading.value = false
  }
}
onMounted(() => { void loadCatalog() })

const visibleProducts = computed(() => {
  const query = search.value.trim().toLowerCase()
  const filtered = products.value.filter((product) => {
    const categoryMatch = selectedCategory.value === 'all' || product.categoryId === selectedCategory.value
    const searchMatch = !query || [product.name, product.shortDescription, product.sku].some((value) => value.toLowerCase().includes(query))
    return categoryMatch && searchMatch
  })
  return [...filtered].sort((first, second) => {
    if (sortOrder.value === 'price-low') return first.price - second.price
    if (sortOrder.value === 'price-high') return second.price - first.price
    if (sortOrder.value === 'name') return first.name.localeCompare(second.name)
    return 0
  })
})

useHead({ title: 'All products | Raccoon Gear Bin' })
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <header class="border-b border-zinc-200 dark:border-zinc-800"><UContainer class="flex min-h-20 items-center justify-between"><NuxtLink to="/" aria-label="Raccoon Gear Bin home"><BrandLogo compact /></NuxtLink><NuxtLink to="/" class="text-sm text-zinc-500">Home</NuxtLink></UContainer></header>
    <UContainer class="py-12 sm:py-16">
      <div class="border-b border-zinc-200 pb-8 dark:border-zinc-800"><p class="text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">The collection</p><h1 class="mt-3 text-4xl font-black tracking-tight sm:text-5xl">All products</h1></div>
      <div class="flex flex-col gap-4 border-b border-zinc-200 py-6 dark:border-zinc-800 sm:flex-row sm:flex-wrap"><UInput v-model="search" icon="i-lucide-search" placeholder="Search products" class="sm:max-w-sm" /><USelect v-model="selectedCategory" :items="[{ label: 'All categories', value: 'all' }, ...categories.map((category) => ({ label: category.name, value: category.id }))]" class="sm:w-56" /><USelect v-model="sortOrder" :items="[{ label: 'Newest', value: 'newest' }, { label: 'Price: low to high', value: 'price-low' }, { label: 'Price: high to low', value: 'price-high' }, { label: 'Name A-Z', value: 'name' }]" class="sm:w-56" /></div>
      <UAlert v-if="loadError" class="mt-6" color="error" variant="soft" :title="loadError" />
      <div v-if="isLoading" class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"><div v-for="item in 6" :key="item" class="h-96 animate-pulse bg-zinc-100 dark:bg-zinc-900" /></div><div v-else-if="!loadError && !visibleProducts.length" class="border-y border-zinc-200 py-24 text-center dark:border-zinc-800"><p class="text-sm text-zinc-500">No products match this view.</p></div>
      <div v-else class="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3"><ProductCard v-for="product in visibleProducts" :key="product.id" :product="product" /></div>
    </UContainer>
  </main>
</template>
