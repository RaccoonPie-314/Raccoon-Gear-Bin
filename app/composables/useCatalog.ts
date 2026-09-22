import type { Database } from '~/types/database'
import type { CatalogCategory, CatalogProduct } from '~/types/catalog'

export const useCatalog = () => {
  const supabase = useSupabaseClient<Database>() as any
  const { locale } = useI18n()

  const publicImageUrl = (storagePath: string) => {
    if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath
    return supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl
  }

  const mapProduct = (product: any): CatalogProduct => {
    const translation = product.product_translations?.find((item: any) => item.locale === locale.value) || product.product_translations?.find((item: any) => item.locale === 'en') || product.product_translations?.[0]
    const category = product.categories
    return {
      id: product.id,
      categoryId: product.category_id,
      categoryName: category?.category_translations?.find((item: any) => item.locale === locale.value)?.name || category?.category_translations?.find((item: any) => item.locale === 'en')?.name || category?.slug || 'Uncategorized',
      slug: product.slug,
      sku: product.sku,
      price: Number(product.price),
      currency: product.currency,
      stockQuantity: product.stock_quantity,
      status: product.status,
      name: translation?.name || product.sku,
      shortDescription: translation?.short_description || '',
      description: translation?.description || '',
      specifications: typeof translation?.specifications === 'string' ? translation.specifications : translation?.specifications ? JSON.stringify(translation.specifications, null, 2) : '',
      images: [...(product.product_images || [])].sort((a, b) => a.sort_order - b.sort_order).map((image) => ({ id: image.id, storagePath: image.storage_path, altText: image.alt_text, url: publicImageUrl(image.storage_path) }))
    }
  }

  const select = 'id, category_id, slug, sku, price, currency, stock_quantity, status, product_translations(id, locale, name, short_description, description, specifications), product_images(id, storage_path, alt_text, sort_order), categories(id, slug, category_translations(id, locale, name))'

  const fetchProducts = async () => {
    const { data, error } = await supabase.from('products').select(select).eq('status', 'published').order('created_at', { ascending: false })
    if (error) throw error
    return (data || []).map(mapProduct)
  }

  const fetchProduct = async (id: string) => {
    const { data, error } = await supabase.from('products').select(select).eq('id', id).eq('status', 'published').maybeSingle()
    if (error) throw error
    return data ? mapProduct(data) : null
  }

  const fetchCategories = async (): Promise<CatalogCategory[]> => {
    const { data, error } = await supabase.from('categories').select('id, slug, category_translations(id, locale, name)').eq('is_active', true).order('sort_order')
    if (error) throw error
    return (data || []).map((category: any) => ({ id: category.id, name: category.category_translations?.find((item: any) => item.locale === locale.value)?.name || category.category_translations?.find((item: any) => item.locale === 'en')?.name || category.slug }))
  }

  return { fetchProducts, fetchProduct, fetchCategories }
}
