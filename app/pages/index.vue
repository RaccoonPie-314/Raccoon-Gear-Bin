<script setup lang="ts">
import type { CatalogCategory, CatalogProduct } from '~/types/catalog'
import type { SiteInfo } from '~/types/site-info'

const user = useSupabaseUser()
const { signOut, isAdmin } = useAdminAuth()
const { fetchCatalog } = useCatalog()
const { fetchSiteInfo } = useSiteInfo()
const { locale, t } = useI18n()

const products = ref<CatalogProduct[]>([])
const categories = ref<CatalogCategory[]>([])
const siteInfo = ref<SiteInfo | null>(null)
const isAdminMode = ref(false)
const isLoading = ref(true)
const isSigningOut = ref(false)
const loadError = ref('')

// Browsing state lives in its own composable; the page only reads what it renders.
const { search, selectedCategory, sortOrder, filteredProducts } = useCatalogBrowse(products)

const loadCatalog = async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const catalog = await fetchCatalog()
    products.value = catalog.products
    categories.value = catalog.categories
  } catch (error: any) {
    loadError.value = error?.message || t('catalogLoadError')
  } finally { isLoading.value = false }
}

// A failed site-info read leaves the header cluster unrendered rather than alerting: contact
// links are the masthead's least load-bearing content, and a red banner there would outweigh
// the phone number it stands in for. The reason is still logged for the console.
const loadSiteInfo = async () => {
  try { siteInfo.value = await fetchSiteInfo() } catch (error: any) { console.error('Site info load failed:', error) }
}

const refreshAdminMode = async () => { isAdminMode.value = await isAdmin() }
// The product editor owns its form, save and delete flow. The page keeps catalog loading,
// browse state and admin identity, and lends the editor the two things it must not own: the
// category list for defaults, and the reload that refreshes what the grid shows. Authorisation
// stays where it always was - row-level security in Postgres.
const {
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
} = useAdminProductEditor({
  categories,
  canMutate: () => isAdminMode.value,
  onMutated: () => { void loadCatalog() }
})

const logout = async () => { isSigningOut.value = true; try { await signOut(); isAdminMode.value = false } finally { isSigningOut.value = false } }
watch(user, () => { void refreshAdminMode() }, { immediate: true })
onMounted(() => { void loadCatalog(); void loadSiteInfo() })
useHead({ title: 'Raccoon Gear Bin | Gaming accessories' })
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <UContainer class="pt-5 sm:pt-6 pb-28 sm:pb-32 lg:pb-20">
      <!-- Masthead: slim logo on the left, utility controls on the right, one hairline below -->
      <header class="flex items-center justify-between gap-4 border-b border-zinc-200/80 pb-4 dark:border-zinc-800/80">
        <NuxtLink to="/" :aria-label="t('appName')" class="shrink-0">
          <BrandLogo size="sm" />
        </NuxtLink>

        <!-- Site info (phone / location / socials) sits between the marks it describes and the
             view controls; below md it yields the row to the logo and the language/theme pair. -->
        <div class="hidden min-w-0 flex-1 justify-end md:flex">
          <SiteInfoLinks :site-info="siteInfo" />
        </div>

        <div class="flex items-center gap-2 sm:gap-3 shrink-0">
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
            @click="navigateTo('/admin/site-info')"
          >
            {{ t('siteInfo') }}
          </UButton>
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
      </header>

      <!-- Page heading: eyebrow over the display line, admin action held to the baseline -->
      <section class="flex flex-col justify-between gap-6 pt-10 sm:pt-14 md:flex-row md:items-end md:gap-10">
        <div class="max-w-3xl">
          <!-- Wide display tracking reads as word-spacing on Khmer, whose clusters carry marks below
               the baseline, so the labels drop to a hairline of tracking in that locale. -->
          <p class="text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? 'tracking-[0.08em]' : 'tracking-[0.25em]'">
            {{ t('collection') }}
          </p>
          <h1 class="mt-3 max-w-[22ch] text-2xl font-bold leading-snug tracking-tight text-balance text-zinc-950 sm:text-3xl lg:text-4xl dark:text-white">
            {{ t('tagLine') }}
          </h1>
        </div>
        <UButton
          v-if="isAdminMode"
          color="neutral"
          class="shrink-0 self-start rounded-full px-5 py-2.5 font-semibold text-xs tracking-wider uppercase shadow-xs md:self-auto"
          @click="openAddEditor"
        >
          ＋ {{ t('addProduct') }}
        </UButton>
      </section>

      <!-- Main Layout: Category Navigation Sidebar + Product Listing -->
      <div class="mt-10 flex flex-col gap-0 sm:mt-12 lg:flex-row lg:items-start lg:gap-10">
        <!-- Left Side: Category Navigation Panel (desktop only in layout flow) -->
        <aside class="relative w-full shrink-0 lg:sticky lg:top-10 lg:w-44 xl:w-48">
          <p class="hidden lg:block mb-4 text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? 'tracking-[0.08em]' : 'tracking-[0.22em]'">
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
        <div class="min-w-0 flex-1">
          <!-- Control group: one row from sm up, search and sort share the same 44px rhythm -->
          <div class="flex flex-col gap-3 border-b border-zinc-200/80 pb-5 dark:border-zinc-800/80 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div data-search-anchor class="flex h-11 w-full shrink-0 items-center gap-2.5 rounded-full border border-zinc-200/80 bg-white pr-1.5 pl-4 shadow-xs sm:w-72 dark:border-zinc-800/80 dark:bg-zinc-900 lg:w-80">
              <span class="flex h-5 w-5 shrink-0 items-center justify-center text-zinc-400 dark:text-zinc-500">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5" aria-hidden="true">
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
                class="h-full w-full min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-zinc-950 outline-none placeholder:text-zinc-400 sm:text-base dark:text-white dark:placeholder:text-zinc-500"
              >
              <button
                type="button"
                class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
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
            <div class="flex items-center justify-between gap-4 sm:justify-end sm:gap-5">
              <span class="text-xs font-medium text-zinc-400 tabular-nums dark:text-zinc-500">
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
                class="h-11 w-44 shrink-0 sm:w-48"
              />
            </div>
          </div>

          <UAlert v-if="loadError" class="mt-6" color="error" variant="soft" :title="loadError" />
          <UAlert v-if="actionError" class="mt-6" color="error" variant="soft" :title="actionError" />

          <div v-if="isLoading" class="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:mt-10 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-12 xl:grid-cols-3">
            <div v-for="item in 6" :key="item" class="aspect-[4/5] rounded-2xl border border-zinc-200/60 bg-zinc-100 animate-pulse dark:border-zinc-800/60 dark:bg-zinc-900" />
          </div>
          <div v-else-if="!filteredProducts.length" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
            <p class="text-sm font-medium text-zinc-500">{{ t('noProducts') }}</p>
          </div>
          <div v-else class="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:mt-10 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-12 xl:grid-cols-3">
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
              class="block w-full text-xs text-zinc-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-zinc-100 dark:file:bg-zinc-800 file:text-zinc-700 dark:file:text-zinc-300 hover:file:bg-zinc-200 cursor-pointer"
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
