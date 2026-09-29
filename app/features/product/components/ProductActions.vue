<script setup lang="ts">
import type { ProductContactChannel } from '~/types/product-contact'
import type { ProductShareDestination, ProductSharePayload } from '../composables/useProductShare'
import type { ProductStockState } from '~/utils/product-stock'
import { selectOnFocus } from '~/utils/clipboard'
import { platformLabel } from '~/utils/social-prefill'
import { motion, useReducedMotion } from 'motion-v'
import { press } from '~/utils/motion'
import type { ComponentPublicInstance } from 'vue'

// Presentational, and it lives behind the product feature boundary because nothing but the product
// detail page renders it. The channel list, the stock band, the ready message, the canonical link,
// the share payload and destinations, and both confirmations all arrive as props from
// `ProductConversion`, which owns the behaviour; this component only decides what the row looks
// like, which of its two surfaces is open, and which event to emit. That split is why the inline
// block and the mobile sticky bar can be two mounts of one component without a second
// implementation of anything — including Share, which the sticky bar carries for exactly the same
// reason the inline block does.
const props = defineProps<{
  state: ProductStockState
  channels: ProductContactChannel[]
  url: string
  message: string
  feedback: string
  /** What the sheet's own last copy did. Kept apart from `feedback` because one string spoken by two
   * live regions would be heard twice, and while the sheet is open it is the surface the visitor is
   * looking at — the bar's own line sits behind it. */
  sheetFeedback: string
  /** The payload the sheet shows and its rows carry. Composed by the owner of the share capability,
   * never rebuilt here. */
  share: ProductSharePayload
  destinations: ProductShareDestination[]
  /** Set once a copy could not be completed: reveals the canonical link as selectable text, so
   * "copy it yourself" is an instruction the visitor can actually carry out. */
  revealLink?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{ copy: [], copyLink: [], copyMessage: [] }>()

const { t } = useI18n()

// Each mount keeps its own open flags — the inline block and the sticky bar are two separate
// affordances, and opening one should not move the other. Nothing here is shared with the gallery:
// the lightbox owns its own state, and neither this panel nor this sheet reads it.
const panelId = useId()
const messageId = useId()
const isOpen = ref(false)
// Phase B moved the press feedback off CSS `active:scale` onto a Motion spring, so these controls
// are `<motion.button>` now. A template ref on a motion component resolves to its instance, not its
// DOM node — the same reason motion-v reaches its element through `instance.$el`. ctaEl/shareEl
// unwrap that node so the FLIP measurement, the popover anchor, and the dismiss focus all target the
// exact same <button> as before: the contact-panel morph is untouched, only the element handle moved.
const ctaBtn = ref<ComponentPublicInstance | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const isSheetOpen = ref(false)
const shareBtn = ref<ComponentPublicInstance | null>(null)
const ctaEl = computed<HTMLElement | null>(() => (ctaBtn.value?.$el as HTMLElement) ?? null)
const shareEl = computed<HTMLElement | null>(() => (shareBtn.value?.$el as HTMLElement) ?? null)
// Reactive prefers-reduced-motion (useMediaQuery-backed): false during SSR, synced on mount — so it
// never changes a rendered attribute and cannot cause a hydration mismatch. The press is gated on it
// in the template, reproducing the old `motion-safe:` contract: no scale is emitted under `reduce`.
const reduced = useReducedMotion()

// Out of stock must not read as "buy now": the same action, worded as the question it actually is.
const ctaLabel = computed(() => props.state === 'out' ? t('askAboutAvailability') : t('contactToOrder'))

// Opening the desktop panel also reveals it: the page scrolls down just enough that the panel
// comes to rest directly under the sticky header, which carries the CTA's own content off the
// top edge. The compact (sticky-bar) mount is deliberately excluded — its panel already floats
// above the bar at the viewport edge, so there is nothing to reveal.
const REVEAL_GAP = 12
// Exactly one of this mount's two surfaces is open at a time: opening the panel closes the sheet
// and vice-versa. They are separate affordances but stacking a dropdown under a modal popover (or
// the reverse) reads as a bug, and Escape already assumes a topmost surface.
const toggle = () => {
  const opening = !isOpen.value
  if (opening) isSheetOpen.value = false
  isOpen.value = opening
}

// The info column is `lg:sticky`, and a sticky element keeps re-resolving its own offset as the
// page scrolls — so a panel inside it would drift away from wherever a one-shot measurement aimed.
// The reliable move is to take the column out of the stickiness for exactly as long as the panel
// is open: pin it to `static`, scroll to the now-stable destination, and restore the class-driven
// position on close (or unmount, or a product swap). `[data-detail-info-col]` and
// `[data-detail-header]` are page contracts owned by [id].vue — this component reads them, it
// does not style them.
const pinnedCol = ref<{ el: HTMLElement, prev: string } | null>(null)
const unpinColumn = () => {
  if (!pinnedCol.value) return
  pinnedCol.value.el.style.position = pinnedCol.value.prev
  pinnedCol.value = null
}
const pinColumnStatic = (panel: HTMLElement) => {
  const column = panel.closest('[data-detail-info-col]') as HTMLElement | null
  if (column && !pinnedCol.value) {
    pinnedCol.value = { el: column, prev: column.style.position }
    column.style.position = 'static'
  }
}

// Only the scroll waits for the settled layout; the column pin happens synchronously in the
// enter hook, before the FLIP measures anything (see below).
watch(isOpen, (open) => {
  if (props.compact) return
  if (!open) { unpinColumn(); return }
  void nextTick(() => {
    const panel = panelEl.value
    if (!panel) return
    // The panel is mid-FLIP by now — its rect is the morph, not the destination. Its layout
    // position is still exact: `offsetTop` inside the untransformed `[data-product-actions]`
    // host, added to the host's document position, names the settled top for the reveal.
    const host = panel.closest('[data-product-actions]') as HTMLElement | null
    if (!host) return
    const headerH = document.querySelector('[data-detail-header]')?.getBoundingClientRect().height ?? 0
    const target = Math.max(0, host.getBoundingClientRect().top + window.scrollY + panel.offsetTop - headerH - REVEAL_GAP)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' })
  })
})

onBeforeUnmount(unpinColumn)

// ---- Contact panel: FLIP expand out of the button ----
// The panel grows from the CTA's own footprint on both axes — the same shared-element morph the
// search dock's spotlight plays (SearchDock measures the launcher rect and scales the panel from
// it) — instead of a vertical squash, which distorts the message text, or a fade. Measure the
// button and the panel's settled box, invert the panel onto the button with a translate + scale,
// then play it back to identity. Each mount is measured against its own button, so the inline
// panel expands down out of the row and the sticky one up out of the bar, and closing retracts it
// back down into the button it came from. Driven by JS hooks, not CSS classes, because the start
// transform is measured, not known ahead of time.
//
// The translate is what makes it land *on the button* rather than collapsing toward some corner, so
// it runs under reduced motion too — this is a short, contained morph of one element, not the
// large-area travel reduced motion exists to suppress. Reduced motion only trims the duration.
const FLIP_IN_MS = 480
const FLIP_OUT_MS = 380
const FLIP_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'
const REDUCED_IN_MS = 340
const REDUCED_OUT_MS = 260
const prefersReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
// The panel's settled box mapped onto the button's: translate its top-left to the button's top-left
// and scale it down to the button's size. Played forward that is grow-out-of-the-button; played in
// reverse (leave) it is retract-back-into-the-button, on both mounts, because the button's live
// rect is the anchor.
const flipCss = (el: HTMLElement) => {
  const t = ctaEl.value?.getBoundingClientRect()
  const p = el.getBoundingClientRect()
  if (!t || !p.width || !p.height) return null
  return `translate(${t.left - p.left}px, ${t.top - p.top}px) scale(${t.width / p.width}, ${t.height / p.height})`
}
// A FLIP inverts the element's *settled* box, so the box must be measured at rest. Toggling the
// panel mid-flight leaves the previous transition's partial transform on the element: measuring
// through it compounds two inverses, which is what made an interrupted exit land at an arbitrary
// scale and position instead of back on the button. Freeze any running transition, clear the
// in-flight transform, and force the reflow that commits the rest geometry — every later rect in
// this tick is then the layout box, never a half-morphed one.
const settleForMeasurement = (p: HTMLElement) => {
  p.style.transition = 'none'
  p.style.transform = ''
  p.style.opacity = ''
  void p.offsetWidth // the write above only becomes a measurable rect after this read flushes it
  p.style.transition = ''
}
// The fallback timeout is the direction's own duration plus one frame's grace: a leave that reused
// the enter's longer budget would hold the unmount hostage for the difference.
const onceSettled = (el: HTMLElement, ms: number, done: () => void) => {
  const finish = (e?: TransitionEvent) => {
    if (e && e.target !== el) return
    el.removeEventListener('transitionend', finish)
    done()
  }
  el.addEventListener('transitionend', finish)
  setTimeout(finish, ms + 220) // a zero-size or hidden element may never fire transitionend
}
// The enter is measured in the `enter` hook, not `before-enter`: Vue calls `before-enter` while
// the panel is still a detached node, and its rect there is all zeros — an inversion computed from
// it silently degrades the entry to a fade. The reveal scroll therefore aims at the panel's
// layout position via `offsetTop`, which no in-flight transform can distort (see the watch above).
const onPanelEnter = (el: Element, done: () => void) => {
  const p = el as HTMLElement
  // Pin before the first measurement: the column goes `static` synchronously, so the settled box
  // the flip inverts is the one the panel will actually hold for the reveal scroll.
  if (!props.compact) pinColumnStatic(p)
  settleForMeasurement(p)
  p.style.transformOrigin = 'top left'
  p.style.opacity = '0'
  const start = flipCss(p)
  if (start) p.style.transform = start
  void p.offsetWidth // commit the inversion — without this flush the transition's "from" is the rest box
  const ms = prefersReduced() ? REDUCED_IN_MS : FLIP_IN_MS
  p.style.transition = `transform ${ms}ms ${FLIP_EASE}, opacity 220ms ease`
  p.style.transform = 'translate(0px, 0px) scale(1, 1)'
  p.style.opacity = '1'
  onceSettled(p, ms, done)
}
const onPanelAfterEnter = (el: Element) => {
  const p = el as HTMLElement
  p.style.transition = ''
  p.style.transform = ''
  p.style.opacity = ''
  p.style.transformOrigin = ''
}
const onPanelLeave = (el: Element, done: () => void) => {
  const p = el as HTMLElement
  // Settle first, then aim: the exit is computed from the same rest box the entry was, and against
  // the button's live rect, so a close that interrupts an open retraces the identical path home.
  settleForMeasurement(p)
  p.style.transformOrigin = 'top left'
  const end = flipCss(p)
  const ms = prefersReduced() ? REDUCED_OUT_MS : FLIP_OUT_MS
  p.style.transition = `transform ${ms}ms ${FLIP_EASE}, opacity ${ms}ms ease`
  if (end) p.style.transform = end
  p.style.opacity = '0'
  onceSettled(p, ms, done)
}

// The sheet is opened by this mount's own Share button, which stays its anchor: a desktop popover is
// placed beside the control the visitor just pressed, and a phone's bottom sheet is anchored to the
// viewport instead and needs no measurement at all. Opening it closes the contact panel (one surface
// at a time).
const openSheet = () => {
  isOpen.value = false
  isSheetOpen.value = true
}

// Escape closes the topmost thing this mount opened, and only that one: the sheet floats above the
// panel, so pressing it once should take the sheet away and leave the panel. Both hand focus back to
// the control that opened them — the dismiss removes whatever was focused inside, and a visitor left
// on `<body>` loses their place in the tab order entirely.
const close = (returnFocus = false) => {
  if (isSheetOpen.value) {
    isSheetOpen.value = false
    if (returnFocus) void nextTick(() => shareEl.value?.focus())
    return
  }
  isOpen.value = false
  if (returnFocus) void nextTick(() => ctaEl.value?.focus())
}

// Selecting the revealed link on focus is what makes the manual path a single click: the visitor
// who was told to copy by hand should not also have to drag across the address. The rule is
// `app/utils/clipboard.ts`'s, because the sheet reveals the same link for the same reason.

// The stored platform string stays the row's identity; only its first letter is shown capitalised.
// One owner for that rule (`platformLabel`), because the share sheet names a destination the same way.
const channelName = platformLabel
</script>

<template>
  <div
    data-product-actions
    class="relative min-w-0 w-full"
    @keydown.esc="close(true)"
  >
    <!-- The row stays a row at every width: `min-w-0` plus a truncating label is what keeps a long
         Khmer string from widening the page. -->
    <div class="flex min-w-0 gap-2 sm:gap-3">
      <motion.button
        v-if="channels.length"
        ref="ctaBtn"
        type="button"
        data-contact-cta
        :aria-expanded="isOpen"
        :aria-controls="panelId"
        :while-press="reduced ? undefined : { scale: press.scale }"
        :transition="press.transition"
        class="inline-flex h-11 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white shadow-xs transition-[background-color,color,border-color] duration-150 ease-out hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:px-5 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950"
        :class="compact ? 'flex-1' : 'flex-1 sm:flex-none'"
        @click="toggle"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="truncate">{{ ctaLabel }}</span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 transition-transform duration-200" :class="isOpen ? 'rotate-180' : ''" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </motion.button>

      <!-- Share is a secondary at the same height and shape, so the hierarchy is carried by fill
           rather than by size. It is the same control on a phone as on a desktop — two
           implementations of "the Share button" is how one of them stops working — and on the sticky
           row it takes only the room its own label needs, because at 320px the primary action's
           wording is the thing worth keeping whole. -->
      <motion.button
        ref="shareBtn"
        type="button"
        data-share-cta
        :aria-expanded="isSheetOpen"
        :while-press="reduced ? undefined : { scale: press.scale }"
        :transition="press.transition"
        class="inline-flex h-11 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-zinc-300/80 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-xs transition-[background-color,color,border-color] duration-150 ease-out hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:px-5 dark:border-zinc-700/70 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950"
        :class="compact ? (channels.length ? 'shrink-0' : 'flex-1') : 'flex-1 sm:flex-none'"
        @click="openSheet"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>
        <span class="truncate">{{ t('share') }}</span>
      </motion.button>
    </div>

    <!-- Only ever rendered after a copy actually failed. The last thing this flow should do is tell a
         visitor to copy a link they cannot see — which is what happened while the canonical address
         existed only inside the message field, behind a closed panel. Read-only, selected on focus,
         and labelled so the accessible name is "Product link" rather than an anonymous field. The
         sheet carries its own copy of this fallback while it is open, because that is where the
         visitor was asked to copy from. -->
    <div v-if="revealLink && !isSheetOpen" class="mt-2 flex min-w-0 items-center">
      <input
        readonly
        type="text"
        inputmode="url"
        :value="url"
        data-share-link
        :aria-label="t('shareLinkLabel')"
        class="min-w-0 w-full truncate rounded-xl border border-zinc-200/80 bg-white px-3 py-2 text-xs text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-800/80 dark:bg-zinc-950 dark:text-zinc-300 dark:focus-visible:ring-white"
        @focus="selectOnFocus"
      />
    </div>

    <!-- Anchored above itself in the sticky variant (the bar sits at the viewport edge, so the
         panel has nowhere to go but up) and in normal flow inline. `max-h` + `overflow-y-auto`
         keeps a long channel list inside the screen instead of pushing the page wider or taller —
         roomier inline, where the page can scroll with it, tighter afloat on a phone. `tabindex`
         is on the scroll box itself: a region that scrolls but cannot be focused is unreachable
         from the keyboard, and a shop with six channels would otherwise hide four of them from
         exactly the visitor least able to discover the scrollbar.
         The surface is set once per variant rather than base-plus-override: two background
         utilities in the same class list are one layer apart in the stylesheet, so the translucent
         inline wash used to win over the solid one this variant needs — and a see-through panel
         floats over the product photo, which is the one place a backdrop must not be transparent.

         The order is the sequence it asks for: read the message, copy it, then open a channel.
         A channel row is a plain link and deliberately copies nothing on its way out — an
         asynchronous clipboard write cannot be awaited before a link navigates, because keeping
         the write means giving up the navigation (a `window.open` after an `await` has no user
         activation left and is popup-blocked). Firing the copy and navigating anyway would leave
         the visitor unable to tell whether the copy worked, which is worse than not offering it.

         The enter is a FLIP morph out of the button (see the JS hooks above): the panel is measured
         against the CTA and scaled up from its footprint on both axes, so it reads as the surface
         expanding out of the control rather than a box appearing nearby. Transform and opacity only,
         so the page behind never moves. -->
    <Transition
      @enter="onPanelEnter"
      @after-enter="onPanelAfterEnter"
      @leave="onPanelLeave"
    >
      <div
        v-if="isOpen && channels.length"
        :id="panelId"
        ref="panelEl"
        data-contact-panel
        role="group"
        :aria-label="ctaLabel"
        tabindex="0"
        class="min-w-0 space-y-3 overflow-y-auto rounded-2xl border border-zinc-200/80 p-4 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-800/80 dark:focus-visible:ring-white"
        :class="compact ? 'absolute inset-x-0 bottom-full mb-2 max-h-[55vh] bg-white shadow-lg dark:bg-zinc-900' : 'mt-3 max-h-[70vh] bg-zinc-50/80 dark:bg-zinc-900/70'"
      >
        <!-- The message is shown, not hidden: the visitor sees exactly what the shop will receive, and
             a browser that refuses the clipboard still leaves them something to select. The field
             sizes to its own content, because the message is four sentences plus a URL: at a phone
             width the link wraps, and a fixed five rows clipped the one line a visitor most needs to
             check. `rows` stays as the fallback where `field-sizing` is unsupported, and the cap keeps
             a pathologically long product name from turning the panel into a wall of text. -->
        <label
          :for="messageId"
          class="block text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500"
        >
          {{ t('contactMessageLabel') }}
        </label>
        <textarea
          :id="messageId"
          readonly
          rows="5"
          data-contact-message
          :value="message"
          class="no-scrollbar field-sizing-content max-h-44 w-full min-w-0 resize-none rounded-xl border border-zinc-200/80 bg-white p-3 text-xs leading-relaxed text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-800/80 dark:bg-zinc-950 dark:text-zinc-300 dark:focus-visible:ring-white"
        />

        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            data-copy-message
            class="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-zinc-300/80 bg-white px-4 text-xs font-semibold text-zinc-700 shadow-xs transition-colors duration-200 hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white dark:focus-visible:ring-white"
            @click="emit('copy')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
            {{ t('copyMessage') }}
          </button>
          <p class="min-w-0 flex-1 text-xs leading-relaxed text-zinc-500">
            {{ t('contactHint') }}
          </p>
        </div>

        <p class="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
          {{ t('chooseChannel') }}
        </p>

        <!-- Real links, real hrefs, and the only copy action in this panel is the button above: no
             click handler here, so nothing on this list races a navigation. -->
        <ul class="space-y-1.5">
          <li v-for="channel in channels" :key="channel.key">
            <a
              :href="channel.href"
              :target="channel.external ? '_blank' : undefined"
              :rel="channel.external ? 'noopener noreferrer' : undefined"
              :data-contact-channel="channel.key"
              :data-contact-prefilled="channel.prefilled"
              class="flex min-w-0 items-center gap-2 rounded-full border border-zinc-200/80 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-xs transition-colors duration-200 hover:border-zinc-300 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:text-white dark:focus-visible:ring-white"
            >
              <!-- The brand marks come from the one source the masthead uses, so a channel is named
                   by the same silhouette the visitor already saw in the header. Phone keeps the
                   drawn glyph it has always had. -->
              <svg v-if="channel.platform === 'phone'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 opacity-70" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <SocialBrandIcon v-else :platform="channel.platform" class="shrink-0 opacity-70" />
              <span class="shrink-0">{{ channelName(channel.label) }}</span>
              <span v-if="channel.value" class="min-w-0 flex-1 truncate text-right font-normal tabular-nums text-zinc-500 dark:text-zinc-400">{{ channel.value }}</span>
              <!-- The row says what it does. A link that carries the message does not tell the
                   visitor to paste anything, and one that cannot is not allowed to imply that it did. -->
              <span v-else class="min-w-0 flex-1 truncate text-right text-xs font-normal text-zinc-500 dark:text-zinc-400">
                {{ channel.prefilled ? t('channelPrefilled') : t('channelCopyFirst') }}
              </span>
            </a>
          </li>
        </ul>
      </div>
    </Transition>

    <!-- The sheet itself is `ProductShareSheet`'s business; this mount only says that it is open,
        where it is anchored, and which of the three things the visitor did was intended. -->
    <ProductShareSheet
      :open="isSheetOpen"
      :payload="share"
      :destinations="destinations"
      :feedback="sheetFeedback"
      :reveal-link="!!revealLink"
      :anchor="shareEl"
      @close="isSheetOpen = false"
      @copy-link="emit('copyLink')"
      @copy-message="emit('copyMessage')"
    />

    <!-- One polite live region for the panel's confirmations: it announces "Message copied." without
         stealing focus, and it sits outside the panel so the text is still read when the panel has
         already been dismissed. The sheet has its own, for as long as it is the surface in front. -->
    <p
      role="status"
      aria-live="polite"
      data-contact-feedback
      class="mt-2 min-h-5 text-xs font-medium text-zinc-500 dark:text-zinc-400"
    >{{ feedback }}</p>
  </div>
</template>

