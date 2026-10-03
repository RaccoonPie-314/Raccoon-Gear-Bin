import type { Database } from '~/types/database'
import type { CatalogCategory, CatalogCategoryDraft, CatalogProduct, CatalogSpecification } from '~/types/catalog'

// The select strings have to stay inline literals: supabase-js infers the result type by
// parsing the query text, so building one at runtime (join/concat/template) degrades every
// row to `any`.
const PRODUCT_SELECT = 'id, category_id, slug, sku, price, currency, stock_quantity, status, promo_price, promo_label, promo_quantity, promo_starts_at, promo_ends_at, product_translations(id, locale, name, short_description, description, specifications), product_images(id, storage_path, alt_text, sort_order), categories(id, slug, category_translations(id, locale, name))'
const CATEGORY_SELECT = 'id, slug, category_translations(id, locale, name)'
// The admin's second view of the same table: inactive rows are included (the shop has to be able to
// bring one back, and RLS is what decides that this visitor may read them), and no locale is picked
// away, because the editor writes both names at once.
const CATEGORY_DRAFT_SELECT = 'id, slug, sort_order, is_active, category_translations(locale, name)'

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
  const supabase = useSupabaseClient<Database>()
  const { locale } = useI18n()

  const productsQuery = () => supabase.from('products').select(PRODUCT_SELECT)
  const categoriesQuery = () => supabase.from('categories').select(CATEGORY_SELECT)
  const categoryDraftsQuery = () => supabase.from('categories').select(CATEGORY_DRAFT_SELECT)

  // Row types are derived from the queries themselves rather than hand-written, so removing
  // a column from a select breaks the mapper at compile time instead of handing the view an
  // `undefined` that happens to be unread today.
  type ProductRow = Exclude<Awaited<ReturnType<typeof productsQuery>>['data'], null>[number]
  type CategoryRow = Exclude<Awaited<ReturnType<typeof categoriesQuery>>['data'], null>[number]
  type CategoryDraftRow = Exclude<Awaited<ReturnType<typeof categoryDraftsQuery>>['data'], null>[number]

  // One owner for every product-photo URL (boundary rule 1), asked for by width. An absolute
  // path is not in our bucket, so there is nothing to transform: it is returned for both widths.
  const publicImageUrl = (storagePath: string, width: number) => {
    if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath
    return supabase.storage.from('product-images').getPublicUrl(storagePath, { transform: { width } }).data.publicUrl
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

  // The loaded rows are kept, not flattened away. `PRODUCT_SELECT` already embeds *every* locale
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
    const { data, error } = await productsQuery().eq('status', 'published').order('created_at', { ascending: false })
    if (error) throw error
    rawProducts.value = data || []
    return products.value
  }

  // Emptied before the round trip, not after: this cache outlives the page that filled it, so a
  // navigation from one product to another would otherwise paint the previous product's name while
  // the new row is in flight — the skeleton is the answer, and clearing is what produces it.
  const fetchProduct = async (id: string) => {
    rawProduct.value = null
    const { data, error } = await productsQuery().eq('id', id).eq('status', 'published').maybeSingle()
    if (error) throw error
    rawProduct.value = data ?? null
    return product.value
  }

  const fetchCategories = async (): Promise<CatalogCategory[]> => {
    const { data, error } = await categoriesQuery().eq('is_active', true).order('sort_order')
    if (error) throw error
    rawCategories.value = data || []
    return categories.value
  }

  /**
   * Admin-facing categories: unfiltered by `is_active`, ordered by the shop's own `sort_order`, and
   * with every locale's name intact. This stays the only place a `categories` row is read besides
   * `fetchCategories`, which is the same table's public view.
   */
  const fetchCategoryDrafts = async (): Promise<CatalogCategoryDraft[]> => {
    const { data, error } = await categoryDraftsQuery().order('sort_order')
    if (error) throw error
    return (data || []).map(mapCategoryDraft)
  }

  /** Everything the catalog landing page needs, in one round-trip pair. */
  const fetchCatalog = async () => {
    await Promise.all([fetchProducts(), fetchCategories()])
    // The computeds' own output, not a second mapping: this is the same array the page is bound to,
    // so a caller that reads the return value and a caller that reads `products` cannot disagree.
    return { products: products.value, categories: categories.value }
  }

  return { fetchCatalog, fetchProducts, fetchProduct, fetchCategoryDrafts, parseSpecifications, parseSpecificationPairs, pickTranslation, products, categories, product }
}
