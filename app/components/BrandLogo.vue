<script setup lang="ts">
defineProps<{
  size?: 'sm' | 'md' | 'lg' | 'hero'
}>()
</script>

<template>
  <span class="inline-flex items-center transition-opacity hover:opacity-95">
    <!-- Light Mode Logo -->
    <img
      src="/rgb-logo-light.png"
      :alt="$t('appName')"
      class="w-auto object-contain transition-all duration-200 dark:hidden"
      :class="[
        size === 'sm' ? 'h-12 sm:h-16' :
        size === 'md' ? 'h-20 sm:h-28 md:h-36' :
        'h-24 sm:h-36 md:h-48 lg:h-56 max-h-[30vh]'
      ]"
    />
    <!-- Dark Mode Logo -->
    <img
      src="/rgb-logo-dark.png"
      :alt="$t('appName')"
      class="w-auto object-contain transition-all duration-200 hidden dark:block"
      :class="[
        size === 'sm' ? 'h-12 sm:h-16' :
        size === 'md' ? 'h-20 sm:h-28 md:h-36' :
        'h-24 sm:h-36 md:h-48 lg:h-56 max-h-[30vh]'
      ]"
    />
  </span>
</template>
