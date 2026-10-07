/**
 * The storefront's signed-in truth, for the UI and the customer guard's SPA branch. The seed is
 * the server's answer at document load — the request's Clerk cookies are the only authority while
 * clerk-js boots, and on a dev-instance browser whose client never adopts they stay the only
 * authority — while clerk-js's live user overlays it whenever it knows one.
 *
 * `markSignedOut` is what the sign-out paths call beside `clerk.signOut()`: clearing the cookies
 * does not change a `useState`, so without it the seed would keep a signed-out visitor's masthead
 * signed in until the next hard load.
 */
export const useSignedIn = () => {
  const { user } = useUser()
  const seeded = useState<boolean>('signed-in', () => {
    // One boundary cast, as in the guards: app-side event typings don't carry @clerk/nuxt's
    // callable auth.
    const context = useRequestEvent()?.context as { auth?: () => { userId: string | null } } | undefined
    return Boolean(context?.auth?.()?.userId)
  })
  return computed(() => Boolean(user.value) || seeded.value)
}

/**
 * Called by every sign-out path (useCustomerAuth, useAdminAuth) beside `clerk.signOut()`.
 * `admin-mode` rides along because clearing the cookies does not change a `useState` — a cached admin
 * answer would outlive the session it came from, which is the failure "logout clears admin mode"
 * measures. Coupled to `useAdminAuth` by literal, so neither key may be invalidated alone.
 */
export const markSignedOut = () => {
  useState<boolean>('signed-in').value = false
  useState<boolean>('admin-mode').value = false
}
