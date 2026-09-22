export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/admin/login') {
    return
  }

  const user = useSupabaseUser()
  if (!user.value) {
    return navigateTo('/admin/login', { replace: true })
  }

  const client = useSupabaseClient()
  const { data, error } = await client
    .from('admin_users')
    .select('id')
    .eq('user_id', user.value.id)
    .maybeSingle()

  if (error) {
    console.error('Admin authorization lookup failed:', error)
    return navigateTo('/admin/login', { replace: true })
  }

  if (!data) {
    return navigateTo('/admin/login', { replace: true })
  }
})
