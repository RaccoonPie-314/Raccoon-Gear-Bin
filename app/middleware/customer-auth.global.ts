import { routePathWithoutLocale } from '~/utils/locale-route'

export default defineNuxtRouteMiddleware((to) => {
  // The account and checkout flows are localized storefront routes, so the match goes through
  // `routePathWithoutLocale`: `/km/checkout` must be guarded exactly like `/checkout`. `/admin/*`
  // stays the admin guard's job (and is deliberately not localized).
  const path = routePathWithoutLocale(to.path)
  if (!path.startsWith('/account') && !path.startsWith('/checkout')) {
    return
  }

  // Session-only check, no DB lookup: this guard decides which page a signed-out visitor sees.
  // Authorization itself is RLS on every table, so there is nothing to verify here.
  const user = useSupabaseUser()
  const identity = user.value as { id?: string, sub?: string } | null
  const userId = identity?.id || identity?.sub
  if (!userId) {
    const localePath = useLocalePath()
    return navigateTo(localePath({ path: '/login', query: { redirect: to.fullPath } }), { replace: true })
  }
})
