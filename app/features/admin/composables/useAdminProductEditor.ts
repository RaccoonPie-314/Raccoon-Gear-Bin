import type { MaybeRefOrGetter } from 'vue'
import type { Database, ProductRow, ProductStatus } from '~/types/database'
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
  /** Gates the promotion section; never a column. Turning it off is how a promotion is cleared. */
  promotionEnabled: boolean
  /** Kept as the modal's own strings: an empty field must stay empty rather than become `0`, which
   * would write a free product or a zero unit cap. Typed `string` because that is `UInput`'s prop
   * contract — but read through `numOf`, because with `type="number"` the control really does hand
   * back a number, which is what the harness found. */
  promoPrice: string
  promoLabel: string
  promoQuantity: string
  /** `datetime-local` wall clock, zone-less by design — see `toInstant`. */
  promoStartsAt: string
  promoEndsAt: string
}

/** `datetime-local` holds a zone-less wall clock, Postgres holds an instant. A shop owner's "8pm"
 * means their 8pm, so the value is written as local time and read back the same way. */
const toInstant = (wallClock: string): string | null => wallClock ? new Date(wallClock).toISOString() : null
const toWallClock = (instant: string | null): string => {
  if (!instant) return ''
  const date = new Date(instant)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The number a promo field holds, or `null` when the owner left it empty. `String` first, never
 * `.trim()` on the value itself: `UInput` types its model as a string and emits a number. */
const numOf = (value: string | number): number | null => {
  const text = String(value).trim()
  return text === '' ? null : Number(text)
}

/** The checks the columns cannot make for themselves: the discount has to be a discount, a unit cap
 * has to be a cap, and the window has to run forwards. Everything else the schema already refuses. */
const promotionIsValid = (form: AdminProductForm) => {
  const price = numOf(form.promoPrice)
  const units = numOf(form.promoQuantity)
  const starts = form.promoStartsAt ? new Date(form.promoStartsAt).getTime() : Number.NaN
  const ends = form.promoEndsAt ? new Date(form.promoEndsAt).getTime() : Number.NaN
  return price !== null && price >= 0 && price < Number(form.price)
    && (units === null || units > 0)
    && (Number.isNaN(starts) || Number.isNaN(ends) || ends > starts)
}

/**
 * The promotion columns for one save: written when the section is on, cleared when it was on and has
 * just been switched off, and absent otherwise. The third branch is what keeps a product that never
 * had a promotion byte-for-byte the save it always was — no five nulls on every write.
 *
 * The return type is named rather than inferred: left to inference the three shapes become a union,
 * and spreading a union into the payload makes supabase-js check every branch against the first one,
 * which rejects `{}` for having no `promo_price` at all.
 */
const promoColumns = (form: AdminProductForm, wasActive: boolean): Partial<Pick<ProductRow, 'promo_price' | 'promo_label' | 'promo_quantity' | 'promo_starts_at' | 'promo_ends_at'>> => {
  if (form.promotionEnabled) {
    return {
      promo_price: Number(form.promoPrice),
      promo_label: form.promoLabel.trim() || null,
      promo_quantity: numOf(form.promoQuantity),
      promo_starts_at: toInstant(form.promoStartsAt),
      promo_ends_at: toInstant(form.promoEndsAt)
    }
  }
  if (!wasActive) return {}
  return { promo_price: null, promo_label: null, promo_quantity: null, promo_starts_at: null, promo_ends_at: null }
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
  // Whether the product being edited had a promotion when the modal opened. It is what tells a
  // switched-off section "nothing to clear" from "clear it", without trusting the form's own fields.
  const promotionWasActive = ref(false)

  function emptyForm(): AdminProductForm {
    return { categoryId: toValue(categories)[0]?.id || '', sku: '', slug: '', price: 0, stockQuantity: 0, status: 'published', name: '', shortDescription: '', description: '', specifications: '', imagePaths: '', promotionEnabled: false, promoPrice: '', promoLabel: '', promoQuantity: '', promoStartsAt: '', promoEndsAt: '' }
  }

  const openAddEditor = () => { actionError.value = ''; editorForm.value = emptyForm(); promotionWasActive.value = false; editorOpen.value = true }
  const openEditEditor = (product: CatalogProduct) => {
    actionError.value = ''
    // `product.price` is the stored original, so the Price field keeps the number the promotion
    // crosses out — the discount belongs to its own field, never to this one.
    editorForm.value = { id: product.id, categoryId: product.categoryId, sku: product.sku, slug: product.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'), price: product.price, stockQuantity: product.stockQuantity, status: 'published', name: product.name, shortDescription: product.shortDescription, description: product.description, specifications: product.specifications, imagePaths: product.images.map((image) => image.storagePath).join('\n'), promotionEnabled: product.promoPrice !== null, promoPrice: product.promoPrice === null ? '' : String(product.promoPrice), promoLabel: product.promoLabel || '', promoQuantity: product.promoQuantity === null ? '' : String(product.promoQuantity), promoStartsAt: toWallClock(product.promoStartsAt), promoEndsAt: toWallClock(product.promoEndsAt) }
    promotionWasActive.value = product.promoPrice !== null
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
      if (editorForm.value.promotionEnabled && !promotionIsValid(editorForm.value)) throw new Error(t('promotionInvalid'))
      const productPayload = { category_id: editorForm.value.categoryId, sku: editorForm.value.sku.trim(), slug: editorForm.value.slug.trim(), price: Number(editorForm.value.price), stock_quantity: Number(editorForm.value.stockQuantity), status: editorForm.value.status, ...promoColumns(editorForm.value, promotionWasActive.value) }
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
