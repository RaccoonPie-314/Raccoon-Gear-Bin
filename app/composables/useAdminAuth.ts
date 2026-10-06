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
  const isAdmin = async () => {
    try {
      return (await $fetch<{ admin: boolean }>('/api/admin-check')).admin
    } catch {
      return false
    }
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
