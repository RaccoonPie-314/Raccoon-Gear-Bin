<script setup lang="ts">
/**
 * The rail every admin editor page carries, so the storefront header needs one entry (`Admin tools`)
 * instead of one button per tool — and the rail is deliberately the same shape as the storefront's
 * category sidebar: an uppercase eyebrow over a vertical column of full-rounded rows, the current one
 * filled and the rest quiet. An admin moving between tools should recognise the gesture.
 *
 * Each tab is still its own page with its own section and its own composable — the site-info singleton
 * and the category rows share no state, and merging them into one component with switchable panels
 * would be a rewrite for the sake of an appearance. So these are links, not ARIA tabs: they navigate,
 * and `aria-current` is what says which one is on screen. `/admin/*` is not a localized flow, so the
 * paths are plain, like every other admin link.
 *
 * No sliding indicator and no drag: the storefront dock's pill is a tuned, measured engine
 * (`CategoryDesktop.vue`) whose whole job is pointer manipulation of a filter. A two-item navigation
 * list does not need to inherit it.
 */
const { locale, t } = useI18n()

const TABS = [
  { id: 'site-info', to: '/admin/site-info', labelKey: 'siteInfo' },
  { id: 'categories', to: '/admin/categories', labelKey: 'categories' }
] as const

const route = useRoute()
</script>

<template>
  <nav :aria-label="t('adminTools')" data-admin-tabs class="w-full">
    <p class="mb-4 text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? 'tracking-[0.08em]' : 'tracking-[0.22em]'">
      {{ t('adminTools') }}
    </p>
    <div class="flex flex-wrap gap-2.5 lg:flex-col lg:items-stretch">
      <NuxtLink
        v-for="tab in TABS"
        :key="tab.id"
        :to="tab.to"
        :data-admin-tab="tab.id"
        :aria-current="route.path === tab.to ? 'page' : undefined"
        class="inline-flex items-center justify-center rounded-full px-4 py-2.5 text-xs font-semibold transition-colors lg:justify-start"
        :class="route.path === tab.to
          ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950'
          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white'"
      >
        {{ t(tab.labelKey) }}
      </NuxtLink>
    </div>
  </nav>
</template>
