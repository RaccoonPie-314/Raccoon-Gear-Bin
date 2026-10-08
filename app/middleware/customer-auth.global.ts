import { routePathWithoutLocale } from '~/utils/locale-route'
import { paywayHopQuery } from '~/utils/payway-hop'

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

  // Back from PayWay hard-loads the guarded /checkout with a stale __session JWT, and this guard
  // would bounce the buyer through /login. `startPaywayCheckout` drops a 10-minute marker carrying
  // the order id AND the attempt id, so THAT bounce lands on the order's pay-result page — the page
  // that answers paid vs not-completed — instead of the emptied checkout. The attempt id is what
  // makes the landing answerable at all: it is the session-free read
  // (`/api/payments/payway/verify` by `tran`), and this bounce was the one entry to the result page
  // without it, so a stale session exhausted the page's three owner-scoped attempts and drew
  // "Order not found" over an order the buyer had just paid (report 2026-10-08).
  //
  // Two rules keep it from becoming a trap, both from a shipped failure: it replaces ONLY the
  // /login bounce — a signed-in buyer who abandons the gateway and comes back to order again gets
  // the checkout, where the marker used to hijack that visit and announce the PREVIOUS order's
  // "Payment received" over a cart that was never ordered (report 2026-10-08) — and it is consumed
  // only when it is used, so a stale-session return keeps it. `paywayHopQuery` owns the shape
  // check (pinned by `tests/unit/payway-hop.test.ts`); the cookie itself stays client-set, and the
  // reads behind the page are owner-scoped or attempt-bounded anyway. The API's `requireUser` stays
  // the boundary — this guard is UX.
  const hopPath = () => {
    if (path !== '/checkout') return null
    const query = paywayHopQuery(useCookie('payway-hop').value)
    if (!query) return null
    useCookie('payway-hop').value = null
    return localePath({ path: '/checkout/pay-result', query })
  }
  const bounceTarget = () => {
    const hop = hopPath()
    return hop ? navigateTo(hop, { replace: true }) : signedOutTarget()
  }

  // On the server the session is known from the request's Clerk cookies (@clerk/nuxt's Nitro
  // middleware runs on every request), so a signed-out hard load is a plain 302 — the same shape
  // the Supabase-era guard had. The decision deliberately does not wait for clerk-js here: a
  // hydration-phase client redirect leaves the freshly-rendered page's locale links with stale
  // hrefs. The client branch below is for SPA navigations, where clerk-js is already loaded.
  if (import.meta.server) {
    // One boundary cast: app-side event typings don't carry @clerk/nuxt's callable auth.
    const context = useRequestEvent()?.context as { auth?: () => { userId: string | null } } | undefined
    if (!context?.auth?.()?.userId) return bounceTarget()
    return
  }

  // Client branch: one truth for the masthead and the navigation — `useSignedIn` is the server's
  // answer seeded at load with clerk-js's live user overlaid once it knows one. While clerk-js is
  // booting (or on a dev-instance browser that never adopts it) the server's answer stands, and a
  // signed-out SPA navigation still bounces. Hydration needs no special case: the seed already
  // carries the server's verdict.
  if (!useSignedIn().value) return bounceTarget()
})
