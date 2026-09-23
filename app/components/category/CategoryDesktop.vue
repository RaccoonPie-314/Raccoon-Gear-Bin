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
// Desktop: Dock Magnification & Drag-to-Select
// ==========================================
const desktopNavRef = ref<HTMLElement | null>(null)
const desktopItemRefs = ref<(HTMLElement | null)[]>([])
const mousePos = ref<{ x: number; y: number } | null>(null)

const isDragging = ref(false)
const dragHighlightIndex = ref<number | null>(null)
const dragStretch = ref(0)
let isMouseDown = false
let dragStartY = 0
let grabOffsetY = 0
let lastDragClientY = 0
let dragVelocityY = 0
let dragJustFinished = false
let dragRafId: number | null = null

const isVisualActive = (item: ReturnType<typeof computedItems.value>[number], index: number) => {
  if (isDragging.value && dragHighlightIndex.value !== null) {
    return index === dragHighlightIndex.value
  }
  return isItemActive(item)
}

const findDesktopItemIndex = (clientY: number) => {
  if (!desktopItemRefs.value.length) return -1

  for (let i = 0; i < desktopItemRefs.value.length; i++) {
    const el = desktopItemRefs.value[i]
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return i
    }
  }

  // Gap between item i and i+1
  for (let i = 0; i < desktopItemRefs.value.length - 1; i++) {
    const el1 = desktopItemRefs.value[i]
    const el2 = desktopItemRefs.value[i + 1]
    if (el1 && el2) {
      const r1 = el1.getBoundingClientRect()
      const r2 = el2.getBoundingClientRect()
      if (clientY > r1.bottom && clientY < r2.top) {
        return clientY - r1.bottom < r2.top - clientY ? i : i + 1
      }
    }
  }

  const firstRect = desktopItemRefs.value[0]?.getBoundingClientRect()
  const lastRect = desktopItemRefs.value[desktopItemRefs.value.length - 1]?.getBoundingClientRect()
  if (firstRect && clientY < firstRect.top) return 0
  if (lastRect && clientY > lastRect.bottom) return desktopItemRefs.value.length - 1

  return -1
}

const updateDragPosition = (clientY: number) => {
  if (!isDragging.value || !desktopNavRef.value) return
  const navRect = desktopNavRef.value.getBoundingClientRect()
  const rawTop = clientY - navRect.top - grabOffsetY
  const minTop = desktopItemRefs.value[0]?.offsetTop ?? 0
  const lastIndex = desktopItemRefs.value.length - 1
  const maxTop = desktopItemRefs.value[lastIndex]?.offsetTop ?? 0
  const clampedTop = Math.max(minTop, Math.min(maxTop, rawTop))

  desktopIndicatorStyle.value.top = clampedTop

  const deltaY = clientY - lastDragClientY
  lastDragClientY = clientY
  dragVelocityY = dragVelocityY * 0.6 + deltaY * 0.4
  dragStretch.value = Math.min(0.08, Math.abs(dragVelocityY) * 0.004)

  const index = findDesktopItemIndex(clientY)
  if (index !== -1) {
    dragHighlightIndex.value = index
    const el = desktopItemRefs.value[index]
    if (el) {
      desktopIndicatorStyle.value.width = el.offsetWidth
      desktopIndicatorStyle.value.height = el.offsetHeight
    }
  }
}

const handleMouseDown = (event: MouseEvent) => {
  if (event.button !== 0) return
  isMouseDown = true
  isDragging.value = false
  dragStartY = event.clientY
  lastDragClientY = event.clientY
  dragVelocityY = 0
  dragStretch.value = 0

  window.addEventListener('mousemove', handleWindowMouseMove)
  window.addEventListener('mouseup', handleWindowMouseUp)
}

const handleWindowMouseMove = (event: MouseEvent) => {
  mousePos.value = { x: event.clientX, y: event.clientY }

  if (!isMouseDown) return

  if (!isDragging.value) {
    if (Math.abs(event.clientY - dragStartY) > 4) {
      isDragging.value = true
      lastDragClientY = event.clientY
      const initialItemIndex = findDesktopItemIndex(dragStartY)
      if (initialItemIndex === activeIndex.value && desktopNavRef.value) {
        const navRect = desktopNavRef.value.getBoundingClientRect()
        grabOffsetY = dragStartY - navRect.top - desktopIndicatorStyle.value.top
      } else {
        grabOffsetY = desktopIndicatorStyle.value.height / 2
      }
    }
  }

  if (isDragging.value) {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId)
    }
    dragRafId = requestAnimationFrame(() => {
      updateDragPosition(event.clientY)
    })
  }
}

const handleWindowMouseUp = (event: MouseEvent) => {
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)

  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId)
    dragRafId = null
  }

  if (isDragging.value) {
    dragJustFinished = true
    setTimeout(() => {
      dragJustFinished = false
    }, 60)

    const targetIndex = dragHighlightIndex.value ?? findDesktopItemIndex(event.clientY)
    isDragging.value = false
    dragHighlightIndex.value = null
    dragStretch.value = 0
    dragVelocityY = 0

    if (targetIndex !== -1) {
      const targetItem = computedItems.value[targetIndex]
      if (targetItem) {
        emit('update:modelValue', targetItem.value)
      }
    }

    nextTick(() => {
      updateDesktopIndicator()
    })
  }

  isMouseDown = false

  if (desktopNavRef.value) {
    const rect = desktopNavRef.value.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      mousePos.value = null
    }
  }
}

const setDesktopItemRef = (el: any, index: number) => {
  if (el) {
    desktopItemRefs.value[index] = (el as any).$el || el
  }
}

const handleMouseMove = (event: MouseEvent) => {
  mousePos.value = { x: event.clientX, y: event.clientY }
}

const handleMouseLeave = () => {
  if (!isMouseDown) {
    mousePos.value = null
  }
}

const getDesktopItemScale = (index: number) => {
  if (!mousePos.value || !desktopItemRefs.value[index]) return 1

  const rect = desktopItemRefs.value[index]!.getBoundingClientRect()
  const itemCenterX = rect.left + rect.width / 2
  const itemCenterY = rect.top + rect.height / 2

  const dx = mousePos.value.x - itemCenterX
  const dy = mousePos.value.y - itemCenterY
  const distance = Math.sqrt(dx * dx + dy * dy)

  const maxDistance = 120
  if (distance > maxDistance) return 1

  const normDist = distance / maxDistance
  const factor = 0.5 * (1 + Math.cos(normDist * Math.PI))

  const maxScale = 0.15
  return 1 + factor * maxScale
}

const getDesktopItemZIndex = (index: number) => {
  const isActive = index === activeIndex.value
  const baseZ = isActive ? 25 : 10

  if (!mousePos.value || !desktopItemRefs.value[index]) return baseZ

  const rect = desktopItemRefs.value[index]!.getBoundingClientRect()
  const itemCenterX = rect.left + rect.width / 2
  const itemCenterY = rect.top + rect.height / 2

  const dx = mousePos.value.x - itemCenterX
  const dy = mousePos.value.y - itemCenterY
  const distance = Math.sqrt(dx * dx + dy * dy)

  const maxDistance = 140
  if (distance > maxDistance) return baseZ

  // Scale z-index inversely with distance (closer to cursor = higher z-index, up to +30)
  const normDist = distance / maxDistance
  const boost = Math.round((1 - normDist) * 30)

  return baseZ + boost
}

// ==========================================
// Desktop: Sliding Selection Indicator
// ==========================================
const desktopIndicatorStyle = ref({
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  opacity: 0
})

const updateDesktopIndicator = () => {
  const activeEl = desktopItemRefs.value[activeIndex.value]
  const navEl = desktopNavRef.value
  if (!activeEl || !navEl) return

  // Measure unscaled layout position relative to desktopNavRef
  let top = 0
  let left = 0
  let curr: HTMLElement | null = activeEl

  while (curr && curr !== navEl) {
    top += curr.offsetTop
    left += curr.offsetLeft
    curr = curr.offsetParent as HTMLElement | null
  }

  desktopIndicatorStyle.value = {
    left,
    top,
    width: activeEl.offsetWidth,
    height: activeEl.offsetHeight,
    opacity: 1
  }
}

const desktopIndicatorTransform = computed(() => {
  const baseScale = getDesktopItemScale(isDragging.value ? (dragHighlightIndex.value ?? activeIndex.value) : activeIndex.value)
  if (isDragging.value) {
    const enlargedScale = (baseScale * 1.1).toFixed(4)
    return `translate3d(${desktopIndicatorStyle.value.left}px, ${desktopIndicatorStyle.value.top}px, 0px) scale(${enlargedScale}, ${enlargedScale})`
  }
  return `translate3d(${desktopIndicatorStyle.value.left}px, ${desktopIndicatorStyle.value.top}px, 0px) scale(${baseScale})`
})

// ==========================================
// Lifecycle & Observers
// ==========================================
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  nextTick(() => {
    updateDesktopIndicator()
  })

  window.addEventListener('resize', updateDesktopIndicator)

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      updateDesktopIndicator()
    })

    if (desktopNavRef.value) resizeObserver.observe(desktopNavRef.value)

    desktopItemRefs.value.forEach((el) => {
      if (el) resizeObserver?.observe(el)
    })
  }

  if (typeof document !== 'undefined' && (document as any).fonts) {
    ;(document as any).fonts.ready.then(() => {
      updateDesktopIndicator()
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', updateDesktopIndicator)
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

watch(activeIndex, () => {
  nextTick(() => {
    updateDesktopIndicator()
  })
})

watch(computedItems, () => {
  nextTick(updateDesktopIndicator)
})
</script>

<template>
  <nav
    ref="desktopNavRef"
    aria-label="Product categories"
    class="relative flex flex-col gap-2.5 overflow-visible py-1 select-none"
    tabindex="-1"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
    @mousedown="handleMouseDown"
    @dragstart.prevent
  >
    <!-- Desktop Shared Sliding Selection Indicator -->
    <div
      class="absolute bg-zinc-950 dark:bg-white shadow-xs pointer-events-none z-0 origin-center"
      :style="{
        top: 0,
        left: 0,
        transform: desktopIndicatorTransform,
        width: `${desktopIndicatorStyle.width}px`,
        height: `${desktopIndicatorStyle.height}px`,
        opacity: desktopIndicatorStyle.opacity,
        borderRadius: isDragging ? '9999px' : '0.75rem',
        transition: isDragging
          ? 'border-radius 600ms cubic-bezier(0.16, 1, 0.3, 1)'
          : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1), width 260ms cubic-bezier(0.16, 1, 0.3, 1), height 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 150ms ease, border-radius 400ms cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: 'transform'
      }"
    />

    <!-- Desktop Category Buttons -->
    <button
      v-for="(item, index) in computedItems"
      :key="`desktop-${item.key}`"
      :ref="(el) => setDesktopItemRef(el, index)"
      type="button"
      role="tab"
      :aria-selected="isItemActive(item)"
      class="relative flex flex-col items-center justify-center w-full rounded-xl select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-white bg-transparent"
      :class="[
        !isVisualActive(item, index)
          ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
          : ''
      ]"
      :style="{ zIndex: getDesktopItemZIndex(index) }"
      @click="handleSelect(item)"
    >
      <!-- Inner visual wrapper -->
      <div
        class="flex flex-col items-center justify-center w-full py-2 px-2.5 lg:px-3 rounded-xl transition-colors duration-200 origin-center"
        :class="[
          isVisualActive(item, index)
            ? 'text-white dark:text-zinc-950 font-bold'
            : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
        ]"
        :style="{
          transform: `scale(${getDesktopItemScale(index)})`,
          transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform'
        }"
      >
        <div class="flex items-center justify-center h-5 w-5 sm:h-5.5 sm:w-5.5 mb-1 shrink-0">
          <!-- All Gear Icon -->
          <svg
            v-if="item.key === 'all'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0 transition-colors duration-200"
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
            class="h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0 transition-colors duration-200"
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
            class="h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0 transition-colors duration-200"
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
            class="h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0 transition-colors duration-200"
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
            class="h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0 transition-colors duration-200"
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
            class="h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0 transition-colors duration-200"
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

        <!-- Category Name -->
        <span
          class="text-[10px] sm:text-[11px] lg:text-xs font-bold tracking-tight text-center truncate max-w-full leading-tight transition-colors duration-200"
        >
          {{ item.name }}
        </span>
      </div>
    </button>
  </nav>
</template>

