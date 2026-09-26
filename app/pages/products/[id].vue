<script setup lang="ts">
const route = useRoute()
const { fetchProduct, parseSpecificationPairs } = useCatalog()
const { t } = useI18n()
const product = ref<Awaited<ReturnType<typeof fetchProduct>>>(null)
const selectedImageIndex = ref(0)
const isLoading = ref(true)
const loadError = ref('')

const loadProduct = async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    product.value = await fetchProduct(String(route.params.id))
  } catch (error: any) {
    loadError.value = error?.message || t('productLoadError')
  } finally {
    isLoading.value = false
  }
}

// The specifications value arrives in whatever shape the editor stored, and only the catalog
// data layer knows how to read it; this page just renders the pairs it is handed.
const parsedSpecs = computed(() => parseSpecificationPairs(product.value?.specifications))

await loadProduct()
useHead(() => ({ title: product.value ? `${product.value.name} | ${t('appName')}` : `${t('products')} | ${t('appName')}` }))
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <!-- Sticky Translucent Minimalist Header -->
    <header class="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/80 transition-colors">
      <UContainer class="flex min-h-16 sm:min-h-20 items-center justify-between">
        <NuxtLink to="/" :aria-label="t('appName')">
          <BrandLogo size="md" />
        </NuxtLink>
        <div class="flex items-center gap-3 sm:gap-4">
          <ColorModeToggle />
          <LanguageSwitcher />
          <NuxtLink
            to="/"
            class="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            <span>{{ t('backToProducts') }}</span>
          </NuxtLink>
        </div>
      </UContainer>
    </header>

    <UContainer class="py-10 sm:py-16">
      <div v-if="isLoading" class="grid gap-10 lg:grid-cols-2">
        <div class="aspect-square rounded-3xl animate-pulse bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60" />
        <div class="space-y-6">
          <div class="h-8 w-40 rounded-lg animate-pulse bg-zinc-100 dark:bg-zinc-900" />
          <div class="h-12 w-3/4 rounded-lg animate-pulse bg-zinc-100 dark:bg-zinc-900" />
          <div class="h-8 w-28 rounded-lg animate-pulse bg-zinc-100 dark:bg-zinc-900" />
          <div class="h-28 w-full rounded-lg animate-pulse bg-zinc-100 dark:bg-zinc-900" />
        </div>
      </div>

      <UAlert v-else-if="loadError" color="error" variant="soft" :title="loadError" />

      <section v-else-if="!product" class="rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
        <h1 class="text-2xl font-black text-zinc-950 dark:text-white">{{ t('productNotFound') }}</h1>
        <p class="mt-3 text-sm text-zinc-500">{{ t('productNotFoundDescription') }}</p>
        <UButton to="/" color="neutral" class="mt-6 rounded-full px-6">
          {{ t('browseProducts') }}
        </UButton>
      </section>

      <section v-else class="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <!-- Gallery Column -->
        <div class="space-y-4">
          <div class="relative aspect-square overflow-hidden rounded-2xl sm:rounded-3xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800/70 p-4 sm:p-8 flex items-center justify-center shadow-xs">
            <img
              v-if="product.images[selectedImageIndex] || product.images[0]"
              :src="(product.images[selectedImageIndex] || product.images[0]).url"
              :alt="(product.images[selectedImageIndex] || product.images[0]).altText || product.name"
              class="h-full w-full object-contain transition-all duration-300"
            />
            <div v-else class="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-400">
              {{ t('noImage') }}
            </div>
          </div>

          <!-- Thumbnails Row -->
          <div v-if="product.images.length > 1" class="flex flex-wrap gap-3">
            <button
              v-for="(image, index) in product.images"
              :key="image.id"
              type="button"
              class="h-16 w-16 sm:h-20 sm:w-20 rounded-xl overflow-hidden border p-1 bg-zinc-50 dark:bg-zinc-900 transition-all cursor-pointer focus-visible:outline-none"
              :class="[
                selectedImageIndex === index
                  ? 'border-zinc-950 dark:border-white ring-2 ring-zinc-950/20 dark:ring-white/20'
                  : 'border-zinc-200/80 dark:border-zinc-800/80 opacity-70 hover:opacity-100 hover:border-zinc-400'
              ]"
              @click="selectedImageIndex = index"
            >
              <img
                :src="image.url"
                :alt="image.altText || product.name"
                class="h-full w-full object-cover rounded-lg"
              />
            </button>
          </div>
        </div>

        <!-- Product Summary & Specs Column -->
        <div class="lg:sticky lg:top-24 self-start">
          <p class="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-400 dark:text-zinc-500">
            {{ product.categoryName }}
          </p>
          <h1 class="mt-3 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl text-zinc-950 dark:text-white">
            {{ product.name }}
          </h1>
          <p class="mt-4 text-2xl sm:text-3xl font-bold tabular-nums text-zinc-950 dark:text-white">
            {{ product.currency }} {{ product.price.toFixed(2) }}
          </p>

          <div class="mt-4">
            <StockStatus :quantity="product.stockQuantity" />
          </div>

          <p class="mt-8 text-base leading-relaxed text-zinc-600 dark:text-zinc-300 font-normal">
            {{ product.description || product.shortDescription }}
          </p>

          <!-- Structured Specifications Table -->
          <div v-if="parsedSpecs.length" class="mt-10 border-t border-zinc-200/80 pt-8 dark:border-zinc-800/80">
            <h2 class="text-xs font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500 mb-4">
              {{ t('specs') }}
            </h2>
            <dl class="divide-y divide-zinc-100 dark:divide-zinc-800/70 text-sm">
              <div
                v-for="(spec, index) in parsedSpecs"
                :key="index"
                class="py-3 flex justify-between items-baseline gap-4"
              >
                <dt class="font-medium text-zinc-500 dark:text-zinc-400">{{ spec.label }}</dt>
                <dd class="font-semibold text-zinc-900 dark:text-zinc-100 text-right">{{ spec.value }}</dd>
              </div>
            </dl>
          </div>
          <div v-else-if="product.specifications" class="mt-10 border-t border-zinc-200/80 pt-8 dark:border-zinc-800/80">
            <h2 class="text-xs font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500 mb-4">
              {{ t('specs') }}
            </h2>
            <pre class="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-500">{{ product.specifications }}</pre>
          </div>
        </div>
      </section>
    </UContainer>
  </main>
</template>
