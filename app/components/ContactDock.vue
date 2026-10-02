<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import type { SiteInfo } from '~/types/site-info'
import { animate, motion, useReducedMotion } from 'motion-v'
import { applePop, collapseTransform, press } from '~/utils/motion'
import { platformLabel } from '~/utils/social-prefill'
import { getSiteContactChannels } from '~/utils/site-contact'

/**
 * The storefront's standing contact entry: a corner control that answers "how do I reach this shop"
 * without making the visitor find a product first.
 *
 * Presentational by rule — the public `SiteInfo` the page already loaded arrives as a prop, and this
 * component issues no query. `useSiteInfo` narrowed it to the rows the shop marked contactable, and
 * `app/utils/site-contact.ts` turns those into channels; the product page's Contact to Order rows read
 * the same two, so one stored row cannot mean two different things on two surfaces.
 *
 * Desktop only. Every fixed control the storefront ships below `lg` — the search launcher, the category
 * bar, the product page's sticky CTA — already lives in this corner or across it, and each of those is
 * a tuned engine this change must not disturb.
 */
const props = defineProps<{
  siteInfo: SiteInfo | null
}>()

const { locale, t } = useI18n()
const panelId = useId()
const isOpen = ref(false)

// Reactive prefers-reduced-motion: false during SSR, synced on mount, so it never changes a rendered
// attribute. Same contract the product action row holds.
const reduced = useReducedMotion()

// The page the visitor is standing on, read where it is actually known: the incoming request while
// rendering, the live location afterwards. This dock mounts on the catalog page alone, so it is never
// left holding an old route.
const requestUrl = useRequestURL()
const pageUrl = () => import.meta.client ? window.location.href : requestUrl.href

/**
 * The channels, plus the one line they are allowed to carry. It must be real text, not `''`: a
 * prefilled row that opens an empty composer still claims it brought the message, which is the one
 * thing the channel rule refuses to do. There is no product in scope, so the line asks about the shop
 * rather than naming one.
 *
 * Nothing is copied from this panel, and no row tells the visitor to paste: the platforms that do not
 * document a prefill simply open, and a generic hello needs no draft handed to it. The Khmer wording is
 * the in-stock ask the product page already ships, so both locales describe the same enquiry.
 */
const channels = computed(() => getSiteContactChannels(props.siteInfo, {
  message: t('contactShopMessage'),
  pageUrl: pageUrl(),
  phoneLabel: t('phone')
}))

// A template ref on a motion component resolves to its instance, not its node — `.$el` is how
// motion-v reaches the element, so focus goes back to the same <button> that opened the panel.
const ctaBtn = ref<ComponentPublicInstance | null>(null)
const rootEl = ref<HTMLElement | null>(null)

const toggle = () => { isOpen.value = !isOpen.value }

// Escape returns focus to the control that opened the panel. A visitor left on `<body>` has lost their
// place in the tab order entirely, and this panel is scrollable, so it is where they were heading.
const close = (returnFocus = false) => {
  isOpen.value = false
  if (returnFocus) void nextTick(() => (ctaBtn.value?.$el as HTMLElement | undefined)?.focus())
}

// Click-away, and deliberately no modal backdrop: this is a popover, not a dialog, so the page stays
// usable and nobody is trapped behind an invisible layer. Capture phase so a press that lands on the
// page underneath is seen before anything else reacts to it.
const onPointerDown = (event: PointerEvent) => {
  const root = rootEl.value
  if (root && !root.contains(event.target as Node)) close()
}
watch(isOpen, (open) => {
  if (!import.meta.client) return
  if (open) document.addEventListener('pointerdown', onPointerDown, true)
  else document.removeEventListener('pointerdown', onPointerDown, true)
})

// ---- The panel's bloom in, and a genie collapse out ----
// Two different jobs, so two different physics. Arriving is a menu being offered: the uniform
// `applePop` bloom every other desktop menu uses, opacity on its own curve, no number retuned here.
// Leaving is a dismissal, and macOS dismissals go back *into* the thing they came from — so the exit
// collapses onto `applePop.collapse`, the shared genie value, which the Contact-to-Order panel and the
// Share popover now read too.
//
// `transform-origin: bottom right` is the corner the trigger actually occupies, and it anchors both
// directions: a popover grows from its control, and only modals keep `center` (the Share popover's
// anchor is its top-left, the inline contact panel's is its top-left as well — same rule, different
// corner). Under reduced motion the collapse is dropped entirely: it is pure movement, and the setting
// asks for the gentler equivalent rather than a smaller version of the same motion.
let running: { stop(): void } | null = null
const stopBloom = () => { running?.stop(); running = null }

const onEnter = (el: Element, done: () => void) => {
  const p = el as HTMLElement
  // A reopen that interrupted a leave inherits that leave's inline styles. Clear them first so the
  // enter starts from the box the panel actually rests in.
  stopBloom()
  p.style.transform = ''
  p.style.opacity = ''
  p.style.transformOrigin = 'bottom right'
  p.style.willChange = 'transform, opacity' // for the length of the pop only; cleared once it settles
  const red = reduced.value
  animate(p, { opacity: [0, 1] }, red ? { duration: 0.16, ease: 'easeOut' } : applePop.opacity.in)
  const a = animate(p, { transform: [applePop.above.from, applePop.rest] }, red ? { duration: 0.2, ease: 'easeOut' } : applePop.transition)
  running = a
  void a.finished.then(() => { if (running === a) running = null; done() })
}
const onAfterEnter = (el: Element) => {
  const p = el as HTMLElement
  p.style.transition = ''
  p.style.transform = ''
  p.style.opacity = ''
  p.style.transformOrigin = ''
  p.style.willChange = '' // a permanent will-change keeps the layer allocated and costs paint forever
}
const onLeave = (el: Element, done: () => void) => {
  const p = el as HTMLElement
  stopBloom()
  p.style.transform = ''
  p.style.transformOrigin = 'bottom right'
  p.style.willChange = 'transform, opacity' // the element unmounts when this finishes
  const red = reduced.value
  animate(p, { opacity: [1, 0] }, red ? { duration: 0.12, ease: 'easeIn' } : applePop.opacity.out)
  // Reduced motion drops the travel and the squash, keeping the fade: a collapse is pure movement, and
  // the setting asks for the gentler equivalent rather than a smaller version of the same motion.
  const a = animate(p, { transform: [applePop.rest, red ? applePop.above.to : collapseTransform(p, ctaBtn.value?.$el as HTMLElement | undefined)] }, red ? { duration: 0.16, ease: 'easeIn' } : applePop.exit)
  running = a
  void a.finished.then(() => { if (running === a) running = null; done() })
}

onBeforeUnmount(() => {
  if (import.meta.client) document.removeEventListener('pointerdown', onPointerDown, true)
  stopBloom()
})

// The stored platform string stays the row's identity; only its first letter is shown capitalised —
// the same owner (`platformLabel`) the contact rows and the Share Sheet name a destination with.
const channelName = platformLabel
</script>

<template>
  <!-- Teleported, for the reason every fixed control here is: the route transition writes a `transform`
       on the page element (`.page-enter-from` in main.css), and a transformed ancestor becomes the
       containing block of a `fixed` descendant — the dock would travel with the page for 220ms instead
       of holding its corner. `hidden` below `lg` is a real cost saving, not just placement: a
       `display: none` subtree lays out and paints nowhere, so mobile pays nothing and keeps the corner. -->
  <Teleport to="body">
    <div
      v-if="channels.length"
      ref="rootEl"
      data-contact-dock
      class="fixed right-10 bottom-10 z-40 hidden lg:block"
      @keydown.esc="close(true)"
    >
      <motion.button
        ref="ctaBtn"
        type="button"
        data-contact-dock-cta
        :aria-expanded="isOpen"
        :aria-controls="panelId"
        :aria-label="t('contactUs')"
        :while-press="reduced ? undefined : { scale: press.scale }"
        :transition="press.transition"
        class="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-zinc-200/80 bg-white text-zinc-950 shadow-xs transition-[background-color,color,border-color] duration-150 ease-out hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-800/80 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950"
        @click="toggle"
      >
        <!-- The message square the product CTA already carries: same action, same glyph. The color
             transition is deliberately transform-free so Motion owns this element's scale alone. -->
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 shrink-0" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </motion.button>

      <Transition
        @enter="onEnter"
        @after-enter="onAfterEnter"
        @leave="onLeave"
      >
        <div
          v-if="isOpen"
          :id="panelId"
          data-contact-dock-panel
          role="group"
          :aria-label="t('contactUs')"
          tabindex="0"
          class="absolute right-0 bottom-full mb-3 w-96 max-h-[60vh] space-y-2 overflow-y-auto rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-800/80 dark:bg-zinc-900 dark:focus-visible:ring-white"
        >
          <!-- Opaque on purpose. A panel that floats over the page has nothing of its own to frost, and
               a scale bloom inside a `backdrop-filter` ancestor is the one shape this storefront traced
               as expensive. `tabindex` is on the scroll box: a region that scrolls but cannot be focused
               hides its last rows from exactly the visitor least able to find the scrollbar.
               `w-96` is a measured width, and the measurement is not the one that first went in: at
               `w-72` the 22ch "Opens with your message" clipped to "…" and the tracked eyebrow wrapped, so
               it went to `w-80`, which passed locally and then clipped by 8px on the CI runner and wrapped
               the eyebrow there too. The storefront answers Latin with the *system* UI font, so glyph
               advance is a property of the machine doing the measuring — a width that only clears its own
               desktop is not a fix. The row keeps `truncate` as the guard for a platform name a shop types
               longer than either. -->
          <p class="text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.22em]'">
            {{ t('chooseChannel') }}
          </p>

          <!-- Real links, real hrefs, and no click handler on this list: nothing here races the
               navigation, and nothing here claims a copy it did not make. -->
          <ul class="space-y-1.5">
            <li v-for="channel in channels" :key="channel.key">
              <motion.a
                :href="channel.href"
                :target="channel.external ? '_blank' : undefined"
                :rel="channel.external ? 'noopener noreferrer' : undefined"
                :data-contact-dock-channel="channel.key"
                :data-contact-prefilled="channel.prefilled"
                :while-press="reduced ? undefined : { scale: press.scale }"
                :transition="press.transition"
                class="flex min-w-0 items-center gap-2 rounded-full border border-zinc-200/80 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-xs transition-colors duration-200 hover:border-zinc-300 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-700/60 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:text-white dark:focus-visible:ring-white"
              >
                <svg v-if="channel.platform === 'phone'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 opacity-70" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <SocialBrandIcon v-else :platform="channel.platform" class="shrink-0 opacity-70" />
                <span class="shrink-0">{{ channelName(channel.label) }}</span>
                <!-- The phone shows its number, because that is the whole answer. A prefilled row says
                     so; a row that carries nothing says nothing rather than pointing at a Copy action
                     this panel does not have. -->
                <span v-if="channel.value" class="min-w-0 flex-1 truncate text-right font-normal tabular-nums text-zinc-500 dark:text-zinc-400">{{ channel.value }}</span>
                <span v-else-if="channel.prefilled" class="min-w-0 flex-1 truncate text-right text-xs font-normal text-zinc-500 dark:text-zinc-400">{{ t('channelPrefilled') }}</span>
              </motion.a>
            </li>
          </ul>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
