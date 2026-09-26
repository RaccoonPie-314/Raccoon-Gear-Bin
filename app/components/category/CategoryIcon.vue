<script setup lang="ts">
import type { CategoryIconName } from '~/composables/useCategoryItems'

/**
 * The six category glyphs, previously duplicated line-for-line in CategoryDesktop and
 * CategoryMobile. Only the geometry lives here; sizing and colour-transition classes are
 * passed in by each consumer, because the desktop dock renders the glyphs one step larger
 * from the `sm` breakpoint up while the mobile dock does not.
 */
defineProps<{ name: CategoryIconName }>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- All Gear -->
    <template v-if="name === 'all'">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </template>

    <!-- Controllers -->
    <template v-else-if="name === 'controllers'">
      <path d="M6 12h4m-2-2v4" />
      <line x1="15" y1="13" x2="15.01" y2="13" stroke-width="2.5" />
      <line x1="18" y1="11" x2="18.01" y2="11" stroke-width="2.5" />
      <path d="M17.3 5H6.7a4 4 0 0 0-4 3.6l-.7 7.4a3 3 0 0 0 3 3.3c1 0 1.5-.5 2-1l1.5-1.5a2 2 0 0 1 1.4-.6h4.2a2 2 0 0 1 1.4.6l1.5 1.5c.5.5 1 1 2 1a3 3 0 0 0 3-3.3l-.7-7.4a4 4 0 0 0-4-3.6z" />
    </template>

    <!-- Keyboards -->
    <template v-else-if="name === 'keyboards'">
      <rect x="2" y="4" width="20" height="16" rx="2.5" />
      <line x1="6" y1="8" x2="6.01" y2="8" stroke-width="2.2" />
      <line x1="10" y1="8" x2="10.01" y2="8" stroke-width="2.2" />
      <line x1="14" y1="8" x2="14.01" y2="8" stroke-width="2.2" />
      <line x1="18" y1="8" x2="18.01" y2="8" stroke-width="2.2" />
      <line x1="8" y1="12" x2="8.01" y2="12" stroke-width="2.2" />
      <line x1="12" y1="12" x2="12.01" y2="12" stroke-width="2.2" />
      <line x1="16" y1="12" x2="16.01" y2="12" stroke-width="2.2" />
      <line x1="7" y1="16" x2="17" y2="16" />
    </template>

    <!-- Mice -->
    <template v-else-if="name === 'mice'">
      <rect x="5" y="2" width="14" height="20" rx="7" />
      <line x1="12" y1="2" x2="12" y2="10" />
      <rect x="11" y="5" width="2" height="4" rx="1" stroke-width="1.5" />
    </template>

    <!-- Headphones -->
    <template v-else-if="name === 'headphones'">
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
    </template>

    <!-- Earphones -->
    <template v-else-if="name === 'earphones'">
      <path d="M6 5a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1z" />
      <path d="M6 14v5a1 1 0 0 1-1 1" />
      <line x1="3" y1="9" x2="1.5" y2="9" stroke-width="2" />
      <path d="M18 5a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1z" />
      <path d="M18 14v5a1 1 0 0 0 1 1" />
      <line x1="21" y1="9" x2="22.5" y2="9" stroke-width="2" />
    </template>
  </svg>
</template>
