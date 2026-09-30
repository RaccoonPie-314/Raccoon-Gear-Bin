<script setup lang="ts">
const { locale } = useI18n()
const switchLocalePath = useSwitchLocalePath()

// Switching locale is a navigation, not a `setLocale()` call. `setLocale` only writes
// `locale.value` and fires `i18n:localeSwitched`; nothing in @nuxtjs/i18n turns that into a route
// change, so the URL keeps its old prefix and the page component is never remounted. Catalog and
// site-info translations are resolved once at fetch time by `pickTranslation`, so a locale button
// would re-render the interface around English product names and a stale location label.
// Linking to the localized path changes the route, and Nuxt's default page key is `route.path` —
// which remounts the page, refetches, and leaves a real alternate-locale URL behind.
type LocaleCode = 'en' | 'km'

const languages: { code: LocaleCode; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'km', label: 'ខ្មែរ' }
]
</script>

<template>
  <div
    class="inline-flex items-center rounded-full p-0.5 bg-zinc-100/90 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs"
    :aria-label="$t('language')"
  >
    <NuxtLink
      v-for="language in languages"
      :key="language.code"
      :to="switchLocalePath(language.code)"
      :aria-current="locale === language.code ? 'true' : undefined"
      class="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wider transition-colors duration-200 select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:focus-visible:ring-white"
      :class="[
        locale === language.code
          ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
          : 'text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
      ]"
    >
      {{ language.label }}
    </NuxtLink>
  </div>
</template>
