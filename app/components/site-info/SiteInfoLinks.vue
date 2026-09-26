<script setup lang="ts">
import type { SiteInfo } from '~/types/site-info'

// Presentational by rule: the resolved public model comes in as a prop, this component owns
// no fetching and no row mapping. It renders whatever the site owner has filled in — an
// empty phone/location simply omits its link, so no placeholder text leaks into the header.
defineProps<{
  siteInfo: SiteInfo | null
}>()

const { t } = useI18n()

// tel: hrefs keep digits and a leading plus only; the displayed text stays exactly as entered.
const phoneHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

// Platform → icon. Unknown platforms render the globe fallback with their name as the label,
// which is what keeps a new social link from being a schema change, a component change, or a
// dead end for the reader.
const FALLBACK_ICON = 'globe'
const knownIcons = ['facebook', 'instagram', 'telegram', 'youtube', 'tiktok', 'x', 'twitter', 'whatsapp']
const iconFor = (platform: string) => knownIcons.includes(platform.toLowerCase()) ? platform.toLowerCase() : FALLBACK_ICON
</script>

<template>
  <div
    v-if="siteInfo && (siteInfo.phone || siteInfo.locationLabel || siteInfo.locationUrl || siteInfo.socialLinks.length)"
    class="flex min-w-0 items-center gap-1.5 lg:gap-3"
    data-site-info
  >
    <a
      v-if="siteInfo.phone"
      :href="phoneHref(siteInfo.phone)"
      :aria-label="t('phone')"
      class="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-950 lg:h-10 lg:px-3 lg:text-sm dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
      data-site-phone
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
      <!-- Icon-only between md and lg: the masthead stays one unravelling row at 834px. -->
      <span class="hidden lg:inline tabular-nums">{{ siteInfo.phone }}</span>
    </a>

    <a
      v-if="siteInfo.locationLabel || siteInfo.locationUrl"
      :href="siteInfo.locationUrl || undefined"
      :target="siteInfo.locationUrl ? '_blank' : undefined"
      rel="noopener"
      :aria-label="t('location')"
      class="flex h-9 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-950 lg:h-10 lg:px-3 lg:text-sm dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
      data-site-location
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true">
        <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <span class="hidden max-w-[16ch] truncate lg:inline">{{ siteInfo.locationLabel }}</span>
    </a>

    <span v-if="siteInfo.socialLinks.length" class="mx-0.5 hidden h-5 w-px shrink-0 bg-zinc-200/80 sm:block dark:bg-zinc-800/80" aria-hidden="true" />

    <!-- Icon-only controls, per the header's utility idiom; the platform name is the label. -->
    <a
      v-for="link in siteInfo.socialLinks"
      :key="`${link.platform}-${link.url}`"
      :href="link.url"
      target="_blank"
      rel="noopener"
      :aria-label="link.platform"
      :title="link.platform"
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-950 lg:h-10 lg:w-10 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
      data-site-social
      :data-platform="link.platform"
    >
      <svg v-if="iconFor(link.platform) === 'facebook'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
      <svg v-else-if="iconFor(link.platform) === 'instagram'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
      </svg>
      <svg v-else-if="iconFor(link.platform) === 'telegram'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </svg>
      <svg v-else-if="iconFor(link.platform) === 'youtube'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
        <path d="m10 15 5-3-5-3z" />
      </svg>
      <svg v-else-if="iconFor(link.platform) === 'tiktok'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      <svg v-else-if="iconFor(link.platform) === 'whatsapp'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </svg>
      <svg v-else-if="iconFor(link.platform) === 'x' || iconFor(link.platform) === 'twitter'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    </a>
  </div>
</template>
