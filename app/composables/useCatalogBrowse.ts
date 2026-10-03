import type { MaybeRefOrGetter } from 'vue'
import type { CatalogProduct } from '~/types/catalog'
import { getProductPricing } from '~/utils/product-pricing'

export type CatalogSortOrder = 'newest' | 'price-low' | 'price-high' | 'name'

const ALL_CATEGORIES = 'all'

/**
 * The browsing state of the catalog: what the visitor typed, picked and ordered by, plus the
 * derived list. Owns no fetching and no DOM — it turns a loaded product list into the subset
 * the page should render.
 */
export const useCatalogBrowse = (source: MaybeRefOrGetter<CatalogProduct[]>) => {
  const search = ref('')
  const selectedCategory = ref<string>(ALL_CATEGORIES)
  const sortOrder = ref<CatalogSortOrder>('newest')

  const filteredProducts = computed<CatalogProduct[]>(() => {
    const query = search.value.trim().toLowerCase()
    const filtered = toValue(source).filter((product) => {
      const categoryMatch = selectedCategory.value === ALL_CATEGORIES ||
        product.categoryId === selectedCategory.value ||
        product.categorySlug === selectedCategory.value ||
        product.categoryName?.toLowerCase() === selectedCategory.value.toLowerCase()
      const queryMatch = !query || [product.name, product.sku, product.shortDescription].some((value) => value.toLowerCase().includes(query))
      return categoryMatch && queryMatch
    })

    // 'newest' is the untouched order: it is the server's `created_at desc`, not a client sort.
    // The price sorts read the price the visitor is shown, not the stored one, so a discounted
    // product lands where its card's number says it should — and the crossed-out original never
    // moves anything.
    return [...filtered].sort((first, second) => {
      if (sortOrder.value === 'price-low') return getProductPricing(first).price - getProductPricing(second).price
      if (sortOrder.value === 'price-high') return getProductPricing(second).price - getProductPricing(first).price
      if (sortOrder.value === 'name') return first.name.localeCompare(second.name)
      return 0
    })
  })

  return { search, selectedCategory, sortOrder, filteredProducts }
}
