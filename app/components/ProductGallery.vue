<script setup lang="ts">
import type { CatalogImage } from '~/types/catalog'
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion-v'
import { lightbox as lightboxPreset } from '~/utils/motion'

const props = defineProps<{ images: CatalogImage[]; name: string }>()
const { t } = useI18n()
// Reactive prefers-reduced-motion (false during SSR, synced on mount) — one source for every
// softened duration here, replacing the per-call `matchMedia` reads.
const reduced = useReducedMotion()

// How many thumbs the strip shows at once. The strip renders exactly this many buttons no
// matter how large the photo set is, so a product with dozens of photos never grows the page.
const VISIBLE_COUNT = 5

const selectedIndex = ref(0)
const stripEl = ref<HTMLElement | null>(null)

const imageCount = computed(() => props.images.length)
const selectedImage = computed(() => props.images[selectedIndex.value])

// The strip window is derived from the selection so the selection always sits in the centre
// slot. Clamping at both ends is what makes the first/last photos rest at the edge instead of
// demanding impossible centring.
const windowStart = computed(() => {
  const max = Math.max(0, imageCount.value - VISIBLE_COUNT)
  return Math.min(Math.max(selectedIndex.value - Math.floor(VISIBLE_COUNT / 2), 0), max)
})
const windowImages = computed(() => props.images.slice(windowStart.value, windowStart.value + VISIBLE_COUNT))

// Which way the main photo (and, over it, the lightbox) should slide. Declared with the
// intent at the moment of navigation, before the index moves — reading the numeric delta
// afterwards is wrong exactly where wrapping lives (last → first is a *next* move whose
// numbers say "previous").
const transitionDirection = ref<'next' | 'previous'>('next')
const swapTransition = computed(() => `gallery-${transitionDirection.value}`)
// One swap cadence for the inline main photo (Motion) and, kept in sync, the lightbox CSS swap.
const swapDuration = computed(() => (reduced.value ? 0.15 : 0.22))

const select = (index: number) => {
  if (index === selectedIndex.value) return
  transitionDirection.value = index > selectedIndex.value ? 'next' : 'previous'
  selectedIndex.value = index
}

// Arrows wrap: previous from the first photo lands on the last and vice versa.
const step = (delta: number) => {
  if (imageCount.value < 2) return
  transitionDirection.value = delta > 0 ? 'next' : 'previous'
  selectedIndex.value = (selectedIndex.value + delta + imageCount.value) % imageCount.value
}

// SPA navigation between two detail pages reuses this component; a new product starts at
// its first photo, and its lightbox does not survive the swap.
watch(() => props.images, () => {
  selectedIndex.value = 0
  transitionDirection.value = 'next'
  resetZoom()
  isLightboxOpen.value = false
})

// The strip only ever holds the window, so an advance swaps the content rather than sliding
// it. Re-anchoring a one-step translateX onto the fresh content reads as the row moving one
// slot; it is transform-only (no layout jump) and always runs from ±step to none, so nothing
// accumulates across repeated advances. Post-flush, so the slide always starts on the freshly
// rendered window rather than the outgoing one. Reduced motion shortens the travel to two
// thirds of a slot over 170ms — restrained, not frozen.
watch(windowStart, (to, from) => {
  const strip = stripEl.value
  if (!strip || to === from || strip.children.length === 0) return
  const children = Array.from(strip.children) as HTMLElement[]
  const first = children[0]
  const second = children[1]
  const stepPx = first && second
    ? second.getBoundingClientRect().left - first.getBoundingClientRect().left
    : (first?.getBoundingClientRect().width ?? 0)
  if (!stepPx) return
  const travel = (to > from ? stepPx : -stepPx) * (reduced.value ? 0.66 : 1)
  // Motion owns this transform now (Phase D): same ±one-slot travel from the freshly rendered
  // window back to rest, same duration/ease, so the slide reads identically — but it is one motion
  // engine across the app instead of a lone WAAPI call.
  animate(strip, { x: [travel, 0] }, reduced.value
    ? { duration: 0.17, ease: 'easeOut' }
    : { duration: 0.24, ease: [0.33, 1, 0.68, 1] })
}, { flush: 'post' })

// Left/right arrows drive the selection while the gallery (or anything in it) has focus.
const onKeydown = (event: KeyboardEvent) => {
  if (imageCount.value < 2) return
  if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
  else if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
}

// ---- lightbox ----
// Deliberately has no index of its own: it renders `selectedImage`, the same derived value
// the main frame and the strip use. Opening it changes nothing, navigating inside it moves
// selectedIndex, so closing it leaves the normal gallery on the photo the lightbox was
// last showing — there is nothing to synchronise because there is one state.
const isLightboxOpen = ref(false)
const photoBtn = ref<HTMLElement | null>(null)
const lightboxCloseBtn = ref<HTMLElement | null>(null)
const dialogEl = ref<HTMLElement | null>(null)
const frameEl = ref<HTMLElement | null>(null)
const zoomControlEl = ref<HTMLElement | null>(null)
const lightboxImgEl = ref<HTMLImageElement | null>(null)

// ---- second-stage zoom: photo → lightbox → click the photo ----
// No separate control and no second modal: the enlarged photo *is* the zoom button, and the same
// `<img>` carries the transform, so the previous/next controls, the swap transition and the shared
// selection all keep working untouched. One step of magnification rather than a scroll-zoom
// continuum — the visitor came to inspect a detail, not to tune a scale — and it opens around the
// point they clicked: 2.5x is where a keyboard keycap or a stitch reads clearly at a phone's
// lightbox size while one pan still reaches every corner of the photo.
const ZOOM_SCALE = 2.5
const isZoomed = ref(false)
// Where the zoom is pinned, as a fraction of the element box `transform-origin` measures in — so a
// viewport resize cannot leave it pointing at a stale pixel. It is the click itself, which is what
// makes the clicked point stay under the pointer instead of sliding to the centre.
const anchor = ref({ x: 0.5, y: 0.5 })
const panX = ref(0)
const panY = ref(0)

/**
 * The picture's own box, in page coordinates, plus the frame it is letterboxed inside.
 *
 * The lightbox `<img>` is `object-contain` in a frame of a different aspect, so a portrait photo in a
 * wide window is banded left-and-right and a landscape one top-and-bottom — and the coordinates that
 * answer "what did they just click on" and "how far may this pan" belong to the picture, not to the
 * transparent box that centres it. Derived from the frame's rect (never transformed) and the image's
 * intrinsic ratio, so it is the rendered geometry at any viewport for any aspect ratio, at a click of
 * the pointer rather than a measurement per frame.
 */
const paintedBox = () => {
  const frame = frameEl.value
  if (!frame) return null
  const r = frame.getBoundingClientRect()
  const img = lightboxImgEl.value
  const ratio = img?.naturalWidth && img?.naturalHeight
    ? img.naturalWidth / img.naturalHeight
    : (r.width / r.height || 1)
  const width = Math.min(r.width, r.height * ratio)
  const height = width / ratio
  return {
    frameLeft: r.left,
    frameTop: r.top,
    frameWidth: r.width,
    frameHeight: r.height,
    left: r.left + (r.width - width) / 2,
    top: r.top + (r.height - height) / 2,
    width,
    height
  }
}

const zoomAt = (clientX: number, clientY: number) => {
  const box = paintedBox()
  if (!box) return false
  // Keep the anchor inside the picture: a click on the letterbox band around it should zoom into the
  // nearest part of the photo, not pin the magnification to empty space.
  const ax = Math.min(box.left + box.width, Math.max(box.left, clientX))
  const ay = Math.min(box.top + box.height, Math.max(box.top, clientY))
  anchor.value = { x: (ax - box.frameLeft) / box.frameWidth, y: (ay - box.frameTop) / box.frameHeight }
  // The resting pan is the *legal* zero, not the literal one: an anchor near the edge of a
  // letterboxed picture has less room on that side than on the other, and starting outside the range
  // would leave a band of bare backdrop at the clicked edge and snap the picture on the first drag.
  const rest = clampPan(0, 0)
  panX.value = rest.x
  panY.value = rest.y
  isZoomed.value = true
  return true
}

const resetZoom = () => {
  isZoomed.value = false
  anchor.value = { x: 0.5, y: 0.5 }
  panX.value = 0
  panY.value = 0
}

/** The one entry point for the zoom, from a pointer or from the keyboard. */
const toggleZoom = (clientX?: number, clientY?: number) => {
  if (isZoomed.value) resetZoom()
  else {
    const box = paintedBox()
    // No coordinates means the keyboard: the middle of the picture, so Enter on the control
    // magnifies the whole of it rather than one corner nobody chose.
    zoomAt(clientX ?? (box ? box.left + box.width / 2 : 0), clientY ?? (box ? box.top + box.height / 2 : 0))
  }
  // Focus belongs to the zoom control, which is inside the dialog: the arrow keys reach the dialog's
  // handler by bubbling, and a keyboard visitor who just pressed Enter is not teleported elsewhere.
  void nextTick(() => zoomControlEl.value?.focus())
}

/**
 * How far one axis may travel: until the picture's own edge reaches the frame's.
 *
 * Scaling about an origin maps a picture edge at element-local coordinate `p` to
 * `o + (p − o)·s`, which is the whole of the arithmetic. Pinning the range to those two edges is what
 * makes the zoom structurally safe — the magnified picture can never uncover the frame or push the
 * document wider, because it is only ever allowed to move inside it. When the picture is shorter than
 * the frame even at 2.5x (a wide photo in a tall window) the range inverts, and the answer is to hold
 * it centred rather than to invent travel. Asked once per gesture, from the frame's rect, which is
 * never the transformed element.
 */
const panRange = (paintStart: number, paintSize: number, originPx: number, frameSize: number): [number, number] => {
  const near = originPx + (paintStart - originPx) * ZOOM_SCALE
  const far = originPx + (paintStart + paintSize - originPx) * ZOOM_SCALE
  const max = -near
  const min = frameSize - far
  return min > max ? [(min + max) / 2, (min + max) / 2] : [min, max]
}

/** Both axes at once, from the travel a drag has produced so far. */
const clampPan = (x: number, y: number) => {
  const box = paintedBox()
  if (!box) return { x: 0, y: 0 }
  const rangeX = panRange(box.left - box.frameLeft, box.width, anchor.value.x * box.frameWidth, box.frameWidth)
  const rangeY = panRange(box.top - box.frameTop, box.height, anchor.value.y * box.frameHeight, box.frameHeight)
  return {
    x: Math.min(rangeX[1], Math.max(rangeX[0], x)),
    y: Math.min(rangeY[1], Math.max(rangeY[0], y))
  }
}

// Changing the photo — by arrow, thumb, or keyboard — resets the zoom: the magnification, the focal
// point and the pan belong to the photo they were made on, and carrying them onto the next one would
// open on some unrelated cropped corner instead of the whole new photo.
watch(selectedIndex, resetZoom)

const zoomStyle = computed(() => isZoomed.value
  ? {
      transform: `translate(${panX.value}px, ${panY.value}px) scale(${ZOOM_SCALE})`,
      'transform-origin': `${(anchor.value.x * 100).toFixed(3)}% ${(anchor.value.y * 100).toFixed(3)}%`
    }
  : undefined)

// One style binding for the enlarged photo: the magnified transform owns it while zoomed, the
// swipe offset owns it while contained. The two gestures are mutually exclusive by construction
// (a swipe starts only from the contained view), so they never compete for the same property.
const lightboxImgStyle = computed(() => isZoomed.value
  ? zoomStyle.value
  : (swipeY.value ? { transform: `translateY(${swipeY.value}px)` } : undefined))

// Drag-to-pan, mouse and touch through one Pointer Events path. Reduced motion is honoured by the
// stylesheet (the zoom entry loses its transition) — the drag itself stays available under that flag,
// because moving content *by the visitor's own hand* is direct manipulation, not an animation the
// flag declines. `dragged` swallows the click that trails a real drag so panning never reads as "zoom
// back out".
let dragId: number | null = null
let dragMoved = false
let dragX = 0
let dragY = 0
let startX = 0
let startY = 0
const dragged = { value: false }

// ---- swipe-to-close (contained view) ----
// The same overlay that pans while magnified is the swipe surface while contained: a vertical
// finger drag follows the pointer with a pure `translateY` on the `<img>` (never on the dialog —
// the zoom maths reads untransformed rects and a scaled or translated ancestor would corrupt the
// focal geometry mid-flight), and a release past the distance or velocity threshold closes the
// lightbox in the swipe's own direction. A mostly-horizontal drag is abandoned to the browser:
// left/right is the photo swap's axis, not an exit gesture. Mouse drags are never swipes — on a
// desktop the press is the zoom, and an old drag must not start moving the photo.
const SWIPE_CLOSE_MIN_PX = 72
const SWIPE_CLOSE_MIN_VEL = 0.45 // px/ms on the last sample — a flick closes where a slow pull does not
const SWIPE_CLOSE_MIN_TRAVEL = 12 // a flick must have actually moved the photo to count
const swipeY = ref(0)
let swipeId: number | null = null
let swipeStartX = 0
let swipeStartY = 0
let swipeLastY = 0
let swipeLastT = 0
let swipeVel = 0
let swipeLocked = false

const endSwipe = () => {
  swipeId = null
  swipeLocked = false
}

const onSwipePointerDown = (event: PointerEvent) => {
  if (isZoomed.value || event.pointerType === 'mouse') return
  swipeId = event.pointerId
  swipeStartX = event.clientX
  swipeStartY = event.clientY
  swipeLastY = event.clientY
  swipeLastT = event.timeStamp
  swipeVel = 0
  swipeLocked = false
  swipeY.value = 0
  try { (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId) } catch { /* the pointer is already released */ }
}

const onSwipePointerMove = (event: PointerEvent) => {
  if (swipeId === null || event.pointerId !== swipeId) return
  const dx = event.clientX - swipeStartX
  const dy = event.clientY - swipeStartY
  const dt = event.timeStamp - swipeLastT
  if (dt > 0) swipeVel = (event.clientY - swipeLastY) / dt
  swipeLastY = event.clientY
  swipeLastT = event.timeStamp
  if (!swipeLocked) {
    // Axis lock at the same 4px the pan uses: commit to the swipe only once the move is
    // unmistakably vertical. A mostly-horizontal drag is abandoned — left/right belongs to the
    // photo swap, and a crooked tap must keep its zoom meaning.
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
    if (Math.abs(dx) > Math.abs(dy)) { endSwipe(); return }
    swipeLocked = true
  }
  swipeY.value = dy
}

const onSwipePointerUp = (event: PointerEvent) => {
  if (swipeId === null || event.pointerId !== swipeId) return
  if (!swipeLocked) { endSwipe(); return }
  const travel = swipeY.value
  const flick = Math.abs(travel) > SWIPE_CLOSE_MIN_TRAVEL && Math.abs(swipeVel) > SWIPE_CLOSE_MIN_VEL
  dragged.value = true // whatever click trails this gesture is the end of a swipe, not a zoom
  const img = lightboxImgEl.value
  if (Math.abs(travel) > SWIPE_CLOSE_MIN_PX || flick) {
    const dir = travel > 0 ? 1 : -1
    if (img) {
      img.animate(
        [{ transform: `translateY(${travel}px)` }, { transform: `translateY(${dir * innerHeight}px)` }],
        { duration: 200, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'forwards' }
      )
    }
    swipeY.value = 0
    endSwipe()
    closeLightbox()
  } else {
    // Snap back: the photo returns to the contained box on its own; the dialog's fade is untouched.
    if (img && travel !== 0) {
      img.animate(
        [{ transform: `translateY(${travel}px)` }, { transform: 'translateY(0px)' }],
        { duration: 180, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }
      )
    }
    swipeY.value = 0
    endSwipe()
  }
}

const onZoomPointerDown = (event: PointerEvent) => {
  if (!isZoomed.value) { onSwipePointerDown(event); return }
  dragId = event.pointerId
  dragMoved = false
  dragX = panX.value
  dragY = panY.value
  startX = event.clientX
  startY = event.clientY
  // Capture keeps the pan alive when the pointer leaves the photo (or the viewport on touch).
  // A pointer can already be gone by the time this runs — that only costs the capture, not the pan.
  try { (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId) } catch { /* the pointer is already released */ }
}

const onZoomPointerMove = (event: PointerEvent) => {
  if (dragId === null || event.pointerId !== dragId) { onSwipePointerMove(event); return }
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  if (!dragMoved && Math.hypot(dx, dy) < 4) return
  dragMoved = true
  const clamped = clampPan(dragX + dx, dragY + dy)
  panX.value = clamped.x
  panY.value = clamped.y
}

const onZoomPointerUp = (event: PointerEvent) => {
  if (dragId === null || event.pointerId !== dragId) { onSwipePointerUp(event); return }
  dragged.value = dragMoved
  dragId = null
}

const openLightbox = () => { isLightboxOpen.value = true }
const closeLightbox = () => {
  // Zoom is a view inside one lightbox visit: leaving the visit — by any of the three exits —
  // resets it, so reopening always starts from the contained photo the frame showed. A swipe in
  // progress is part of the same visit and resets with it.
  resetZoom()
  swipeY.value = 0
  endSwipe()
  isLightboxOpen.value = false
  void nextTick(() => photoBtn.value?.focus())
}

// The page must not scroll awkwardly behind a full-screen photo. Restoring on close (and on
// unmount, in case the route changed while the dialog was open) keeps the lock from leaking.
// Escape is answered document-wide, not only inside the dialog: clicking a non-focusable
// zone moves focus to <body>, and a lightbox that only answers to its own subtree would
// then have trapped the user in it.
const onGlobalKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && isLightboxOpen.value) closeLightbox()
}
watch(isLightboxOpen, (open) => {
  document.documentElement.style.overflow = open ? 'hidden' : ''
  if (open) void nextTick(() => lightboxCloseBtn.value?.focus())
  if (open) document.addEventListener('keydown', onGlobalKeydown)
  else document.removeEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  document.documentElement.style.overflow = ''
  document.removeEventListener('keydown', onGlobalKeydown)
})

// The enlarged photo is the zoom control: a click in its picture magnifies around the exact point
// that was clicked, and a click while magnified returns to the contained view. The click that trails
// a pan drag is the end of a gesture, not an intent, and is ignored — otherwise every drag that ended
// without moving far enough to count as one would silently un-zoom what it just panned.
const onZoomControlClick = (event: MouseEvent) => {
  if (dragged.value) { dragged.value = false; return }
  // A keyboard-activated button reports a click with no pointer behind it (`detail` 0, coordinates
  // 0,0), which is exactly the case the centre anchor exists for.
  if (event.detail === 0) { toggleZoom(); return }
  toggleZoom(event.clientX, event.clientY)
}

const onDialogKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') { closeLightbox(); return }
  // Enter and Space belong to the zoom control itself — it is a real button, so Blink activates it
  // and the click handler decides where to anchor. Everything else is the arrow-key selection rule.
  onKeydown(event)
}
</script>

<template>
  <div
    data-product-gallery
    role="group"
    :aria-label="t('photos')"
    tabindex="0"
    class="mx-auto w-full min-w-0 max-w-md space-y-4 rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 dark:focus-visible:ring-white/25"
    @keydown="onKeydown"
  >
    <!-- Main photo: a deliberately smaller frame than the full gallery column, so the strip
         below it reads as part of this one component rather than an unrelated list. The
         .gallery-arrow rule below keeps the arrows out of sight on hover-capable pointers
         until the frame is hovered or keyboard-focused (opacity + pointer-events only, never
         display:none, so they stay tabbable the whole time); on touch they simply stay put
         where they always were. -->
    <div class="gallery-swap relative aspect-square overflow-hidden rounded-2xl border border-zinc-200/70 bg-zinc-50 p-4 shadow-xs sm:rounded-3xl sm:p-8 dark:border-zinc-800/70 dark:bg-zinc-900/60 flex items-center justify-center">
      <button
        v-if="selectedImage"
        ref="photoBtn"
        type="button"
        data-gallery-zoom
        :aria-label="t('enlargePhoto')"
        class="relative flex h-full w-full cursor-zoom-in items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-white"
        @click="openLightbox"
      >
        <AnimatePresence>
          <motion.img
            v-if="selectedImage"
            :key="selectedImage.id"
            data-gallery-main
            :src="selectedImage.url"
            :alt="selectedImage.altText || name"
            class="absolute inset-0 h-full w-full object-contain"
            :initial="{ opacity: 0, x: transitionDirection === 'next' ? '18%' : '-18%' }"
            :animate="{ opacity: 1, x: 0 }"
            :exit="{ opacity: 0, x: transitionDirection === 'next' ? '-18%' : '18%' }"
            :transition="{ duration: swapDuration, ease: [0.33, 1, 0.68, 1] }"
          />
        </AnimatePresence>
      </button>
      <div v-else class="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-400">
        {{ t('noImage') }}
      </div>

      <!-- Edge-hugging circles: inside the frame's own padding, so they never cover the
           centre of the photo, and type="button" so they can never act as navigation.
           .gallery-arrow below hides them on hover-capable pointers until the frame is
           hovered or keyboard-focused — and only keyboard-focused: a mouse click leaves
           :focus-visible unmatched, so the arrows fade back out when the pointer leaves. -->
      <template v-if="imageCount > 1">
        <button
          type="button"
          data-gallery-prev
          :aria-label="t('previousPhoto')"
          class="gallery-arrow absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-zinc-200/70 bg-white/85 text-zinc-700 shadow-xs backdrop-blur hover:bg-white hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white dark:focus-visible:ring-white"
          @click="step(-1)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button
          type="button"
          data-gallery-next
          :aria-label="t('nextPhoto')"
          class="gallery-arrow absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-zinc-200/70 bg-white/85 text-zinc-700 shadow-xs backdrop-blur hover:bg-white hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white dark:focus-visible:ring-white"
          @click="step(1)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </template>
    </div>

    <!-- Filmstrip: one row, bounded to VISIBLE_COUNT thumbs. Below the photo count that
         needs no windowing at all — every thumb shows and nothing slides. -->
    <div v-if="imageCount > 1" class="overflow-hidden">
      <div ref="stripEl" data-gallery-strip class="mx-auto flex w-max gap-2 sm:gap-3">
        <button
          v-for="(image, offset) in windowImages"
          :key="image.id"
          type="button"
          data-gallery-thumb
          :data-index="windowStart + offset"
          :data-selected="selectedIndex === windowStart + offset ? 'true' : undefined"
          :aria-current="selectedIndex === windowStart + offset ? 'true' : undefined"
          :aria-label="image.altText || name"
          class="h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-xl border bg-zinc-50 p-1 transition-[opacity,border-color] focus-visible:outline-none sm:h-16 sm:w-16 lg:h-20 lg:w-20 dark:bg-zinc-900"
          :class="[
            selectedIndex === windowStart + offset
              ? 'border-zinc-950 dark:border-white ring-2 ring-zinc-950/20 dark:ring-white/20'
              : 'border-zinc-200/80 opacity-70 hover:opacity-100 hover:border-zinc-400 dark:border-zinc-800/80'
          ]"
          @click="select(windowStart + offset)"
        >
          <img
            :src="image.url"
            :alt="image.altText || name"
            loading="lazy"
            class="h-full w-full rounded-lg object-cover"
          />
        </button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <!-- Backdrop click closes (the click has to land on the root itself: the photo box and
         its buttons do not). The photo never covers the whole viewport, so there is always a
         real backdrop band to click, and clicking inside the photo box keeps the photo up.

         The fade is on the whole fixed container — backdrop and photo arrive and leave together,
         which is the "the page transitions into a focused viewing state" read the hard cut never
         sold. It is opacity-only and on the dialog root, so it never touches the `<img>`'s own
         transform: the focal-point zoom, the pan bound and the swap transitions all keep exactly
         the geometry they were measured against. -->
    <AnimatePresence>
      <motion.div
        v-if="isLightboxOpen"
        key="lightbox"
        ref="dialogEl"
        data-lightbox
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-label="t('photos')"
        class="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm outline-none"
        :initial="{ opacity: 0 }"
        :animate="{ opacity: 1 }"
        :exit="{ opacity: 0 }"
        :transition="lightboxPreset.transition"
        @click.self="closeLightbox"
        @keydown="onDialogKeydown"
      >
      <div ref="frameEl" class="relative flex h-[82dvh] w-[92vw] max-w-5xl items-center justify-center overflow-hidden">
        <Transition :name="swapTransition">
          <img
            v-if="selectedImage"
            ref="lightboxImgEl"
            :key="selectedImage.id"
            data-lightbox-main
            :data-zoomed="isZoomed ? 'true' : undefined"
            draggable="false"
            :src="selectedImage.url"
            :alt="selectedImage.altText || name"
            :style="lightboxImgStyle"
            class="h-full w-full object-contain"
            :class="isZoomed ? 'lightbox-zoomed' : ''"
          />
        </Transition>

        <!-- The zoom control lies over the photo instead of being the photo. A focusable `<img>` with
             an action name would be announced as an image (no role), and its `aria-label` would
             replace the alt text the photo exists to carry; a transparent button keeps the picture's
             own semantics and gets a real role, name, cursor and keyboard activation for free. The
             prev/next controls sit above it (`z-10`), so the overlay never trades a hit with them. -->
        <button
          v-if="selectedImage"
          ref="zoomControlEl"
          type="button"
          data-lightbox-zoom-target
          :aria-label="isZoomed ? t('zoomOut') : t('zoomIn')"
          class="absolute inset-0 cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
          :class="isZoomed ? 'cursor-zoom-out active:cursor-grabbing' : ''"
          @click="onZoomControlClick"
          @pointerdown="onZoomPointerDown"
          @pointermove="onZoomPointerMove"
          @pointerup="onZoomPointerUp"
          @pointercancel="onZoomPointerUp"
        />

        <template v-if="imageCount > 1">
          <button
            type="button"
            data-lightbox-prev
            :aria-label="t('previousPhoto')"
            class="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-zinc-900/70 text-white shadow-xs backdrop-blur transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            @click="step(-1)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button
            type="button"
            data-lightbox-next
            :aria-label="t('nextPhoto')"
            class="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-zinc-900/70 text-white shadow-xs backdrop-blur transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            @click="step(1)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </template>
      </div>

      <!-- Thumb-reach close: the bottom-centre band under the photo, where a one-handed grip
           actually lands, instead of the far top corner. Bottom-centring the dialog's own flex
           axis is `left-1/2` + the half-width translate — transform-only, so it joins no layout.
           Focus still starts here when the dialog opens. -->
      <button
        ref="lightboxCloseBtn"
        type="button"
        data-lightbox-close
        :aria-label="t('close')"
        class="absolute bottom-4 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-zinc-900/70 text-white shadow-xs backdrop-blur transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        @click="closeLightbox"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </button>
      </motion.div>
    </AnimatePresence>
  </Teleport>
</template>

<style scoped>
/* One directional swap, used by both the frame and the lightbox: the old photo slides out
   the far edge while the new one enters from the side its direction names, so "next" always
   reads as the strip moving left and "previous" as the strip moving right.
   Both layers must occupy the SAME painted box, or the outgoing photo reads as a flash of
   enlargement for the length of the transition. That is what `inset: 0` inside each layer's
   own `relative` parent guarantees: the leaving img's h-full/w-full then resolve against the
   identical content box (absolute percentages size to the PADDING box, so letting them
   resolve against the padded frame instead made the old photo ~17% wider mid-swap — the
   split-second enlargement this rule exists to prevent). */
.gallery-next-enter-active,
.gallery-next-leave-active,
.gallery-previous-enter-active,
.gallery-previous-leave-active {
  transition: transform 220ms cubic-bezier(0.33, 1, 0.68, 1), opacity 220ms ease;
}
.gallery-next-leave-active,
.gallery-previous-leave-active {
  position: absolute;
  inset: 0;
}
.gallery-next-enter-from { transform: translateX(18%); opacity: 0; }
.gallery-next-leave-to { transform: translateX(-18%); opacity: 0; }
.gallery-previous-enter-from { transform: translateX(-18%); opacity: 0; }
.gallery-previous-leave-to { transform: translateX(18%); opacity: 0; }

/* The arrows wait for the pointer: on hover-capable pointers they rest invisible, and wake
   when the frame is hovered or a keyboard focus has reached inside it. :focus-visible rather
   than :focus-within — a mouse click focuses the arrow too, and that must NOT pin the arrows
   lit after the pointer leaves; only a keyboard focus keeps them up. Hidden with opacity +
   pointer-events only, so they never leave the tab order; touch pointers match none of this
   and see the arrows permanently. */
.gallery-arrow { transition: opacity 150ms ease; }
@media (hover: hover) {
  .gallery-arrow { opacity: 0; pointer-events: none; }
  .gallery-swap:hover .gallery-arrow,
  .gallery-swap:has(:focus-visible) .gallery-arrow { opacity: 1; pointer-events: auto; }
}

/* Reduced motion keeps the swap a real directional slide, just softened: shorter travel and
   a faster blend, never a freeze-frame teleport. (macOS raises this flag together with
   "Reduce transparency", so users who never chose it still expect the gallery to move.) */
@media (prefers-reduced-motion: reduce) {
  .gallery-next-enter-active,
  .gallery-next-leave-active,
  .gallery-previous-enter-active,
  .gallery-previous-leave-active {
    transition-duration: 150ms;
  }
  .gallery-next-enter-from { transform: translateX(12%); }
  .gallery-next-leave-to { transform: translateX(-12%); }
  .gallery-previous-enter-from { transform: translateX(-12%); }
  .gallery-previous-leave-to { transform: translateX(12%); }
}

/* The zoomed photo: the transition turns the zoom toggle into the same 220ms move the swap already
   uses. Because the magnification is pinned to the point that was clicked, that move travels *out of*
   the pointer rather than towards the centre, which is what makes it read as "the photo opened where I
   touched" instead of a resize. During an actual drag the transform must track the pointer on the
   frame it moved, so the easing is dropped while the control is being pressed. Reduced motion keeps
   the zoom and the drag-pan (direct manipulation), and drops the animated entry — the photo arrives at
   its magnification rather than travelling to it. */
.lightbox-zoomed {
  transition: transform 220ms cubic-bezier(0.33, 1, 0.68, 1);
}
/* `touch-action: none` on the zoom control — contained and magnified alike — hands every drag to
   the gesture code instead of letting the browser claim it: the pan while magnified, and the
   swipe-to-close while contained (the dialog cannot scroll anyway; the page behind is locked).
   Unset, a vertical swipe would read as a scroll attempt and the pointer would be cancelled. */
[data-lightbox-zoom-target] {
  touch-action: none;
}
/* The photo follows the control it sits under: while the zoom control is being dragged, the
   transform must track the pointer on the frame it moved, so the easing is dropped. `:has()` because
   the control is the photo's following sibling. */
[data-lightbox-main]:has(+ [data-lightbox-zoom-target]:active) {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .lightbox-zoomed { transition: none; }
}

/* The lightbox's enter/exit is now a Motion opacity fade on the dialog root (the `<AnimatePresence>`
   above + the `lightbox` preset in app/utils/motion.ts). It stays opacity-only, never transform: the
   zoom maths reads the `<img>` and the frame's untransformed rects, and a scaled ancestor would
   corrupt both mid-flight — the same reason the old CSS carried no transform on this rule. */
</style>
