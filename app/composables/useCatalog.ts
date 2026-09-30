import type { Database } from '~/types/database'
import type { CatalogCategory, CatalogProduct, CatalogSpecification } from '~/types/catalog'

// The select strings have to stay inline literals: supabase-js infers the result type by
// parsing the query text, so building one at runtime (join/concat/template) degrades every
// row to `any`.
const PRODUCT_SELECT = 'id, category_id, slug, sku, price, currency, stock_quantity, status, promo_price, promo_label, promo_quantity, promo_starts_at, promo_ends_at, product_translations(id, locale, name, short_description, description, specifications), product_images(id, storage_path, alt_text, sort_order), categories(id, slug, category_translations(id, locale, name))'
const CATEGORY_SELECT = 'id, slug, category_translations(id, locale, name)'

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

export const useCatalog = () => {
  const supabase = useSupabaseClient<Database>()
  const { locale } = useI18n()

  const productsQuery = () => supabase.from('products').select(PRODUCT_SELECT)
  const categoriesQuery = () => supabase.from('categories').select(CATEGORY_SELECT)

  // Row types are derived from the queries themselves rather than hand-written, so removing
  // a column from a select breaks the mapper at compile time instead of handing the view an
  // `undefined` that happens to be unread today.
  type ProductRow = Exclude<Awaited<ReturnType<typeof productsQuery>>['data'], null>[number]
  type CategoryRow = Exclude<Awaited<ReturnType<typeof categoriesQuery>>['data'], null>[number]

  const publicImageUrl = (storagePath: string) => {
    if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath
    return supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl
  }

  // Current locale → English → first available. Shared by product and category translations
  // so a locale can never resolve differently in one place than another. Also exported for
  // the one other locale-resolved jsonb in the app (site_settings.location_translations) —
  // this stays the only implementation in the codebase.
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
        .map((image) => ({ id: image.id, storagePath: image.storage_path, altText: image.alt_text, url: publicImageUrl(image.storage_path) }))
    }
  }

  const mapCategory = (category: CategoryRow): CatalogCategory => ({
    id: category.id,
    name: pickTranslation(category.category_translations)?.name || category.slug,
    slug: category.slug
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

  const fetchProducts = async () => {
    const { data, error } = await productsQuery().eq('status', 'published').order('created_at', { ascending: false })
    if (error) throw error
    return (data || []).map(mapProduct)
  }

  const fetchProduct = async (id: string) => {
    const { data, error } = await productsQuery().eq('id', id).eq('status', 'published').maybeSingle()
    if (error) throw error
    return data ? mapProduct(data) : null
  }

  const fetchCategories = async (): Promise<CatalogCategory[]> => {
    const { data, error } = await categoriesQuery().eq('is_active', true).order('sort_order')
    if (error) throw error
    return (data || []).map(mapCategory)
  }

  /** Everything the catalog landing page needs, in one round-trip pair. */
  const fetchCatalog = async () => {
    const [products, categories] = await Promise.all([fetchProducts(), fetchCategories()])
    return { products, categories }
  }

  return { fetchCatalog, fetchProducts, fetchProduct, fetchCategories, parseSpecifications, parseSpecificationPairs, pickTranslation }
}
