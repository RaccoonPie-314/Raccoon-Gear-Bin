import type { MaybeRefOrGetter } from 'vue'
import type { CatalogProduct } from '~/types/catalog'
import type { ProductContactChannel } from '~/types/product-contact'
import type { SiteInfo } from '~/types/site-info'
import { copyToClipboard } from '~/utils/clipboard'
import { getProductPricing } from '~/utils/product-pricing'
import { getProductStockState } from '~/utils/product-stock'
import { getSiteContactChannels } from '~/utils/site-contact'

/**
 * The contact half of the product detail page's conversion: which channels the shop has actually
 * configured, what the ready-to-send message says, and whether copying it really worked.
 *
 * It owns no fetching and reads no table. The product arrives from `useCatalog` and the site info
 * from `useSiteInfo`, both handed in by the caller — the same `MaybeRefOrGetter` shape
 * `useCatalogBrowse` is handed its list — which is what keeps this from becoming a second catalog
 * or site-info layer. Sharing is deliberately not here either: asking a shop about a product and
 * handing a link to a friend are different capabilities that merely happen to sit in one row of
 * buttons (`app/utils/clipboard.ts` is the only thing the two share).
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
  // canonical link cannot drift away from the page that prints it.
  const origin = () => import.meta.client ? window.location.origin : requestUrl.origin
  const productUrl = (id: string) => new URL(`${config.app.baseURL}products/${encodeURIComponent(id)}`, origin()).href

  // Asked of the shared rule, never recalculated here: the badge and the CTA now disagree only if
  // the rule itself changes, which is the intended behaviour.
  const stock = computed(() => getProductStockState(toValue(source)?.stockQuantity ?? 0))

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
    // The price the visitor was shown is the price the shop is asked about. Quoting the stored one
    // instead would send a customer a message that contradicts the page they are standing on.
    const pricing = getProductPricing(product)
    const ask = stock.value === 'out'
      ? t('contactAskOutOfStock')
      : stock.value === 'low'
        ? t('contactAskLowStock')
        : t('contactAskInStock')
    return [
      t('contactIntent', { name: product.name }),
      t('contactPriceLine', { currency: product.currency, price: pricing.price.toFixed(2) }),
      product.sku ? t('contactSkuLine', { sku: product.sku }) : '',
      ask,
      productUrl(product.id)
    ].filter(Boolean).join('\n')
  })

  /**
   * Copy the message and hand back the truth. It is the caller's `aria-live` region that turns
   * `false` into "the copy did not happen" — this does not claim success it did not witness, and
   * the panel keeps the text selectable, so a refused clipboard is a slowdown rather than a dead end.
   */
  const copyMessage = async () => copyToClipboard(message.value)

  /**
   * Where a channel actually goes, given the message it may be allowed to carry. Both halves are
   * owned elsewhere: `useSiteInfo`'s `contactLinks` decides *which* rows are contactable (the links
   * the shop marked contactable, which are not the links the shop marked visible), and
   * `app/utils/site-contact.ts` builds the list — the same function the storefront's desktop contact
   * dock reads, so the two surfaces cannot offer a shopper different channels from one stored row.
   * Declared after `message`/`url` because it composes them.
   */
  const channels = computed<ProductContactChannel[]>(() => getSiteContactChannels(toValue(siteInfoSource), {
    message: message.value,
    pageUrl: url.value,
    phoneLabel: t('phone')
  }))

  return { stock, url, channels, message, copyMessage }
}
