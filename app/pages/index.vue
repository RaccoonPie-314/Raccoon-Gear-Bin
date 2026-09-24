<script setup lang="ts">
import type { Database, Json } from '~/types/database'
import type { CatalogCategory, CatalogProduct } from '~/types/catalog'

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

const supabase = useSupabaseClient<Database>() as any
const user = useSupabaseUser()
const { signOut, isAdmin } = useAdminAuth()
const { locale, t } = useI18n()

const products = ref<CatalogProduct[]>([])
const categories = ref<CatalogCategory[]>([])
const isAdminMode = ref(false)
const isLoading = ref(true)
const isSaving = ref(false)
const isSigningOut = ref(false)
const loadError = ref('')
const actionError = ref('')
const search = ref('')
const selectedCategory = ref('all')
const sortOrder = ref('newest')
const editorOpen = ref(false)
const deleteTarget = ref<CatalogProduct | null>(null)
const imageFiles = ref<File[]>([])
const editorForm = ref<EditorForm>(emptyForm())

function emptyForm(): EditorForm {
  return { categoryId: categories.value[0]?.id || '', sku: '', slug: '', price: 0, stockQuantity: 0, status: 'published', name: '', shortDescription: '', description: '', specifications: '', imagePaths: '' }
}

const filteredProducts = computed(() => {
  const query = search.value.trim().toLowerCase()
  const filtered = products.value.filter((product) => {
    const categoryMatch = selectedCategory.value === 'all' ||
      product.categoryId === selectedCategory.value ||
      product.categorySlug === selectedCategory.value ||
      product.categoryName?.toLowerCase() === selectedCategory.value.toLowerCase()
    const queryMatch = !query || [product.name, product.sku, product.shortDescription].some((value) => value.toLowerCase().includes(query))
    return categoryMatch && queryMatch
  })

  return [...filtered].sort((first, second) => {
    if (sortOrder.value === 'price-low') return first.price - second.price
    if (sortOrder.value === 'price-high') return second.price - first.price
    if (sortOrder.value === 'name') return first.name.localeCompare(second.name)
    return 0
  })
})

const publicImageUrl = (storagePath: string) => {
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath
  return supabase.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl
}

const parseSpecifications = (value: string): Json => {
  if (!value.trim()) return []
  try { return JSON.parse(value) } catch {
    return value.split('\n').filter(Boolean).map((line) => { const [label = '', ...rest] = line.split(':'); return { label: label.trim(), value: rest.join(':').trim() } })
  }
}

const formatSpecifications = (value: unknown) => typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : ''

const mapProduct = (product: any): CatalogProduct => {
  const translation = product.product_translations?.find((item: any) => item.locale === locale.value) || product.product_translations?.find((item: any) => item.locale === 'en') || product.product_translations?.[0]
  const category = product.categories
  return {
    id: product.id,
    categoryId: product.category_id,
    categoryName: category?.category_translations?.find((item: any) => item.locale === locale.value)?.name || category?.category_translations?.find((item: any) => item.locale === 'en')?.name || category?.slug || 'Uncategorized',
    categorySlug: category?.slug,
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
    categories.value = (categoryData || []).map((category: any) => ({
      id: category.id,
      name: category.category_translations?.find((item: any) => item.locale === 'en')?.name || category.slug,
      slug: category.slug
    }))
    products.value = (productData || []).map(mapProduct)
  } catch (error: any) {
    loadError.value = error?.message || t('catalogLoadError')
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
    if (!editorForm.value.categoryId) throw new Error(t('requiredCategory'))
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
    if (!productId) throw new Error('The product could not be identified after saving.')
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
  } catch (error: any) { actionError.value = error?.message || t('productSaveError') } finally { isSaving.value = false }
}

const confirmDelete = async () => {
  if (!deleteTarget.value || !isAdminMode.value) return
  isSaving.value = true
  try {
    const { error } = await supabase.from('products').delete().eq('id', deleteTarget.value.id)
    if (error) throw error
    deleteTarget.value = null
    await loadCatalog()
  } catch (error: any) { actionError.value = error?.message || t('productDeleteError') } finally { isSaving.value = false }
}

const logout = async () => { isSigningOut.value = true; try { await signOut(); isAdminMode.value = false } finally { isSigningOut.value = false } }
watch(user, () => { void refreshAdminMode() }, { immediate: true })
onMounted(() => { void loadCatalog() })
useHead({ title: 'Raccoon Gear Bin | Gaming accessories' })
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <UContainer class="pt-6 sm:pt-8 pb-28 sm:pb-32 lg:pb-16">
      <!-- Top Row: Massive Logo on Left, ColorMode & Language Buttons on Right -->
      <div class="flex items-start justify-between gap-4 pb-8 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <NuxtLink to="/" :aria-label="t('appName')">
          <BrandLogo size="hero" />
        </NuxtLink>

        <div class="flex items-center gap-3 sm:gap-4 shrink-0 pt-2">
          <ColorModeToggle />
          <LanguageSwitcher />
          <span
            v-if="isAdminMode"
            class="hidden items-center gap-2 rounded-full border border-zinc-200/80 bg-zinc-100/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600 sm:inline-flex dark:border-zinc-800/80 dark:bg-zinc-900/70 dark:text-zinc-400"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-zinc-950 dark:bg-white" />
            {{ t('adminMode') }}
          </span>
          <UButton
            v-if="isAdminMode"
            size="xs"
            color="neutral"
            variant="ghost"
            :loading="isSigningOut"
            @click="logout"
          >
            {{ t('logout') }}
          </UButton>
        </div>
      </div>

      <!-- Hero Section with 'The Collection' tagline under the logo -->
      <section class="flex flex-col justify-between gap-6 border-b border-zinc-200/80 py-8 dark:border-zinc-800/80 md:flex-row md:items-end">
        <div class="max-w-2xl">
          <p class="text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-400 dark:text-zinc-500">
            {{ t('collection') }}
          </p>
          <p class="mt-2 text-base sm:text-lg leading-relaxed text-zinc-500 dark:text-zinc-400 font-normal">
            {{ t('tagLine') }}
          </p>
        </div>
        <UButton
          v-if="isAdminMode"
          color="neutral"
          class="shrink-0 rounded-full px-5 py-2.5 font-semibold text-xs tracking-wider uppercase shadow-xs"
          @click="openAddEditor"
        >
          ＋ {{ t('addProduct') }}
        </UButton>
      </section>

      <!-- Main Layout: Category Navigation Sidebar + Product Listing -->
      <div class="mt-8 sm:mt-10 flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
        <!-- Left Side: Category Navigation Panel (desktop only in layout flow) -->
        <aside class="relative w-full lg:w-44 xl:w-48 shrink-0 lg:sticky lg:top-24">
          <p class="hidden lg:block mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
            {{ t('shopByCategory') }}
          </p>
          <CategoryNav
            v-model="selectedCategory"
            :categories="categories"
          />
          <SearchDock
            v-model="search"
            :result-count="filteredProducts.length"
          />
        </aside>

        <!-- Right Side: Search, Sort & Products -->
        <div class="flex-1 min-w-0">
          <div class="flex flex-col gap-4 border-b border-zinc-200/80 pb-6 dark:border-zinc-800/80 sm:flex-row sm:items-center sm:justify-between">
            <div data-search-anchor class="flex h-14 w-full items-center gap-3 rounded-full border border-zinc-200/80 bg-white pr-2 pl-5 sm:max-w-xs md:max-w-sm dark:border-zinc-800/80 dark:bg-zinc-900">
              <span class="flex h-5 w-5 shrink-0 items-center justify-center text-zinc-400 dark:text-zinc-500">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                v-model="search"
                type="text"
                autocomplete="off"
                enterkeyhint="search"
                :spellcheck="false"
                :placeholder="t('searchCatalog')"
                :aria-label="t('searchCatalog')"
                class="h-full w-full min-w-0 border-0 bg-transparent p-0 text-base font-medium text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-white dark:placeholder:text-zinc-500"
              >
              <button
                type="button"
                class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
                :aria-label="t('clearSearch')"
                :title="t('clearSearch')"
                @click="search = ''"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div class="flex items-center justify-between sm:justify-end gap-4">
              <span class="text-xs font-medium text-zinc-400 dark:text-zinc-500 tabular-nums">
                {{ filteredProducts.length }} {{ filteredProducts.length === 1 ? 'item' : 'items' }}
              </span>
              <USelect
                v-model="sortOrder"
                :items="[
                  { label: t('newest'), value: 'newest' },
                  { label: t('priceLow'), value: 'price-low' },
                  { label: t('priceHigh'), value: 'price-high' },
                  { label: t('nameAZ'), value: 'name' }
                ]"
                class="w-44 sm:w-48"
              />
            </div>
          </div>

          <UAlert v-if="loadError" class="mt-6" color="error" variant="soft" :title="loadError" />
          <UAlert v-if="actionError" class="mt-6" color="error" variant="soft" :title="actionError" />

          <div v-if="isLoading" class="mt-8 grid gap-6 sm:gap-8 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            <div v-for="item in 6" :key="item" class="h-96 rounded-2xl bg-zinc-100 dark:bg-zinc-900 animate-pulse border border-zinc-200/60 dark:border-zinc-800/60" />
          </div>
          <div v-else-if="!filteredProducts.length" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
            <p class="text-sm font-medium text-zinc-500">{{ t('noProducts') }}</p>
          </div>
          <div v-else class="mt-8 grid gap-6 sm:gap-8 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            <ProductCard
              v-for="product in filteredProducts"
              :key="product.id"
              :product="product"
              :is-admin="isAdminMode"
              @edit="openEditEditor"
            />
          </div>
        </div>
      </div>
    </UContainer>

    <!-- Admin Edit Modal -->
    <div
      v-if="editorOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm overflow-y-auto"
      @click.self="editorOpen = false"
    >
      <section
        class="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800/80 my-auto overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        :aria-label="t('editProduct')"
      >
        <div class="flex items-center justify-between gap-4 border-b border-zinc-200/80 px-6 py-5 dark:border-zinc-800/80">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{{ t('catalog') }}</p>
            <h2 class="mt-1 text-xl font-black">{{ editorForm.id ? t('editProduct') : t('addProduct') }}</h2>
          </div>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            :aria-label="t('close')"
            @click="editorOpen = false"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <form class="flex-1 overflow-y-auto p-6 sm:p-8 space-y-5" @submit.prevent="saveProduct">
          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField :label="t('productName')" required>
              <UInput v-model="editorForm.name" required class="w-full" />
            </UFormField>
            <UFormField :label="t('category')" required>
              <USelect
                v-model="editorForm.categoryId"
                :items="categories.map((category) => ({ label: category.name, value: category.id }))"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('sku')" required>
              <UInput v-model="editorForm.sku" required class="w-full" />
            </UFormField>
            <UFormField :label="t('slug')" required>
              <UInput v-model="editorForm.slug" required class="w-full" />
            </UFormField>
            <UFormField :label="t('price')" required>
              <UInput v-model.number="editorForm.price" type="number" min="0" step="0.01" required class="w-full" />
            </UFormField>
            <UFormField :label="t('stock')" required>
              <UInput v-model.number="editorForm.stockQuantity" type="number" min="0" step="1" required class="w-full" />
            </UFormField>
          </div>

          <UFormField :label="t('shortDescription')" required>
            <UInput v-model="editorForm.shortDescription" required class="w-full" />
          </UFormField>

          <UFormField :label="t('fullDescription')" required>
            <UTextarea v-model="editorForm.description" :rows="4" required class="w-full" />
          </UFormField>

          <UFormField :label="t('specs')" :hint="t('specificationsHint')">
            <UTextarea v-model="editorForm.specifications" :rows="4" class="w-full font-mono text-xs" />
          </UFormField>

          <UFormField :label="t('imagePaths')" :hint="t('imagePathsHint')">
            <UTextarea v-model="editorForm.imagePaths" :rows="3" class="w-full font-mono text-xs" />
          </UFormField>

          <UFormField :label="t('uploadImages')">
            <input
              type="file"
              accept="image/*"
              multiple
              class="block w-full text-xs text-zinc-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-zinc-100 dark:file:bg-zinc-800 file:text-zinc-700 dark:file:text-zinc-300 hover:file:bg-zinc-200 cursor-pointer"
              @change="handleImageSelection"
            />
          </UFormField>

          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 pt-5 dark:border-zinc-800/80">
            <UButton
              v-if="editorForm.id"
              type="button"
              color="error"
              variant="ghost"
              size="sm"
              @click="deleteTarget = products.find((product) => product.id === editorForm.id) || null; editorOpen = false"
            >
              {{ t('deleteProduct') }}
            </UButton>
            <span v-else />
            <div class="flex gap-2.5">
              <UButton type="button" color="neutral" variant="ghost" size="sm" @click="editorOpen = false">
                {{ t('cancel') }}
              </UButton>
              <UButton type="submit" color="neutral" size="sm" :loading="isSaving">
                {{ t('saveChanges') }}
              </UButton>
            </div>
          </div>
        </form>
      </section>
    </div>

    <!-- Delete Confirmation Modal -->
    <div
      v-if="deleteTarget"
      class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      @click.self="deleteTarget = null"
    >
      <section
        class="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800/80 p-6 sm:p-8"
        role="alertdialog"
        aria-modal="true"
      >
        <h2 class="text-xl font-black text-zinc-950 dark:text-white">
          {{ t('deleteConfirm', { name: deleteTarget.name }) }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          {{ t('deleteWarning') }}
        </p>
        <div class="mt-6 flex justify-end gap-3">
          <UButton color="neutral" variant="ghost" size="sm" @click="deleteTarget = null">
            {{ t('cancel') }}
          </UButton>
          <UButton color="error" size="sm" :loading="isSaving" @click="confirmDelete">
            {{ t('deleteProduct') }}
          </UButton>
        </div>
      </section>
    </div>
  </main>
</template>
