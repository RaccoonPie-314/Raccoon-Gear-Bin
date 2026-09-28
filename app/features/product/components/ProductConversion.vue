<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'
import type { ProductSharePayload } from '../composables/useProductShare'
import type { SiteInfo } from '~/types/site-info'

/**
 * The product feature's boundary for conversion: one place that knows how a shopper reaches the
 * shop about this product and how the page is handed to a friend.
 *
 * The page hands over the two things it owns — the catalog-mapped product and the public site
 * info — and composes this as a section. Everything below that line (channel resolution, message
 * construction, the clipboard, the share payload and its destinations, the Share Sheet, the
 * confirmation and the mobile sticky bar) lives here or in the composables beside it, which is what
 * keeps `[id].vue` a composition rather than the place those rules get written.
 */
const props = defineProps<{
  product: CatalogProduct
  siteInfo: SiteInfo | null
}>()

// How long a confirmation stays on screen. It is a courtesy, not a toast system: the same text is
// carried by an `aria-live` region, so it is heard even by someone who never sees it clear.
const FEEDBACK_MS = 4000

const { t } = useI18n()
const { stock, channels, url, message, copyMessage } = useProductContact(() => props.product, () => props.siteInfo)
const { destinations, copyLink, copyMessage: copyShareMessage } = useProductShare()

// Which of the three surfaces spoke. Two live regions bound to the same string would announce every
// copy twice, and the sticky bar's own line hides behind the open sheet, so the sheet gets its own
// channel: only the surface the visitor is actually looking at shows (and claims) the sentence.
type Speaker = 'inline' | 'sticky' | 'sheet'
const feedback = ref('')
const speaker = ref<Speaker>('inline')
let hideAt: ReturnType<typeof setTimeout> | undefined

const say = (text: string, who: Speaker) => {
  speaker.value = who
  feedback.value = text
  clearTimeout(hideAt)
  hideAt = setTimeout(() => { feedback.value = '' }, FEEDBACK_MS)
}

const feedbackFor = (who: Speaker) => speaker.value === who ? feedback.value : ''

// The one share payload for this product, built by the capability that consumes it: the name, the
// line the shop already shows under it, and the canonical link. Both mounts are handed this, so
// neither can compose a different one.
const sharePayload = computed<ProductSharePayload>(() => ({
  title: props.product.name,
  text: props.product.shortDescription || undefined,
  url: url.value
}))

// The sheet's destinations are the links the shop shows in its header — the *share* list, resolved
// apart from the contact list on purpose, because whether an owner answers a platform's messages and
// whether they let a shopper order through it are two different decisions.
const shareDestinations = computed(() => destinations(sharePayload.value, props.siteInfo?.socialLinks ?? []))

// A product swap must not leave the previous product's confirmation, or its manual fallback, on
// screen: the link in that field belongs to the product the visitor has already left.
watch(url, () => { clearTimeout(hideAt); feedback.value = ''; revealLink.value = false })
onBeforeUnmount(() => { clearTimeout(hideAt) })

// The clipboard's boolean is the truth; this is where it becomes a sentence. A refused write says so
// rather than letting a claimed copy go unchallenged — and it puts the address on screen, because
// telling someone to copy a link they cannot see is not a fallback.
const revealLink = ref(false)

const report = (copied: boolean, text: string, who: Speaker) => {
  if (!copied) revealLink.value = true
  say(text, who)
}

const handleCopy = async (mount: Speaker) => {
  const copied = await copyMessage()
  report(copied, copied ? t('messageCopied') : t('copyFailed'), mount)
}

const handleCopyLink = async () => {
  const copied = await copyLink(sharePayload.value)
  report(copied, copied ? t('linkCopied') : t('copyFailed'), 'sheet')
}

const handleCopyShareMessage = async () => {
  const copied = await copyShareMessage(sharePayload.value)
  report(copied, copied ? t('messageCopied') : t('copyFailed'), 'sheet')
}
</script>

<template>
  <!-- Inline: under the product's own information, in the column that is sticky on a desktop, so
       the action is already reachable without a floating control. Below `lg` it is switched off
       here rather than in the page: the sticky bar below is the same component, so a visitor must
       never see two Contact to Order controls — one visible mount per breakpoint, both driven by
       this one file. -->
  <ProductActions
    class="hidden lg:block"
    :state="stock"
    :channels="channels"
    :url="url"
    :message="message"
    :feedback="feedbackFor('inline')"
    :sheet-feedback="feedbackFor('sheet')"
    :share="sharePayload"
    :destinations="shareDestinations"
    :reveal-link="revealLink"
    @copy="handleCopy('inline')"
    @copy-link="handleCopyLink"
    @copy-message="handleCopyShareMessage"
  />

  <!-- Mobile only, and teleported for the same reason the gallery lightbox and the mobile category
       dock are: a fixed control should not inherit a stacking context from wherever it happens to be
       composed. `z-50` deliberately sits below the lightbox's `z-[70]`, so a full-screen photo always
       paints over this bar — and no state is read from the gallery to arrange it. The bar always
       exists: it carries Share as well as Contact, and Share does not wait for the shop to configure
       a channel. The dark surface is `zinc-900`, not the page's own `zinc-950`: the storefront has
       exactly two dark rungs and a bar that sits *on* the page belongs to the upper one, or in dark
       mode it is a hairline with a button floating in nowhere. -->
  <Teleport to="body">
    <div
      data-sticky-cta
      class="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200/80 bg-white/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden dark:border-zinc-800/80 dark:bg-zinc-900/85"
    >
      <ProductActions
        compact
        :state="stock"
        :channels="channels"
        :url="url"
        :message="message"
        :feedback="feedbackFor('sticky')"
        :sheet-feedback="feedbackFor('sheet')"
        :share="sharePayload"
        :destinations="shareDestinations"
        :reveal-link="revealLink"
        @copy="handleCopy('sticky')"
        @copy-link="handleCopyLink"
        @copy-message="handleCopyShareMessage"
      />
    </div>
  </Teleport>
</template>
