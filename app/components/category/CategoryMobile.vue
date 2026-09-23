<script setup lang="ts">
import type { CatalogCategory } from '~/types/catalog'

interface CategoryItemDef {
  key: string
  slug: string
  labelKey: string
  defaultName: string
}

const CATEGORY_ITEMS: CategoryItemDef[] = [
  { key: 'all', slug: 'all', labelKey: 'all', defaultName: 'All Gear' },
  { key: 'controllers', slug: 'controllers', labelKey: 'controllers', defaultName: 'Controllers' },
  { key: 'keyboards', slug: 'keyboards', labelKey: 'keyboards', defaultName: 'Keyboards' },
  { key: 'mice', slug: 'mice', labelKey: 'mice', defaultName: 'Mice' },
  { key: 'headphones', slug: 'headphones', labelKey: 'headphones', defaultName: 'Headphones' },
  { key: 'earphones', slug: 'earphones', labelKey: 'earphones', defaultName: 'Earphones' }
]

const props = withDefaults(
  defineProps<{
    modelValue: string
    categories?: CatalogCategory[]
  }>(),
  {
    categories: () => []
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()

const computedItems = computed(() => {
  return CATEGORY_ITEMS.map((item) => {
    if (item.key === 'all') {
      return {
        key: 'all',
        slug: 'all',
        value: 'all',
        name: t('all') || item.defaultName
      }
    }

    const matchedDbCat = props.categories.find((cat) => {
      if (cat.slug && cat.slug.toLowerCase() === item.slug.toLowerCase()) return true
      if (cat.id && cat.id.toLowerCase() === item.slug.toLowerCase()) return true
      if (cat.name && cat.name.toLowerCase() === item.defaultName.toLowerCase()) return true
      return false
    })

    const name = matchedDbCat?.name || (t(item.labelKey) !== item.labelKey ? t(item.labelKey) : item.defaultName)
    const value = matchedDbCat?.id || item.slug

    return {
      key: item.key,
      slug: item.slug,
      value,
      dbId: matchedDbCat?.id,
      name
    }
  })
})

const isItemActive = (item: ReturnType<typeof computedItems.value>[number]) => {
  const current = props.modelValue
  if (item.key === 'all') {
    return !current || current === 'all'
  }
  return current === item.value || current === item.slug || (Boolean(item.dbId) && current === item.dbId)
}

const activeIndex = computed(() => {
  const idx = computedItems.value.findIndex((item) => isItemActive(item))
  return idx !== -1 ? idx : 0
})

const handleSelect = (item: ReturnType<typeof computedItems.value>[number]) => {
  if (item.key === 'all') {
    emit('update:modelValue', 'all')
    return
  }
  if (isItemActive(item)) {
    emit('update:modelValue', 'all')
    return
  }
  emit('update:modelValue', item.value)
}

// ==========================================
// Mobile: Sliding Selection Indicator
// ==========================================
const mobileNavRef = ref<HTMLElement | null>(null)
const mobileItemRefs = ref<(HTMLElement | null)[]>([])
const isMobileNavVisible = ref(true)

const setMobileItemRef = (el: any, index: number) => {
  if (el) {
    mobileItemRefs.value[index] = (el as any).$el || el
  }
}

const mobileIndicatorStyle = ref({
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  opacity: 0
})

const updateMobileIndicator = () => {
  const activeEl = mobileItemRefs.value[activeIndex.value]
  const navEl = mobileNavRef.value
  if (!activeEl || !navEl) return

  const navRect = navEl.getBoundingClientRect()
  const activeRect = activeEl.getBoundingClientRect()

  // Calculate position relative to <nav> content area including horizontal scroll offset
  const left = activeRect.left - navRect.left + navEl.scrollLeft
  const top = activeRect.top - navRect.top + navEl.scrollTop

  mobileIndicatorStyle.value = {
    left,
    top,
    width: activeRect.width,
    height: activeRect.height,
    opacity: 1
  }
}

const scrollActiveMobileItemIntoView = () => {
  const activeEl = mobileItemRefs.value[activeIndex.value]
  const navEl = mobileNavRef.value
  if (!activeEl || !navEl) return

  const targetScrollLeft = activeEl.offsetLeft - (navEl.clientWidth - activeEl.clientWidth) / 2
  navEl.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
}

// ==========================================
// Mobile: Scroll Direction Detection
// ==========================================
let lastScrollY = 0
let isScrollingTicking = false

const handleWindowScroll = () => {
  if (isScrollingTicking) return
  isScrollingTicking = true

  requestAnimationFrame(() => {
    const currentScrollY = typeof window !== 'undefined' ? (window.scrollY || document.documentElement.scrollTop) : 0

    if (currentScrollY < 60) {
      isMobileNavVisible.value = true
    } else {
      const scrollDiff = currentScrollY - lastScrollY
      if (scrollDiff > 6) {
        isMobileNavVisible.value = false
      } else if (scrollDiff < -6) {
        isMobileNavVisible.value = true
      }
    }

    lastScrollY = Math.max(0, currentScrollY)
    isScrollingTicking = false
  })
}

// ==========================================
// Lifecycle & Observers
// ==========================================
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  nextTick(() => {
    updateMobileIndicator()
  })

  window.addEventListener('resize', updateMobileIndicator)
  window.addEventListener('scroll', handleWindowScroll, { passive: true })

  if (mobileNavRef.value) {
    mobileNavRef.value.addEventListener('scroll', updateMobileIndicator, { passive: true })
  }

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      updateMobileIndicator()
    })

    if (mobileNavRef.value) resizeObserver.observe(mobileNavRef.value)

    mobileItemRefs.value.forEach((el) => {
      if (el) resizeObserver?.observe(el)
    })
  }

  if (typeof document !== 'undefined' && (document as any).fonts) {
    ;(document as any).fonts.ready.then(() => {
      updateMobileIndicator()
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', updateMobileIndicator)
  window.removeEventListener('scroll', handleWindowScroll)
  if (mobileNavRef.value) {
    mobileNavRef.value.removeEventListener('scroll', updateMobileIndicator)
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

watch(activeIndex, () => {
  nextTick(() => {
    updateMobileIndicator()
    scrollActiveMobileItemIntoView()
  })
})

watch(computedItems, () => {
  nextTick(updateMobileIndicator)
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed bottom-0 inset-x-0 z-40 lg:hidden pointer-events-none transition-transform duration-300 ease-out"
      :class="isMobileNavVisible ? 'translate-y-0' : 'translate-y-[125%]'"
    >
      <div class="pointer-events-auto bg-white/90 dark:bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-200/80 dark:border-zinc-800/80 shadow-xl px-2 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        <nav
          ref="mobileNavRef"
          aria-label="Mobile product categories"
          class="relative flex flex-row items-center overflow-x-auto no-scrollbar gap-1.5 px-1 py-1 max-w-lg mx-auto"
          tabindex="-1"
        >
          <!-- Mobile Category Buttons -->
          <button
            v-for="(item, index) in computedItems"
            :key="`mobile-${item.key}`"
            :ref="(el) => setMobileItemRef(el, index)"
            type="button"
            role="tab"
            :aria-selected="isItemActive(item)"
            class="relative flex flex-col items-center justify-center text-center flex-1 min-w-[4.25rem] py-1.5 px-2 rounded-xl transition-all duration-200 select-none cursor-pointer z-10 shrink-0 focus-visible:outline-none"
            :class="[
              isItemActive(item)
                ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 font-bold shadow-xs -translate-x-[0.5px]'
                : 'bg-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
            ]"
            @click="handleSelect(item)"
          >
            <div class="flex items-center justify-center h-5 w-5 mb-0.5 shrink-0">
              <!-- All Gear Icon -->
              <svg
                v-if="item.key === 'all'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4.5 w-4.5 shrink-0 transition-colors duration-200"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
              </svg>

              <!-- Controllers Icon -->
              <svg
                v-else-if="item.key === 'controllers'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4.5 w-4.5 shrink-0 transition-colors duration-200"
                aria-hidden="true"
              >
                <path d="M6 12h4m-2-2v4" />
                <line x1="15" y1="13" x2="15.01" y2="13" stroke-width="2.5" />
                <line x1="18" y1="11" x2="18.01" y2="11" stroke-width="2.5" />
                <path d="M17.3 5H6.7a4 4 0 0 0-4 3.6l-.7 7.4a3 3 0 0 0 3 3.3c1 0 1.5-.5 2-1l1.5-1.5a2 2 0 0 1 1.4-.6h4.2a2 2 0 0 1 1.4.6l1.5 1.5c.5.5 1 1 2 1a3 3 0 0 0 3-3.3l-.7-7.4a4 4 0 0 0-4-3.6z" />
              </svg>

              <!-- Keyboards Icon -->
              <svg
                v-else-if="item.key === 'keyboards'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4.5 w-4.5 shrink-0 transition-colors duration-200"
                aria-hidden="true"
              >
                <rect x="2" y="4" width="20" height="16" rx="2.5" />
                <line x1="6" y1="8" x2="6.01" y2="8" stroke-width="2.2" />
                <line x1="10" y1="8" x2="10.01" y2="8" stroke-width="2.2" />
                <line x1="14" y1="8" x2="14.01" y2="8" stroke-width="2.2" />
                <line x1="18" y1="8" x2="18.01" y2="8" stroke-width="2.2" />
                <line x1="8" y1="12" x2="8.01" y2="12" stroke-width="2.2" />
                <line x1="12" y1="12" x2="12.01" y2="12" stroke-width="2.2" />
                <line x1="16" y1="12" x2="16.01" y2="12" stroke-width="2.2" />
                <line x1="7" y1="16" x2="17" y2="16" />
              </svg>

              <!-- Mice Icon -->
              <svg
                v-else-if="item.key === 'mice'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4.5 w-4.5 shrink-0 transition-colors duration-200"
                aria-hidden="true"
              >
                <rect x="5" y="2" width="14" height="20" rx="7" />
                <line x1="12" y1="2" x2="12" y2="10" />
                <rect x="11" y="5" width="2" height="4" rx="1" stroke-width="1.5" />
              </svg>

              <!-- Headphones Icon -->
              <svg
                v-else-if="item.key === 'headphones'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4.5 w-4.5 shrink-0 transition-colors duration-200"
                aria-hidden="true"
              >
                <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
              </svg>

              <!-- Earphones Icon -->
              <svg
                v-else-if="item.key === 'earphones'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4.5 w-4.5 shrink-0 transition-colors duration-200"
                aria-hidden="true"
              >
                <!-- Left earbud -->
                <path d="M6 5a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1z" />
                <path d="M6 14v5a1 1 0 0 1-1 1" />
                <line x1="3" y1="9" x2="1.5" y2="9" stroke-width="2" />
                <!-- Right earbud -->
                <path d="M18 5a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1z" />
                <path d="M18 14v5a1 1 0 0 0 1 1" />
                <line x1="21" y1="9" x2="22.5" y2="9" stroke-width="2" />
              </svg>
            </div>

            <span
              class="text-[10px] font-bold leading-tight tracking-tight text-center truncate max-w-[4.5rem] transition-colors duration-200"
            >
              {{ item.name }}
            </span>
          </button>
        </nav>
      </div>
    </div>
  </Teleport>
</template>
