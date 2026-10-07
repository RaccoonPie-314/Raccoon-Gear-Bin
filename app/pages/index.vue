<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'
import { pageKeyFor, shouldScrollToTop } from '~/utils/locale-route'
import { hasKhmerText } from '~/utils/locale-script'
import { disintegrateText } from '~/utils/text-disintegrate'

const signedIn = useSignedIn()
const { signOut, isAdmin } = useAdminAuth()
const { fetchCatalog, products, categories } = useCatalog()
const { fetchSiteInfo, siteInfo } = useSiteInfo()
const { locale, t } = useI18n()
// Every internal path on the storefront resolves through the locale. A bare `/` happens to come out
// right today only because `redirectOn: 'root'` sends it back to `/km/` from the cookie — a redirect
// hop that depends on a cookie being present; `localePath` states the route it means.
const localePath = useLocalePath()

// The control itself (badge included) lives in `CartControl.vue` — the same entry the product
// detail header mounts. The count comes from the one cart composable.
const { count: cartCount } = useCart()

// The masthead's two per-account reads — the Orders badge's pending queue (admin) and unseen
// updates (buyer). Both scoped and both inert when signed out.
const { fetchUnseenCount } = useCustomerOrders()
const { fetchPendingCount } = useAdminOrders()

// A locale switch is the same page in another language, so it must not rebuild this component: the
// key drops the locale prefix (the visitor keeps their scroll, their search text and their loaded
// catalog) and `scrollToTop` declines for that navigation alone. Both rules are one function in
// `app/utils/locale-route.ts`, shared with the product page, because a locale prefix is a fact about
// routing and not about either page.
// Real navigation still remounts: `/products/a` and `/products/b` are different keys, and every entry
// into this page from anywhere else runs `loadCatalog()` exactly as it did before.
definePageMeta({ key: pageKeyFor, scrollToTop: shouldScrollToTop })

const isAdminMode = ref(false)
const isLoading = ref(true)
const isSigningOut = ref(false)
const loadError = ref('')

// Browsing state lives in its own composable; the page only reads what it renders.
const { search, selectedCategory, sortOrder, filteredProducts } = useCatalogBrowse(products)

// The clear control is owed to a field that has something in it: an ✕ over an empty box offers nothing,
// and here it would also sit next to the placeholder telling the visitor to type. `trim`, because a
// field holding only spaces reads as empty and the visitor expects the same answer from both.
const searchInputEl = ref<HTMLInputElement | null>(null)
const canClearSearch = computed(() => search.value.trim().length > 0)
const clearSearch = () => {
  // Asked for the letters before the value goes: the effect mirrors whatever the visitor typed, and a
  // cleared input has nothing left to show.
  disintegrateText(searchInputEl.value)
  search.value = ''
  searchInputEl.value?.focus({ preventScroll: true })
}

// No assignment here: `products`/`categories`/`siteInfo` are the data layer's own computeds over the
// rows it loaded, so this call exists to fill them, and a language change re-resolves them from what
// is already in memory instead of asking the server for text it already sent.
const loadCatalog = async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    await fetchCatalog()
  } catch (error: any) {
    loadError.value = error?.message || t('catalogLoadError')
  } finally { isLoading.value = false }
}

// A failed site-info read leaves the header cluster unrendered rather than alerting: contact
// links are the masthead's least load-bearing content, and a red banner there would outweigh
// the phone number it stands in for. The reason is still logged for the console.
const loadSiteInfo = async () => {
  try { await fetchSiteInfo() } catch (error: any) { console.error('Site info load failed:', error) }
}

const refreshAdminMode = async () => { isAdminMode.value = await isAdmin() }
const logout = async () => { isSigningOut.value = true; try { await signOut(); isAdminMode.value = false } finally { isSigningOut.value = false } }

// The Orders pill's badge — one number with two meanings by audience. An admin's is the desk's
// pending queue (a work list, self-clearing as it is worked); a buyer's is "orders whose latest
// lifecycle stamp is newer than your last look at the orders area". Both reads are the owning
// composables'; a failed read is a quiet zero, because a badge is not worth an error banner.
// Known transient: on an admin's first paint `isAdminMode` may not have resolved yet, so the
// buyer branch can run once before the pending count replaces it.
const orderNotices = ref(0)
const refreshOrderNotices = async () => {
  try {
    if (isAdminMode.value) orderNotices.value = await fetchPendingCount()
    else orderNotices.value = signedIn.value ? await fetchUnseenCount() : 0
  } catch {
    orderNotices.value = 0
  }
}
// `immediate`, or a client-side remount never recomputes: on a fresh page load the watcher fires
// when the async user state lands, but an SPA navigation back to the storefront mounts with the
// user already set — nothing changes, nothing fires, and a stale badge would sit there forever.
watch([signedIn, isAdminMode], () => { void refreshOrderNotices() }, { immediate: true })

// The editor UI — both modals, its banner and its writes — lives in the admin feature. The page
// reaches it through the two names its own template already used, and hands over what the feature
// must not own: the catalog lists it renders but never fetches, and the reload that refreshes them.
const adminEditor = ref<{ openAddEditor: () => void, openEditEditor: (product: CatalogProduct) => void } | null>(null)
const openAddEditor = () => { adminEditor.value?.openAddEditor() }
const openEditEditor = (product: CatalogProduct) => { adminEditor.value?.openEditEditor(product) }

watch(signedIn, () => { void refreshAdminMode() }, { immediate: true })
onMounted(() => { void loadCatalog(); void loadSiteInfo() })
useHead({ title: 'Raccoon Gear Bin | Gaming accessories' })
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <UContainer class="pt-5 sm:pt-6 pb-28 sm:pb-32 lg:pb-20">
      <!-- Masthead, two levels: the quiet contact line, a rule, then the row that carries the
           brand. The emblem is the anchor on the left; on the right the utility pair and the
           social group stack as two separately bounded groups, so neither reads as part of the
           other and neither sits beside the logo. `flex-wrap` is the reflow valve — a group that
           no longer fits drops to its own line instead of widening the page. -->
      <header class="border-b border-zinc-200/80 pb-3 sm:pb-5 dark:border-zinc-800/80">
        <SiteInfoContact :site-info="siteInfo" />

        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pt-2.5 sm:pt-4 lg:gap-x-6">
          <NuxtLink :to="localePath('/')" :aria-label="t('appName')" class="shrink-0">
            <BrandLogo size="masthead" />
          </NuxtLink>

          <div class="ml-auto flex shrink-0 flex-col items-end gap-2.5 sm:gap-3">
            <div class="flex items-center gap-2 sm:gap-3">
              <ColorModeToggle />
              <LanguageSwitcher />
              <CartControl :count="cartCount" />
              <!-- The account entry, for everyone at every width (the admin controls below are
                   mode-gated). A text pill rather than an icon: "Sign in" has to be findable on
                   sight, and signed in it is the mobile path to the profile + sign-out. Signed in,
                   a phone wears the short label: "My account" (and its much longer Khmer form)
                   is what tips the cluster over its one-line budget at 390px. -->
              <NuxtLink
                :to="localePath(signedIn ? '/account' : '/login')"
                class="inline-flex items-center rounded-full border border-zinc-200/80 bg-zinc-100/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 shadow-xs transition-[color,background-color,scale] duration-200 hover:text-zinc-950 motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800/80 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:text-white dark:focus-visible:ring-white"
                :class="locale === 'km' ? '' : 'tracking-wider'"
              >
                <template v-if="signedIn"><span class="sm:hidden">{{ t('account') }}</span><span class="hidden sm:inline">{{ t('myAccount') }}</span></template>
                <template v-else>{{ t('signIn') }}</template>
              </NuxtLink>
              <!-- Orders, signed in only: there is nothing to list otherwise, and the account
                   pill above already carries the sign-in path. An admin's points at the desk —
                   their own account has no purchases to read — everyone else's at their own
                   history. Same pill shape as the account entry. A phone drops it: the cluster's
                   one-line budget at 390px fits the account pill but not both (measured: the
                   pair overlays the row, 144 → 244px tall), and /account carries the orders
                   entry plus the sign-out the phone otherwise loses. -->
              <NuxtLink
                v-if="signedIn"
                :to="isAdminMode ? '/admin/orders' : localePath('/account/orders')"
                class="relative hidden items-center rounded-full border border-zinc-200/80 bg-zinc-100/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 shadow-xs transition-[color,background-color,scale] duration-200 hover:text-zinc-950 motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 sm:inline-flex dark:border-zinc-800/80 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:text-white dark:focus-visible:ring-white"
                :class="locale === 'km' ? '' : 'tracking-wider'"
              >
                {{ t('orders') }}
                <span
                  v-if="orderNotices > 0"
                  data-orders-badge
                  class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-950 px-1 text-[9px] font-bold tabular-nums text-white dark:bg-white dark:text-zinc-950"
                >
                  {{ orderNotices }}
                </span>
              </NuxtLink>
              <span
                v-if="isAdminMode"
                class="hidden items-center gap-2 rounded-full border border-zinc-200/80 bg-zinc-100/70 px-3 py-1 text-[10px] font-bold uppercase text-zinc-600 sm:inline-flex dark:border-zinc-800/80 dark:bg-zinc-900/70 dark:text-zinc-400"
                :class="locale === 'km' ? '' : 'tracking-[0.16em]'"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-zinc-950 dark:bg-white" />
                {{ t('adminMode') }}
              </span>
              <!-- One entry for the admin tools, not one per tool: the editors each keep their own
                   page and section, and `AdminTabs` is what moves between them. A phone drops the
                   two admin buttons — with them the cluster wraps the whole header onto a second
                   row (live phone report, 2026-10-06); the editors are a desk workflow, and
                   sign-out lives on /account, which the account pill above reaches. -->
              <UButton
                v-if="isAdminMode"
                size="xs"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
                @click="navigateTo('/admin/site-info')"
              >
                {{ t('adminTools') }}
              </UButton>
              <UButton
                v-if="isAdminMode"
                size="xs"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
                :loading="isSigningOut"
                @click="logout"
              >
                {{ t('logout') }}
              </UButton>
            </div>

            <SiteInfoSocials :site-info="siteInfo" />
          </div>
        </div>
      </header>

      <!-- Catalog label: the masthead carries the brand weight now, so the section under it is
           one line of eyebrow plus the admin action, not a second heading block. -->
      <section class="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 pt-7 sm:pt-9">
        <!-- Wide display tracking reads as word-spacing on Khmer, whose clusters carry marks above and
             below the base letter — letter-spacing lands between those codepoints and tears a cluster in
             two — so a Khmer run carries no tracking at all. The guard reads the string rather than the
             route, and that distinction is the point here: the shop names this heading "Collection Bin"
             in both locales, so on the Khmer route it is still Latin, still wants the same display
             spacing it has in English, and nothing tears. Translate it into Khmer and the tracking
             disappears on its own, because `hasKhmerText` is what decides, not `locale`. -->
        <h1 class="text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="hasKhmerText(t('collection')) ? '' : 'tracking-[0.25em]'">
          {{ t('collection') }}
        </h1>
        <UButton
          v-if="isAdminMode"
          color="neutral"
          class="shrink-0 rounded-full px-5 py-2.5 font-semibold text-xs uppercase shadow-xs"
          :class="locale === 'km' ? '' : 'tracking-wider'"
          @click="openAddEditor"
        >
          <span aria-hidden="true">+</span> {{ t('addProduct') }}
        </UButton>
      </section>

      <!-- Main Layout: Category Navigation Sidebar + Product Listing -->
      <div class="mt-8 flex flex-col gap-0 sm:mt-10 lg:flex-row lg:items-start lg:gap-10">
        <!-- Left Side: Category Navigation Panel (desktop only in layout flow) -->
        <aside class="relative w-full shrink-0 lg:sticky lg:top-10 lg:w-44 xl:w-48">
          <p class="hidden lg:block mb-4 text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.22em]'">
            {{ t('shopByCategory') }}
          </p>
          <!-- The dock's length is now the shop's to decide, so the box it lives in has to bound it.
               Measured: eighteen categories made the nav 1204px tall in a 900px viewport, and a
               `top`-only sticky element pins its top forever — every category past the fold existed on
               the page and could not be reached. Only the nav scrolls: the mobile bar teleports
               itself out of this box, and the overflow must never go on the <aside>, because the
               collapsed search launcher is anchored to that element's bottom edge. The padding is the
               clip box's room, and it has to be generous: measured while dragging, the selection pill
               scales 25px past the nav on each side and 4px past it vertically, and `overflow-y: auto`
               clips at the padding edge — a 16px gutter cut the pill's rounded ends off. The negative
               margin puts that space back into the transparent gutter, so the rows stay exactly where
               they were and only the clip moves.
               The cap is counted in rows rather than in viewport fractions: a row is 57px and the gap
               10px, so 7 whole rows are 7*57 + 6*10 = 459, plus the nav's own 4+4 padding and the 8+8
               of clip padding above = 483px. `68vh` was the wrong unit for this — on a shorter window it
               landed mid-row and drew half an icon at the bottom edge. `verify` now asserts the rail
               rests on whole rows. -->
          <div data-category-nav-scroll class="lg:-mx-7 lg:-my-2 lg:max-h-[483px] lg:px-7 lg:py-2 lg:overflow-y-auto">
            <CategoryNav
              v-model="selectedCategory"
              :categories="categories"
            />
          </div>
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
                ref="searchInputEl"
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
                v-if="canClearSearch"
                data-search-clear
                type="button"
                class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-[background-color,color,scale] duration-150 ease-out motion-safe:active:scale-[0.97] hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
                :aria-label="t('clearSearch')"
                :title="t('clearSearch')"
                @click="clearSearch"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div class="flex items-center justify-between gap-4 sm:justify-end sm:gap-5">
              <span class="text-xs font-medium text-zinc-400 tabular-nums dark:text-zinc-500">
                {{ t('itemCount', { count: filteredProducts.length }) }}
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

          <!-- The editor sits here rather than at the end of the page so that its own banner keeps
               its place in this column; both overlays it renders are fixed and full-viewport, so
               where it mounts does not change how they appear. -->
          <AdminProductEditor
            ref="adminEditor"
            :categories="categories"
            :products="products"
            :is-admin-mode="isAdminMode"
            @mutated="loadCatalog()"
          />

          <div v-if="isLoading" class="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:mt-10 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-12 xl:grid-cols-3">
            <div v-for="item in 6" :key="item" class="aspect-[4/5] rounded-2xl border border-zinc-200/60 bg-zinc-100 animate-pulse dark:border-zinc-800/60 dark:bg-zinc-900" />
          </div>
          <div v-else-if="!filteredProducts.length" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
            <p class="text-sm font-medium text-zinc-500">{{ t('noProducts') }}</p>
          </div>
          <!-- The grid arrives with a fade rather than a cut. It is its own `v-if` chain now (the same
               three mutually exclusive conditions) precisely so it can be a Transition child — Vue only
               accepts `v-else` as a direct sibling, and a Transition slot needs the condition on the
               element it wraps. -->
          <Transition name="reveal">
            <div v-if="!isLoading && filteredProducts.length" class="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:mt-10 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-12 xl:grid-cols-3">
              <ProductCard
                v-for="product in filteredProducts"
                :key="product.id"
                :product="product"
                :is-admin="isAdminMode"
                @edit="openEditEditor"
              />
            </div>
          </Transition>
        </div>
      </div>
    </UContainer>

    <!-- The standing contact entry, desktop-only and teleported by its own component. It reads the
         site info this page already loaded — no second query, no new table. -->
    <ContactDock :site-info="siteInfo" />

    <StoreFooter />
  </main>
</template>
