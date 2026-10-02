<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'
import type { SiteInfo } from '~/types/site-info'
import { hasKhmerText } from '~/utils/locale-script'

const route = useRoute()
const { fetchProduct, fetchProducts, parseSpecificationPairs } = useCatalog()
const { fetchSiteInfo } = useSiteInfo()
const { locale, t } = useI18n()
// The header search, the logo and the back link all resolve through the locale, so a Khmer visitor
// who landed here from a card stays in Khmer instead of being handed the English route.
const localePath = useLocalePath()
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

// Site info is what tells the product feature which channels the shop actually runs. It is read
// after mount, not from the product's setup-await path, for the reason the home page already
// applies to this same row: a failed auxiliary read should cost the visitor the contact options,
// not the product page — so it logs and leaves `siteInfo` null rather than setting `loadError`.
// `useSiteInfo` stays the only reader of `site_settings`; this page holds no query and no shape of
// its own, and a detail→detail navigation keeps the loaded row instead of fetching it twice.
const siteInfo = ref<SiteInfo | null>(null)
const loadSiteInfo = async () => {
  try { siteInfo.value = await fetchSiteInfo() } catch (error) { console.error('Site info load failed:', error) }
}

onMounted(() => { void loadSiteInfo() })

await loadProduct()

// The canonical address of this page is the page. Built from the reactive route rather than from
// `useRequestURL()`, because on the client that composable reads `window.location.href` once at
// setup and never updates: a canonical taken from it would keep pointing at the previous product
// after the header search moved detail → detail. The origin is the address the request arrived at.
const requestUrl = useRequestURL()
const canonicalUrl = computed(() => new URL(route.path, requestUrl.origin).href)

// One `useHead` for the page, fed by the loaded product only — no second SEO layer, and every
// value degrades with the data it comes from: a product with no photo publishes no `og:image`
// (an empty content is a broken preview card, and the gallery renders its own "No image" frame for
// the same absence), and a product with no summary publishes no description at all.
useHead(() => {
  const current = product.value
  const summary = current?.shortDescription || current?.description || ''
  const photo = current?.images[0]
  const tags: Array<{ name?: string, property?: string, content: string }> = [
    { property: 'og:type', content: 'product' },
    { property: 'og:site_name', content: t('appName') },
    { property: 'og:title', content: current?.name || t('products') },
    { property: 'og:url', content: canonicalUrl.value }
  ]
  if (summary) {
    tags.push({ name: 'description', content: summary }, { property: 'og:description', content: summary })
  }
  if (photo) {
    tags.push({ property: 'og:image', content: photo.url }, { property: 'og:image:alt', content: photo.altText || current?.name || t('appName') })
  }
  return {
    title: current ? `${current.name} | ${t('appName')}` : `${t('products')} | ${t('appName')}`,
    meta: tags,
    link: [{ rel: 'canonical', href: canonicalUrl.value }]
  }
})
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <!-- Sticky Translucent Minimalist Header. `data-detail-header` is a measured contract: the
         desktop Contact CTA scrolls the panel it opens to sit just below this header, and reads
         this element's live height to do it (see ProductActions.vue's toggle). Rename it in the
         same commit as that scroll, never across two. -->
    <header data-detail-header class="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/80 transition-colors">
      <!-- The search sits between the brand and the utility group from `sm` up, and drops to
           its own full-width line below that — the same reflow valve the masthead uses, so a
           control that no longer fits adds a row instead of widening the page. -->
      <UContainer class="flex min-h-16 sm:min-h-20 flex-wrap items-center gap-x-3 gap-y-2 py-2 sm:gap-x-4">
        <NuxtLink :to="localePath('/')" :aria-label="t('appName')" class="shrink-0">
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
            :to="localePath('/')"
            class="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            <span>{{ t('backToProducts') }}</span>
          </NuxtLink>
        </div>
      </UContainer>
    </header>

    <!-- The bottom padding is clearance for the sticky bar the product feature teleports: the bar
         is roughly 96px tall (12 + a 44px control + 8 + a 20px status line + 12), and it only
         exists below `lg`, so the page only reserves room for it there. Same idiom the home page
         uses for its own teleported category dock — a fixed control that overlaps the end of the
         document is paid for with padding, never with a scroll trick. -->
    <UContainer class="pt-10 pb-28 sm:pt-16 sm:pb-32 lg:pb-16">
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
        <UButton :to="localePath('/')" color="neutral" class="mt-6 rounded-full px-6">
          {{ t('browseProducts') }}
        </UButton>
      </section>

      <!-- The loaded product fades in over the skeleton instead of cutting to it — the same `reveal`
           transition the catalog grid uses. Its condition is spelled out rather than left as `v-else`
           because a Transition child owns its own `v-if`. -->
      <Transition name="reveal">
      <section v-if="!isLoading && !loadError && product" class="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <!-- Gallery Column: the photo frame, arrows and filmstrip live in one presentational
             component; the page only hands it the catalog-mapped images. The wrapper exists for one
             reason — `relative` is what the corner ribbon measures itself against, so the ribbon can cut
             across the photo without reaching inside the gallery, whose zoom maths owns that frame
             outright. No transform here on purpose: a transformed ancestor would become the containing
             block for the lightbox's fixed overlay. No `overflow-hidden` either — the wrapper is taller
             than the frame, so clipping it would shave the frame's shadow; the ribbon carries its own
             clip box. The width cap mirrors the gallery's own box (`max-w-md`, centred): a wrapper wider
             than the photo would park the ribbon in the gutter beside it, and `verify` measures the
             ribbon against the frame, which is what catches the two drifting apart. `min-w-0` is the
             same load-bearing guard the gallery's own root carries, and it belongs on the wrapper now:
             as a grid item its default `min-width: auto` is the filmstrip's min-content width, which
             pushes the whole page wider than a narrow phone. -->
        <div class="relative mx-auto w-full min-w-0 max-w-md">
          <ProductGallery :images="product.images" :name="product.name" />
          <ProductSaleRibbon :product="product" />
        </div>

        <!-- Product Summary & Specs Column. `min-w-0` is load-bearing at the narrowest phones: a
             grid item's default `min-width:auto` lets the conversion row's intrinsic width (pill
             padding + label + icons) stretch the whole page instead of letting the label truncate —
             measured at 320px it was 5px of horizontal scroll before this was added. -->
        <!-- `data-detail-info-col` marks the sticky partner of the `data-detail-header` contract:
             while the desktop Contact panel is being revealed, the scroll code pins this column
             in place for exactly one frame so its measurement is not taken mid-unstick. -->
        <div data-detail-info-col class="min-w-0 lg:sticky lg:top-24 self-start">
          <p class="text-[10px] sm:text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="hasKhmerText(product.categoryName ?? t('uncategorized')) ? '' : 'tracking-[0.25em]'">
            {{ product.categoryName ?? t('uncategorized') }}
          </p>
          <h1 class="mt-3 text-3xl font-black sm:text-4xl lg:text-5xl text-zinc-950 dark:text-white" :class="hasKhmerText(product.name) ? '' : 'tracking-tight'">
            {{ product.name }}
          </h1>
          <ProductPrice :product="product" class="mt-4 text-2xl sm:text-3xl font-bold text-zinc-950 dark:text-white" />

          <div class="mt-4">
            <StockStatus :quantity="product.stockQuantity" />
          </div>

          <p class="mt-8 text-base leading-relaxed text-zinc-600 dark:text-zinc-300 font-normal">
            {{ product.description || product.shortDescription }}
          </p>

          <!-- Structured Specifications Table -->
          <div v-if="parsedSpecs.length" class="mt-10 border-t border-zinc-200/80 pt-8 dark:border-zinc-800/80">
            <h2 class="text-xs font-bold uppercase text-zinc-400 dark:text-zinc-500 mb-4" :class="locale === 'km' ? '' : 'tracking-[0.22em]'">
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
            <h2 class="text-xs font-bold uppercase text-zinc-400 dark:text-zinc-500 mb-4" :class="locale === 'km' ? '' : 'tracking-[0.22em]'">
              {{ t('specs') }}
            </h2>
            <pre class="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-500">{{ product.specifications }}</pre>
          </div>

          <!-- Conversion, after the product's own content. The page hands over the two models it
               loaded and nothing else: no channel list, no message construction, no clipboard or
               share code exists in this file. `ProductConversion` mounts the inline block here and
               teleports the mobile sticky bar itself, which is why this page needs no knowledge of
               either. -->
          <div class="mt-10">
            <ProductConversion :product="product" :site-info="siteInfo" />
          </div>
        </div>
      </section>
      </Transition>
    </UContainer>
  </main>
</template>
