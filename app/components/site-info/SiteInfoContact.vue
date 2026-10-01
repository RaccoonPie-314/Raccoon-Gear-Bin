<script setup lang="ts">
import type { SiteInfo } from '~/types/site-info'

// Level one of the masthead: where to reach the shop and where the shop is. Presentational by
// rule — the resolved public model comes in as a prop, this component owns no fetching and no row
// mapping. It renders whatever the site owner has filled in; an empty phone or location simply
// omits its link, so no placeholder text leaks into the header.
defineProps<{
  siteInfo: SiteInfo | null
}>()

const { t } = useI18n()

// tel: hrefs keep digits and a leading plus only; the displayed text stays exactly as entered.
const phoneHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
</script>

<template>
  <!-- Deliberately the quiet level: no pill, no background, one step below the masthead's own
       type, and a hairline underneath so the eye reads it as the letterhead rather than as
       navigation. Phone anchors the left and location the right, but from `lg` both are lifted
       off the container margin — pinned to the extremes they read as two unrelated labels that
       happen to share a line rather than as one pair. Each truncates before it will widen the
       page, and the rule stays full-bleed because padding sits inside the border.
       The `reveal` wrapper is the data-arrival handoff the catalog grid already uses, and it lives
       here rather than in the page because this component mounts with `siteInfo` still null — a
       `Transition` around the component would fire on the placeholder, not on the line appearing.
       Opacity only, so the measured contact geometry is untouched. -->
  <Transition name="reveal">
    <div
      v-if="siteInfo && (siteInfo.phone || siteInfo.locationLabel || siteInfo.locationUrl)"
      class="flex min-w-0 items-center justify-between gap-x-4 border-b border-zinc-200/60 pb-2 sm:pb-2.5 lg:px-8 xl:px-12 dark:border-zinc-800/60"
      data-site-contact
    >
      <a
        v-if="siteInfo.phone"
        :href="phoneHref(siteInfo.phone)"
        :aria-label="t('phone')"
        class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-zinc-500 transition-colors duration-200 hover:text-zinc-950 sm:text-[13px] dark:text-zinc-400 dark:hover:text-white"
        data-site-phone
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
        <span class="truncate tabular-nums">{{ siteInfo.phone }}</span>
      </a>

      <a
        v-if="siteInfo.locationLabel || siteInfo.locationUrl"
        :href="siteInfo.locationUrl || undefined"
        :target="siteInfo.locationUrl ? '_blank' : undefined"
        rel="noopener"
        :aria-label="t('location')"
        class="ml-auto flex min-w-0 items-center gap-1.5 text-xs font-semibold text-zinc-500 transition-colors duration-200 hover:text-zinc-950 sm:text-[13px] dark:text-zinc-400 dark:hover:text-white"
        data-site-location
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true">
          <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <!-- Truncates only when the row actually runs out of room; the cap exists so a long label
             can never squeeze the phone number off the line. -->
        <span class="max-w-[24ch] truncate">{{ siteInfo.locationLabel }}</span>
      </a>
    </div>
  </Transition>
</template>
