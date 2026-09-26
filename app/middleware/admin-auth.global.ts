export default defineNuxtRouteMiddleware(async (to) => {
  // Only guard /admin/* routes (skip login page itself)
  if (!to.path.startsWith('/admin') || to.path === '/admin/login') {
    return
  }

  const user = useSupabaseUser()
  // On client-side navigation the supabase plugin re-places this state with the JWT
  // *claims* (its `page:start` hook), and a GoTrue claims payload names the user `sub`,
  // not `id`. Reading only `id` bounced every SPA navigation to /admin/site-info - the
  // first route that ever exercised this guard. Both spellings are the same uuid.
  const identity = user.value as { id?: string; sub?: string } | null
  const userId = identity?.id || identity?.sub
  if (!userId) {
    return navigateTo('/admin/login', { replace: true })
  }

  const client = useSupabaseClient()
  const { data, error } = await client
    .from('admin_users')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('Admin authorization lookup failed:', error)
    return navigateTo('/admin/login', { replace: true })
  }

  if (!data) {
    return navigateTo('/admin/login', { replace: true })
  }
})
