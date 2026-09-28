<script setup lang="ts">
import type { ProductShareDestination, ProductSharePayload } from '../composables/useProductShare'
import { platformLabel } from '~/utils/social-prefill'
import { selectOnFocus } from '~/utils/clipboard'

/**
 * The share UI: one product, one link, two shapes.
 *
 * It is a sheet on a phone — bottom-anchored, safe-area aware, dismissed by the backdrop or
 * Escape — and an anchored popover on a desktop, placed beside the control that opened it and
 * flipped above it when the viewport runs out of room below. One component with both, because a
 * second implementation of "the thing with the Copy row and the platform rows" is how the two
 * drift apart, and because the *content* genuinely is the same: it only disagrees about where it
 * sits.
 *
 * It teleports itself for the reason the sticky bar and the lightbox do: a `position: fixed` panel
 * must not inherit a containing block from wherever it happens to be composed, and the mobile
 * sticky bar's `backdrop-blur` would have made this one a child of the bar's own box.
 *
 * Presentational by construction: the payload, the destinations and the confirmation all arrive as
 * props and the three things a visitor can do leave as events. No query, no clipboard write, and no
 * knowledge of the contact panel beside it — Share is offered whether or not the shop configured a
 * single contact channel, which is the same reason the two lists are resolved separately.
 */
const props = defineProps<{
  open: boolean
  payload: ProductSharePayload
  destinations: ProductShareDestination[]
  /** What the last copy really did, in the page's words. Empty until one happens. */
  feedback: string
  /** Set when a copy could not be completed: the address becomes selectable text here, because
   * this is the surface the visitor was just asked to copy from. */
  revealLink: boolean
  /** The control that opened the sheet. Only a desktop popover reads it — a bottom sheet is
   * anchored to the viewport, so where the button was is somebody else's business. */
  anchor: HTMLElement | null
}>()

const emit = defineEmits<{ close: [], copyLink: [], copyMessage: [] }>()

const { t } = useI18n()

// The breakpoint the layout already uses to choose between the inline block and the sticky bar.
// Following it rather than guessing about devices means the popover appears exactly where the
// control that opened it is a desktop-sized one.
const DESKTOP_QUERY = '(min-width: 1024px)'
const isDesktop = ref(false)
let media: MediaQueryList | undefined

const readDesktop = () => { isDesktop.value = media?.matches ?? false }

// The popover's position is measured once, on the frame it enters: the panel's own size is only
// known once it exists, and choosing above-or-below the control needs it. `placed` resets on close
// so a reopened sheet can never be positioned by the previous product's geometry, and the panel
// stays `visibility: hidden` for the frame it has no position yet — an unpositioned fixed element
// sits at the viewport's top-left corner, and painting it there is the flash this guards against.
const panelEl = ref<HTMLElement | null>(null)
const placed = ref<{ left: number, top: number } | null>(null)

const place = () => {
  const el = panelEl.value
  const box = props.anchor?.getBoundingClientRect()
  if (!el || !box) return
  const margin = 12
  const gap = 8
  const left = Math.min(Math.max(box.left, margin), Math.max(margin, innerWidth - el.offsetWidth - margin))
  const below = box.bottom + gap
  const top = below + el.offsetHeight <= innerHeight - margin ? below : Math.max(margin, box.top - el.offsetHeight - gap)
  placed.value = { left, top }
}

// The popover is anchored to a control that stays where the page put it, so a scroll or a resize has
// to re-place it — otherwise the fixed panel drifts away from its own trigger while the sheet is open.
// One rAF is the whole throttle: the re-place reads a rect and writes two properties, and doing it
// twice in a frame would cost the same as doing it once.
let repositionQueued = false
const reposition = () => {
  if (repositionQueued || !isDesktop.value) return
  repositionQueued = true
  requestAnimationFrame(() => { repositionQueued = false; if (props.open) place() })
}

const panelStyle = computed(() => {
  if (!isDesktop.value) return undefined
  const box = props.anchor?.getBoundingClientRect()
  return {
    left: `${placed.value?.left ?? Math.max(12, (box?.left ?? 0))}px`,
    top: `${placed.value?.top ?? Math.max(12, (box?.bottom ?? 0) + 8)}px`,
    visibility: placed.value ? 'visible' : 'hidden'
  }
})

const close = (returnFocus = true) => {
  emit('close')
  if (returnFocus) props.anchor?.focus()
}

// Modality is claimed only where it is true: a phone's sheet covers the page, so the background
// really is gone, while a desktop popover dims nothing and its invisible full-viewport catcher is
// the standard menu contract — the first click outside dismisses and does nothing else. Escape, that
// catcher and the close button are the dismiss paths in both shapes, and focus returns to the
// control that opened the sheet either way.

// Escape belongs to the sheet while it is open, answered document-wide rather than only inside the
// panel: a click on a non-focusable part of the backdrop moves focus to `<body>`, and a sheet that
// only listened to its own subtree would then have trapped the visitor in it.
const onKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }

watch(() => props.open, (open) => {
  if (!open) {
    document.removeEventListener('keydown', onKeydown)
    removeEventListener('scroll', reposition, true)
    removeEventListener('resize', reposition)
    return
  }
  // Reset on the way in, never on the way out: cleared while the leave transition runs, the panel
  // would hide itself at the first frame of its own exit.
  placed.value = null
  document.addEventListener('keydown', onKeydown)
  // Capture, because the page scrolls behind the backdrop rather than inside the panel.
  addEventListener('scroll', reposition, true)
  addEventListener('resize', reposition)
  void nextTick(place)
})

onMounted(() => {
  media = window.matchMedia(DESKTOP_QUERY)
  media.addEventListener('change', readDesktop)
  readDesktop()
})
onBeforeUnmount(() => {
  media?.removeEventListener('change', readDesktop)
  document.removeEventListener('keydown', onKeydown)
  removeEventListener('scroll', reposition, true)
  removeEventListener('resize', reposition)
})
</script>

<template>
  <Teleport to="body">
    <Transition :name="isDesktop ? 'share-pop' : 'share-sheet'">
      <div
        v-if="open"
        data-share-backdrop
        class="fixed inset-0 z-[60] outline-none"
        :class="isDesktop ? '' : 'bg-zinc-950/45 backdrop-blur-[2px] dark:bg-zinc-950/60'"
        @click.self="close(false)"
      >
        <div
          ref="panelEl"
          data-share-sheet
          role="dialog"
          :aria-modal="isDesktop ? 'false' : 'true'"
          :aria-label="t('shareSheetLabel', { name: payload.title })"
          tabindex="-1"
          class="flex min-w-0 flex-col border border-zinc-200/80 bg-white text-zinc-950 shadow-xl outline-none dark:border-zinc-800/80 dark:bg-zinc-900 dark:text-white"
          :class="isDesktop
            ? 'fixed w-72 rounded-2xl p-3'
            : 'fixed inset-x-0 bottom-0 max-h-[85dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))]'"
          :style="panelStyle"
        >
          <!-- The grabber reads as "this slides", and is the only thing on a desktop popover that
               would read as a browser dialog instead of a control. -->
          <div v-if="!isDesktop" class="mx-auto mb-1 mt-3 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />

          <div class="flex min-w-0 items-start gap-3 px-2 pt-1 pb-3">
            <div class="min-w-0 flex-1">
              <p class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{{ t('share') }}</p>
              <p class="mt-1 truncate text-sm font-semibold">{{ payload.title }}</p>
              <p v-if="payload.text" class="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{{ payload.text }}</p>
            </div>
            <button
              type="button"
              data-share-close
              :aria-label="t('close')"
              class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-200/80 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
              @click="close()"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>

          <div class="min-w-0 space-y-1.5">
            <button
              type="button"
              data-share-copy-link
              class="flex h-11 w-full min-w-0 cursor-pointer items-center gap-3 rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950"
              @click="emit('copyLink')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <span class="min-w-0 flex-1 truncate text-left">{{ t('copyLink') }}</span>
            </button>

            <button
              type="button"
              data-share-copy-message
              class="flex h-11 w-full min-w-0 cursor-pointer items-center gap-3 rounded-full border border-zinc-300/80 bg-white px-4 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
              @click="emit('copyMessage')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
              <span class="min-w-0 flex-1 truncate text-left">{{ t('copyMessage') }}</span>
            </button>
          </div>

          <!-- The destinations are the shop's own configured accounts, and only the platforms with
               a documented prefill carry the product's line. The rest open where they were stored
               and say so, beside the Copy rows above that actually do it. -->
          <template v-if="destinations.length">
            <p class="mt-4 px-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {{ t('shareVia') }}
            </p>
            <ul class="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-2 px-2">
              <li v-for="destination in destinations" :key="destination.key" class="min-w-0">
                <a
                  :href="destination.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  :data-share-destination="destination.platform"
                  :data-share-prefilled="destination.prefilled"
                  class="flex h-11 min-w-0 max-w-full items-center gap-2 rounded-full border border-zinc-200/80 bg-white px-4 text-sm font-semibold text-zinc-800 transition-colors hover:border-zinc-300 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:text-white dark:focus-visible:ring-white"
                >
                  <SocialBrandIcon :platform="destination.platform" class="shrink-0 opacity-70" />
                  <span class="min-w-0 truncate">{{ platformLabel(destination.platform) }}</span>
                </a>
              </li>
            </ul>
          </template>

          <!-- The failure path is shown where the visitor was asked to copy, and the row above it
               never claims a write that did not happen. -->
          <div v-if="revealLink" class="mt-3 min-w-0 px-2">
            <input
              readonly
              type="text"
              inputmode="url"
              :value="payload.url"
              data-share-sheet-link
              :aria-label="t('shareLinkLabel')"
              class="min-w-0 w-full truncate rounded-xl border border-zinc-200/80 bg-white px-3 py-2 text-xs text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-800/80 dark:bg-zinc-950 dark:text-zinc-300 dark:focus-visible:ring-white"
              @focus="selectOnFocus"
            />
          </div>

          <p
            role="status"
            aria-live="polite"
            data-share-feedback
            class="mt-2 min-h-5 px-2 text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >{{ feedback }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* The sheet slides on its own axis and nothing else moves: a transform-only enter cannot shift
   the page behind it, which is the "no layout jump" requirement. */
.share-sheet-enter-active,
.share-sheet-leave-active {
  transition: opacity 220ms ease;
}
.share-sheet-enter-active [data-share-sheet],
.share-sheet-leave-active [data-share-sheet] {
  transition: transform 260ms cubic-bezier(0.33, 1, 0.68, 1);
}
.share-sheet-enter-from,
.share-sheet-leave-to {
  opacity: 0;
}
.share-sheet-enter-from [data-share-sheet],
.share-sheet-leave-to [data-share-sheet] {
  transform: translateY(100%);
}

/* The popover unfolds from the control that opened it — the same idiom the catalog's select panels
   use, kept small enough that it reads as a control rather than a dialog. */
.share-pop-enter-active,
.share-pop-leave-active {
  transition: opacity 140ms ease;
}
.share-pop-enter-active [data-share-sheet],
.share-pop-leave-active [data-share-sheet] {
  transition: transform 180ms cubic-bezier(0.33, 1, 0.68, 1);
}
.share-pop-enter-from,
.share-pop-leave-to {
  opacity: 0;
}
.share-pop-enter-from [data-share-sheet] {
  transform: translateY(-6px) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .share-sheet-enter-active,
  .share-sheet-leave-active {
    transition-duration: 120ms;
  }
  .share-sheet-enter-active [data-share-sheet],
  .share-sheet-leave-active [data-share-sheet],
  .share-pop-enter-active [data-share-sheet],
  .share-pop-leave-active [data-share-sheet] {
    transition: none;
  }
  .share-sheet-enter-from [data-share-sheet],
  .share-sheet-leave-to [data-share-sheet],
  .share-pop-enter-from [data-share-sheet] {
    transform: none;
  }
}
</style>
