<script setup lang="ts">
import type { Json } from '~/types/database'

type CatalogProduct = {
  id: string
  categoryId: string
  categoryName: string
  sku: string
  price: number
  currency: string
  stockQuantity: number
  name: string
  shortDescription: string
  description: string
  specifications: string
  images: Array<{ id: string; storagePath: string; altText: string | null; url: string }>
}

type CategoryOption = { id: string; name: string }
type ProductStatus = 'draft' | 'published' | 'archived'
type EditorForm = {
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

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { signOut, isAdmin } = useAdminAuth()

const products = ref<CatalogProduct[]>([])
const categories = ref<CategoryOption[]>([])
const isAdminMode = ref(false)
const isLoading = ref(true)
const isSaving = ref(false)
const isSigningOut = ref(false)
const loadError = ref('')
const actionError = ref('')
const search = ref('')
const selectedCategory = ref('all')
const editorOpen = ref(false)
const deleteTarget = ref<CatalogProduct | null>(null)
const imageFiles = ref<File[]>([])
const editorForm = ref<EditorForm>(emptyForm())

function emptyForm(): EditorForm {
  return { categoryId: categories.value[0]?.id || '', sku: '', slug: '', price: 0, stockQuantity: 0, status: 'published', name: '', shortDescription: '', description: '', specifications: '', imagePaths: '' }
}

const filteredProducts = computed(() => {
  const query = search.value.trim().toLowerCase()
  return products.value.filter((product) => {
    const categoryMatch = selectedCategory.value === 'all' || product.categoryId === selectedCategory.value
    const queryMatch = !query || [product.name, product.sku, product.shortDescription].some((value) => value.toLowerCase().includes(query))
    return categoryMatch && queryMatch
  })
})

const publicImageUrl = (storagePath: string) => {
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath
  return supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl
}

const parseSpecifications = (value: string): Json => {
  if (!value.trim()) return []
  try { return JSON.parse(value) } catch {
    return value.split('\n').filter(Boolean).map((line) => { const [label, ...rest] = line.split(':'); return { label: label.trim(), value: rest.join(':').trim() } })
  }
}

const formatSpecifications = (value: unknown) => typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : ''

const mapProduct = (product: any): CatalogProduct => {
  const translation = product.product_translations?.find((item: any) => item.locale === 'en') || product.product_translations?.[0]
  const category = product.categories
  return {
    id: product.id,
    categoryId: product.category_id,
    categoryName: category?.category_translations?.find((item: any) => item.locale === 'en')?.name || category?.slug || 'Uncategorized',
    sku: product.sku,
    price: Number(product.price),
    currency: product.currency,
    stockQuantity: product.stock_quantity,
    name: translation?.name || product.sku,
    shortDescription: translation?.short_description || '',
    description: translation?.description || '',
    specifications: formatSpecifications(translation?.specifications),
    images: [...(product.product_images || [])].sort((a, b) => a.sort_order - b.sort_order).map((image) => ({ id: image.id, storagePath: image.storage_path, altText: image.alt_text, url: publicImageUrl(image.storage_path) }))
  }
}

const loadCatalog = async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const [{ data: categoryData, error: categoryError }, { data: productData, error: productError }] = await Promise.all([
      supabase.from('categories').select('id, slug, category_translations(id, locale, name)').eq('is_active', true).order('sort_order'),
      supabase.from('products').select('id, category_id, sku, price, currency, stock_quantity, product_translations(id, locale, name, short_description, description, specifications), product_images(id, storage_path, alt_text, sort_order), categories(id, slug, category_translations(id, locale, name))').eq('status', 'published').order('created_at', { ascending: false })
    ])
    if (categoryError) throw categoryError
    if (productError) throw productError
    categories.value = (categoryData || []).map((category: any) => ({ id: category.id, name: category.category_translations?.find((item: any) => item.locale === 'en')?.name || category.slug }))
    products.value = (productData || []).map(mapProduct)
  } catch (error: any) {
    loadError.value = error?.message || 'The catalog could not be loaded.'
  } finally { isLoading.value = false }
}

const refreshAdminMode = async () => { isAdminMode.value = await isAdmin() }
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
  if (!isAdminMode.value) return
  isSaving.value = true
  actionError.value = ''
  try {
    if (!editorForm.value.categoryId) throw new Error('Choose a category before saving.')
    const productPayload = { category_id: editorForm.value.categoryId, sku: editorForm.value.sku.trim(), slug: editorForm.value.slug.trim(), price: Number(editorForm.value.price), stock_quantity: Number(editorForm.value.stockQuantity), status: editorForm.value.status }
    let productId = editorForm.value.id
    if (productId) {
      const { error } = await supabase.from('products').update(productPayload).eq('id', productId)
      if (error) throw error
      const { error: translationError } = await supabase.from('product_translations').update({ name: editorForm.value.name.trim(), short_description: editorForm.value.shortDescription.trim(), description: editorForm.value.description.trim(), specifications: parseSpecifications(editorForm.value.specifications) }).eq('product_id', productId).eq('locale', 'en')
      if (translationError) throw translationError
    } else {
      const { data, error } = await supabase.from('products').insert(productPayload).select('id').single()
      if (error) throw error
      productId = data.id
      const { error: translationError } = await supabase.from('product_translations').insert({ product_id: productId, locale: 'en', name: editorForm.value.name.trim(), short_description: editorForm.value.shortDescription.trim(), description: editorForm.value.description.trim(), specifications: parseSpecifications(editorForm.value.specifications) })
      if (translationError) throw translationError
    }
    const imagePaths = editorForm.value.imagePaths.split('\n').map((path) => path.trim()).filter(Boolean)
    for (const file of imageFiles.value) {
      const storagePath = `products/${productId}/${crypto.randomUUID()}-${file.name}`
      const { error } = await supabase.storage.from('product-images').upload(storagePath, file, { upsert: false })
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
    await loadCatalog()
  } catch (error: any) { actionError.value = error?.message || 'The product could not be saved.' } finally { isSaving.value = false }
}

const confirmDelete = async () => {
  if (!deleteTarget.value || !isAdminMode.value) return
  isSaving.value = true
  try {
    const { error } = await supabase.from('products').delete().eq('id', deleteTarget.value.id)
    if (error) throw error
    deleteTarget.value = null
    await loadCatalog()
  } catch (error: any) { actionError.value = error?.message || 'The product could not be deleted.' } finally { isSaving.value = false }
}

const logout = async () => { isSigningOut.value = true; try { await signOut(); isAdminMode.value = false } finally { isSigningOut.value = false } }
watch(user, () => { void refreshAdminMode() }, { immediate: true })
onMounted(() => { void loadCatalog() })
useHead({ title: 'Raccoon Gear Bin | Gaming accessories' })
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <header class="border-b border-zinc-200 dark:border-zinc-800"><UContainer class="flex min-h-20 items-center justify-between gap-5"><NuxtLink to="/" class="text-sm font-black uppercase tracking-[0.28em]">Raccoon Gear Bin</NuxtLink><div class="flex items-center gap-3"><span v-if="isAdminMode" class="hidden items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500 sm:flex"><span class="h-2 w-2 rounded-full bg-emerald-500" /> Admin mode</span><UButton v-if="isAdminMode" size="sm" color="neutral" variant="ghost" :loading="isSigningOut" @click="logout">Log out</UButton><UButton v-else to="/admin/login" size="sm" color="neutral" variant="ghost">Admin login</UButton></div></UContainer></header>
    <UContainer class="py-12 sm:py-16">
      <section class="flex flex-col justify-between gap-8 border-b border-zinc-200 pb-10 dark:border-zinc-800 md:flex-row md:items-end"><div class="max-w-2xl"><p class="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">Precision equipment</p><h1 class="text-4xl font-black tracking-tight sm:text-6xl">Gear for the long session.</h1><p class="mt-5 max-w-xl text-base leading-7 text-zinc-500">A focused collection of controllers, keyboards, mice, and audio built for play without the noise.</p></div><UButton v-if="isAdminMode" color="neutral" class="shrink-0" @click="openAddEditor">＋ Add product</UButton></section>
      <section class="flex flex-col gap-4 border-b border-zinc-200 py-6 dark:border-zinc-800 sm:flex-row"><UInput v-model="search" icon="i-lucide-search" placeholder="Search the catalog" class="sm:max-w-sm" /><USelect v-model="selectedCategory" :items="[{ label: 'All categories', value: 'all' }, ...categories.map((category) => ({ label: category.name, value: category.id }))]" class="sm:w-56" /></section>
      <UAlert v-if="loadError" class="mt-6" color="error" variant="soft" :title="loadError" /><UAlert v-if="actionError" class="mt-6" color="error" variant="soft" :title="actionError" />
      <div v-if="isLoading" class="grid gap-px bg-zinc-200 sm:grid-cols-2 lg:grid-cols-3 dark:bg-zinc-800"><div v-for="item in 6" :key="item" class="h-96 animate-pulse bg-white dark:bg-zinc-950" /></div><div v-else-if="!filteredProducts.length" class="border-y border-zinc-200 py-24 text-center dark:border-zinc-800"><p class="text-sm text-zinc-500">No products match this view.</p></div><div v-else class="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3"><article v-for="product in filteredProducts" :key="product.id" class="group"><div class="relative aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-900"><img v-if="product.images[0]" :src="product.images[0].url" :alt="product.images[0].altText || product.name" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" /><div v-else class="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-400">No image</div><UButton v-if="isAdminMode" icon="i-lucide-pencil" color="neutral" variant="solid" size="sm" class="absolute right-3 top-3 opacity-0 transition group-hover:opacity-100" aria-label="Edit product" @click="openEditEditor(product)" /></div><div class="flex items-start justify-between gap-4 pt-4"><div><p class="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">{{ product.categoryName }}</p><h2 class="mt-1 font-bold">{{ product.name }}</h2><p class="mt-1 text-sm text-zinc-500">{{ product.shortDescription }}</p></div><p class="shrink-0 font-bold">{{ product.currency }} {{ product.price.toFixed(2) }}</p></div><div class="mt-3 flex justify-between text-xs text-zinc-400"><span>{{ product.sku }}</span><span>{{ product.stockQuantity }} in stock</span></div></article></div>
    </UContainer>
    <div v-if="editorOpen" class="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4 sm:p-8"><section class="ml-auto min-h-full w-full max-w-2xl bg-white p-6 shadow-2xl dark:bg-zinc-950" role="dialog" aria-modal="true" aria-label="Edit product"><div class="flex items-start justify-between gap-5 border-b border-zinc-200 pb-5 dark:border-zinc-800"><div><p class="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">Catalog control</p><h2 class="mt-2 text-2xl font-black">{{ editorForm.id ? 'Edit product' : 'Add product' }}</h2></div><UButton icon="i-lucide-x" color="neutral" variant="ghost" aria-label="Close editor" @click="editorOpen = false" /></div><form class="grid gap-5 py-7" @submit.prevent="saveProduct"><div class="grid gap-5 sm:grid-cols-2"><UFormField label="Product name" required><UInput v-model="editorForm.name" required /></UFormField><UFormField label="Category" required><USelect v-model="editorForm.categoryId" :items="categories.map((category) => ({ label: category.name, value: category.id }))" /></UFormField><UFormField label="SKU" required><UInput v-model="editorForm.sku" required /></UFormField><UFormField label="Slug" required><UInput v-model="editorForm.slug" required /></UFormField><UFormField label="Price" required><UInput v-model.number="editorForm.price" type="number" min="0" step="0.01" required /></UFormField><UFormField label="Stock" required><UInput v-model.number="editorForm.stockQuantity" type="number" min="0" step="1" required /></UFormField></div><UFormField label="Short description" required><UInput v-model="editorForm.shortDescription" required /></UFormField><UFormField label="Full description" required><UTextarea v-model="editorForm.description" :rows="4" required /></UFormField><UFormField label="Specifications" hint="JSON or one label: value pair per line"><UTextarea v-model="editorForm.specifications" :rows="5" /></UFormField><UFormField label="Product image paths" hint="One public URL or Supabase storage path per line"><UTextarea v-model="editorForm.imagePaths" :rows="4" /></UFormField><UFormField label="Upload images" hint="New files are stored in the protected product-images bucket"><input type="file" accept="image/*" multiple class="block w-full text-sm text-zinc-500" @change="handleImageSelection" /></UFormField><div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800"><UButton v-if="editorForm.id" type="button" color="error" variant="ghost" @click="deleteTarget = products.find((product) => product.id === editorForm.id) || null; editorOpen = false">Delete product</UButton><span v-else /><div class="flex gap-3"><UButton type="button" color="neutral" variant="ghost" @click="editorOpen = false">Cancel</UButton><UButton type="submit" color="neutral" :loading="isSaving">Save changes</UButton></div></div></form></section></div>
    <div v-if="deleteTarget" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"><section class="w-full max-w-md bg-white p-6 shadow-2xl dark:bg-zinc-950" role="alertdialog" aria-modal="true"><h2 class="text-xl font-black">Delete {{ deleteTarget.name }}?</h2><p class="mt-3 text-sm leading-6 text-zinc-500">This removes the product and its translations and images. This action cannot be undone.</p><div class="mt-6 flex justify-end gap-3"><UButton color="neutral" variant="ghost" @click="deleteTarget = null">Cancel</UButton><UButton color="error" :loading="isSaving" @click="confirmDelete">Delete product</UButton></div></section></div>
  </main>
</template>
