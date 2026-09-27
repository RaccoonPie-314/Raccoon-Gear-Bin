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

    // Presence is tested before anything is awaited: `navigator.share` is absent on desktop
    // browsers, and a missing method is a capability the page never had rather than a failure.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: payload.title, text: payload.text, url: payload.url })
        return 'shared'
      } catch (error: any) {
        // The visitor dismissing the sheet is a decision, not an error, and it must not be
        // answered by silently copying behind their back.
        if (error?.name === 'AbortError') return 'cancelled'
      }
    }

    // Reached by browsers with no share sheet, and by a sheet that failed to open.
    return await copyToClipboard(payload.url) ? 'copied' : 'failed'
  }

  return { share }
}
