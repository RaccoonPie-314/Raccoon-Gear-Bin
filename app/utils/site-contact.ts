import type { ProductContactChannel } from '~/types/product-contact'
import type { SiteInfo } from '~/types/site-info'
import { socialPrefillLink } from './social-prefill'

/**
 * The caller's context: what a channel is allowed to carry with it.
 *
 * Labels stay untranslated here for the same reason a price stays unformatted — `app/utils` holds no
 * locale strings and reads no locale. The caller already has `t()`, so its own word for "Phone"
 * arrives as an argument.
 */
export type SiteContactContext = {
  /** What a platform with a documented prefill carries. Empty means "open the stored URL as stored". */
  message: string
  /** Where the visitor is, read only by the platform that documents a share endpoint. */
  pageUrl: string
  phoneLabel: string
}

/**
 * Which channels a visitor may reach the shop through, and in what order.
 *
 * The one owner of that answer, because two surfaces ask it: the product page's Contact to Order rows
 * (through `useProductContact`) and the storefront's desktop contact dock. Neither may build a channel
 * inline — the phone row, the `tel:` digit rule and the call into `socialPrefillLink` all live here, so
 * a third surface that offers contact gets the same list from the same place rather than a third
 * interpretation of the stored row.
 *
 * It reads no table and touches no browser API. The `SiteInfo` handed in is already narrowed to the
 * rows the shop marked contactable, and already scheme-filtered, by `useSiteInfo` — which is the only
 * reader of that row and stays the only one.
 */
export const getSiteContactChannels = (
  siteInfo: SiteInfo | null,
  context: SiteContactContext
): ProductContactChannel[] => {
  const channels: ProductContactChannel[] = []

  // A number the shop never typed is an empty string, not `undefined`: the prefill rule takes one
  // `phone` for both the row it builds and the WhatsApp digits it may fall back to.
  const phone = siteInfo?.phone?.trim() ?? ''
  if (phone) {
    // `tel:` keeps the digits and a leading plus; the displayed value stays exactly as entered. The
    // masthead carries its own copy of this one-line rule on purpose (that component sits under the
    // harness's masthead invariants) — this function is the owner for the two *channel lists*.
    channels.push({
      key: 'phone',
      platform: 'phone',
      label: context.phoneLabel,
      href: `tel:${phone.replace(/[^\d+]/g, '')}`,
      value: phone,
      external: false,
      prefilled: false
    })
  }

  for (const link of siteInfo?.contactLinks ?? []) {
    const stored = link.url.trim()
    // An unset channel is not a channel: nothing is offered in its place.
    if (!stored) continue
    const target = socialPrefillLink(link, { phone, message: context.message, productUrl: context.pageUrl })
    channels.push({
      key: `${link.platform}-${stored}`,
      platform: link.platform,
      label: link.platform,
      href: target.href,
      value: '',
      external: true,
      prefilled: target.prefilled
    })
  }

  return channels
}
