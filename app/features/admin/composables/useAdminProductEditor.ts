import type { MaybeRefOrGetter } from 'vue'
import type { Database, ProductStatus } from '~/types/database'
import type { CatalogCategory, CatalogProduct } from '~/types/catalog'

const IMAGE_BUCKET = 'product-images'
const EDITOR_LOCALE = 'en'

/** What the editor holds while it is open. Fields map one-to-one onto the modal's controls. */
export type AdminProductForm = {
  id?: string
  categoryId: string
  sku: string
  slug: string
  price: number
  stockQuantity: number
  status: ProductStatus
  name: string
  shortDescription: string
  description: string
  specifications: string
  imagePaths: string
}

/**
 * The admin product editor: the form the modal binds to, the multi-table save, the image
 * upload behind it, and the delete confirmation. It owns no catalog read and no identity —
 * `categories` arrives for the default/option list, and `canMutate` is supplied by the caller
 * because authorisation is row-level security in Postgres: this guard only keeps a UI affordance
 * honest, it is not the security boundary.
 *
 * `onMutated` is how the editor's host refreshes after a write. The editor deliberately does not import
 * the catalog loader, so there is still exactly one place that fetches and maps products.
 *
 * Save and delete are one unit here on purpose: the save writes four things (product row,
 * English translation, storage objects, image rows) and the delete's confirmation reuses the
 * same `isSaving`/`actionError` surface, so splitting the form from the writes would leave two
 * modules that can only be used together.
 */
export const useAdminProductEditor = (options: {
  categories: MaybeRefOrGetter<CatalogCategory[]>
  canMutate: () => boolean
  onMutated: () => void | Promise<void>
}) => {
  const { categories, canMutate, onMutated } = options
  const supabase = useSupabaseClient<Database>()
  const { parseSpecifications } = useCatalog()
  const { t } = useI18n()

  const editorForm = ref<AdminProductForm>(emptyForm())
  const editorOpen = ref(false)
  const deleteTarget = ref<CatalogProduct | null>(null)
  const imageFiles = ref<File[]>([])
  const isSaving = ref(false)
  const actionError = ref('')

  function emptyForm(): AdminProductForm {
    return { categoryId: toValue(categories)[0]?.id || '', sku: '', slug: '', price: 0, stockQuantity: 0, status: 'published', name: '', shortDescription: '', description: '', specifications: '', imagePaths: '' }
  }

  const openAddEditor = () => { actionError.value = ''; editorForm.value = emptyForm(); editorOpen.value = true }
  const openEditEditor = (product: CatalogProduct) => {
    actionError.value = ''
    editorForm.value = { id: product.id, categoryId: product.categoryId, sku: product.sku, slug: product.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'), price: product.price, stockQuantity: product.stockQuantity, status: 'published', name: product.name, shortDescription: product.shortDescription, description: product.description, specifications: product.specifications, imagePaths: product.images.map((image) => image.storagePath).join('\n') }
    editorOpen.value = true
  }

  const handleImageSelection = (event: Event) => {
    const input = event.target as HTMLInputElement
    imageFiles.value = Array.from(input.files || [])
  }

  const saveProduct = async () => {
    if (!canMutate()) return
    isSaving.value = true
    actionError.value = ''
    try {
      if (!editorForm.value.categoryId) throw new Error(t('requiredCategory'))
      const productPayload = { category_id: editorForm.value.categoryId, sku: editorForm.value.sku.trim(), slug: editorForm.value.slug.trim(), price: Number(editorForm.value.price), stock_quantity: Number(editorForm.value.stockQuantity), status: editorForm.value.status }
      let productId = editorForm.value.id
      if (productId) {
        const { error } = await supabase.from('products').update(productPayload).eq('id', productId)
        if (error) throw error
        const { error: translationError } = await supabase.from('product_translations').update({ name: editorForm.value.name.trim(), short_description: editorForm.value.shortDescription.trim(), description: editorForm.value.description.trim(), specifications: parseSpecifications(editorForm.value.specifications) }).eq('product_id', productId).eq('locale', EDITOR_LOCALE)
        if (translationError) throw translationError
      } else {
        const { data, error } = await supabase.from('products').insert(productPayload).select('id').single()
        if (error) throw error
        productId = data.id
        const { error: translationError } = await supabase.from('product_translations').insert({ product_id: productId, locale: EDITOR_LOCALE, name: editorForm.value.name.trim(), short_description: editorForm.value.shortDescription.trim(), description: editorForm.value.description.trim(), specifications: parseSpecifications(editorForm.value.specifications) })
        if (translationError) throw translationError
      }
      if (!productId) throw new Error('The product could not be identified after saving.')
      const imagePaths = editorForm.value.imagePaths.split('\n').map((path) => path.trim()).filter(Boolean)
      for (const file of imageFiles.value) {
        const storagePath = `products/${productId}/${crypto.randomUUID()}-${file.name}`
        const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(storagePath, file, { upsert: false })
        if (error) throw error
        imagePaths.push(storagePath)
      }
      const { error: deleteImagesError } = await supabase.from('product_images').delete().eq('product_id', productId)
      if (deleteImagesError) throw deleteImagesError
      if (imagePaths.length) {
        const { error } = await supabase.from('product_images').insert(imagePaths.map((storagePath, index) => ({ product_id: productId, storage_path: storagePath, sort_order: index, is_primary: index === 0 })))
        if (error) throw error
      }
      editorOpen.value = false
      imageFiles.value = []
      await onMutated()
    } catch (error: any) { actionError.value = error?.message || t('productSaveError') } finally { isSaving.value = false }
  }

  const confirmDelete = async () => {
    if (!deleteTarget.value || !canMutate()) return
    isSaving.value = true
    try {
      const { error } = await supabase.from('products').delete().eq('id', deleteTarget.value.id)
      if (error) throw error
      deleteTarget.value = null
      await onMutated()
    } catch (error: any) { actionError.value = error?.message || t('productDeleteError') } finally { isSaving.value = false }
  }

  return {
    editorForm,
    editorOpen,
    deleteTarget,
    isSaving,
    actionError,
    openAddEditor,
    openEditEditor,
    handleImageSelection,
    saveProduct,
    confirmDelete
  }
}
