/**
 * Customer accounts — the auth half of the `identity` module (specs/ecommerce/SPEC-identity.md),
 * now on Clerk (plans/005 P6). Same public shape the Supabase-era version had, so pages that only
 * read `user` / save a profile did not change; what moved:
 *
 * - the session is Clerk's (`useUser`); phone accounts sign in with their `p<e164>` username
 *   alias — resolved from what the buyer typed by `/api/auth/phone/identifier`, because
 *   normalizePhone stays the server's single owner of that mapping;
 * - profile reads/writes are `/api/profile` (claims path + RLS), not PostgREST;
 * - Telegram login and login codes answer a Clerk sign-in URL (`completeOnHosted` appends the
 *   redirect back), where the old flow handed `verifyOtp` a token_hash.
 */
export const useCustomerAuth = () => {
  const { user, isLoaded, isSignedIn } = useUser()
  const { signIn: signInResource } = useSignIn()
  const { signUp: signUpResource } = useSignUp()
  const clerk = useClerk()

  const currentUserId = () => user.value?.id ?? null

  const activate = async (createdSessionId: string | null | undefined) => {
    if (!createdSessionId) throw new Error('SESSION_INCOMPLETE')
    await clerk.value?.setActive({ session: createdSessionId })
  }

  /** Email OR username alias — Clerk infers the identifier type. Used by both login modes. */
  const signIn = async (identifier: string, password: string) => {
    if (!signInResource.value) throw new Error('AUTH_NOT_LOADED')
    const attempt = await signInResource.value.create({ identifier, password })
    if (attempt.status !== 'complete') throw new Error('SIGN_IN_INCOMPLETE')
    await activate(attempt.createdSessionId)
  }

  const signUp = async (email: string, password: string) => {
    if (!signUpResource.value) throw new Error('AUTH_NOT_LOADED')
    const attempt = await signUpResource.value.create({ emailAddress: email, password })
    if (attempt.status !== 'complete') throw new Error('SIGN_UP_INCOMPLETE')
    await activate(attempt.createdSessionId)
  }

  /**
   * Phone signup = the server route creates the alias account (spec capability 1), then this
   * session signs in with the returned alias. The buyer never sees the alias.
   */
  const signUpWithPhone = async (phone: string, password: string) => {
    const { username } = await $fetch<{ username: string }>('/api/auth/phone/signup', {
      method: 'POST',
      body: { phone, password }
    })
    await signIn(username, password)
  }

  /** What the phone LOGIN mode submits with: the alias the password belongs to. */
  const phoneIdentifier = async (phone: string) => {
    const { username } = await $fetch<{ username: string }>('/api/auth/phone/identifier', {
      method: 'POST',
      body: { phone }
    })
    return username
  }

  const signOut = async () => {
    await clerk.value?.signOut()
    markSignedOut()
  }

  /**
   * The tickets (Telegram login, login codes) land on Clerk's hosted completion page; this
   * appends where to come back to. Callers navigate externally — the hosted page owns the
   * cookie handshake, which is exactly what the P0 spike established.
   */
  const completeOnHosted = (signInUrl: string, target: string) =>
    `${signInUrl}&redirect_url=${encodeURIComponent(target)}`

  // Clerk's client state lands with `setActive`, but the guarded redirect historically raced the
  // async user refresh (the harness caught it on the Supabase module) — the bounded wait keeps
  // "sign up and land on your account" true instead of a coin flip.
  const waitForUser = async (timeoutMs = 3000) => {
    const until = Date.now() + timeoutMs
    while (!currentUserId() && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return currentUserId() !== null
  }

  /**
   * Completes a Telegram/code sign-in ticket in-page: `signIn.create({ strategy: 'ticket' })`
   * establishes the session on this origin exactly like a password sign-in — no hosted page, no
   * cross-domain handshake (whose dev-browser hop burned tickets without creating sessions in
   * some browsers, 2026-10-06). False means "could not" — the caller falls back to the hosted URL.
   */
  const completeTicket = async (ticket: string) => {
    if (!signInResource.value) return false
    try {
      const attempt = await signInResource.value.create({ strategy: 'ticket', ticket })
      if (attempt.status !== 'complete') return false
      await activate(attempt.createdSessionId)
      return await waitForUser()
    } catch {
      return false
    }
  }

  /**
   * Google OAuth (the dev instance ships Clerk's shared Google credentials, so this works before
   * a Google Cloud app exists). One arm for both first-time and returning visitors — Clerk
   * creates the account on first consent. Our `/sso-callback` page finishes the handshake on
   * this origin, then `redirectUrlComplete` lands the visitor like any other sign-in.
   */
    const signInWithGoogle = async (target: string) => {
    // The button exists from the first frame but the SDK script lands later — a fast click must
    // wait, not fail ("Login failed" for what is really "not loaded yet").
    const until = Date.now() + 8000
    while (!signInResource.value && !user.value && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (user.value) {
      // The client already holds a user: land. This branch once probed `/api/profile` and signed
      // out on a 401 — but a 401 only means the SERVER cannot see the cookie *yet* (the
      // dev-browser lag, measured: this branch removed a live session seconds after its adoption).
      // Server blindness is the guard's problem — `useSignedIn` or-s the client user in, so the
      // landing renders; nothing here may destroy a session.
      await navigateTo(target, { replace: true })
      return
    }
    if (!signInResource.value) throw new Error('AUTH_NOT_LOADED')
    // The callback lands on OUR page, not the prebuilt component's path: probed (2026-10-06),
    // `<SignIn routing="path">` relocates callback params into hash routing and renders an
    // EMPTY page when anything is malformed — a void with no diagnostics. Our page completes
    // explicitly (handleRedirectCallback + grace + adoption) and renders the whole trail on
    // failure. The destination survives the round trip in sessionStorage.
    sessionStorage.setItem('sso-to', target)
    await signInResource.value.authenticateWithRedirect({
      strategy: 'oauth_google',
      redirectUrl: `${window.location.origin}/sso-callback`,
      redirectUrlComplete: `${window.location.origin}${target}`
    })
  }

  const fetchProfile = async () => {
    if (!currentUserId()) return null
    return await $fetch<{ id: string, display_name: string | null, phone: string | null } | null>('/api/profile')
  }

  const updateProfile = async (patch: { displayName: string | null, phone: string | null }) => {
    const row = await $fetch<{ id: string, display_name: string | null, phone: string | null } | null>('/api/profile', {
      method: 'PATCH',
      body: patch
    })
    if (!row) throw new Error('PROFILE_SAVE_FAILED')
    return row
  }

  // Identity-flow helpers — the pages own the UI state; these own the wire.
  const startTelegram = (mode: 'login' | 'link') =>
    $fetch<{ nonce: string, deepLink: string, expiresAt: string }>('/api/auth/telegram/start', { method: 'POST', body: { mode } })

  const pollTelegram = (nonce: string) =>
    $fetch<{ status: 'pending' | 'confirmed' | 'linked' | 'expired', ticket?: string, signInUrl?: string }>('/api/auth/telegram/poll', { method: 'POST', body: { nonce } })

  const fetchTelegramLink = () =>
    $fetch<{ linked: boolean, username: string | null }>('/api/auth/telegram/link')

  const verifyLoginCode = (code: string) =>
    $fetch<{ ticket: string, signInUrl: string }>('/api/auth/code/verify', { method: 'POST', body: { code } })

  const generateLoginCode = () =>
    $fetch<{ code: string, expiresAt: string }>('/api/auth/code/generate', { method: 'POST' })

  return {
    user,
    isLoaded,
    isSignedIn,
    signIn,
    signUp,
    signUpWithPhone,
    phoneIdentifier,
    signOut,
    completeOnHosted,
    completeTicket,
    signInWithGoogle,
    waitForUser,
    fetchProfile,
    updateProfile,
    startTelegram,
    pollTelegram,
    fetchTelegramLink,
    verifyLoginCode,
    generateLoginCode
  }
}
