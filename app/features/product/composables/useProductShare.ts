import { copyToClipboard } from '~/utils/clipboard'

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
 * What actually happened, in the caller's words rather than this file's. Four outcomes because
 * they are four different things to say: the sheet took it, the visitor closed the sheet, the link
 * went to the clipboard instead, or neither was possible.
 */
export type ProductShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed'

// The one number this file adds is a time budget, and it exists because of a measured browser
// behaviour: a platform that cannot share answers `navigator.share()` with an *immediate*
// AbortError — headless Chrome, and desktop Chrome on a platform without a share service, reject
// within the same activation turn — while a visitor who opened the real sheet and dismissed it
// settles no sooner than they could have read it. A share rejected inside this window is therefore
// the platform aborting, not the visitor deciding, and it must fall through to the clipboard
// instead of ending as a silent 'cancelled'. Measured head-to-side: the abort lands under ~10ms,
// a human dismissal is a second or more away; 250ms separates them with an order of magnitude.
const PLATFORM_ABORT_MS = 250

/**
 * Share through the platform's own sheet when the browser offers one, and fall back to the one
 * thing every browser can do — the link on the clipboard.
 *
 * No dependency on the catalog, the site info, or a component: it is handed a title and a URL and
 * reports an outcome. Deciding which of those outcomes deserves a sentence is the caller's job,
 * because only the caller knows which region on the screen should say it.
 */
export const useProductShare = () => {
  const share = async (payload: ProductSharePayload): Promise<ProductShareOutcome> => {
    if (!payload.url) return 'failed'

    const data = { title: payload.title, text: payload.text, url: payload.url }

    // Presence is tested before anything is awaited: `navigator.share` is absent on many desktop
    // browsers, and a missing method is a capability the page never had rather than a failure.
    // `canShare()` is consulted where the browser offers it — it is the browser's own statement
    // that this exact payload is shareable, and honouring it keeps a doomed `share()` call from
    // rejecting with some non-abort error name and leaving this file's contract to guess.
    if (typeof navigator.share === 'function'
      && (typeof navigator.canShare !== 'function' || navigator.canShare(data))) {
      const openedAt = performance.now()
      try {
        // The await sits *on* the call, never before it: the sheet only opens while the click's
        // user activation is still live.
        await navigator.share(data)
        return 'shared'
      } catch (error: any) {
        // A rejection that took its time is the visitor closing a sheet they opened. That is a
        // decision, not an error, and it must not be answered by silently copying behind their
        // back. Anything else — AbortError arriving instantly, NotAllowedError, a data error no
        // name was invented for — is the platform not sharing, and joins the clipboard path.
        if (error?.name === 'AbortError' && performance.now() - openedAt >= PLATFORM_ABORT_MS) return 'cancelled'
      }
    }

    // Reached by browsers with no share sheet, by a payload they refuse to share, and by a sheet
    // that never visibly opened.
    return await copyToClipboard(payload.url) ? 'copied' : 'failed'
  }

  return { share }
}
