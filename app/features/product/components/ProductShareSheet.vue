<script setup lang="ts">
import type { ProductShareDestination, ProductSharePayload } from '../composables/useProductShare'
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion-v'
import { press, sheet } from '~/utils/motion'

/**
 * The share surface on a phone: a bottom sheet — bottom-anchored, safe-area aware, dismissed by
 * the backdrop, its own close buttons, a swipe down or Escape.
 *
 * The desktop shape is not this component's business any more. There the share surface is a panel
 * in `ProductActions`' own panel slot — the same slot the contact panel occupies — because it has
 * to expand downward under its button, in the page's flow, exactly as the contact panel does; a
 * fixed popover hanging over the page could never be that. Both shapes wear the same rows from
 * `ProductShareBody`; this file owns only what is true of a phone: the teleport (a `position:
 * fixed` panel must not inherit the sticky bar's `backdrop-blur` containing block), the backdrop,
 * the slide, the drag, and the thumb-reach close row.
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
  /** The control that opened the sheet, so a dismiss can hand focus back to it. */
  anchor: HTMLElement | null
}>()

const emit = defineEmits<{ close: [], copyLink: [], copyMessage: [] }>()

const { t } = useI18n()
const reduced = useReducedMotion()

// ---- swipe-to-dismiss — a single transform owner: Motion ----
// The grabber + header band is the drag handle. Motion owns the panel's `transform` outright — the
// enter/exit slide, the finger-follow, the snap-back and the dismiss are all the same `y` — so
// there is no CSS leave transition and an imperative WAAPI flick both writing transform. Drag
// starts only from the handle (`dragListener` off + `useDragControls`), a mouse is never a swipe,
// and the handle's own buttons stay clickable — a gesture that starts on a button is not a swipe.
// `dragConstraints { top: 0, bottom: 0 }` with `dragElastic { top: 0, bottom: 1 }` gives 1:1
// downward finger-follow, locks upward, and springs the sheet home automatically below the gate.
const SHEET_SWIPE_MIN_PX = 96
const SHEET_SWIPE_MIN_VEL = 500 // px/s (0.5 px/ms) — a short fast flick dismisses where a slow long drag does not
const SHEET_SWIPE_FLICK_PX = 16 // below this travel even a fast release reads as a tap artifact
const dragControls = useDragControls()

// Begin the Motion drag only from the handle, never on a mouse or a button. The press arrives from
// `ProductShareBody`'s band, which is where the handle's markup lives.
const onHandlePointerDown = (event: PointerEvent) => {
  if (event.pointerType === 'mouse') return
  if ((event.target as HTMLElement).closest('button')) return
  dragControls.start(event)
}

// Releasing past either gate closes the sheet; AnimatePresence plays the exit from wherever the
// finger lifted, so the dismiss is velocity-continuous rather than teleporting to the top of a
// keyframe. Below both gates we leave it open and the dragConstraints spring returns it home on
// its own.
const onDragEnd = (_event: PointerEvent, info: { offset: { y: number }, velocity: { y: number } }) => {
  const dismissed = info.offset.y > SHEET_SWIPE_MIN_PX
    || (info.offset.y > SHEET_SWIPE_FLICK_PX && info.velocity.y > SHEET_SWIPE_MIN_VEL)
  if (dismissed) close()
}

const close = (returnFocus = true) => {
  emit('close')
  if (returnFocus) props.anchor?.focus()
}

// Escape belongs to the sheet while it is open, answered document-wide rather than only inside the
// panel: the sheet is teleported outside the mount that opened it, and a click on a non-focusable
// part of the backdrop moves focus to `<body>` — a sheet that only listened to its own subtree
// would then have trapped the visitor in it.
const onKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }

watch(() => props.open, (open) => {
  if (open) document.addEventListener('keydown', onKeydown)
  else document.removeEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <AnimatePresence>
      <motion.div
        v-if="open"
        key="share-backdrop"
        data-share-backdrop
        class="fixed inset-0 z-[60] bg-zinc-950/45 outline-none backdrop-blur-md backdrop-saturate-150 dark:bg-zinc-950/65"
        :initial="{ opacity: 0 }"
        :animate="{ opacity: 1 }"
        :exit="{ opacity: 0 }"
        :transition="{ duration: reduced ? 0.12 : 0.22 }"
        @click.self="close(false)"
      >
        <motion.div
          key="share-sheet"
          data-share-sheet
          role="dialog"
          aria-modal="true"
          :aria-label="t('shareSheetLabel', { name: payload.title })"
          tabindex="-1"
          class="fixed inset-x-0 bottom-0 flex max-h-[85dvh] w-full max-w-lg min-w-0 flex-col overflow-y-auto overscroll-contain rounded-t-3xl border border-zinc-200/80 bg-white pb-[max(1rem,env(safe-area-inset-bottom))] text-zinc-950 shadow-xl outline-none dark:border-zinc-800/80 dark:bg-zinc-900 dark:text-white"
          :initial="reduced ? { opacity: 0 } : { opacity: 0, y: '100%' }"
          :animate="{ opacity: 1, y: 0 }"
          :exit="reduced ? { opacity: 0 } : { opacity: 0, y: '100%' }"
          :transition="reduced ? { duration: 0.18 } : sheet.transition"
          :drag="'y'"
          :drag-controls="dragControls"
          :drag-listener="false"
          :drag-constraints="{ top: 0, bottom: 0 }"
          :drag-elastic="{ top: 0.15, bottom: 1 }"
          :drag-momentum="false"
          @drag-end="onDragEnd"
        >
          <ProductShareBody
            compact
            :payload="payload"
            :destinations="destinations"
            :feedback="feedback"
            :reveal-link="revealLink"
            @close="close()"
            @copy-link="emit('copyLink')"
            @copy-message="emit('copyMessage')"
            @drag-start="onHandlePointerDown"
          />

          <!-- Thumb-reachable dismiss for the phone sheet. The header close sits at the top of a
               bottom sheet — the far corner from the hand holding the phone — so the same action is
               repeated here at the bottom edge, inside easy reach. -->
          <motion.button
            type="button"
            data-share-close-bottom
            :aria-label="t('close')"
            :while-press="reduced ? undefined : { scale: press.scale }"
            :transition="press.transition"
            class="mx-auto mt-3 flex h-11 w-full min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-zinc-300/80 bg-white text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
            @click="close()"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            {{ t('close') }}
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  </Teleport>
</template>
