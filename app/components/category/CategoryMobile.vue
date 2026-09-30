<script setup lang="ts">
import type { CatalogCategory } from '~/types/catalog'
import type { CategoryItem } from '~/composables/useCategoryItems'
import { motion, animate, useReducedMotion } from 'motion-v'
import { press, iconPop, dock } from '~/utils/motion'

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

// Item model, active matching and selection toggling are shared with the desktop dock;
// everything below this line is mobile-only touch behaviour.
const { computedItems, isItemActive, activeIndex, nextSelection } = useCategoryItems(props)

const reduced = useReducedMotion()

// One-shot spring on the newly-active icon (Phase F). Pure decoration — nothing awaits it.
const popActiveIcon = () => {
  if (reduced.value) return
  const icon = mobileItemRefs.value[activeIndex.value]?.querySelector('svg')?.parentElement
  if (icon) animate(icon, { scale: [...iconPop.keyframes] }, iconPop.transition)
}

const handleSelect = (item: CategoryItem) => {
  if (dragJustFinished) return
  emit('update:modelValue', nextSelection(item))
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

const isVisualActive = (item: CategoryItem, index: number) => {
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
// Hide/show follows the shared scroll-direction rule; translating the bar is mobile-only.
const { visible: isMobileNavVisible } = useScrollReveal()

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
// Lifecycle & Observers
// ==========================================
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  nextTick(() => {
    updateMobileIndicator()
  })

  window.addEventListener('resize', updateMobileIndicator)

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
    popActiveIcon()
  })
})

watch(computedItems, () => {
  nextTick(updateMobileIndicator)
})
</script>

<template>
  <Teleport to="body">
    <motion.div
      class="fixed bottom-0 inset-x-0 z-40 lg:hidden pointer-events-none"
      :initial="false"
      :animate="{ y: isMobileNavVisible ? '0%' : '125%' }"
      :transition="reduced ? { duration: 0 } : dock.transition"
    >
      <div class="pointer-events-auto bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl backdrop-saturate-150 border-t border-white/50 dark:border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_-12px_32px_-14px_rgba(0,0,0,0.3)] px-2 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
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
              borderRadius: '9999px',
              transition: isTouchDragging
                ? 'border-radius 300ms cubic-bezier(0.16, 1, 0.3, 1)'
                : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1), width 260ms cubic-bezier(0.16, 1, 0.3, 1), height 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 150ms ease, border-radius 300ms cubic-bezier(0.16, 1, 0.3, 1)'
            }"
          />

          <!-- Mobile Category Buttons -->
          <motion.button
            v-for="(item, index) in computedItems"
            :key="`mobile-${item.key}`"
            :ref="(el) => setMobileItemRef(el, index)"
            type="button"
            role="tab"
            :aria-selected="isItemActive(item)"
            :while-press="reduced || isTouchDragging ? undefined : { scale: press.scale }"
            :transition="press.transition"
            class="relative flex flex-col items-center justify-center text-center flex-1 min-w-[4.25rem] py-1.5 px-2 rounded-full transition-colors duration-200 select-none cursor-pointer z-10 bg-transparent shrink-0 focus-visible:outline-none"
            :class="[
              isVisualActive(item, index)
                ? 'text-white dark:text-zinc-950 font-bold'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
            ]"
            @click="handleSelect(item)"
          >
            <div class="flex items-center justify-center h-5 w-5 mb-0.5 shrink-0">
              <CategoryIcon
                :name="item.key"
                class="h-4.5 w-4.5 shrink-0 transition-colors duration-200"
              />
            </div>

            <span
              class="text-[10px] font-bold leading-tight tracking-tight text-center truncate max-w-[4.5rem] transition-colors duration-200"
            >
              {{ item.name }}
            </span>
          </motion.button>
        </nav>
      </div>
    </motion.div>
  </Teleport>
</template>
