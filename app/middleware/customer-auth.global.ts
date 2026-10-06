import { routePathWithoutLocale } from '~/utils/locale-route'

export default defineNuxtRouteMiddleware(async (to) => {
  // The account and checkout flows are localized storefront routes, so the match goes through
  // `routePathWithoutLocale`: `/km/checkout` must be guarded exactly like `/checkout`. `/admin/*`
  // stays the admin guard's job (and is deliberately not localized).
  const path = routePathWithoutLocale(to.path)
  // The post-payment return surfaces are deliberately NOT guarded: their shells carry no private
  // data (the order id is in the URL the buyer just used, and every read behind them is
  // owner-scoped by the API), and the guard's bounce was the visible defect — after a
  // multi-minute PayWay excursion the __session JWT arrives stale, so the browser's Back button
  // bounced through /login (and its auto-landing) instead of showing the page the buyer left.
  // The trio: the payment result, the order-confirmation shell, and one order's detail page
  // (the orders LIST stays guarded — only the detail pattern with an id is free).
  if (path === '/checkout/pay-result' || path === '/checkout/success' || /^\/account\/orders\/[^/]+$/.test(path)) {
    return
  }
  if (!path.startsWith('/account') && !path.startsWith('/checkout')) {
    return
  }

  const localePath = useLocalePath()
  const signedOutTarget = () => navigateTo(localePath({ path: '/login', query: { redirect: to.fullPath } }), { replace: true })

  // On the server the session is known from the request's Clerk cookies (@clerk/nuxt's Nitro
  // middleware runs on every request), so a signed-out hard load is a plain 302 — the same shape
  // the Supabase-era guard had. The decision deliberately does not wait for clerk-js here: a
  // hydration-phase client redirect leaves the freshly-rendered page's locale links with stale
  // hrefs. The client branch below is for SPA navigations, where clerk-js is already loaded.
  if (import.meta.server) {
    // One boundary cast: app-side event typings don't carry @clerk/nuxt's callable auth.
    const context = useRequestEvent()?.context as { auth?: () => { userId: string | null } } | undefined
    if (!context?.auth?.()?.userId) return signedOutTarget()
    return
  }

  // Client branch: one truth for the masthead and the navigation — `useSignedIn` is the server's
  // answer seeded at load with clerk-js's live user overlaid once it knows one. While clerk-js is
  // booting (or on a dev-instance browser that never adopts it) the server's answer stands, and a
  // signed-out SPA navigation still bounces. Hydration needs no special case: the seed already
  // carries the server's verdict.
  if (!useSignedIn().value) return signedOutTarget()
})
