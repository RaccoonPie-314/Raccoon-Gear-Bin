<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'
import { getProductPricing } from '~/utils/product-pricing'

/**
 * The red corner ribbon a promoted product wears across the top-left of its photo: the campaign's own
 * name when the shop gave it one, the generic wording otherwise.
 *
 * One component because two surfaces wear it — the catalog card and the detail page's gallery — and a
 * ribbon that drifts between them is worse than no ribbon. It renders nothing unless `getProductPricing`
 * says a promotion is running, so the ribbon and the price pair can never disagree: the same rule
 * decides both, and neither surface owns the look.
 *
 * The band is cut across the corner by its own 112px clip box rather than by the surface it sits on.
 * That is deliberate: the card's photo frame already clips, but the gallery's frame is `ProductGallery`'s
 * own box — clipping it from outside would shave the frame's shadow, and reaching inside the component is
 * off bounds because the zoom maths measures that frame. A `size-28` box at the corner needs neither.
 */
const props = defineProps<{ product: CatalogProduct }>()
const { locale, t } = useI18n()
const pricing = computed(() => getProductPricing(props.product))
</script>

<template>
  <!-- The band's centre sits at (34px, 34px) inside the clip box, so its centre line crosses the left
       edge at y=68 and the top edge at x=68: a 45° chamfer off the corner, with both ends running past
       the box to be cut flush. `pointer-events-none` is load-bearing — the card's whole photo is one link
       and the detail photo is one zoom control, so a ribbon that ate the tap would read as a dead spot
       that works. `data-sale-ribbon` is what `verify` aims at. -->
  <span
    v-if="pricing.originalPrice !== null"
    data-sale-ribbon
    class="pointer-events-none absolute left-0 top-0 z-10 size-28 overflow-hidden"
  >
    <span class="absolute -left-[30px] top-[23px] w-32 -rotate-45 truncate bg-red-700 py-1 text-center text-[10px] font-bold uppercase leading-[14px] text-white" :class="locale === 'km' ? '' : 'tracking-wide'">
      {{ pricing.label || t('sale') }}
    </span>
  </span>
</template>
