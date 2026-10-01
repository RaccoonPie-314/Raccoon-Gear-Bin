<script setup lang="ts">
import type { CategoryIconName } from '~/composables/useCategoryItems'

/**
 * The category glyphs, previously duplicated line-for-line in CategoryDesktop and
 * CategoryMobile. Only the geometry lives here; sizing and colour-transition classes are
 * passed in by each consumer, because the desktop dock renders the glyphs one step larger
 * from the `sm` breakpoint up while the mobile dock does not.
 *
 * Anything the shop adds beyond the categories with art below falls through to the crate mark:
 * a category is a category, it is not required to have bespoke art to be navigable. Every mark here is
 * drawn on the same 24-unit grid, at the root's 1.75 stroke and round joins, and is picked by slug in
 * `useCategoryItems`' `ICON_BY_SLUG` — adding one is one entry there and one `<template>` here.
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

    <!-- Whole machines -->

    <!-- Laptop: the lid, then the base wider than the lid so the hinge reads -->
    <template v-else-if="name === 'laptop'">
      <path d="M5 5h14a1 1 0 0 1 1 1v9H4V6a1 1 0 0 1 1-1z" />
      <path d="M2 19.5h20l-1.5-4.5h-17z" />
    </template>

    <!-- Desktop: a tower case with its drive slots and power dot -->
    <template v-else-if="name === 'desktop'">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="9" y1="7" x2="15" y2="7" />
      <line x1="9" y1="10.5" x2="15" y2="10.5" />
      <line x1="9" y1="17" x2="9.01" y2="17" stroke-width="2.5" />
    </template>

    <!-- Monitor: a display on a foot -->
    <template v-else-if="name === 'monitor'">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </template>

    <!-- Tablet -->
    <template v-else-if="name === 'tablet'">
      <rect x="5" y="2" width="14" height="20" rx="2.5" />
      <line x1="12" y1="18.5" x2="12.01" y2="18.5" stroke-width="2" />
    </template>

    <!-- The parts that go inside them -->

    <!-- CPU: the die, the substrate, the pins -->
    <template v-else-if="name === 'cpu'">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <path d="M9 2.5v3.5M15 2.5v3.5M9 18v3.5M15 18v3.5M2.5 9h3.5M2.5 15h3.5M18 9h3.5M18 15h3.5" />
    </template>

    <!-- GPU: a card with two fans and its edge connector -->
    <template v-else-if="name === 'gpu'">
      <rect x="2" y="4" width="20" height="11" rx="2" />
      <circle cx="8" cy="9.5" r="2.6" />
      <circle cx="15" cy="9.5" r="2.6" />
      <path d="M5 15v3.5h7V15" />
    </template>

    <!-- RAM: chips across the stick, the pins split by the notch -->
    <template v-else-if="name === 'ram'">
      <rect x="2" y="4" width="20" height="10" rx="2" />
      <path d="M6 7.5v3M10 7.5v3M14 7.5v3M18 7.5v3" />
      <path d="M4 14v3.5M7.5 14v3.5M11 14v3.5M15 14v3.5M18.5 14v3.5" />
    </template>

    <!-- Motherboard: the socket, the slots, a header -->
    <template v-else-if="name === 'motherboard'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="6.5" y="6.5" width="6" height="6" rx="1" />
      <path d="M16 6.5v6M19 6.5v6" />
      <path d="M6.5 16.5h8" />
      <line x1="18.5" y1="17.5" x2="18.51" y2="17.5" stroke-width="2.2" />
    </template>

    <!-- Storage: a drive's platter, spindle and arm -->
    <template v-else-if="name === 'storage'">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <circle cx="10" cy="12" r="4.5" />
      <line x1="10" y1="12" x2="10.01" y2="12" stroke-width="2.2" />
      <path d="M14 9.5 18.5 7" />
    </template>

    <!-- Cooling: a fan, four blades swept off the hub -->
    <template v-else-if="name === 'cooling'">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 3c3 2.5 3 5.5 0 7.4" />
      <path d="M21 12c-2.5 3-5.5 3-7.4 0" />
      <path d="M12 21c-3-2.5-3-5.5 0-7.4" />
      <path d="M3 12c2.5-3 5.5-3 7.4 0" />
    </template>

    <!-- Power: a plug and its cord -->
    <template v-else-if="name === 'power'">
      <path d="M8.5 3v4M15.5 3v4" />
      <path d="M5 7h14v3a7 7 0 0 1-14 0z" />
      <path d="M12 17v4" />
    </template>

    <!-- Everything that plugs in -->

    <!-- Network: a router under its signal -->
    <template v-else-if="name === 'network'">
      <rect x="2" y="14" width="20" height="7" rx="2" />
      <line x1="6" y1="17.5" x2="6.01" y2="17.5" stroke-width="2.2" />
      <line x1="10" y1="17.5" x2="10.01" y2="17.5" stroke-width="2.2" />
      <path d="M12 14v-2" />
      <path d="M9 9.5a4.5 4.5 0 0 1 6 0" />
      <path d="M6 6.5a9 9 0 0 1 12 0" />
    </template>

    <!-- Microphone -->
    <template v-else-if="name === 'microphone'">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
      <path d="M8.5 22h7" />
    </template>

    <!-- Webcam: the lens on its clip -->
    <template v-else-if="name === 'webcam'">
      <circle cx="12" cy="9.5" r="6.5" />
      <circle cx="12" cy="9.5" r="2" />
      <path d="M12 16v4" />
      <path d="M8 20h8" />
    </template>

    <!-- Speaker: a cabinet, tweeter above the woofer -->
    <template v-else-if="name === 'speaker'">
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <line x1="12" y1="6" x2="12.01" y2="6" stroke-width="2.5" />
      <circle cx="12" cy="14.5" r="4" />
    </template>

    <!-- Printer: paper in, paper out -->
    <template v-else-if="name === 'printer'">
      <path d="M7 8V4h10v4" />
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <rect x="7" y="14" width="10" height="7" rx="1.5" />
      <line x1="17.5" y1="11.5" x2="17.51" y2="11.5" stroke-width="2.2" />
    </template>

    <!-- Everything else: a crate. Deliberately the same line weight and corner radius as the rest. -->
    <template v-else>
      <path d="M12 3l8 4v10l-8 4-8-4V7z" />
      <path d="M4 7l8 4 8-4" />
      <path d="M12 11v10" />
    </template>
  </svg>
</template>
