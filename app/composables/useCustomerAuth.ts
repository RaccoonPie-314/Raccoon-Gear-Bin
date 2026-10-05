import type { Database } from '~/types/database'

/**
 * Customer accounts — the auth half of the `identity` module (specs/ecommerce/SPEC-identity.md).
 *
 * Same shape as `useAdminAuth` on purpose (throws on error, typed client), with one difference:
 * there is no allowlist. Any signed-up account is a customer; what an account may READ or WRITE is
 * decided by RLS on `profiles` and later by the orders RPCs, never by this composable.
 */
export const useCustomerAuth = () => {
  const supabase = useSupabaseClient<Database>()
  const user = useSupabaseUser()

  // On a hard load the server user carries `id`; on client-side navigation the supabase plugin
  // re-places state from JWT claims, which name the user `sub` (the same trap the admin guard
  // documents). Both spellings are the same uuid.
  const currentUserId = () => {
    const identity = user.value as { id?: string, sub?: string } | null
    return identity?.id || identity?.sub || null
  }

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return data
  }

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  // The Nuxt module refreshes `useSupabaseUser` asynchronously after SIGNED_IN (its handler awaits
  // the auth server), so navigating into a guarded route in the same tick as signUp/signIn loses
  // the race: the guard reads a still-empty user and bounces to /login. Waiting here — bounded —
  // is what makes "sign up and land on your account" true instead of a coin flip. The harness
  // caught this as a real defect (signup landed on /login?redirect=/account with a live cookie).
  const waitForUser = async (timeoutMs = 3000) => {
    const until = Date.now() + timeoutMs
    while (!currentUserId() && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return currentUserId() !== null
  }

  const fetchProfile = async () => {
    const userId = currentUserId()
    if (!userId) return null

    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, phone')
      .eq('id', userId)
      .maybeSingle()

    if (error) throw error
    return data
  }

  const updateProfile = async (patch: { displayName: string | null, phone: string | null }) => {
    const userId = currentUserId()
    if (!userId) throw new Error('AUTH_REQUIRED')

    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: patch.displayName, phone: patch.phone })
      .eq('id', userId)
      .select('id, display_name, phone')
      .single()

    if (error) throw error
    return data
  }

  return { user, signUp, signIn, signOut, waitForUser, fetchProfile, updateProfile }
}
