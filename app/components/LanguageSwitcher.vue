<script setup lang="ts">
const { locale, setLocale } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const router = useRouter()

// Two locale codes, and `nuxt.config.ts` `i18n.locales` is the owner of that list.
type LocaleCode = 'en' | 'km'

const languages: { code: LocaleCode; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'km', label: 'ខ្មែរ' }
]

// Switching language is `setLocale()`, and the URL follows it.
//
// It used to be the other way round: `switchLocalePath` alone, a route change as the mechanism, on the
// reasoning that catalog and site-info translations were resolved *once at fetch time* by
// `pickTranslation` — so anything short of a refetch would leave the interface re-rendered around rows
// picked in the language the visitor just left. That reasoning is still true of a layer that flattens
// a row into a single string. It stopped being true when `useCatalog`/`useSiteInfo` began holding the
// loaded rows and mapping them in a computed: the `product_translations` the query already embeds
// carries every locale, so a switch has nothing to fetch, only something to re-resolve.
//
// What the route-only version cost, measured: ~230ms of Supabase round trip for text that was already
// in memory, a skeleton grid through the page transition, and Nuxt's default scroll-to-top throwing the
// visitor back to the masthead from wherever they were reading. All of it for a language change.
//
// `setLocale()` is the module's own answer (docs → Lang Switcher): it sets the locale, updates the
// `raccoon-gear-bin-locale` cookie when detection is on, and — because the strategy is prefixed —
// navigates to the locale's route itself, so the URL stays a real alternate-locale URL that can be
// shared, bookmarked and reloaded. `switchLocalePath` therefore stays on the link as `to`: the href is
// what middle-click, copy-link and a crawler's alternate link need, and it costs nothing to keep.
// The page component survives that navigation because the two storefront pages key themselves on the
// path *without* the locale prefix (`app/utils/locale-route.ts`), which is what lets the highlight
// below animate instead of snapping: a locale switch no longer destroys the element that has to change.
//
// The `router.replace` after it is not a duplicate of what `setLocale` already did — it is the case
// where `setLocale` did not do it. It navigates only when the current route is one i18n localizes, and
// the admin pages are not: switching to English on `/km/admin/categories` moves the locale, the cookie
// and every label, and leaves the URL saying `/km/`. Before this component delegated to `setLocale`,
// the `NuxtLink`'s own `switchLocalePath` href carried that page to `/admin/categories`; keeping the
// href as the link's `to` is what makes the pair complete. On a localized route the path already moved,
// so the guard below skips and the navigation stays the one `setLocale` made.
async function switchTo (code: LocaleCode) {
  await setLocale(code)
  const to = switchLocalePath(code)
  if (to && to !== router.currentRoute.value.path) await router.replace(to)
}
</script>

<template>
  <div
    class="inline-flex items-center rounded-full p-0.5 bg-zinc-100/90 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs"
    :aria-label="$t('language')"
    data-language-switcher
  >
    <NuxtLink
      v-for="language in languages"
      :key="language.code"
      :to="switchLocalePath(language.code)"
      :aria-current="locale === language.code ? 'true' : undefined"
      class="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold transition-[color,background-color,scale] duration-200 select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:focus-visible:ring-white motion-safe:active:scale-[0.97]"
      :class="[
        // Tracking keys off the label, not the page: `ខ្មែរ` is a Khmer run wherever it is drawn,
        // and the English route is exactly where a Khmer visitor has to read it to switch.
        language.code === 'km' ? '' : 'tracking-wider',
        locale === language.code
          ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
          : 'text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
      ]"
      @click.prevent="switchTo(language.code)"
    >
      {{ language.label }}
    </NuxtLink>
  </div>
</template>
