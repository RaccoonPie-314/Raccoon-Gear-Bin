<script setup lang="ts">
import type { CatalogImage } from '~/types/catalog'

const props = defineProps<{ images: CatalogImage[]; name: string }>()
const { t } = useI18n()

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
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const children = Array.from(strip.children) as HTMLElement[]
  const first = children[0]
  const second = children[1]
  const stepPx = first && second
    ? second.getBoundingClientRect().left - first.getBoundingClientRect().left
    : (first?.getBoundingClientRect().width ?? 0)
  if (!stepPx) return
  const travel = (to > from ? stepPx : -stepPx) * (reduced ? 0.66 : 1)
  strip.animate(
    [{ transform: `translateX(${travel.toFixed(2)}px)` }, { transform: 'translateX(0px)' }],
    { duration: reduced ? 170 : 240, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }
  )
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
const zoomBtn = ref<HTMLElement | null>(null)
const lightboxCloseBtn = ref<HTMLElement | null>(null)
const dialogEl = ref<HTMLElement | null>(null)

const openLightbox = () => { isLightboxOpen.value = true }
const closeLightbox = () => {
  isLightboxOpen.value = false
  void nextTick(() => zoomBtn.value?.focus())
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

// A click on the enlarged photo keeps the lightbox up and pulls focus back into the dialog,
// so the arrow keys still belong to it afterwards.
const onLightboxImgClick = () => { dialogEl.value?.focus() }

const onDialogKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') { closeLightbox(); return }
  onKeydown(event)
}
</script>

<template>
  <div
    data-product-gallery
    role="group"
    :aria-label="t('photos')"
    tabindex="0"
    class="mx-auto w-full max-w-md space-y-4 rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 dark:focus-visible:ring-white/25"
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
        ref="zoomBtn"
        type="button"
        data-gallery-zoom
        :aria-label="t('enlargePhoto')"
        class="relative flex h-full w-full cursor-zoom-in items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-white"
        @click="openLightbox"
      >
        <Transition :name="swapTransition">
          <img
            :key="selectedImage.id"
            data-gallery-main
            :src="selectedImage.url"
            :alt="selectedImage.altText || name"
            class="h-full w-full object-contain"
          />
        </Transition>
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
          class="h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-xl border bg-zinc-50 p-1 transition-all focus-visible:outline-none sm:h-16 sm:w-16 lg:h-20 lg:w-20 dark:bg-zinc-900"
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
         real backdrop band to click, and clicking inside the photo box keeps the photo up. -->
    <div
      v-if="isLightboxOpen"
      ref="dialogEl"
      data-lightbox
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="t('photos')"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm outline-none"
      @click.self="closeLightbox"
      @keydown="onDialogKeydown"
    >
      <div class="relative flex h-[82dvh] w-[92vw] max-w-5xl items-center justify-center">
        <Transition :name="swapTransition">
          <img
            v-if="selectedImage"
            :key="selectedImage.id"
            data-lightbox-main
            tabindex="-1"
            :src="selectedImage.url"
            :alt="selectedImage.altText || name"
            class="h-full w-full cursor-default object-contain"
            @click="onLightboxImgClick"
          />
        </Transition>

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

      <button
        ref="lightboxCloseBtn"
        type="button"
        data-lightbox-close
        :aria-label="t('close')"
        class="absolute right-4 top-4 z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-zinc-900/70 text-white shadow-xs backdrop-blur transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        @click="closeLightbox"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </button>
    </div>
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
</style>
