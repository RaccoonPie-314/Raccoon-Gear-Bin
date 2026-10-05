<script setup lang="ts">
import type { ProductShareDestination, ProductSharePayload } from '../composables/useProductShare'
import { platformLabel } from '~/utils/social-prefill'
import { selectOnFocus } from '~/utils/clipboard'
import { motion, useReducedMotion } from 'motion-v'
import { copyPop, press, pulseScale } from '~/utils/motion'
import type { ComponentPublicInstance } from 'vue'

/**
 * The share surface's body: the header the visitor reads, the two Copy rows, the shop's
 * destinations, the manual fallback and the confirmation line. It is the same rows in both shapes
 * the share surface wears — the phone's bottom sheet and the desktop panel `ProductActions` blooms
 * under the Share button — because a second implementation of "the thing with the Copy row and the
 * platform rows" is how the two drift apart. The chrome around it is the owner's (a grabber and a
 * drag band on the phone; an in-flow panel on a desktop), which is why nothing here positions,
 * animates or dismisses itself: `close` leaves as an event, and so does the drag band's press.
 *
 * Presentational by construction: the payload, the destinations and the confirmation arrive as
 * props, and the three things a visitor can do leave as events.
 */
defineProps<{
  payload: ProductSharePayload
  destinations: ProductShareDestination[]
  /** What the last copy really did, in the page's words. Empty until one happens. */
  feedback: string
  /** Set when a copy could not be completed: the address becomes selectable text here, because
   * this is the surface the visitor was just asked to copy from. */
  revealLink: boolean
  /** True only inside the phone sheet: adds the grabber and turns the header band into the swipe
   * handle. The desktop panel keeps browser scrolling over its own header. */
  compact: boolean
}>()

const emit = defineEmits<{ close: [], copyLink: [], copyMessage: [], dragStart: [event: PointerEvent] }>()

const { t } = useI18n()
const reduced = useReducedMotion()

// Tactile copy confirmation (Phase G): a one-shot `copyPop` on the copy button, fired on `click`,
// after `while-press` has released on pointer-up, so the two never race for the same transform. The
// template ref on a motion component is its instance, so the pulse unwraps `.$el` to reach the node.
const copyLinkBtn = ref<ComponentPublicInstance | null>(null)
const copyMsgBtn = ref<ComponentPublicInstance | null>(null)
const popCopy = (inst: ComponentPublicInstance | null) => {
  const el = inst?.$el as HTMLElement | undefined
  if (el && !reduced.value) pulseScale(el, copyPop.keyframes, copyPop.ms)
}
const onCopyLink = () => { emit('copyLink'); popCopy(copyLinkBtn.value) }
const onCopyMessage = () => { emit('copyMessage'); popCopy(copyMsgBtn.value) }
</script>

<template>
  <!-- The grabber reads as "this slides", and on the phone the whole band — grabber and header —
       is the drag handle: grabbing it and pulling down dismisses the sheet. The desktop panel gets
       neither: there is nothing to drag, and `touch-action: none` over a panel's header would eat
       the page's own scroll there. -->
  <div
    class="shrink-0"
    :class="compact ? 'sheet-drag-handle' : ''"
    :data-share-drag="compact ? '' : undefined"
    @pointerdown="compact ? emit('dragStart', $event) : undefined"
  >
    <div v-if="compact" class="mx-auto mb-1 mt-3 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />

    <div class="flex min-w-0 items-start gap-3 px-2 pt-1 pb-3">
      <div class="min-w-0 flex-1">
        <p class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{{ t('share') }}</p>
        <p class="mt-1 truncate text-sm font-semibold">{{ payload.title }}</p>
        <p v-if="payload.text" class="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{{ payload.text }}</p>
      </div>
      <motion.button
        type="button"
        data-share-close
        :aria-label="t('close')"
        :while-press="reduced ? undefined : { scale: press.scale }"
        :transition="press.transition"
        class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-200/80 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
        @click="emit('close')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </motion.button>
    </div>
  </div>

  <!-- One shared 16px content inset for every interactive row: the panel's own p-3 plus this
       px-2 puts the Copy rows' icons on the same vertical line as the destination pills' icons
       below, so the whole surface reads as one column of controls rather than two systems. -->
  <div class="min-w-0 space-y-1.5 px-2">
    <motion.button
      ref="copyLinkBtn"
      type="button"
      data-share-copy-link
      :while-press="reduced ? undefined : { scale: press.scale }"
      :transition="press.transition"
      class="flex h-11 w-full min-w-0 cursor-pointer items-center gap-3 rounded-full bg-zinc-950 px-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950"
      @click="onCopyLink"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      <span class="min-w-0 flex-1 truncate text-left">{{ t('copyLink') }}</span>
    </motion.button>

    <motion.button
      ref="copyMsgBtn"
      type="button"
      data-share-copy-message
      :while-press="reduced ? undefined : { scale: press.scale }"
      :transition="press.transition"
      class="flex h-11 w-full min-w-0 cursor-pointer items-center gap-3 rounded-full border border-zinc-300/80 bg-white px-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
      @click="onCopyMessage"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
      <span class="min-w-0 flex-1 truncate text-left">{{ t('copyMessage') }}</span>
    </motion.button>
  </div>

  <!-- The destinations are the shop's own configured accounts, and only the platforms with
       a documented prefill carry the product's line. The rest open where they were stored
       and say so, beside the Copy rows above that actually do it.
       A grid, not a wrapping row of intrinsic-width pills: every destination gets the same
       intentional cell — aligned with the Copy rows' own inset above — so one, two, three
       or four platforms all read as a settled group rather than a ragged edge. The column
       count comes from the container, not from a breakpoint, because the sheet and the
       panel give the same list different widths. -->
  <template v-if="destinations.length">
    <p class="mt-4 px-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
      {{ t('shareVia') }}
    </p>
    <ul class="mt-2 grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2 px-2">
      <li v-for="destination in destinations" :key="destination.key" class="min-w-0">
        <motion.a
          :href="destination.href"
          target="_blank"
          rel="noopener noreferrer"
          :data-share-destination="destination.platform"
          :data-share-prefilled="destination.prefilled"
          :while-press="reduced ? undefined : { scale: press.scale }"
          :transition="press.transition"
          class="flex h-11 w-full min-w-0 max-w-full items-center justify-center gap-2 rounded-full border border-zinc-200/80 bg-white px-4 text-sm font-semibold text-zinc-800 transition-colors hover:border-zinc-300 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:text-white dark:focus-visible:ring-white"
        >
          <SocialBrandIcon :platform="destination.platform" class="shrink-0 opacity-70" />
          <span class="min-w-0 truncate">{{ platformLabel(destination.platform) }}</span>
        </motion.a>
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
</template>

<style scoped>
/* The phone sheet's drag handle opts out of browser scrolling over its own band, so the vertical
   gesture belongs to the Motion drag rather than to the sheet's `overflow-y-auto`. The desktop
   panel never gets this class — its header is not a handle. */
.sheet-drag-handle {
  touch-action: none;
}
</style>
