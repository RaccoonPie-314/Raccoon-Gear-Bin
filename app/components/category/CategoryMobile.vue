<script setup lang="ts">
import type { CatalogCategory } from '~/types/catalog'
import type { CategoryItem } from '~/composables/useCategoryItems'
import { motion, useReducedMotion } from 'motion-v'
import { press, iconPop, dock, pulseScale } from '~/utils/motion'
import { hasKhmerText } from '~/utils/locale-script'

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

// The nav's accessible name is a harness selector string (`nav[aria-label="Mobile product categories"]`),
// so the English value of `mobileProductCategories` must stay byte-identical to it.
const { t } = useI18n()
const reduced = useReducedMotion()

// One-shot spring on the newly-active icon (Phase F). Pure decoration — nothing awaits it.
const popActiveIcon = () => {
  if (reduced.value) return
  const icon = mobileItemRefs.value[activeIndex.value]?.querySelector('svg')?.parentElement
  if (icon) pulseScale(icon, iconPop.keyframes, iconPop.ms)
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
// Swipe vs. drag-select on ONE horizontal axis, told apart by time. A quick flick scrolls the
// strip natively — `touch-pan-x` hands the horizontal gesture to the browser, which gives free
// finger-follow + momentum. Holding the finger still for LONG_PRESS_MS and then moving arms the
// tuned drag-select instead. Tap still selects through `@click`. Moving past the slop before the
// hold elapses disarms drag-select so the two never fight over the same swipe.
let longPressTimer: ReturnType<typeof setTimeout> | undefined
let longPressArmed = false
let touchScrolled = false
const LONG_PRESS_MS = 220
const MOVE_CANCEL_PX = 8

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

  // Edge auto-scroll: `touch-pan-y` keeps the browser from panning the bar horizontally, so before
  // this the only way to reach an off-screen category was to tap the last item (selection then
  // centres it). Dragging into a horizontal edge pans the bar, making every category reachable in
  // one gesture while leaving the tuned drag-select engine and indicator maths untouched.
  // touchmove-driven — no rAF timer to leak; upgrade to a timed loop only if hold-at-edge
  // continuous scrolling is actually wanted.
  const EDGE_ZONE = 40
  const MAX_EDGE_STEP = 34
  if (clientX > navRect.right - EDGE_ZONE) navEl.scrollLeft += Math.min(MAX_EDGE_STEP, clientX - (navRect.right - EDGE_ZONE))
  else if (clientX < navRect.left + EDGE_ZONE) navEl.scrollLeft -= Math.min(MAX_EDGE_STEP, (navRect.left + EDGE_ZONE) - clientX)

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

const armDragSelect = () => {
  // The hold elapsed with the finger still: grab the pill. Same offset rule the immediate drag
  // used — on the active item keep the pill under the finger, elsewhere centre it on the finger.
  if (!isTouchDown || !longPressArmed) return
  isTouchDragging.value = true
  const initialIndex = findMobileItemIndex(touchStartX)
  if (initialIndex === activeIndex.value && mobileNavRef.value) {
    const navRect = mobileNavRef.value.getBoundingClientRect()
    grabOffsetX = touchStartX - navRect.left + mobileNavRef.value.scrollLeft - mobileIndicatorStyle.value.left
  } else {
    grabOffsetX = mobileIndicatorStyle.value.width / 2
  }
  lastDragClientX = touchStartX
  updateMobileDragPosition(touchStartX)
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
  touchScrolled = false
  isTouchDragging.value = false
  longPressArmed = true
  clearTimeout(longPressTimer)
  longPressTimer = setTimeout(armDragSelect, LONG_PRESS_MS)
}

const handleTouchMove = (event: TouchEvent) => {
  if (!isTouchDown || event.touches.length !== 1) return
  const touch = event.touches[0]
  if (!touch) return

  // Drag-select already owns the gesture: stop the browser scrolling and move the pill.
  if (isTouchDragging.value) {
    longPressArmed = false
    if (event.cancelable) event.preventDefault()
    updateMobileDragPosition(touch.clientX)
    return
  }

  // Still deciding. A move past the slop before the hold elapsed means this is a scroll (or a
  // vertical page scroll) — disarm drag-select and let the browser own the gesture natively.
  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY
  if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) {
    longPressArmed = false
    clearTimeout(longPressTimer)
    if (Math.abs(dx) > Math.abs(dy)) touchScrolled = true
  }
}

const handleTouchEnd = () => {
  clearTimeout(longPressTimer)
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
  } else if (touchScrolled) {
    // A native scroll's trailing click must not read as a select.
    dragJustFinished = true
    setTimeout(() => {
      dragJustFinished = false
    }, 80)
  }
  isTouchDown = false
  longPressArmed = false
  touchScrolled = false
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
  // While a drag owns the pill, this writer stands down — it aims at the *active* item, and the drag
  // has moved the pill away from it on purpose.
  //
  // The edge auto-scroll makes this the difference between a glide and a flicker: panning the bar
  // writes `scrollLeft`, every `scrollLeft` change fires the `scroll` listener below, and this
  // function used to answer it by re-measuring the active item's box. So the moment a drag reached
  // the end of the list and started panning, the pill alternated at touch frequency between the
  // finger and the active item — measured as a 264px retreat in one frame, on a transform still
  // scaled 1.6 by the drag. `handleTouchEnd` re-aims the pill itself once the finger lifts, and
  // `watch(activeIndex)` keeps it there, so nothing waits on these frames.
  if (isTouchDragging.value) return

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
  // Reduced motion still has to follow the selection — it just must not travel there.
  navEl.scrollTo({ left: targetScrollLeft, behavior: reduced.value ? 'auto' : 'smooth' })
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
  clearTimeout(longPressTimer)
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
      <div data-site-dock class="pointer-events-auto bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl backdrop-saturate-150 border-t border-white/50 dark:border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_-12px_32px_-14px_rgba(0,0,0,0.3)] px-2 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        <nav
          ref="mobileNavRef"
          :aria-label="t('mobileProductCategories')"
          class="relative flex flex-row items-center overflow-x-auto no-scrollbar gap-1.5 px-1 py-1 max-w-lg mx-auto touch-pan-x select-none"
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

          <!-- Keyed on `item.value` (the row id, or `all`) rather than `item.key`, which is the glyph
               name: two categories without a bespoke glyph share one key. See the same note in
               CategoryDesktop.vue — the buttons do render, the undefined part is a keyed diff on a
               list that changes length without a remount. -->
          <motion.button
            v-for="(item, index) in computedItems"
            :key="`mobile-${item.value}`"
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
              class="text-[10px] font-bold leading-tight text-center truncate max-w-[4.5rem] transition-colors duration-200"
              :class="hasKhmerText(item.name) ? '' : 'tracking-tight'"
            >
              {{ item.name }}
            </span>
          </motion.button>
        </nav>
      </div>
    </motion.div>
  </Teleport>
</template>
