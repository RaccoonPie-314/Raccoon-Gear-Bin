<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'
import { getProductPricing } from '~/utils/product-pricing'

// Presentational by design: the results are the page's `useCatalogBrowse` output, filtered
// where the fetch lives. This box owns only the popover's open state and its keyboard exit —
// it never touches the network, and it is deliberately not a second (animated, frozen)
// SearchDock.
const query = defineModel<string>({ default: '' })
const props = withDefaults(defineProps<{ results: CatalogProduct[]; loading?: boolean }>(), { loading: false })
const emit = defineEmits<{ focus: [] }>()

const { t } = useI18n()
// Results are links into the catalog, so they resolve through the current locale: a bare
// `/products/<id>` is the English route, which would drop a Khmer visitor out of Khmer mid-search.
const localePath = useLocalePath()

// A header popover is a scanner, not a second results page; anything past the first hits is
// noise next to the product the visitor actually came to read.
const MAX_RESULTS = 6

// One row, one number: the price a visitor would pay (so a running promotion shows its discounted
// price), asked of the same rule the card and the detail page ask. The crossed-out original belongs
// to those, not to a 44px result row — `ProductPrice` would add a second line here.
const priceOf = (product: CatalogProduct) => getProductPricing(product).price

const isFocused = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const isOpen = computed(() => isFocused.value && query.value.trim().length > 0 && !props.loading)
const displayed = computed(() => props.results.slice(0, MAX_RESULTS))

const onFocus = () => {
  isFocused.value = true
  // The page lazy-loads (once) the list this box filters; the box itself fetches nothing.
  emit('focus')
}
const close = () => { isFocused.value = false }

// Clicking a result blurs the input before the click lands; unmounting the panel in that
// instant would eat the navigation. Only close when focus leaves the whole box.
const onBlur = (event: FocusEvent) => {
  const root = rootEl.value
  if (root && event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return
  close()
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    query.value = ''
    close()
  }
  else if (event.key === 'Enter') {
    // Enter takes the first hit — the popover's whole purpose is one keystroke away.
    const first = displayed.value[0]
    if (first) {
      close()
      void navigateTo(localePath(`/products/${first.id}`))
    }
  }
}
</script>

<template>
  <div ref="rootEl" data-catalog-search class="relative w-full" role="search">
    <div class="flex h-11 w-full items-center gap-2 rounded-full border border-zinc-200/80 bg-white pr-1 pl-3.5 shadow-xs dark:border-zinc-800/80 dark:bg-zinc-900">
      <span class="flex h-5 w-5 shrink-0 items-center justify-center text-zinc-400 dark:text-zinc-500">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
      <input
        :value="query"
        type="text"
        autocomplete="off"
        enterkeyhint="search"
        :spellcheck="false"
        :placeholder="t('searchCatalog')"
        :aria-label="t('searchCatalog')"
        class="h-full w-full min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-white dark:placeholder:text-zinc-500"
        @input="query = ($event.target as HTMLInputElement).value"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
      >
      <button
        v-if="query"
        type="button"
        class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-[background-color,color,scale] duration-150 ease-out motion-safe:active:scale-[0.97] hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
        :aria-label="t('clearSearch')"
        :title="t('clearSearch')"
        @click="query = ''"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>

    <div
      v-if="isOpen"
      class="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-zinc-200/80 bg-white shadow-lg dark:border-zinc-800/80 dark:bg-zinc-900"
    >
      <ul v-if="displayed.length" class="py-1">
        <li v-for="product in displayed" :key="product.id">
          <NuxtLink
            :to="localePath(`/products/${product.id}`)"
            class="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            @click="close"
          >
            <img
              v-if="product.images[0]"
              :src="product.images[0].url"
              :alt="product.images[0].altText || product.name"
              class="h-9 w-9 shrink-0 rounded-lg bg-zinc-50 object-cover dark:bg-zinc-950"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold text-zinc-950 dark:text-white">{{ product.name }}</span>
              <span class="block truncate text-xs text-zinc-500 dark:text-zinc-400">{{ product.categoryName ?? t('uncategorized') }}</span>
            </span>
            <span class="shrink-0 text-sm font-bold tabular-nums text-zinc-950 dark:text-white">{{ product.currency }} {{ priceOf(product).toFixed(2) }}</span>
          </NuxtLink>
        </li>
      </ul>
      <p v-else class="px-3 py-3 text-sm text-zinc-500 dark:text-zinc-400">{{ t('noProducts') }}</p>
    </div>
  </div>
</template>
