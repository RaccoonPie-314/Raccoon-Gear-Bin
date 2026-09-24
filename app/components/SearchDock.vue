<script setup lang="ts">
const searchQuery = defineModel<string>({ default: '' })

withDefaults(defineProps<{ resultCount?: number }>(), { resultCount: 0 })

const { t } = useI18n()

// The icon only takes over once the real search field has scrolled away, so the two never share the screen.
const SEARCH_FIELD_SELECTOR = '[data-search-anchor]'
const FIELD_GONE_AT = 0
const FIELD_BACK_AT = 24
const DOCK_REVEAL_AT = 60
const DOCK_DIRECTION_DELTA = 6

const OPEN_MORPH_MS = 420
const CLOSE_MORPH_MS = 380
// Ease-out-expo spent 49% of the size change in the first 46ms, so the morph read as a snap.
// Ease-out-cubic spreads the same motion across the whole duration.
const MORPH_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'
const BACKDROP_IN_MS = 260
const BACKDROP_OUT_MS = 200
const CONTENT_IN_MS = 220
const CONTENT_OUT_MS = 140
const CONTENT_DELAY_MS = 150
const DESKTOP_QUERY = '(min-width: 1024px)'
const LAUNCHER_MOTION = 'opacity 300ms ease, transform 300ms cubic-bezier(0.22, 1, 0.36, 1)'
const SCROLL_KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'])

const isCollapsed = ref(false)
const isDockVisible = ref(true)

const overlayMounted = ref(false)
const overlayActive = ref(false)
const overlayClosing = ref(false)
const launcherTaken = ref(false)
const suppressLauncherMotion = ref(false)
const morphing = ref(false)

const backdropOpacity = ref(0)
const backdropTransition = ref(`opacity ${BACKDROP_IN_MS}ms ease`)
const contentOpacity = ref(0)
const contentTransition = ref(`opacity ${CONTENT_IN_MS}ms ease ${CONTENT_DELAY_MS}ms`)
const panelOpacity = ref(1)
const panelTransform = ref('none')
const panelTransition = ref('none')
const panelRadius = ref('')
const flyerTransform = ref('none')
const flyerTransition = ref('none')
const flyerBox = ref<{ left: string, top: string, size: string } | null>(null)

const desktopLauncherRef = ref<HTMLButtonElement | null>(null)
const mobileLauncherRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const overlayInputRef = ref<HTMLInputElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
const realGlyphRef = ref<HTMLElement | null>(null)

const panelStartTransform = ref('none')
const flyerStartTransform = ref('none')
const flyerColor = ref('')

let searchFieldEl: HTMLElement | null = null
let launcherGlyphColor = ''
let panelGlyphColor = ''
let collapsedRadius = ''
let restingRadius = ''
let originClickEvent: Event | null = null
let openTimer: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let settleOn: 'open' | 'close' | null = null
let restoreFrame = 0
let scrollTicking = false
let lastScrollY = 0
let scrollLocked = false
let lockedScrollY = 0

const desktopLauncherStyle = computed(() => ({
  opacity: isCollapsed.value && !launcherTaken.value ? 1 : 0,
  transform: isCollapsed.value && !launcherTaken.value ? 'scale(1)' : 'scale(0.92)',
  transition: launcherTaken.value || suppressLauncherMotion.value ? 'none' : LAUNCHER_MOTION,
  pointerEvents: isCollapsed.value && !launcherTaken.value ? 'auto' : 'none'
}))

const mobileLauncherStyle = computed(() => {
  const visible = isCollapsed.value && isDockVisible.value && !launcherTaken.value
  return {
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0px) scale(1)' : 'translateY(18px) scale(0.92)',
    transition: launcherTaken.value || suppressLauncherMotion.value ? 'none' : LAUNCHER_MOTION,
    pointerEvents: visible ? 'auto' : 'none'
  }
})

const readScrollY = () => window.scrollY || document.documentElement.scrollTop || 0

// Hysteresis on the field's own position: it must clear the top edge to collapse, and return 24px to restore.
const searchField = () => {
  if (!searchFieldEl?.isConnected) searchFieldEl = document.querySelector<HTMLElement>(SEARCH_FIELD_SELECTOR)
  return searchFieldEl
}

const fieldIsOffScreen = () => {
  const field = searchField()
  if (!field) return false
  const limit = isCollapsed.value ? FIELD_BACK_AT : FIELD_GONE_AT
  return field.getBoundingClientRect().bottom <= limit
}

const handleScroll = () => {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(() => {
    const currentY = readScrollY()
    isCollapsed.value = fieldIsOffScreen()

    if (currentY < DOCK_REVEAL_AT) {
      isDockVisible.value = true
    } else {
      const delta = currentY - lastScrollY
      if (delta > DOCK_DIRECTION_DELTA) isDockVisible.value = false
      else if (delta < -DOCK_DIRECTION_DELTA) isDockVisible.value = true
    }

    lastScrollY = Math.max(0, currentY)
    scrollTicking = false
  })
}

const activeLauncherEl = () => {
  if (typeof window === 'undefined') return null
  return window.matchMedia(DESKTOP_QUERY).matches ? desktopLauncherRef.value : mobileLauncherRef.value
}

// During a morph the panel reports its *transformed* box, and neutralising it through refs
// cannot flush before the read. Instead invert the panel's own matrix: origin is top left, so
// screen = layout + translate and size * scale.
const toLayoutRect = (rect: DOMRect, panelRect: DOMRect, m: DOMMatrix) => ({
  left: panelRect.left - m.e + (rect.left - panelRect.left) / m.a,
  top: panelRect.top - m.f + (rect.top - panelRect.top) / m.d,
  width: rect.width / m.a,
  height: rect.height / m.d
})

const measureScene = () => {
  const panel = panelRef.value
  const glyph = realGlyphRef.value
  if (!panel || !glyph) return null

  const panelRect = panel.getBoundingClientRect()
  const computed = getComputedStyle(panel).transform
  const m = computed === 'none' ? new DOMMatrix() : new DOMMatrix(computed)
  const glyphRect = toLayoutRect(glyph.getBoundingClientRect(), panelRect, m)
  panelGlyphColor = getComputedStyle(glyph).color

  return {
    panelRect: toLayoutRect(panelRect, panelRect, m),
    glyphRect
  }
}

const captureScene = (launcherEl: HTMLElement) => {
  const scene = measureScene()
  if (!scene) return false

  // The launcher is scaled down while the overlay owns its slot, so measure its resting box instead.
  const previousTransform = launcherEl.style.transform
  const previousTransition = launcherEl.style.transition
  launcherEl.style.transition = 'none'
  launcherEl.style.transform = 'none'

  const launcherRect = launcherEl.getBoundingClientRect()
  const launcherGlyph = launcherEl.querySelector('svg')
  const launcherGlyphRect = launcherGlyph?.getBoundingClientRect() ?? launcherRect
  launcherGlyphColor = launcherGlyph ? getComputedStyle(launcherGlyph).color : ''

  launcherEl.style.transform = previousTransform
  launcherEl.style.transition = previousTransition
  if (!launcherRect.width || !scene.panelRect.width || !scene.glyphRect.width) return false

  panelStartTransform.value = `translate3d(${launcherRect.left - scene.panelRect.left}px, ${launcherRect.top - scene.panelRect.top}px, 0) scale(${launcherRect.width / scene.panelRect.width}, ${launcherRect.height / scene.panelRect.height})`
  flyerStartTransform.value = `translate3d(${launcherGlyphRect.left + launcherGlyphRect.width / 2 - (scene.glyphRect.left + scene.glyphRect.width / 2)}px, ${launcherGlyphRect.top + launcherGlyphRect.height / 2 - (scene.glyphRect.top + scene.glyphRect.height / 2)}px, 0) scale(${launcherGlyphRect.width / scene.glyphRect.width})`
  flyerBox.value = { left: `${scene.glyphRect.left}px`, top: `${scene.glyphRect.top}px`, size: `${scene.glyphRect.width}px` }

  // A non-uniform scale squashes `rounded-full` into a rounded rectangle, so the radii are
  // pre-compensated per axis: the pill stays a pill and the icon lands on a true circle.
  const screenRadius = Math.min(launcherRect.width, launcherRect.height) / 2
  collapsedRadius = `${screenRadius * scene.panelRect.width / launcherRect.width}px / ${screenRadius * scene.panelRect.height / launcherRect.height}px`
  restingRadius = `${scene.panelRect.height / 2}px`

  return true
}

const blockScroll = (event: WheelEvent) => {
  event.preventDefault()
}

const keepScrollPosition = () => {
  const y = readScrollY()
  if (Math.abs(y - lockedScrollY) < 1) return
  // The stylesheet asks for smooth scrolling, which would turn this snap-back into a feedback loop.
  window.scrollTo({ top: lockedScrollY, left: 0, behavior: 'instant' })
}

// Blocking the scroll events instead of toggling `overflow: hidden` keeps the sticky sidebar stuck,
// so the launcher never moves while the overlay owns the screen.
const lockScroll = () => {
  if (scrollLocked) return
  scrollLocked = true
  lockedScrollY = readScrollY()
  window.addEventListener('wheel', blockScroll, { passive: false })
  window.addEventListener('touchmove', handleTouchMove, { passive: false })
  window.addEventListener('scroll', keepScrollPosition)
}

const unlockScroll = () => {
  if (!scrollLocked) return
  scrollLocked = false
  window.removeEventListener('wheel', blockScroll)
  window.removeEventListener('touchmove', handleTouchMove)
  window.removeEventListener('scroll', keepScrollPosition)
}

const focusOverlayInput = () => {
  overlayInputRef.value?.focus({ preventScroll: true })
}

const finishOpen = () => {
  if (openTimer) { clearTimeout(openTimer); openTimer = null }
  if (settleOn === 'open') settleOn = null
  if (overlayClosing.value || !morphing.value) return
  morphing.value = false
}

// Whichever morph armed the token gets to settle; an interrupted morph never reports in.
const onMorphSettled = (event: TransitionEvent) => {
  if (event.target !== panelRef.value || event.propertyName !== 'transform') return
  if (settleOn === 'close') finishClose()
  else if (settleOn === 'open') finishOpen()
}

const isInsidePanel = (node: EventTarget | null) => {
  const panel = panelRef.value
  return !!panel && node instanceof Node && panel.contains(node)
}

// Outside clicks must reach the page (so listings still open) while the overlay dismisses itself.
const handleDocumentClick = (event: MouseEvent) => {
  if (event === originClickEvent || overlayClosing.value) return
  if (isInsidePanel(event.target)) return
  void closeOverlay()
}

const handleTouchMove = (event: TouchEvent) => {
  if (isInsidePanel(event.target)) return
  event.preventDefault()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeOverlay()
    return
  }
  // The page cannot scroll by events any more, but a focused button would still act on these.
  if (event.target !== overlayInputRef.value && SCROLL_KEYS.has(event.key)) event.preventDefault()
  if (event.key !== 'Tab') return

  const focusables = [overlayInputRef.value, closeButtonRef.value].filter(Boolean) as HTMLElement[]
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (!first || !last) return

  const active = document.activeElement as HTMLElement | null
  if (!active || !focusables.includes(active)) {
    event.preventDefault()
    first.focus()
    return
  }
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

const openOverlay = async (event: MouseEvent) => {
  if (overlayMounted.value) return
  const launcherEl = event.currentTarget as HTMLElement | null
  if (!launcherEl) return

  originClickEvent = event
  overlayMounted.value = true
  overlayActive.value = false
  overlayClosing.value = false
  morphing.value = true
  panelOpacity.value = 1
  panelTransform.value = 'none'
  panelTransition.value = 'none'
  panelRadius.value = ''
  flyerTransform.value = 'none'
  flyerTransition.value = 'none'
  backdropOpacity.value = 0
  backdropTransition.value = `opacity ${BACKDROP_IN_MS}ms ease`
  contentOpacity.value = 0
  contentTransition.value = `opacity ${CONTENT_IN_MS}ms ease ${CONTENT_DELAY_MS}ms`

  lockScroll()
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleDocumentClick)

  await nextTick()
  if (overlayClosing.value) return

  if (!captureScene(launcherEl)) {
    overlayActive.value = true
    launcherTaken.value = true
    morphing.value = false
    panelRadius.value = ''
    backdropOpacity.value = 1
    contentOpacity.value = 1
    focusOverlayInput()
    return
  }

  // Start from the launcher's exact pixels: the pill and glyph take over the icon's place.
  panelTransform.value = panelStartTransform.value
  panelRadius.value = collapsedRadius
  flyerTransform.value = flyerStartTransform.value
  flyerColor.value = launcherGlyphColor
  overlayActive.value = true
  launcherTaken.value = true

  await nextTick()
  if (overlayClosing.value) return
  focusOverlayInput()

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!overlayMounted.value || overlayClosing.value) return
    panelTransition.value = `transform ${OPEN_MORPH_MS}ms ${MORPH_EASE}, border-radius ${OPEN_MORPH_MS}ms ${MORPH_EASE}`
    panelTransform.value = 'translate3d(0px, 0px, 0) scale(1, 1)'
    panelRadius.value = restingRadius
    flyerTransition.value = `transform ${OPEN_MORPH_MS}ms ${MORPH_EASE}, color ${OPEN_MORPH_MS}ms ${MORPH_EASE}`
    flyerTransform.value = 'translate3d(0px, 0px, 0) scale(1)'
    flyerColor.value = panelGlyphColor
    backdropOpacity.value = 1
    contentOpacity.value = 1
    settleOn = 'open'
    openTimer = setTimeout(finishOpen, OPEN_MORPH_MS + 120)
  }))
}

const finishClose = () => {
  if (!overlayMounted.value) return
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  settleOn = null
  overlayMounted.value = false
  overlayActive.value = false
  overlayClosing.value = false
  morphing.value = false
  suppressLauncherMotion.value = true
  launcherTaken.value = false
  unlockScroll()
  restoreFrame = requestAnimationFrame(() => requestAnimationFrame(() => {
    suppressLauncherMotion.value = false
    restoreFrame = 0
  }))
}

const closeOverlay = async () => {
  if (!overlayMounted.value || overlayClosing.value) return
  overlayClosing.value = true
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
  originClickEvent = null
  if (openTimer) { clearTimeout(openTimer); openTimer = null }

  contentTransition.value = `opacity ${CONTENT_OUT_MS}ms ease`
  contentOpacity.value = 0
  backdropTransition.value = `opacity ${BACKDROP_OUT_MS}ms ease`
  backdropOpacity.value = 0

  const launcherEl = activeLauncherEl()
  const launcherRect = launcherEl?.getBoundingClientRect()

  if (!launcherEl || !launcherRect?.width || !captureScene(launcherEl)) {
    panelTransition.value = `transform ${CLOSE_MORPH_MS}ms ${MORPH_EASE}, opacity ${CONTENT_OUT_MS}ms ease`
    panelTransform.value = 'translate3d(0px, 0px, 0) scale(0.97, 0.97)'
    panelRadius.value = ''
    panelOpacity.value = 0
    settleOn = 'close'
    closeTimer = setTimeout(finishClose, CLOSE_MORPH_MS + 120)
    return
  }

  // Mid-flight the flyer already has its own transition running; resetting it would teleport the glyph.
  const wasMorphing = morphing.value
  morphing.value = true
  if (!wasMorphing) {
    flyerTransition.value = 'none'
    flyerTransform.value = 'translate3d(0px, 0px, 0) scale(1)'
    flyerColor.value = panelGlyphColor
  }

  await nextTick()
  if (!overlayMounted.value) return

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!overlayMounted.value) return
    panelTransition.value = `transform ${CLOSE_MORPH_MS}ms ${MORPH_EASE}, border-radius ${CLOSE_MORPH_MS}ms ${MORPH_EASE}`
    panelTransform.value = panelStartTransform.value
    panelRadius.value = collapsedRadius
    flyerTransition.value = `transform ${CLOSE_MORPH_MS}ms ${MORPH_EASE}, color ${CLOSE_MORPH_MS}ms ${MORPH_EASE}`
    flyerTransform.value = flyerStartTransform.value
    flyerColor.value = launcherGlyphColor
    settleOn = 'close'
    closeTimer = setTimeout(finishClose, CLOSE_MORPH_MS + 120)
  }))
}

const handleResize = () => {
  if (!overlayMounted.value) return
  const launcherEl = activeLauncherEl()
  if (!launcherEl || !launcherEl.getBoundingClientRect().width) return
  captureScene(launcherEl)
}

onMounted(() => {
  lastScrollY = readScrollY()
  handleScroll()
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
  if (openTimer) clearTimeout(openTimer)
  if (closeTimer) clearTimeout(closeTimer)
  if (restoreFrame) cancelAnimationFrame(restoreFrame)
  unlockScroll()
})
</script>

<template>
  <!-- Desktop: collapsed icon alongside the sticky category navigation -->
  <div class="pointer-events-none absolute inset-x-0 top-full hidden justify-center pt-6 lg:flex">
    <button
      ref="desktopLauncherRef"
      type="button"
      class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-zinc-200/80 bg-white text-zinc-950 shadow-xs transition-colors duration-200 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-800/80 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950"
      :style="desktopLauncherStyle"
      :aria-label="t('searchCatalog')"
      :aria-expanded="overlayMounted"
      aria-haspopup="dialog"
      @click="openOverlay"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-5 w-5"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  </div>

  <!-- Mobile: collapsed icon alongside the fixed bottom category navigation -->
  <Teleport to="body">
    <button
      ref="mobileLauncherRef"
      type="button"
      class="fixed right-4 bottom-[calc(5.25rem_+_env(safe-area-inset-bottom))] z-40 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-zinc-200/80 bg-white/95 text-zinc-950 shadow-xs backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 lg:hidden dark:border-zinc-800/80 dark:bg-zinc-950/95 dark:text-white dark:focus-visible:ring-white"
      :style="mobileLauncherStyle"
      :aria-label="t('searchCatalog')"
      :aria-expanded="overlayMounted"
      aria-haspopup="dialog"
      @click="openOverlay"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-5 w-5"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  </Teleport>

  <!-- Search interface -->
  <Teleport to="body">
    <div
      v-if="overlayMounted"
      class="pointer-events-none fixed inset-0 z-[60]"
      :style="{ opacity: overlayActive ? 1 : 0 }"
      role="dialog"
      aria-modal="true"
      :aria-label="t('searchProducts')"
    >
      <div
        class="absolute inset-0 bg-white/70 dark:bg-zinc-950/70"
        :style="{ opacity: backdropOpacity, transition: backdropTransition }"
      />

      <div class="pointer-events-none relative flex h-full flex-col items-center justify-start px-4 pt-[14vh]">
        <div
          ref="panelRef"
          class="pointer-events-auto flex h-14 w-full max-w-xl origin-top-left items-center gap-3 rounded-full border border-zinc-200/80 bg-white shadow-xs pr-2 pl-5 dark:border-zinc-800/80 dark:bg-zinc-900"
          :style="{ transform: panelTransform, transition: panelTransition, borderRadius: panelRadius, opacity: panelOpacity, willChange: 'transform' }"
          @transitionend="onMorphSettled"
        >
          <span
            ref="realGlyphRef"
            class="flex h-5 w-5 shrink-0 items-center justify-center text-zinc-400 dark:text-zinc-500"
            :style="{ opacity: morphing ? 0 : 1 }"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-5 w-5"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>

          <input
            ref="overlayInputRef"
            v-model="searchQuery"
            type="text"
            autocomplete="off"
            enterkeyhint="search"
            :spellcheck="false"
            :placeholder="t('searchCatalog')"
            class="h-full w-full min-w-0 border-0 bg-transparent p-0 text-base font-medium text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-white dark:placeholder:text-zinc-500"
            :style="{ opacity: contentOpacity, transition: contentTransition }"
          >

          <button
            ref="closeButtonRef"
            type="button"
            class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
            :style="{ opacity: contentOpacity, transition: contentTransition }"
            :aria-label="t('close')"
            :title="t('close')"
            @click="closeOverlay"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <p
          class="mt-4 text-[10px] font-bold tracking-[0.22em] text-zinc-400 uppercase tabular-nums dark:text-zinc-500"
          :style="{ opacity: contentOpacity, transition: contentTransition }"
        >
          {{ resultCount }} {{ resultCount === 1 ? 'item' : 'items' }}
        </p>
      </div>

      <!-- The launcher glyph in flight while the pill expands into the search field -->
      <span
        v-if="morphing && flyerBox"
        class="pointer-events-none fixed flex items-center justify-center"
        :style="{
          left: flyerBox.left,
          top: flyerBox.top,
          width: flyerBox.size,
          height: flyerBox.size,
          color: flyerColor,
          transform: flyerTransform,
          transition: flyerTransition
        }"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-full w-full"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
    </div>
  </Teleport>
</template>
