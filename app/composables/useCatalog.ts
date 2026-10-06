import type { CategoryRow as CategoryBase, CategoryTranslationRow, Database, ProductImageRow, ProductRow as ProductBase, ProductTranslationRow } from '~/types/database'
import type { CatalogCategory, CatalogCategoryDraft, CatalogProduct, CatalogSpecification } from '~/types/catalog'

// The shapes `/api/catalog/**` answers with (server/utils/catalog-queries.ts owns the SQL; the two
// must move together). They mirror the PostgREST embeds this file used to derive from its select
// strings — the mappers below were written against exactly this shape and are untouched.
type ProductRow = Pick<ProductBase, 'id' | 'category_id' | 'slug' | 'sku' | 'price' | 'currency' | 'stock_quantity' | 'status' | 'promo_price' | 'promo_label' | 'promo_quantity' | 'promo_starts_at' | 'promo_ends_at'> & {
  product_translations: Pick<ProductTranslationRow, 'id' | 'locale' | 'name' | 'short_description' | 'description' | 'specifications'>[]
  product_images: Pick<ProductImageRow, 'id' | 'storage_path' | 'alt_text' | 'sort_order'>[]
  categories: (Pick<CategoryBase, 'id' | 'slug'> & {
    category_translations: Pick<CategoryTranslationRow, 'id' | 'locale' | 'name'>[]
  }) | null
}
type CategoryRow = Pick<CategoryBase, 'id' | 'slug'> & {
  category_translations: Pick<CategoryTranslationRow, 'id' | 'locale' | 'name'>[]
}
type CategoryDraftRow = Pick<CategoryBase, 'id' | 'slug' | 'sort_order' | 'is_active'> & {
  category_translations: Pick<CategoryTranslationRow, 'locale' | 'name'>[]
}

const FALLBACK_LOCALE = 'en'

type SpecificationsColumn = Database['public']['Tables']['product_translations']['Row']['specifications']

/**
 * The editor's shorthand: one `label: value` pair per line. Shared by both directions of the
 * specifications conversion so the syntax can never be understood differently on the way in
 * than on the way out — a page used to keep its own copy of these four lines.
 */
const specLinesToPairs = (value: string): CatalogSpecification[] => value.split('\n').filter(Boolean).map((line) => {
  const [label = '', ...rest] = line.split(':')
  return { label: label.trim(), value: rest.join(':').trim() }
})

// The promo columns are nullable, and a number PostgREST hands back as a string: absent means
// "no promotion", never `NaN`. Every price the storefront shows is decided from this, so the
// distinction is made once, on the way in.
const numberOrNull = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value)

// The two widths a photo is ever served at. A card grid loads one image per product and the
// originals are phone photographs and exported diagrams, so the byte ceiling that matters here is
// width: Supabase's render endpoint answers a browser `Accept` with WebP, and that pair of facts is
// the whole saving. Measured on the live bucket (8 published products): 6.4 MB of card images
// becomes 958 kB at 800 and 1.5 MB at 1600 — the 3.3 MB screenshot PNG alone comes back at 175 kB.
// 1600 is the lightbox's own budget: `h-[82dvh] w-[92vw] max-w-5xl` shown on a 3x phone, so a 2.5x
// zoom upscales the visible crop by under 2x. Raise DISPLAY_WIDTH if a buyer ever complains the
// zoomed stitch detail is soft; nothing else in the app needs the untouched original.
const DISPLAY_WIDTH = 1600
const THUMB_WIDTH = 800

export const useCatalog = () => {
  // Storage URLs only — the rows come from `/api/catalog/**` now. Until the R2 flip (P3 of
  // plans/005) the public URL builder stays on the Supabase storage client, exactly as it shipped.
  const supabase = useSupabaseClient<Database>()
  const { locale } = useI18n()

  // One owner for every product-photo URL (boundary rule 1), asked for by width. An absolute
  // path is not in our bucket, so there is nothing to transform: it is returned for both widths.
  const publicImageUrl = (storagePath: string, width: number) => {
    if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath
    // `resize: 'contain'` is load-bearing, not styling: without it the render endpoint's default
    // cover mode answers `width × originalHeight` (measured 2026-10-06: `?width=128` on a
    // 1200×1600 photo returned 128×1600) — every portrait image arrived squashed 10×+, which at
    // thumbnail sizes read as a flat colour slice. Contain gives the proportional resize.
    return supabase.storage.from('product-images').getPublicUrl(storagePath, { transform: { width, resize: 'contain' } }).data.publicUrl
  }

  // Current locale → English → first available. Shared by product and category translations
  // so a locale can never resolve differently in one place than another. Also exported for
  // the one other locale-resolved jsonb in the app (site_settings.location_translations) —
  // this stays the only implementation in the codebase.
  //
  // It reads `locale.value` while the mapping computeds above are evaluating, which is what makes a
  // locale switch reactive: the mappers re-run on the rows already held, no request involved. The
  // comment this used to carry — "runs at fetch time, which makes the route load-bearing" — described
  // the flatten-everything-into-a-string version of this layer, where the only way to re-resolve was
  // to ask the server again.
  const pickTranslation = <T extends { locale: string }>(translations: T[] | null | undefined): T | undefined => {
    if (!translations?.length) return undefined
    return translations.find((item) => item.locale === locale.value) || translations.find((item) => item.locale === FALLBACK_LOCALE) || translations[0]
  }

  // `null`, not a placeholder word: what an unclassified product is *called* is a translation,
  // and this mapper runs at fetch time, before the view knows which locale is on screen.
  const categoryName = (category: ProductRow['categories']): string | null => {
    if (!category) return null
    return pickTranslation(category.category_translations)?.name || category.slug || null
  }

  const mapProduct = (product: ProductRow): CatalogProduct => {
    const translation = pickTranslation(product.product_translations)
    return {
      id: product.id,
      categoryId: product.category_id,
      categoryName: categoryName(product.categories),
      categorySlug: product.categories?.slug,
      slug: product.slug,
      sku: product.sku,
      price: Number(product.price),
      currency: product.currency,
      stockQuantity: product.stock_quantity,
      status: product.status,
      promoPrice: numberOrNull(product.promo_price),
      promoLabel: product.promo_label ?? null,
      promoQuantity: numberOrNull(product.promo_quantity),
      promoStartsAt: product.promo_starts_at ?? null,
      promoEndsAt: product.promo_ends_at ?? null,
      name: translation?.name || product.sku,
      shortDescription: translation?.short_description || '',
      description: translation?.description || '',
      specifications: formatSpecifications(translation?.specifications),
      images: [...(product.product_images || [])]
        .sort((first, second) => first.sort_order - second.sort_order)
        .map((image) => ({ id: image.id, storagePath: image.storage_path, altText: image.alt_text, url: publicImageUrl(image.storage_path, DISPLAY_WIDTH), thumbUrl: publicImageUrl(image.storage_path, THUMB_WIDTH) }))
    }
  }

  const mapCategory = (category: CategoryRow): CatalogCategory => ({
    id: category.id,
    name: pickTranslation(category.category_translations)?.name || category.slug,
    slug: category.slug
  })

  /** Admin-facing: every row the shop can edit, with each locale's name kept separate. */
  const mapCategoryDraft = (category: CategoryDraftRow): CatalogCategoryDraft => ({
    id: category.id,
    slug: category.slug,
    sortOrder: category.sort_order,
    isActive: category.is_active,
    names: Object.fromEntries((category.category_translations || []).map((translation) => [translation.locale, translation.name]))
  })

  /** Editor-facing: JSON, or one `label: value` pair per line, into the stored jsonb shape. */
  function parseSpecifications(value: string): SpecificationsColumn {
    if (!value.trim()) return []
    try {
      return JSON.parse(value) as SpecificationsColumn
    } catch {
      return specLinesToPairs(value)
    }
  }

  /** Row-facing: the stored jsonb shape back into the textarea the editor shows. */
  function formatSpecifications(value: SpecificationsColumn | null | undefined): string {
    if (typeof value === 'string') return value
    return value ? JSON.stringify(value, null, 2) : ''
  }

  /**
   * View-facing: whatever `formatSpecifications` produced — pretty JSON, a stored object, or
   * the raw `label: value` shorthand — back into the pairs a template renders. The detail page
   * used to carry its own copy of this, storage shapes and all, which is how the line syntax
   * came to be parsed in two places with two subtly different rules.
   */
  function parseSpecificationPairs(value: string | null | undefined): CatalogSpecification[] {
    if (!value) return []
    const raw = value.trim()
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.filter((item) => item && (item.label || item.value))
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed).map(([label, specValue]) => ({ label, value: String(specValue) }))
      }
    } catch {}
    return specLinesToPairs(raw).filter((item) => item.label || item.value)
  }

  // The loaded rows are kept, not flattened away. The product payload already embeds *every* locale
  // (`product_translations(… locale …)`), so a language switch has nothing to fetch: it has to
  // re-RESOLVE, and that is what these three computeds do — they read `locale.value` through
  // `pickTranslation`, so changing locale re-runs the mappers over the rows already in memory.
  // `useState` rather than a module `ref`: per-request on the server (no cross-request leak), a plain
  // ref across client navigations (so it survives the page it describes). Every genuine load still
  // writes through `fetch*`, so nothing is ever served stale — the cache only ever mirrors what is on
  // screen, which is why it needs no expiry rule. Declared after the mappers it calls, so reading
  // this file top to bottom never has to wonder about a function that appears further down.
  const rawProducts = useState<ProductRow[]>('catalog:products', () => [])
  const rawCategories = useState<CategoryRow[]>('catalog:categories', () => [])
  const rawProduct = useState<ProductRow | null>('catalog:product', () => null)

  const products = computed(() => rawProducts.value.map(mapProduct))
  const categories = computed(() => rawCategories.value.map(mapCategory))
  const product = computed(() => (rawProduct.value ? mapProduct(rawProduct.value) : null))

  const fetchProducts = async () => {
    rawProducts.value = (await $fetch<ProductRow[]>('/api/catalog/products')) || []
    return products.value
  }

  // Emptied before the round trip, not after: this cache outlives the page that filled it, so a
  // navigation from one product to another would otherwise paint the previous product's name while
  // the new row is in flight — the skeleton is the answer, and clearing is what produces it.
  const fetchProduct = async (id: string) => {
    rawProduct.value = null
    rawProduct.value = await $fetch<ProductRow | null>('/api/catalog/products', { query: { id } })
    return product.value
  }

  const fetchCategories = async (): Promise<CatalogCategory[]> => {
    rawCategories.value = (await $fetch<CategoryRow[]>('/api/catalog/categories')) || []
    return categories.value
  }

  /**
   * Admin-facing categories: unfiltered by `is_active`, ordered by the shop's own `sort_order`, and
   * with every locale's name intact. This stays the only place a `categories` row is read besides
   * `fetchCategories`, which is the same table's public view.
   */
  const fetchCategoryDrafts = async (): Promise<CatalogCategoryDraft[]> => {
    const data = await $fetch<CategoryDraftRow[]>('/api/catalog/category-drafts')
    return (data || []).map(mapCategoryDraft)
  }

  /** Everything the catalog landing page needs, in one round-trip pair. */
  const fetchCatalog = async () => {
    await Promise.all([fetchProducts(), fetchCategories()])
    // The computeds' own output, not a second mapping: this is the same array the page is bound to,
    // so a caller that reads the return value and a caller that reads `products` cannot disagree.
    return { products: products.value, categories: categories.value }
  }

  return { fetchCatalog, fetchProducts, fetchProduct, fetchCategoryDrafts, parseSpecifications, parseSpecificationPairs, pickTranslation, products, categories, product, publicImageUrl }
}
