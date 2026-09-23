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
  if (dragJustFinished) return
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
// Mobile: Drag-to-Select
// ==========================================
const isTouchDragging = ref(false)
const dragHighlightIndex = ref<number | null>(null)
const dragStretch = ref(0)
let isTouchDown = false
let touchStartX = 0
let touchStartY = 0
let grabOffsetX = 0
let lastDragClientX = 0
let dragVelocityX = 0
let dragJustFinished = false

const isVisualActive = (item: ReturnType<typeof computedItems.value>[number], index: number) => {
  if (isTouchDragging.value && dragHighlightIndex.value !== null) {
    return index === dragHighlightIndex.value
  }
  return isItemActive(item)
}

const findMobileItemIndex = (clientX: number) => {
  if (!mobileItemRefs.value.length) return -1

  for (let i = 0; i < mobileItemRefs.value.length; i++) {
    const el = mobileItemRefs.value[i]
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (clientX >= rect.left && clientX <= rect.right) {
      return i
    }
  }

  // Gap between item i and i+1
  for (let i = 0; i < mobileItemRefs.value.length - 1; i++) {
    const el1 = mobileItemRefs.value[i]
    const el2 = mobileItemRefs.value[i + 1]
    if (el1 && el2) {
      const r1 = el1.getBoundingClientRect()
      const r2 = el2.getBoundingClientRect()
      if (clientX > r1.right && clientX < r2.left) {
        return clientX - r1.right < r2.left - clientX ? i : i + 1
      }
    }
  }

  const firstRect = mobileItemRefs.value[0]?.getBoundingClientRect()
  const lastRect = mobileItemRefs.value[mobileItemRefs.value.length - 1]?.getBoundingClientRect()
  if (firstRect && clientX < firstRect.left) return 0
  if (lastRect && clientX > lastRect.right) return mobileItemRefs.value.length - 1

  return -1
}

const updateMobileDragPosition = (clientX: number) => {
  if (!isTouchDragging.value || !mobileNavRef.value) return
  const navEl = mobileNavRef.value
  const navRect = navEl.getBoundingClientRect()
  const rawLeft = clientX - navRect.left + navEl.scrollLeft - grabOffsetX
  const minLeft = mobileItemRefs.value[0]?.offsetLeft ?? 0
  const lastIndex = mobileItemRefs.value.length - 1
  const maxLeft = mobileItemRefs.value[lastIndex]?.offsetLeft ?? 0
  const clampedLeft = Math.max(minLeft, Math.min(maxLeft, rawLeft))

  mobileIndicatorStyle.value.left = clampedLeft

  const deltaX = clientX - lastDragClientX
  lastDragClientX = clientX
  dragVelocityX = dragVelocityX * 0.6 + deltaX * 0.4
  dragStretch.value = Math.min(0.08, Math.abs(dragVelocityX) * 0.004)

  const index = findMobileItemIndex(clientX)
  if (index !== -1) {
    dragHighlightIndex.value = index
    const el = mobileItemRefs.value[index]
    if (el) {
      mobileIndicatorStyle.value.width = el.offsetWidth
      mobileIndicatorStyle.value.height = el.offsetHeight
    }
  }
}

const handleTouchStart = (event: TouchEvent) => {
  if (event.touches.length !== 1) return
  const touch = event.touches[0]
  if (!touch) return
  touchStartX = touch.clientX
  touchStartY = touch.clientY
  lastDragClientX = touch.clientX
  dragVelocityX = 0
  dragStretch.value = 0
  isTouchDown = true
  isTouchDragging.value = false
}

const handleTouchMove = (event: TouchEvent) => {
  if (!isTouchDown || event.touches.length !== 1) return
  const touch = event.touches[0]
  if (!touch) return

  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY

  if (!isTouchDragging.value) {
    if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
      isTouchDragging.value = true
      lastDragClientX = touch.clientX
      const initialIndex = findMobileItemIndex(touchStartX)
      if (initialIndex === activeIndex.value && mobileNavRef.value) {
        const navRect = mobileNavRef.value.getBoundingClientRect()
        grabOffsetX = touchStartX - navRect.left + mobileNavRef.value.scrollLeft - mobileIndicatorStyle.value.left
      } else {
        grabOffsetX = mobileIndicatorStyle.value.width / 2
      }
    } else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      isTouchDown = false
      return
    }
  }

  if (isTouchDragging.value) {
    if (event.cancelable) {
      event.preventDefault()
    }
    updateMobileDragPosition(touch.clientX)
  }
}

const handleTouchEnd = () => {
  if (isTouchDragging.value) {
    dragJustFinished = true
    setTimeout(() => {
      dragJustFinished = false
    }, 80)

    const targetIndex = dragHighlightIndex.value !== null ? dragHighlightIndex.value : activeIndex.value
    isTouchDragging.value = false
    dragHighlightIndex.value = null
    dragStretch.value = 0
    dragVelocityX = 0

    if (targetIndex !== -1) {
      const targetItem = computedItems.value[targetIndex]
      if (targetItem) {
        emit('update:modelValue', targetItem.value)
      }
    }

    nextTick(() => {
      updateMobileIndicator()
      scrollActiveMobileItemIntoView()
    })
  }
  isTouchDown = false
  isTouchDragging.value = false
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

const mobileIndicatorTransform = computed(() => {
  if (isTouchDragging.value) {
    const enlargedScale = (1.5 + dragStretch.value).toFixed(4)
    return `translate3d(${mobileIndicatorStyle.value.left}px, ${mobileIndicatorStyle.value.top}px, 0px) scale(${enlargedScale}, ${enlargedScale})`
  }
  return `translate3d(${mobileIndicatorStyle.value.left}px, ${mobileIndicatorStyle.value.top}px, 0px)`
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
    mobileNavRef.value.addEventListener('touchstart', handleTouchStart, { passive: true })
    mobileNavRef.value.addEventListener('touchmove', handleTouchMove, { passive: false })
    mobileNavRef.value.addEventListener('touchend', handleTouchEnd, { passive: true })
    mobileNavRef.value.addEventListener('touchcancel', handleTouchEnd, { passive: true })
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
    mobileNavRef.value.removeEventListener('touchstart', handleTouchStart)
    mobileNavRef.value.removeEventListener('touchmove', handleTouchMove)
    mobileNavRef.value.removeEventListener('touchend', handleTouchEnd)
    mobileNavRef.value.removeEventListener('touchcancel', handleTouchEnd)
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
          class="relative flex flex-row items-center overflow-x-auto no-scrollbar gap-1.5 px-1 py-1 max-w-lg mx-auto touch-pan-y select-none"
          tabindex="-1"
        >
          <!-- Mobile Shared Sliding Selection Indicator -->
          <div
            class="absolute bg-zinc-950 dark:bg-white border border-zinc-950 dark:border-white shadow-xs pointer-events-none z-0"
            :style="{
              top: 0,
              left: 0,
              transform: mobileIndicatorTransform,
              width: `${mobileIndicatorStyle.width}px`,
              height: `${mobileIndicatorStyle.height}px`,
              opacity: mobileIndicatorStyle.opacity,
              borderRadius: isTouchDragging ? '9999px' : '0.75rem',
              transition: isTouchDragging
                ? 'border-radius 300ms cubic-bezier(0.16, 1, 0.3, 1)'
                : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1), width 260ms cubic-bezier(0.16, 1, 0.3, 1), height 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 150ms ease, border-radius 300ms cubic-bezier(0.16, 1, 0.3, 1)'
            }"
          />

          <!-- Mobile Category Buttons -->
          <button
            v-for="(item, index) in computedItems"
            :key="`mobile-${item.key}`"
            :ref="(el) => setMobileItemRef(el, index)"
            type="button"
            role="tab"
            :aria-selected="isItemActive(item)"
            class="relative flex flex-col items-center justify-center text-center flex-1 min-w-[4.25rem] py-1.5 px-2 rounded-xl transition-colors duration-200 select-none cursor-pointer z-10 bg-transparent shrink-0 focus-visible:outline-none"
            :class="[
              isVisualActive(item, index)
                ? 'text-white dark:text-zinc-950 font-bold'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
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
