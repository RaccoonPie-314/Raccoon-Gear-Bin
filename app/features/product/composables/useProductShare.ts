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

// One number, one question: could this settle have been a *human* leaving the sheet? Measured on
// real Chrome (visible window, macOS): the native popover takes ~1s to even appear, the promise
// stays pending while the visitor is in it, and it settles — resolve or AbortError — only after
// they chose or dismissed. So any settle inside this window came from the platform, not the
// visitor: a no-sheet platform rejects instantly (headless Chrome, desktop Chrome where the OS
// share service is absent) or "resolves" instantly without ever painting (the phantom sheet a
// plain success claim would report as shared). Both fall through to the clipboard. Slower than
// the window: the visitor had a sheet and used or closed it — their decision is answered with
// silence, never with a claim behind them. 250ms sits at least ~750ms below the fastest real
// settle, so the two cases cannot overlap.
const HUMAN_SHEET_MS = 250

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
        // A resolve inside the window is the platform claiming success without ever showing the
        // sheet — the phantom the plain-'shared' report used to hand the visitor a sentence about
        // a popover they never saw. Only a resolve a human could have caused is a real outcome.
        if (performance.now() - openedAt >= HUMAN_SHEET_MS) return 'shared'
      } catch (error: any) {
        // A rejection that took its time is the visitor closing a sheet they opened. That is a
        // decision, not an error, and it must not be answered by silently copying behind their
        // back. Anything else — AbortError arriving instantly, NotAllowedError, a data error no
        // name was invented for — is the platform not sharing, and joins the clipboard path.
        if (error?.name === 'AbortError' && performance.now() - openedAt >= HUMAN_SHEET_MS) return 'cancelled'
      }
    }

    // Reached by browsers with no share sheet, by a payload they refuse to share, and by a sheet
    // that never visibly opened.
    return await copyToClipboard(payload.url) ? 'copied' : 'failed'
  }

  return { share }
}
