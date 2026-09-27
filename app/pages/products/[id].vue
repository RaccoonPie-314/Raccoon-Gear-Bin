<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'

const route = useRoute()
const { fetchProduct, fetchProducts, parseSpecificationPairs } = useCatalog()
const { t } = useI18n()
const product = ref<Awaited<ReturnType<typeof fetchProduct>>>(null)
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

// The header search filters a loaded catalog list locally: the fetch is `useCatalog`'s, the
// matching is `useCatalogBrowse`'s — the same pair the home page uses, so the detail page adds
// no second search implementation and never queries on a keystroke. The list is pulled once,
// lazily, on the first focus of the field.
const searchProducts = ref<CatalogProduct[]>([])
const { search, filteredProducts } = useCatalogBrowse(searchProducts)
const isSearchCatalogLoading = ref(false)
const isSearchCatalogLoaded = ref(false)

const ensureSearchCatalog = async () => {
  if (isSearchCatalogLoaded.value || isSearchCatalogLoading.value) return
  isSearchCatalogLoading.value = true
  try {
    searchProducts.value = await fetchProducts()
    isSearchCatalogLoaded.value = true
  } catch (error) {
    // Like the home masthead's site-info read: a failed auxiliary fetch degrades to "no
    // results", not to a red banner on a page whose subject is the product.
    console.error('Catalog search load failed:', error)
  } finally {
    isSearchCatalogLoading.value = false
  }
}

// Detail→detail navigation (now reachable from the header search) keeps this component
// instance; without re-reading on a param change the page would show the previous product
// under the new URL.
watch(() => route.params.id, () => { void loadProduct() })

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
      <!-- The search sits between the brand and the utility group from `sm` up, and drops to
           its own full-width line below that — the same reflow valve the masthead uses, so a
           control that no longer fits adds a row instead of widening the page. -->
      <UContainer class="flex min-h-16 sm:min-h-20 flex-wrap items-center gap-x-3 gap-y-2 py-2 sm:gap-x-4">
        <NuxtLink to="/" :aria-label="t('appName')" class="shrink-0">
          <BrandLogo size="md" />
        </NuxtLink>
        <div class="order-last w-full min-w-0 sm:order-none sm:w-auto sm:max-w-xs sm:flex-1">
          <CatalogSearchBox
            v-model="search"
            :results="filteredProducts"
            :loading="isSearchCatalogLoading"
            @focus="ensureSearchCatalog"
          />
        </div>
        <div class="ml-auto flex items-center gap-3 sm:gap-4">
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
        <!-- Gallery Column: the photo frame, arrows and filmstrip live in one presentational
             component; the page only hands it the catalog-mapped images. -->
        <ProductGallery :images="product.images" :name="product.name" />

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
