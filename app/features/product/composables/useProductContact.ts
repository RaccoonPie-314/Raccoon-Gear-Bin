import type { MaybeRefOrGetter } from 'vue'
import type { CatalogProduct } from '~/types/catalog'
import type { ProductContactChannel } from '~/types/product-contact'
import type { SiteInfo } from '~/types/site-info'
import { copyToClipboard } from '~/utils/clipboard'
import { getProductStockState } from '~/utils/product-stock'

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

  // The phone digits rule the masthead applies to the stored number: keep the digits and a leading
  // plus. Deliberately a second copy rather than an extraction from `SiteInfoContact.vue` — that
  // component sits under the harness's masthead invariants and this change must not touch it. The
  // duplication is recorded in ARCHITECTURE.md so a later site-info change can give it one owner.
  const phoneHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

  /**
   * Whatever the shop configured, and nothing else: the phone number when it is filled in, then
   * the social links in their stored order. `useSiteInfo` has already dropped the disabled ones, so
   * a hidden masthead icon is a hidden channel here too. No username, handle or number is ever
   * constructed — an unset channel simply does not appear, and a stored profile URL is opened
   * exactly as stored rather than rewritten into a compose endpoint.
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

  /**
   * Copy the message and hand back the truth. It is the caller's `aria-live` region that turns
   * `false` into "the copy did not happen" — this does not claim success it did not witness, and
   * the panel keeps the text selectable, so a refused clipboard is a slowdown rather than a dead end.
   */
  const copyMessage = async () => copyToClipboard(message.value)

  return { stock, url, channels, message, copyMessage }
}
