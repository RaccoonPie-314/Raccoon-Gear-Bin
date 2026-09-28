<script setup lang="ts">
type BrandLogoSize = 'sm' | 'md' | 'masthead' | 'hero'

withDefaults(defineProps<{
  size?: BrandLogoSize
}>(), { size: 'hero' })

// Height steps per usage. The artwork is a square emblem, so a step buys prominence in the row
// without eating the header's horizontal budget the way a wordmark would. `masthead` is the
// storefront header, where the logo is the anchor: it opens at a quarter of a phone's width and
// climbs to a full emblem on a desktop. The lower steps are deliberately close to the height of
// the band the two masthead rules draw, so the emblem fills that band instead of floating in it.
const sizeClasses: Record<BrandLogoSize, string> = {
  sm: 'h-12 sm:h-16',
  md: 'h-20 sm:h-28 md:h-36',
  masthead: 'h-24 sm:h-28 xl:h-32',
  hero: 'h-24 sm:h-36 md:h-48 lg:h-56 max-h-[30vh]'
}
</script>

<template>
  <!-- `flex`, not `inline-flex`: as an atomic inline box the emblem would sit on a text
       baseline, which parks a few pixels of descender under it and lifts the logo out of the
       vertical centre of any row it shares with controls. -->
  <span class="flex items-center transition-opacity hover:opacity-95">
    <!-- Light Mode Logo -->
    <img
      src="/rgb-logo-light.png"
      :alt="$t('appName')"
      class="w-auto object-contain transition-all duration-200 dark:hidden"
      :class="sizeClasses[size]"
    />
    <!-- Dark Mode Logo -->
    <img
      src="/rgb-logo-dark.png"
      :alt="$t('appName')"
      class="w-auto object-contain transition-all duration-200 hidden dark:block"
      :class="sizeClasses[size]"
    />
  </span>
</template>
