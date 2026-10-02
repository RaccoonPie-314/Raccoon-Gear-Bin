<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'
import { hasKhmerText } from '~/utils/locale-script'

defineProps<{ product: CatalogProduct; isAdmin?: boolean }>()
const emit = defineEmits<{ edit: [product: CatalogProduct] }>()
// `locale` gates the wide Latin tracking on the card's own words: letter-spacing at this scale pulls
// Khmer clusters apart. The category name is not the card's own word — it is a resolved translation
// row — so that one asks `hasKhmerText` instead (see `~/utils/locale-script`).
// `localePath` is why the card's links are built rather than written: a hardcoded `/products/<id>`
// is the *English* route under `prefix_except_default`, so clicking a card from the Khmer storefront
// silently dropped the visitor back to English (and remounted the page, which reads as a reload).
const { locale, t } = useI18n()
const localePath = useLocalePath()
</script>

<template>
  <article class="group flex flex-col justify-between">
    <div>
      <div class="relative aspect-square overflow-hidden rounded-2xl bg-zinc-50 dark:bg-zinc-900/70 border border-zinc-200/70 dark:border-zinc-800/70 shadow-2xs group-hover:border-zinc-300 dark:group-hover:border-zinc-700 group-hover:shadow-sm transition-[border-color,box-shadow] duration-200 ease-out">
        <NuxtLink :to="localePath(`/products/${product.id}`)" class="block h-full w-full">
          <img
            v-if="product.images[0]"
            :src="product.images[0].thumbUrl"
            :alt="product.images[0].altText || product.name"
            loading="lazy"
            class="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03]"
          />
          <div v-else class="flex h-full items-center justify-center text-xs uppercase text-zinc-400" :class="locale === 'km' ? '' : 'tracking-[0.2em]'">
            {{ t('noImage') }}
          </div>
        </NuxtLink>
        <!-- The grid's sale signal: the ribbon carries its own clip box, so it is cut off by the
             photo's corner here and by the detail page's wrapper in exactly the same way. -->
        <ProductSaleRibbon :product="product" />
        <!-- Always visible, not reveal-on-hover: this button only exists in admin mode, so the
             hover gate bought nothing for its entire audience and cost the affordance itself —
             an `opacity-0` element is still clickable, which reads as a dead spot that works.
             The transition list says `scale`, not `transform`: Tailwind v4's scale utilities write
             the standalone `scale` property, so a `transform` list animates neither the hover pop nor
             the press, and `active:` is listed after `hover:` so the press wins while the finger is down. -->
        <button
          v-if="isAdmin"
          type="button"
          class="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 dark:bg-zinc-900/90 text-zinc-800 dark:text-zinc-200 shadow-sm border border-zinc-200/60 dark:border-zinc-700/60 transition-[scale,background-color,border-color] duration-150 ease-out hover:scale-105 hover:bg-white dark:hover:bg-zinc-900 motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-white cursor-pointer"
          :aria-label="t('editProduct')"
          @click.stop="emit('edit', product)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
        </button>
      </div>

      <div class="flex items-start justify-between gap-4 pt-4">
        <div class="min-w-0 flex-1">
          <p class="text-[10px] sm:text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="hasKhmerText(product.categoryName ?? t('uncategorized')) ? '' : 'tracking-[0.2em]'">
            {{ product.categoryName ?? t('uncategorized') }}
          </p>
          <h2 class="mt-1 text-sm sm:text-base font-bold text-zinc-950 dark:text-white truncate" :class="hasKhmerText(product.name) ? '' : 'tracking-tight'">
            <NuxtLink :to="localePath(`/products/${product.id}`)" class="hover:underline">
              {{ product.name }}
            </NuxtLink>
          </h2>
          <p v-if="product.shortDescription" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
            {{ product.shortDescription }}
          </p>
        </div>
        <ProductPrice :product="product" class="shrink-0 text-right text-sm sm:text-base font-bold text-zinc-950 dark:text-white" />
      </div>
    </div>

    <div class="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-900/80">
      <StockStatus :quantity="product.stockQuantity" />
      <NuxtLink
        :to="localePath(`/products/${product.id}`)"
        class="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white transition-colors"
      >
        <span>{{ t('details') }}</span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
      </NuxtLink>
    </div>
  </article>
</template>
