<script setup lang="ts">
/**
 * The stock desk: one row per product — name, SKU, status, units sold and the one editable
 * number — saved as a single batch. It owns the feature composable, so the page keeps only the
 * admin-mode flag; authorisation itself is row-level security behind `/api/admin/stock`, and
 * `isAdminMode` only keeps the save honest before the server has to say no. The band reuses
 * `StockStatus` rather than re-deriving it, because `product-stock.ts` stays the one owner of the
 * in / low / out rule.
 */
const props = defineProps<{ isAdminMode: boolean }>()

const { t } = useI18n()
const { rows, visibleRows, search, isLoading, loadError, actionError, saved, isSaving, hasChanges, loadStock, valueFor, bandValue, onInput, saveStock }
  = useAdminStock({ canMutate: () => props.isAdminMode })

onMounted(loadStock)
</script>

<template>
  <div>
    <UAlert v-if="actionError" class="mt-8" color="error" variant="soft" :title="actionError" />

    <div v-if="isLoading" class="mt-8 h-40 animate-pulse rounded-2xl border border-zinc-200/60 bg-zinc-100 dark:border-zinc-800/60 dark:bg-zinc-900" />

    <div v-else-if="loadError" class="mt-8 rounded-2xl border border-dashed border-zinc-200 py-24 text-center dark:border-zinc-800">
      <p class="text-sm font-medium text-zinc-500">{{ t('stockLoadError') }}</p>
    </div>

    <Transition name="reveal"><div v-if="!isLoading && !loadError" data-stock-form>
      <p class="mt-8 max-w-xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{{ t('stockHint') }}</p>

      <div v-if="rows.length" class="mt-6">
        <UInput v-model="search" data-stock-search type="search" :placeholder="t('adminStockSearch')" :aria-label="t('adminStockSearch')" class="w-full sm:max-w-xs" />
      </div>

      <p v-if="!rows.length" class="mt-6 rounded-2xl border border-dashed border-zinc-200 py-16 text-center text-sm font-medium text-zinc-500 dark:border-zinc-800">
        {{ t('stockEmpty') }}
      </p>

      <p v-else-if="!visibleRows.length" class="mt-6 rounded-2xl border border-dashed border-zinc-200 py-16 text-center text-sm font-medium text-zinc-500 dark:border-zinc-800">
        {{ t('noProducts') }}
      </p>

      <ul v-else class="mt-6 space-y-3">
        <li
          v-for="row in visibleRows"
          :key="row.id"
          data-stock-row
          class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-zinc-200/80 bg-white px-4 py-3.5 dark:border-zinc-800/80 dark:bg-zinc-900"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold text-zinc-950 dark:text-white">{{ row.name }}</span>
            <span class="block text-xs text-zinc-500">{{ t('sku') }}: <span data-stock-sku class="font-mono">{{ row.sku }}</span></span>
          </span>
          <span
            data-stock-product-status
            class="text-[11px] font-medium"
            :class="row.status === 'published' ? 'text-zinc-400 dark:text-zinc-500' : 'text-amber-600 dark:text-amber-500'"
          >
            {{ row.status === 'published' ? t('productPublished') : t('productDraft') }}
          </span>
          <span class="inline-flex items-baseline gap-1.5 text-xs text-zinc-500">
            {{ t('sold') }}
            <span data-stock-sold class="font-semibold tabular-nums text-zinc-950 dark:text-white">{{ row.sold }}</span>
          </span>
          <StockStatus :quantity="bandValue(row)" />
          <UInput
            :data-stock-input="row.id"
            :model-value="valueFor(row)"
            type="number"
            min="0"
            step="1"
            class="w-24"
            :aria-label="`${t('stock')}: ${row.name}`"
            @update:model-value="onInput(row, $event)"
          />
        </li>
      </ul>

      <div v-if="rows.length" class="mt-6 flex flex-wrap items-center gap-3">
        <UButton data-stock-save type="button" :disabled="!hasChanges || isSaving" :loading="isSaving" @click="saveStock">
          {{ t('saveChanges') }}
        </UButton>
        <span v-if="saved" class="text-sm text-zinc-500 dark:text-zinc-400">{{ t('stockSaved') }}</span>
      </div>
    </div></Transition>
  </div>
</template>
