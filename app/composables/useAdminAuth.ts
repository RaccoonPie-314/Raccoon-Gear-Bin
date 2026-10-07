/**
 * Admin sign-in on Clerk (plans/005 P6). Same shape the pages already consume — `user`,
 * `isAdmin`, `signIn`, `signOut` — with the allowlist check moved server-side:
 * `/api/admin-check` reads `admin_users` in the owner context, because the browser has no read
 * path to that table anymore. Authorisation itself stays a route/RLS concern; this only keeps
 * the UI honest.
 */
export const useAdminAuth = () => {
  const { user } = useUser()
  const { signIn: signInResource } = useSignIn()
  const clerk = useClerk()

  // The server is the only judge of membership (the session cookie is what it reads); the client
  // user ref is deliberately not consulted — right after `setActive` it can still be empty, and
  // gating on it would refuse a real admin. No session → the fetch answers 401 → false.
  //
  // `admin-mode` is remembered for one thing: six surfaces ask this same boolean — the guard's client
  // branch and five `isAdmin()` callers (the storefront badge, the login page, the three admin pages) —
  // and before it existed, an admin walking `/admin/orders` to `/admin/categories` paid one round trip
  // per view to learn what the previous view already knew. Keyed by the literal, coupled to
  // `markSignedOut` by string (the house pattern — `useSignedIn`'s `'signed-in'` seed is the same pair).
  //
  // Only a truthy answer short-circuits (a `false` may be stored and is re-asked on every call). A
  // cached `false` would be a lie with consequences: `index.vue` asks on a
  // `watch(signedIn, …, { immediate: true })`, so a visitor who arrived signed out stores `false`, then
  // SPA-navigates to `/admin/login` in the SAME document, signs in with real admin credentials, and
  // `login.vue`'s `await isAdmin()` would hand back the stale `false` — "unauthorized" to a legitimate
  // admin, until a hard reload. Rejections stay uncached for the same reason in the other direction: a
  // blip must not stick.
  // ponytail: a non-admin therefore re-asks per mount, which is today's cost, unchanged. Keying the
  // answer to the session id would fix it; not done, because a session-keyed cache re-invites the
  // clerk-js-state decision this module's guard already rejects.
  const adminMode = useState('admin-mode', () => false)

  const isAdmin = async () => {
    if (adminMode.value) return true
    try {
      adminMode.value = (await $fetch<{ admin: boolean }>('/api/admin-check')).admin
    } catch {
      return false
    }
    return adminMode.value
  }

  const signIn = async (identifier: string, password: string) => {
    if (!signInResource.value) throw new Error('AUTH_NOT_LOADED')
    const attempt = await signInResource.value.create({ identifier, password })
    if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('SIGN_IN_INCOMPLETE')
    await clerk.value?.setActive({ session: attempt.createdSessionId })
    return { user: user.value }
  }

  const signOut = async () => {
    await clerk.value?.signOut()
    markSignedOut()
  }

  return { user, isAdmin, signIn, signOut }
}
