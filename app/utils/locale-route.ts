import type { RouteLocationNormalizedLoaded } from 'vue-router'

/**
 * Which of two routes are "the same page in another language".
 *
 * Under `prefix_except_default` a locale switch is a navigation from `/products/x` to
 * `/km/products/x`: the path changes, the page does not. Nothing in Nuxt or @nuxtjs/i18n says that
 * out loud, so the two things a locale switch must not do — rebuild the page component and scroll
 * the visitor back to the top — are both keyed off path equality and have to be opted out of here.
 * `definePageMeta` reads these from the two pages that own that decision.
 *
 * Plain functions, not a composable: this is neither reactive state nor a browser capability, and it
 * answers a question about two route objects handed to it.
 */

// The storefront's two locale codes, and they are only ever these two: `nuxt.config.ts` `i18n.locales`
// is the owner of the list.
// ponytail: prefix-level match rather than the module's `getLocaleFromRoute`/`getRouteBaseName`, which
// would also cover compact routes and domain strategies. Upgrade if a third locale or a domain lands.
const LOCALE_PREFIX = /^\/(km|en)(?=\/|$)/

/** `/km/products/x` and `/products/x` both answer `/products/x`; the root answers `/`. */
export function routePathWithoutLocale(path: string): string {
  const stripped = path.replace(LOCALE_PREFIX, '')
  return stripped.startsWith('/') ? stripped : `/${stripped}`
}

/**
 * The page key: a locale switch keeps the page component (and with it the visitor's scroll position,
 * their search text and the loaded catalog) while a real navigation — another product, another
 * section — still rebuilds it. Two different pages can never collide here: the stripped path is the
 * route both of them would have had in the default locale.
 */
export function pageKeyFor(route: RouteLocationNormalizedLoaded): string {
  return routePathWithoutLocale(route.path)
}

/**
 * `scrollToTop: false` for a locale switch only. Returning `true` anywhere else leaves Nuxt's own
 * behaviour exactly as it is (back/forward `savedPosition`, hashes, `scrollToTop` pages, the wait for
 * the page transition) — this hook is only ever consulted when the path changed.
 */
export function shouldScrollToTop(to: RouteLocationNormalizedLoaded, from: RouteLocationNormalizedLoaded): boolean {
  return routePathWithoutLocale(to.path) !== routePathWithoutLocale(from.path)
}
