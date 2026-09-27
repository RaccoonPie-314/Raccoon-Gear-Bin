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

// The selected index is the only state; the strip window is derived from it so the selection
// always sits in the centre slot. Clamping at both ends is what makes the first/last photos
// rest at the edge instead of demanding impossible centring.
const windowStart = computed(() => {
  const max = Math.max(0, imageCount.value - VISIBLE_COUNT)
  return Math.min(Math.max(selectedIndex.value - Math.floor(VISIBLE_COUNT / 2), 0), max)
})
const windowImages = computed(() => props.images.slice(windowStart.value, windowStart.value + VISIBLE_COUNT))

const select = (index: number) => { selectedIndex.value = index }

// Arrows wrap: previous from the first photo lands on the last and vice versa.
const step = (delta: number) => {
  if (imageCount.value < 2) return
  selectedIndex.value = (selectedIndex.value + delta + imageCount.value) % imageCount.value
}

// SPA navigation between two detail pages reuses this component; a new product starts at
// its first photo rather than at whatever index the previous one was left on.
watch(() => props.images, () => { selectedIndex.value = 0 })

// The strip only ever holds the window, so an advance swaps the content rather than sliding
// it. Re-anchoring a one-step translateX onto the fresh content reads as the row moving one
// slot; it is transform-only (no layout jump) and always runs from ±step to none, so nothing
// accumulates across repeated advances.
watch(windowStart, (to, from) => {
  const strip = stripEl.value
  if (!strip || to === from || strip.children.length === 0) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const children = Array.from(strip.children) as HTMLElement[]
  const first = children[0]
  const second = children[1]
  const stepPx = first && second
    ? second.getBoundingClientRect().left - first.getBoundingClientRect().left
    : (first?.getBoundingClientRect().width ?? 0)
  if (!stepPx) return
  strip.animate(
    [{ transform: `translateX(${(to > from ? stepPx : -stepPx).toFixed(2)}px)` }, { transform: 'translateX(0px)' }],
    { duration: 240, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }
  )
})

// Left/right arrows drive the selection while the gallery (or anything in it) has focus.
const onKeydown = (event: KeyboardEvent) => {
  if (imageCount.value < 2) return
  if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
  else if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
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
         below it reads as part of this one component rather than an unrelated list. -->
    <div class="relative aspect-square overflow-hidden rounded-2xl border border-zinc-200/70 bg-zinc-50 p-4 shadow-xs sm:rounded-3xl sm:p-8 dark:border-zinc-800/70 dark:bg-zinc-900/60 flex items-center justify-center">
      <img
        v-if="selectedImage"
        :key="selectedImage.id"
        data-gallery-main
        :src="selectedImage.url"
        :alt="selectedImage.altText || name"
        class="gallery-main-fade h-full w-full object-contain"
      />
      <div v-else class="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-400">
        {{ t('noImage') }}
      </div>

      <!-- Edge-hugging circles: inside the frame's own padding, so they never cover the
           centre of the photo, and type="button" so they can never act as navigation. -->
      <template v-if="imageCount > 1">
        <button
          type="button"
          data-gallery-prev
          :aria-label="t('previousPhoto')"
          class="absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-zinc-200/70 bg-white/85 text-zinc-700 shadow-xs backdrop-blur transition-colors hover:bg-white hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white dark:focus-visible:ring-white"
          @click="step(-1)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button
          type="button"
          data-gallery-next
          :aria-label="t('nextPhoto')"
          class="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-zinc-200/70 bg-white/85 text-zinc-700 shadow-xs backdrop-blur transition-colors hover:bg-white hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white dark:focus-visible:ring-white"
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
</template>

<style scoped>
/* The keyed img remounts on selection, so the new photo fades up from transparent. Short and
   opacity-only: the gallery must never feel slow. */
.gallery-main-fade {
  animation: gallery-main-fade 160ms ease-out;
}
@keyframes gallery-main-fade {
  from { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .gallery-main-fade { animation: none; }
}
</style>
