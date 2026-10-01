<script setup lang="ts">
import type { SiteInfo } from '~/types/site-info'

// The masthead's social group: icon-only, in the stored order, with the stored URLs, and only
// the links the site owner left enabled. Presentational by rule — the resolved public model
// comes in as a prop, this component owns no fetching and no row mapping.
defineProps<{
  siteInfo: SiteInfo | null
}>()

</script>

<template>
  <!-- Bounded with the header's own pill-group container, the same idiom as the language
       switcher: the box is what makes five loose glyphs read as one group, and what keeps it
       from looking like a third utility control bolted onto the theme/language pair.
       The `reveal` wrapper is the data-arrival handoff, and it lives here rather than in the page
       because this component mounts with `siteInfo` still null: a `Transition` around the component
       would fire on the placeholder, not on the links appearing. Opacity only, like the grid's — the
       masthead's measured geometry (socials below the utility line, flush right) is untouched. -->
  <Transition name="reveal">
    <div
      v-if="siteInfo?.socialLinks.length"
      class="flex shrink-0 items-center gap-0.5 rounded-full border border-zinc-200/70 bg-white p-1 shadow-xs dark:border-zinc-800/70 dark:bg-zinc-900/60"
      :aria-label="$t('socialLinks')"
      data-site-socials
    >
      <!-- Icon-only; the platform name is the label. -->
      <a
        v-for="link in siteInfo.socialLinks"
        :key="`${link.platform}-${link.url}`"
        :href="link.url"
        target="_blank"
        rel="noopener"
        :aria-label="link.platform"
        :title="link.platform"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-950 sm:h-9 sm:w-9 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
        data-site-social
        :data-platform="link.platform"
      >
        <SocialBrandIcon :platform="link.platform" />
      </a>
    </div>
  </Transition>
</template>
