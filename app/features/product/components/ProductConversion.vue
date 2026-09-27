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
 * construction, the clipboard, the share sheet, the confirmation and the mobile sticky bar) lives
 * here or in the composables beside it, which is what keeps `[id].vue` a composition rather than
 * the place those rules get written.
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
const { share } = useProductShare()

// One feedback owner for both mounts. `mount` says which one spoke: two live regions bound to the
// same string would announce every copy twice, so only the block the visitor actually used shows
// (and claims) the sentence.
type ActionsMount = 'inline' | 'sticky'
const feedback = ref('')
const feedbackMount = ref<ActionsMount>('inline')
let hideAt: ReturnType<typeof setTimeout> | undefined

const say = (text: string, mount: ActionsMount) => {
  feedbackMount.value = mount
  feedback.value = text
  clearTimeout(hideAt)
  hideAt = setTimeout(() => { feedback.value = '' }, FEEDBACK_MS)
}

const feedbackFor = (mount: ActionsMount) => feedbackMount.value === mount ? feedback.value : ''

// A product swap must not leave the previous product's confirmation on screen.
watch(url, () => { clearTimeout(hideAt); feedback.value = '' })
onBeforeUnmount(() => { clearTimeout(hideAt) })

// The composable's boolean is the truth; this is where it becomes a sentence. `false` says so
// rather than letting a claimed copy go unchallenged.
const handleCopy = async (mount: ActionsMount) => {
  say(await copyMessage() ? t('messageCopied') : t('copyFailed'), mount)
}

const handleShare = async (payload: ProductSharePayload) => {
  const outcome = await share(payload)
  // A sheet that opened has already said everything worth saying, and a sheet the visitor closed
  // was a decision — neither gets a message behind it. Only the copy paths need one.
  if (outcome === 'copied') say(t('linkCopied'), 'inline')
  else if (outcome === 'failed') say(t('shareFailed'), 'inline')
}
</script>

<template>
  <!-- Inline: under the product's own information, in the column that is sticky on a desktop, so
       the action is already reachable without a floating control. -->
  <ProductActions
    :product="product"
    :state="stock"
    :channels="channels"
    :url="url"
    :message="message"
    :feedback="feedbackFor('inline')"
    @copy="handleCopy('inline')"
    @share="handleShare"
  />

  <!-- Mobile only, and teleported for the same reason the gallery lightbox and the mobile category
       dock are: a fixed control should not inherit a stacking context from wherever it happens to
       be composed. `z-50` deliberately sits below the lightbox's `z-[70]`, so a full-screen photo
       always paints over this bar — and no state is read from the gallery to arrange it.
       Nothing renders at all when the shop has configured no channel: an empty bar would be a
       permanent strip covering the product for an action that does not exist. -->
  <Teleport to="body">
    <div
      v-if="channels.length"
      data-sticky-cta
      class="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200/80 bg-white/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden dark:border-zinc-800/80 dark:bg-zinc-950/85"
    >
      <ProductActions
        compact
        :product="product"
        :state="stock"
        :channels="channels"
        :url="url"
        :message="message"
        :feedback="feedbackFor('sticky')"
        @copy="handleCopy('sticky')"
        @share="handleShare"
      />
    </div>
  </Teleport>
</template>
