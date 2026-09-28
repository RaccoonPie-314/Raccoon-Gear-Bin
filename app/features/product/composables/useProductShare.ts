import type { SiteSocialLink } from '~/types/site-info'
import { copyToClipboard } from '~/utils/clipboard'
import { socialPrefillLink } from '~/utils/social-prefill'

/**
 * What a caller hands over to be shared. Deliberately not a product: a title, an optional line of
 * text and the link are what a share sheet needs for anything shareable, so the day a category or
 * a plain page wants the same button there is no new implementation to write.
 */
export type ProductSharePayload = {
  title: string
  text?: string
  url: string
}

/**
 * One destination the sheet offers: the shop's own configured account, at the address a share
 * actually goes to. `prefilled` carries the same promise it does on a contact row — the href
 * contains the text — so no row can imply a send it did not make.
 */
export type ProductShareDestination = {
  key: string
  platform: string
  label: string
  href: string
  prefilled: boolean
}

/**
 * Share capability, and nothing else: the text a share carries, where each destination goes, and
 * whether the clipboard took it. The three names it hands back are the three the sheet actually uses;
 * `shareText` and `copy` stay private rather than becoming a public surface nobody calls.
 *
 * It is not a *sheet*. `ProductShareSheet.vue` decides what sharing looks like and when it is open;
 * this file answers what it says and where its links point. That split is why the browser's own
 * `navigator.share()` is not here: the platform sheet was removed as the primary UI (it cannot be
 * styled, it cannot show the product, and its success tells you nothing — desktop Chrome answers a
 * share it never painted with an instant resolve, and a page that trusts it reports a share nobody
 * performed). Anything a visitor could not see happen is reported as what it was: a clipboard write
 * that worked, or one that did not.
 *
 * No dependency on the catalog, the site info, or a component. Links arrive from the caller, which
 * is what keeps the share destinations from reading a table and keeps `useSiteInfo` the only reader
 * of the row.
 */
export const useProductShare = () => {
  /**
   * The text a destination or the clipboard receives: the thing's name, its own line, then the
   * address on a line of its own so a chat client does not fold it into the sentence before it.
   */
  const shareText = (payload: ProductSharePayload) =>
    [payload.title, payload.text, payload.url].filter(Boolean).join('\n')

  /**
   * One write, one truth: `true` only when the Clipboard API said it stored the text. Deliberately a
   * boolean rather than a named outcome — the caller has its own words for each branch, and a
   * `'copied' | 'failed'` union is a string an `if` can get wrong without a compiler noticing.
   */
  const copy = async (text: string) => !!text && await copyToClipboard(text)

  const copyLink = (payload: ProductSharePayload) => copy(payload.url)
  const copyMessage = (payload: ProductSharePayload) => copy(shareText(payload))

  /**
   * Where the sheet's rows go, given the links the shop lists in its header.
   *
   * The platform-URL rule has one owner — `app/utils/social-prefill.ts` — and this only changes
   * *which text* it hands over: the share's own line rather than the message a contact row drafts.
   * The shop's phone is deliberately not passed: a share addressed to the shop's own number is a
   * contact, and the two settings answer different questions.
   */
  const destinations = (payload: ProductSharePayload, links: SiteSocialLink[]) => {
    const text = shareText(payload)
    const resolved: ProductShareDestination[] = []
    for (const link of links) {
      const stored = link.url.trim()
      // An unset link is not a destination: nothing is invented in its place.
      if (!stored) continue
      const target = socialPrefillLink(link, { phone: '', message: text, productUrl: payload.url })
      resolved.push({
        key: `${link.platform}-${stored}`,
        platform: link.platform,
        label: link.platform,
        href: target.href,
        prefilled: target.prefilled
      })
    }
    return resolved
  }

  return { copyLink, copyMessage, destinations }
}
