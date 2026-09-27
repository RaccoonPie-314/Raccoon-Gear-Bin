import type { MaybeRefOrGetter } from 'vue'
import type { CatalogProduct } from '~/types/catalog'
import type { ProductContactChannel, ProductStockState } from '~/types/product-contact'
import type { SiteInfo } from '~/types/site-info'
import { LOW_STOCK_THRESHOLD } from '~/constants/catalog'

// How long a copy/share confirmation stays on screen. It is a courtesy, not a toast system: the
// text is also carried in an `aria-live` region, so a screen reader gets it even if it clears
// before anyone reads it twice.
const FEEDBACK_MS = 4000

/**
 * The conversion actions of one product: which channels the shop has configured, what the
 * ready-to-send message says, and how the clipboard and the share sheet are used.
 *
 * It owns no fetching and reads no table — the product arrives from `useCatalog` and the site
 * info from `useSiteInfo`, both handed in by the page, exactly the way `useCatalogBrowse` is
 * handed the already-loaded list. That is what keeps this phase from becoming a second catalog
 * or site-info layer, and why the inline CTA and the mobile sticky CTA can be the same component
 * wired to the same functions without duplicating a single rule.
 */
export const useProductContact = (
  source: MaybeRefOrGetter<CatalogProduct | null>,
  siteInfoSource: MaybeRefOrGetter<SiteInfo | null>
) => {
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const requestUrl = useRequestURL()

  // The address this product lives at, read where it is actually known: the incoming request while
  // rendering on the server (so a crawler is given a real absolute `og:url`) and the live origin in
  // the browser. The route is built from the app's own base URL and this product's id, so the
  // canonical link can never drift away from the page it is printed on.
  const origin = () => import.meta.client ? window.location.origin : requestUrl.origin
  const productUrl = (id: string) => new URL(`${config.app.baseURL}products/${encodeURIComponent(id)}`, origin()).href

  // The same three bands StockStatus renders, from the same threshold constant — the calculation is
  // reused, never redefined, so the badge and the CTA can not disagree about what "low" means.
  const stock = computed<ProductStockState>(() => {
    const quantity = toValue(source)?.stockQuantity ?? 0
    if (quantity <= 0) return 'out'
    if (quantity <= LOW_STOCK_THRESHOLD) return 'low'
    return 'in'
  })

  // The phone digits rule the masthead applies to the stored number: keep the digits and a leading
  // plus. Deliberately a second copy rather than an extraction from `SiteInfoContact.vue` — that
  // component sits under the harness's masthead invariants and this phase must not touch it. The
  // duplication is recorded in ARCHITECTURE.md so a later site-info change can give it one owner.
  const phoneHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

  /**
   * Whatever the shop configured, and nothing else: the phone number when it is filled in, then
   * the social links in their stored order. `useSiteInfo` has already dropped the disabled ones, so
   * a hidden masthead icon is a hidden channel here too. No username, handle or number is ever
   * constructed — an unset channel simply does not appear.
   */
  const channels = computed<ProductContactChannel[]>(() => {
    const siteInfo = toValue(siteInfoSource)
    const resolved: ProductContactChannel[] = []
    const phone = siteInfo?.phone?.trim()
    if (phone) resolved.push({ key: 'phone', label: t('phone'), href: phoneHref(phone), value: phone, external: false })
    for (const link of siteInfo?.socialLinks ?? []) {
      const url = link.url.trim()
      if (!url) continue
      resolved.push({ key: `${link.platform}-${url}`, label: link.platform, href: url, value: '', external: true })
    }
    return resolved
  })

  const url = computed(() => {
    const product = toValue(source)
    return product ? productUrl(product.id) : ''
  })

  /**
   * The message the shop needs to answer in one reply: which product, what it costs, which code to
   * look it up by, the ask that matches the stock, and where the product page is. Built from
   * translations, so it follows the visitor's locale, and joined with newlines because a chat box
   * keeps them readable where a single run-on line would not. Nothing about the visitor is included.
   */
  const message = computed(() => {
    const product = toValue(source)
    if (!product) return ''
    const ask = stock.value === 'out'
      ? t('contactAskOutOfStock')
      : stock.value === 'low'
        ? t('contactAskLowStock')
        : t('contactAskInStock')
    return [
      t('contactIntent', { name: product.name }),
      t('contactPriceLine', { currency: product.currency, price: product.price.toFixed(2) }),
      product.sku ? t('contactSkuLine', { sku: product.sku }) : '',
      ask,
      productUrl(product.id)
    ].filter(Boolean).join('\n')
  })

  const feedback = ref('')
  let hideAt: ReturnType<typeof setTimeout> | undefined

  const say = (text: string) => {
    feedback.value = text
    clearTimeout(hideAt)
    hideAt = setTimeout(() => { feedback.value = '' }, FEEDBACK_MS)
  }

  // A product swap must not leave the previous product's confirmation on screen.
  watch(url, () => { clearTimeout(hideAt); feedback.value = '' })
  onBeforeUnmount(() => { clearTimeout(hideAt) })

  const copyText = async (text: string) => {
    if (!text) return false
    try {
      await navigator.clipboard?.writeText(text)
      return true
    } catch { return false }
  }

  /** Copy the ready message, then say whether it landed. The panel keeps the text selectable, so a
   * browser that refuses the clipboard is a slowdown rather than a dead end. */
  const copyMessage = async () => {
    say(await copyText(message.value) ? t('messageCopied') : t('copyFailed'))
  }

  /**
   * Share with the platform sheet when the browser has one, and fall back to the one thing that
   * always works — the canonical link on the clipboard. A share sheet the visitor dismissed is a
   * decision, not an error, so it reports nothing.
   */
  const share = async () => {
    const product = toValue(source)
    if (!product) return
    const link = productUrl(product.id)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: product.name, text: t('contactIntent', { name: product.name }), url: link })
        return
      } catch (error: any) {
        if (error?.name === 'AbortError') return
      }
    }
    say(await copyText(link) ? t('linkCopied') : t('shareFailed'))
  }

  return { stock, channels, url, message, feedback, productUrl, copyMessage, share }
}
