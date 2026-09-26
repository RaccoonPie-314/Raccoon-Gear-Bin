import type { Database } from '~/types/database'
import type { CatalogCategory, CatalogProduct } from '~/types/catalog'

// The select strings have to stay inline literals: supabase-js infers the result type by
// parsing the query text, so building one at runtime (join/concat/template) degrades every
// row to `any`.
const PRODUCT_SELECT = 'id, category_id, slug, sku, price, currency, stock_quantity, status, product_translations(id, locale, name, short_description, description, specifications), product_images(id, storage_path, alt_text, sort_order), categories(id, slug, category_translations(id, locale, name))'
const CATEGORY_SELECT = 'id, slug, category_translations(id, locale, name)'

const FALLBACK_LOCALE = 'en'

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
  // so a locale can never resolve differently in one place than another.
  const pickTranslation = <T extends { locale: string }>(translations: T[] | null | undefined): T | undefined => {
    if (!translations?.length) return undefined
    return translations.find((item) => item.locale === locale.value) || translations.find((item) => item.locale === FALLBACK_LOCALE) || translations[0]
  }

  const categoryName = (category: ProductRow['categories']): string => {
    if (!category) return 'Uncategorized'
    return pickTranslation(category.category_translations)?.name || category.slug || 'Uncategorized'
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
  function parseSpecifications(value: string): Database['public']['Tables']['product_translations']['Row']['specifications'] {
    if (!value.trim()) return []
    try {
      return JSON.parse(value) as Database['public']['Tables']['product_translations']['Row']['specifications']
    } catch {
      return value.split('\n').filter(Boolean).map((line) => {
        const [label = '', ...rest] = line.split(':')
        return { label: label.trim(), value: rest.join(':').trim() }
      })
    }
  }

  /** Row-facing: the stored jsonb shape back into the textarea the editor shows. */
  function formatSpecifications(value: Database['public']['Tables']['product_translations']['Row']['specifications'] | null | undefined): string {
    if (typeof value === 'string') return value
    return value ? JSON.stringify(value, null, 2) : ''
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

  return { fetchCatalog, fetchProducts, fetchProduct, fetchCategories, parseSpecifications, formatSpecifications }
}
