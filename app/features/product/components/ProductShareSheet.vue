<script setup lang="ts">
import type { ProductShareDestination, ProductSharePayload } from '../composables/useProductShare'
import { platformLabel } from '~/utils/social-prefill'
import { selectOnFocus } from '~/utils/clipboard'
import { AnimatePresence, animate, motion, useDragControls, useReducedMotion } from 'motion-v'
import { applePop, collapseTransform, copyPop, press, sheet } from '~/utils/motion'
import type { ComponentPublicInstance } from 'vue'

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
// The side it landed on is recorded with the position because the fold belongs to that edge: the
// panel scales open from whichever of its own edges touches the trigger, not from its centre.
const panelEl = ref<ComponentPublicInstance | null>(null)
// A template ref on the motion panel is its instance, not its node (the same reason motion-v reaches
// its element through `instance.$el`); place() measures the real box through this.
const panelNode = computed<HTMLElement | null>(() => (panelEl.value?.$el as HTMLElement) ?? null)
const placed = ref<{ left: number, top: number, side: 'below' | 'above' } | null>(null)
const reduced = useReducedMotion()

// Tactile copy confirmation (Phase G): a one-shot `copyPop` on the copy button. It fires on `click`,
// after `while-press` has released on pointer-up, so the two never race for the same transform. The
// template ref on a motion component is its instance, so the pulse unwraps `.$el` to reach the node.
const copyLinkBtn = ref<ComponentPublicInstance | null>(null)
const copyMsgBtn = ref<ComponentPublicInstance | null>(null)
const popCopy = (inst: ComponentPublicInstance | null) => {
  const el = inst?.$el as HTMLElement | undefined
  if (el && !reduced.value) animate(el, { scale: [...copyPop.keyframes] }, copyPop.transition)
}
const onCopyLink = () => { emit('copyLink'); popCopy(copyLinkBtn.value) }
const onCopyMessage = () => { emit('copyMessage'); popCopy(copyMsgBtn.value) }

const place = () => {
  const el = panelNode.value
  const box = props.anchor?.getBoundingClientRect()
  if (!el || !box) return
  const margin = 12
  const gap = 8
  const left = Math.min(Math.max(box.left, margin), Math.max(margin, innerWidth - el.offsetWidth - margin))
  const below = box.bottom + gap
  const fits = below + el.offsetHeight <= innerHeight - margin
  const top = fits ? below : Math.max(margin, box.top - el.offsetHeight - gap)
  placed.value = { left, top, side: fits ? 'below' : 'above' }
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

// The panel's coordinates come from `placed` and nowhere else. It used to fall back to
// `props.anchor.getBoundingClientRect()` here, which put a forced layout in the render path: this
// computed re-runs on every re-place (a scroll frame, a resize), so each one read a rect and then
// wrote inline styles — read–write–read on the very frame the popover is trying to move, and the
// second read of the same box `place()` already measured. Nothing is lost by dropping it: while
// `placed` is still null the panel is `visibility: hidden`, so its coordinates cannot be seen.
const panelStyle = computed(() => {
  if (!isDesktop.value) return undefined
  const box = placed.value
  return {
    left: `${box?.left ?? 12}px`,
    top: `${box?.top ?? 12}px`,
    // `place()` pins the popover's left edge to the anchor's own left edge, so the control sits at this
    // panel's top-left (hanging below it) or bottom-left (flipped above) — the corner it blooms from and
    // collapses back into.
    'transform-origin': box?.side === 'above' ? 'bottom left' : 'top left',
    visibility: box ? 'visible' : 'hidden'
  }
})

// ---- swipe-to-dismiss (phone sheet) — a single transform owner: Motion ----
// The grabber + header band is the drag handle. On a phone, Motion owns the panel's `transform`
// outright — the enter/exit slide, the finger-follow, the snap-back and the dismiss are all the same
// `y` — so there is no longer a CSS leave transition and an imperative WAAPI flick both writing
// transform. Drag starts only from the handle (`dragListener` off + `useDragControls`), a mouse is
// never a swipe, and the handle's own buttons stay clickable — a gesture that starts on a button is
// not a swipe. `dragConstraints { top: 0, bottom: 0 }` with `dragElastic { top: 0, bottom: 1 }` gives
// 1:1 downward finger-follow, locks upward, and springs the sheet home automatically below the gate.
const SHEET_SWIPE_MIN_PX = 96
const SHEET_SWIPE_MIN_VEL = 500 // px/s (0.5 px/ms) — a short fast flick dismisses where a slow long drag does not
const SHEET_SWIPE_FLICK_PX = 16 // below this travel even a fast release reads as a tap artifact
const dragControls = useDragControls()

// Begin the Motion drag only from the handle, only on a phone, never on a mouse or a button.
const onHandlePointerDown = (event: PointerEvent) => {
  if (isDesktop.value || event.pointerType === 'mouse') return
  if ((event.target as HTMLElement).closest('button')) return
  dragControls.start(event)
}

// Releasing past either gate closes the sheet; AnimatePresence plays the exit from wherever the finger
// lifted, so the dismiss is velocity-continuous rather than teleporting to the top of a keyframe.
// Below both gates we leave it open and the dragConstraints spring returns it home on its own.
const onDragEnd = (_event: PointerEvent, info: { offset: { y: number }, velocity: { y: number } }) => {
  const dismissed = info.offset.y > SHEET_SWIPE_MIN_PX
    || (info.offset.y > SHEET_SWIPE_FLICK_PX && info.velocity.y > SHEET_SWIPE_MIN_VEL)
  if (dismissed) close()
}

// Both shapes are one motion language but two physics, because they are two kinds of thing. The
// desktop popover is a menu, so it reads `applePop` — the SAME preset the Contact-to-Order panel
// animates with: a uniform scale plus a few px of travel back toward the control that opened it,
// opacity on its own short curve rather than on the spring, and a shorter ease-in exit. It used to
// unfold on `scaleY(0.5 → 1)` with the fade blended into the spring, which both stretched the copy
// rows vertically and made the two menus feel different. The phone sheet keeps its `y` slide: that one
// is a dragged gesture surface, so its spring has to stay velocity-aware for the drag handoff.
// Reduced motion drops the sheet's position change to a fade and keeps the popover's position-free
// scale — the same tiering the removed CSS classes carried.
//
// Which offset the bloom starts from is whichever edge of the popover faces the trigger. `place()`
// decides that on the frame the panel enters, and until it does the panel is `visibility: hidden`;
// the common case (a popover hanging below its control) is the default, so in the rare flip to
// `above` the first unpainted frames start from the other 8px. The settle target is reactive, so it
// still lands in the right place and travels the same distance.
const popSide = computed(() => placed.value?.side ?? 'below')
const popShrink = 'scale(0.94) translateY(0px)'

const panelInitial = computed(() => isDesktop.value
  ? (reduced.value ? { opacity: 0, transform: popShrink } : { opacity: 0, transform: applePop[popSide.value].from })
  : (reduced.value ? { opacity: 0 } : { opacity: 0, y: '100%' }))
const panelAnimate = computed(() => (isDesktop.value
  ? { opacity: 1, transform: applePop.rest }
  : { opacity: 1, y: 0 }))
const panelExit = computed(() => isDesktop.value
  ? (reduced.value
      ? { opacity: 0, transform: popShrink }
      // motion-v honours a `transition` key inside a variant target (it destructures it off the
      // resolved variant), which is what lets the exit be a 160ms ease-in while the enter stays a spring.
      // Desktop dismisses into its control — the genie, measured against the anchor so it lands on the
      // button — while the enter stays the uniform bloom. The phone sheet never comes here: its
      // transform belongs to the drag, which has to hand release velocity to the exit.
      : { opacity: 0, transform: collapseTransform(panelNode.value, props.anchor), transition: { ...applePop.exit, opacity: applePop.opacity.out } })
  : (reduced.value ? { opacity: 0 } : { opacity: 0, y: '100%' }))
const panelTransition = computed(() => reduced.value
  ? { duration: 0.18 }
  : (isDesktop.value ? { ...applePop.transition, opacity: applePop.opacity.in } : sheet.transition))

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
    <AnimatePresence>
      <motion.div
        v-if="open"
        key="share-backdrop"
        data-share-backdrop
        class="fixed inset-0 z-[60] outline-none"
        :class="isDesktop ? '' : 'bg-zinc-950/45 backdrop-blur-md backdrop-saturate-150 dark:bg-zinc-950/65'"
        :initial="{ opacity: 0 }"
        :animate="{ opacity: 1 }"
        :exit="{ opacity: 0 }"
        :transition="{ duration: reduced ? 0.12 : 0.22 }"
        @click.self="close(false)"
      >
        <motion.div
          ref="panelEl"
          key="share-sheet"
          data-share-sheet
          role="dialog"
          :aria-modal="isDesktop ? 'false' : 'true'"
          :aria-label="t('shareSheetLabel', { name: payload.title })"
          tabindex="-1"
          class="flex min-w-0 flex-col border border-zinc-200/80 bg-white text-zinc-950 shadow-xl outline-none dark:border-zinc-800/80 dark:bg-zinc-900 dark:text-white"
          :class="isDesktop
            ? 'fixed w-72 max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-2xl p-3'
            : 'fixed inset-x-0 bottom-0 max-h-[85dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))]'
          "
          :style="panelStyle"
          :initial="panelInitial"
          :animate="panelAnimate"
          :exit="panelExit"
          :transition="panelTransition"
          :drag="isDesktop ? false : 'y'"
          :drag-controls="dragControls"
          :drag-listener="false"
          :drag-constraints="{ top: 0, bottom: 0 }"
          :drag-elastic="{ top: 0.15, bottom: 1 }"
          :drag-momentum="false"
          @drag-end="onDragEnd"
        >
          <!-- The grabber reads as "this slides", and is the only thing on a desktop popover that
               would read as a browser dialog instead of a control. On the phone it is also the top
               of the drag handle: grabbing it (or the header band beside it) and pulling down
               dismisses the sheet — see `onHandlePointer*` above. -->
          <div
            data-share-drag
            class="shrink-0"
            :class="isDesktop ? '' : 'sheet-drag-handle'"
            @pointerdown="onHandlePointerDown"
          >
            <div v-if="!isDesktop" class="mx-auto mb-1 mt-3 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />

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
                @click="close()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </motion.button>
            </div>
          </div>

          <!-- One shared 16px content inset for every interactive row: the sheet's own p-3 plus this
               px-2 puts the Copy rows' icons on the same vertical line as the destination pills' icons
               below, so the whole panel reads as one column of controls rather than two systems. -->
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
               count comes from the container, not from a breakpoint, because the popover and the
               sheet give the same list different widths. -->
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

          <!-- Thumb-reachable dismiss for the phone sheet. The header close sits at the top of a
               bottom sheet — the far corner from the hand holding the phone — so the same action is
               repeated here at the bottom edge, inside easy reach. Desktop omits it: the popover is
               anchored under the cursor and already has its header close, and a second control there
               would just be clutter. -->
          <motion.button
            v-if="!isDesktop"
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

<style scoped>
/* The phone sheet's drag handle opts out of browser scrolling over its own band, so the vertical
   gesture belongs to the Motion drag rather than to the sheet's `overflow-y-auto`. The desktop
   popover never gets this class — its header is not a handle. The enter/exit, the finger-follow, the
   snap-back and the dismiss are now one `y` owned by Motion (Phase C.2), so there is no CSS
   transition or @keyframes here any more — only the touch-action that lets the browser hand the
   vertical swipe to the drag instead of to the page scroll. */
.sheet-drag-handle {
  touch-action: none;
}
</style>
