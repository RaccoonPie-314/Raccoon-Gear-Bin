<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'
import type { ProductContactChannel } from '~/types/product-contact'
import type { ProductSharePayload } from '../composables/useProductShare'
import type { ProductStockState } from '~/utils/product-stock'

// Presentational, and it lives behind the product feature boundary because nothing but the product
// detail page renders it. The channel list, the stock band, the ready message, the canonical link
// and the confirmation all arrive as props from `ProductConversion`, which owns the behaviour;
// this component only decides what the row looks like and which event to emit. That split is why
// the inline block and the mobile sticky bar can be two mounts of one component without a second
// implementation of anything.
const props = defineProps<{
  product: CatalogProduct
  state: ProductStockState
  channels: ProductContactChannel[]
  url: string
  message: string
  feedback: string
  /** Set once a copy or share could not be completed: reveals the canonical link as selectable
   * text, so "copy it yourself" is an instruction the visitor can actually carry out. */
  revealLink?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{ copy: [], share: [payload: ProductSharePayload] }>()

const { t } = useI18n()

// Selecting the revealed link on focus is what makes the manual path a single click: the visitor
// who was told to copy by hand should not also have to drag across the address.
const selectOnFocus = (event: FocusEvent) => {
  (event.target as HTMLInputElement | null)?.select()
}

// Each mount keeps its own open flag — the inline block and the sticky bar are two separate
// affordances, and opening one should not move the other. Nothing here is shared with the gallery:
// the lightbox owns its own state, and this panel never reads it.
const panelId = useId()
const messageId = useId()
const isOpen = ref(false)
const ctaBtn = ref<HTMLElement | null>(null)

// Out of stock must not read as "buy now": the same action, worded as the question it actually is.
const ctaLabel = computed(() => props.state === 'out' ? t('askAboutAvailability') : t('contactToOrder'))

const toggle = () => { isOpen.value = !isOpen.value }

// Escape belongs to the panel only while focus is inside it, so it can never intercept the
// gallery's document-wide Escape handler. It then hands focus back to the control that opened the
// panel: the dismiss removes whatever was focused inside it, and a visitor left on `<body>` loses
// their place in the tab order entirely.
const close = (returnFocus = false) => {
  isOpen.value = false
  if (returnFocus) void nextTick(() => ctaBtn.value?.focus())
}

// The share payload is composed from props, which is all a presentational component is allowed to
// use: the name, the line the shop already shows under it, and the canonical link.
const shareProduct = () => {
  emit('share', { title: props.product.name, text: props.product.shortDescription || undefined, url: props.url })
}

// The stored platform string is the shop's own data and stays the row's identity, but a raw
// lowercase `telegram` beside the translated "Phone" reads as an unresolved message key. The first
// letter is the only thing changed: nothing is renamed, re-translated, or mapped to a guess about
// what the owner meant to call it.
const channelName = (channel: ProductContactChannel) =>
  channel.label ? `${channel.label[0]?.toUpperCase()}${channel.label.slice(1)}` : channel.label
</script>

<template>
  <div
    data-product-actions
    class="min-w-0"
    :class="compact ? 'relative w-full' : 'w-full'"
    @keydown.esc="close(true)"
  >
    <!-- The row stays a row at every width: `min-w-0` plus a truncating label is what keeps a long
         Khmer string from widening the page. Share is a secondary at the same height and shape, so
         the hierarchy is carried by fill rather than by size. -->
    <div class="flex min-w-0 gap-2 sm:gap-3">
      <button
        v-if="channels.length"
        ref="ctaBtn"
        type="button"
        data-contact-cta
        :aria-expanded="isOpen"
        :aria-controls="panelId"
        class="inline-flex h-11 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white shadow-xs transition-colors duration-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950"
        :class="compact ? 'flex-1' : 'flex-1 sm:flex-none'"
        @click="toggle"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="truncate">{{ ctaLabel }}</span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 transition-transform duration-200" :class="isOpen ? 'rotate-180' : ''" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>

      <!-- The sticky bar carries the primary action alone: two pills plus a safe-area row on a
           390px screen is how a sticky control starts causing horizontal overflow. -->
      <button
        v-if="!compact"
        type="button"
        data-share-cta
        class="inline-flex h-11 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-zinc-300/80 bg-white px-5 text-sm font-semibold text-zinc-700 shadow-xs transition-colors duration-200 hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700/70 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950"
        @click="shareProduct"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>
        <span class="truncate">{{ t('share') }}</span>
      </button>
    </div>

    <!-- Only ever rendered after a copy or a share actually failed. The last thing this flow should
         do is tell a visitor to copy a link they cannot see — which is what happened while the
         canonical address existed only inside the message field, behind a closed panel. Read-only,
         selected on focus, and labelled so the accessible name is "Product link" rather than an
         anonymous field. -->
    <div v-if="revealLink" class="mt-2 flex min-w-0 items-center">
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
         the visitor unable to tell whether the copy worked, which is worse than not offering it. -->
    <div
      v-if="isOpen && channels.length"
      :id="panelId"
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
            <span class="shrink-0">{{ channelName(channel) }}</span>
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

    <!-- One polite live region for both confirmations: it announces "Message copied." without
         stealing focus, and it sits outside the panel so the text is still read when the panel
         has already been dismissed. -->
    <p
      role="status"
      aria-live="polite"
      data-contact-feedback
      class="mt-2 min-h-5 text-xs font-medium text-zinc-500 dark:text-zinc-400"
    >{{ feedback }}</p>
  </div>
</template>
