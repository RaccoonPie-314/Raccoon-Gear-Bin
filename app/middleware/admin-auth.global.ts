export default defineNuxtRouteMiddleware(async (to) => {
  // Only guard /admin/* routes (skip login page itself)
  if (!to.path.startsWith('/admin') || to.path === '/admin/login') {
    return
  }

  // On the server the session is known from the request's Clerk cookies (@clerk/nuxt's Nitro
  // middleware runs on every request), so a signed-out hard load is a plain 302 — not a
  // hydration-phase client redirect (which leaves the new page's locale links with stale hrefs).
  // The allowlist itself is still verified below: membership is a Neon read, not a cookie.
  if (import.meta.server) {
    // One boundary cast: app-side event typings don't carry @clerk/nuxt's callable auth.
    const context = useRequestEvent()?.context as { auth?: () => { userId: string | null } } | undefined
    if (!context?.auth?.()?.userId) return navigateTo('/admin/login', { replace: true })
    return
  }

  // Client branch: the allowlist question is answered by the server — `/api/admin-check` reads
  // the session cookie, so no clerk-js state is consulted at all. The old `user.value` pre-check
  // raced hydration (still empty right after a handshake) and ejected real admins; the fetch's
  // fail-closed catch is the only judgement, exactly like the Supabase-era lookup it replaced.
  const admin = await $fetch<{ admin: boolean }>('/api/admin-check')
    .then(response => response.admin)
    .catch(() => false)
  if (!admin) {
    return navigateTo('/admin/login', { replace: true })
  }
})
