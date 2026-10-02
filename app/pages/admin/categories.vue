<script setup lang="ts">
import { CATEGORY_ICON_ITEMS, categoryIconOf } from '~/composables/useCategoryItems'

const user = useSupabaseUser()
const { isAdmin } = useAdminAuth()
const { locale, t } = useI18n()

const isAdminMode = ref(false)

// Same boundary as the other two editors: the page composes, `useAdminCategoryEditor` owns the rows
// and every write, and authorisation stays in row-level security — `canMutate` is a UI guard, not the
// security boundary. The storefront's own dock reads the categories through `useCatalog` → `index.vue`,
// so nothing here has to tell the shop it changed.
const {
  categoryRows,
  isLoading,
  isSaving,
  actionError,
  savedNotice,
  loadCategories,
  saveCategories,
  addCategoryRow,
  moveCategoryRow,
  reorderCategoryRow,
  removeCategoryRow
} = useAdminCategoryEditor({ canMutate: () => isAdminMode.value })

// Drag-to-reorder, the same shape as the site-info social links: the dragged row's uid is the only
// state, `dragover` is inert (it only permits the drop) and the list moves once, on `drop`. Reordering
// per dragover is what made the social row flicker — see the comment in `admin/site-info.vue`.
const dragUid = ref('')
const onCategoryDragStart = (event: DragEvent, uid: string) => {
  dragUid.value = uid
  const transfer = event.dataTransfer
  if (!transfer) return
  transfer.setData('text/plain', uid)
  transfer.effectAllowed = 'move'
  const row = (event.currentTarget as HTMLElement | null)?.closest('[data-category-row]')
  if (row) {
    const rect = row.getBoundingClientRect()
    transfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top)
  }
}
const onCategoryDragOver = (event: DragEvent) => { event.preventDefault() }
const onCategoryDrop = (index: number) => {
  if (dragUid.value) reorderCategoryRow(dragUid.value, index)
  dragUid.value = ''
}
const onCategoryDragEnd = () => { dragUid.value = '' }

const refreshAdminMode = async () => { isAdminMode.value = await isAdmin() }
watch(user, () => { void refreshAdminMode() }, { immediate: true })
onMounted(() => { void loadCategories() })

useHead(() => ({ title: `${t('categories')} | ${t('appName')}` }))
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <UContainer class="pt-5 sm:pt-6">
      <header class="flex items-center justify-between gap-4 border-b border-zinc-200/80 pb-4 dark:border-zinc-800/80">
        <NuxtLink to="/" :aria-label="t('appName')" class="shrink-0">
          <BrandLogo size="sm" />
        </NuxtLink>
        <div class="flex items-center gap-2 shrink-0 sm:gap-3">
          <ColorModeToggle />
          <LanguageSwitcher />
          <NuxtLink
            to="/"
            class="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-950 sm:text-sm dark:text-zinc-400 dark:hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            <span>{{ t('backToCatalog') }}</span>
          </NuxtLink>
        </div>
      </header>

      <section class="pt-10 sm:pt-14">
        <p class="text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.25em]'">
          {{ t('adminAccess') }}
        </p>
        <h1 class="mt-3 text-2xl font-bold text-balance text-zinc-950 sm:text-3xl dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
          {{ t('categories') }}
        </h1>
        <p class="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          {{ t('categoriesHint') }}
        </p>
      </section>

      <!-- The tools rail on the left, the tool itself on the right: same two-column shape the
           catalog page uses, so switching between admin tools feels like moving around one app
           rather than between unrelated pages. Stacked below `lg`. -->
      <div class="lg:flex lg:items-start lg:gap-10">
        <aside class="lg:w-44 lg:shrink-0 lg:pt-8">
          <AdminTabs />
        </aside>
        <div class="min-w-0 flex-1">

          <UAlert v-if="actionError" class="mt-8" color="error" variant="soft" :title="actionError" />
          <UAlert v-if="savedNotice" class="mt-8" color="success" variant="soft" :title="savedNotice" />

          <form v-if="!isLoading" class="mt-8 space-y-8 pb-24" data-category-form @submit.prevent="saveCategories">
            <section class="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-6 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-category-section>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-black text-zinc-950 dark:text-white">{{ t('categories') }}</h2>
                  <p class="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{{ t('categoryOrderHint') }}</p>
                </div>
                <UButton type="button" color="neutral" variant="outline" size="sm" data-category-add @click="addCategoryRow">
                  ＋ {{ t('addCategory') }}
                </UButton>
              </div>

              <p v-if="!categoryRows.length" class="mt-6 rounded-xl border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                {{ t('noCategories') }}
              </p>

              <!-- Rows enter, leave and reorder instead of teleporting: `sort_order` is this editor's
                   whole subject, so a row that jumps past its neighbours to a new position hides the
                   thing the owner just did. `relative` is load-bearing — the leaving row goes absolute
                   so it stops taking up space while it fades, and that needs a containing block.
                   Rows are keyed on the row model's `uid`, not on `id || new-<index>`: an unsaved row's
                   index key made deleting it re-key every row after it, which read as a content swap
                   instead of a leave — and a drag needs an identity that survives the move anyway. -->
              <TransitionGroup v-else tag="ul" name="row" class="relative mt-6 space-y-3">
                <li
                  v-for="(row, index) in categoryRows"
                  :key="row.uid"
                  class="flex flex-wrap items-center gap-2.5 rounded-xl border border-zinc-200/80 bg-white p-3 sm:flex-nowrap dark:border-zinc-800/80 dark:bg-zinc-900"
                  :class="[row.isActive ? '' : 'opacity-60', dragUid === row.uid ? 'ring-2 ring-zinc-900/15 dark:ring-white/25' : '']"
                  data-category-row
                  @dragover="onCategoryDragOver"
                  @drop.prevent="onCategoryDrop(index)"
                >
                  <!-- The grip is the only draggable thing in the row, so selecting text in a field
                       cannot drag the row. The arrows beside it stay: they are the keyboard and touch
                       path, and this drag is mouse and trackpad only. -->
                  <button
                    type="button"
                    draggable="true"
                    class="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950 active:cursor-grabbing dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-white"
                    :aria-label="t('dragToReorder')"
                    :title="t('dragToReorder')"
                    @dragstart="onCategoryDragStart($event, row.uid)"
                    @dragend="onCategoryDragEnd"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4" aria-hidden="true"><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>
                  </button>
                  <UInput v-model="row.nameEn" :placeholder="t('categoryNameEnglish')" class="w-full min-w-0 flex-1" :data-category-en="index" />
                  <UInput v-model="row.nameKm" :placeholder="t('categoryNameKhmer')" class="w-full min-w-0 flex-1" :data-category-km="index" />
                  <!-- The slug is the row's stable identity: it is what keeps a category's glyph matched and
                       what the shop means when it says "monitors". Left empty, the save derives it from the
                       English name. -->
                  <UInput v-model="row.slug" :placeholder="t('slug')" class="w-full min-w-0 sm:w-36" :data-category-slug="index" />
                  <!-- The dock matches a category's mark on its slug, so the icon picker is the slug
                       field's other end: choosing a mark writes the slug, and the glyph in the trigger
                       is what the storefront will draw. The options are the slugs that have art, shown
                       as themselves — a technical name the Khmer UI keeps in Latin like `Slug` and `SKU`.
                       A slug with no art reads as unselected and wears the crate. -->
                  <USelect
                    :model-value="row.slug"
                    :items="CATEGORY_ICON_ITEMS"
                    :placeholder="t('categoryIconLabel')"
                    class="w-full min-w-0 sm:w-36"
                    :data-category-icon="index"
                    @update:model-value="row.slug = String($event ?? '')"
                  >
                    <template #leading>
                      <CategoryIcon :name="categoryIconOf(row.slug)" class="h-4.5 w-4.5 text-zinc-500 dark:text-zinc-400" />
                    </template>
                  </USelect>
                  <span class="flex shrink-0 items-center gap-2">
                    <USwitch v-model="row.isActive" color="neutral" :aria-label="t('categoryVisibleLabel')" :title="t('categoryVisibleLabel')" class="shrink-0" :data-category-active="index" />
                    <span class="hidden max-w-[6.5rem] text-[10px] font-semibold uppercase leading-tight text-zinc-500 xl:block dark:text-zinc-400" data-switch-caption>{{ t('categoryVisibleLabel') }}</span>
                  </span>
                  <span class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-[color,background-color,scale] duration-150 ease-out motion-safe:active:scale-[0.97] hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                      :aria-label="t('moveUp')"
                      :disabled="index === 0"
                      :data-category-up="index"
                      @click="moveCategoryRow(index, -1)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
                    </button>
                    <button
                      type="button"
                      class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-[color,background-color,scale] duration-150 ease-out motion-safe:active:scale-[0.97] hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                      :aria-label="t('moveDown')"
                      :disabled="index === categoryRows.length - 1"
                      :data-category-down="index"
                      @click="moveCategoryRow(index, 1)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <button
                      type="button"
                      class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-[color,background-color,scale] duration-150 ease-out motion-safe:active:scale-[0.97] hover:bg-error/10 hover:text-error dark:text-zinc-400"
                      :aria-label="t('removeCategory')"
                      :disabled="isSaving"
                      :data-category-remove="index"
                      @click="removeCategoryRow(index)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </span>
                </li>
              </TransitionGroup>
            </section>

            <div class="flex items-center justify-end gap-3 border-t border-zinc-200/80 pt-6 dark:border-zinc-800/80">
              <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="isSaving" @click="navigateTo('/')">
                {{ t('cancel') }}
              </UButton>
              <UButton type="submit" color="neutral" size="sm" :loading="isSaving" data-category-save>
                {{ t('saveChanges') }}
              </UButton>
            </div>
          </form>

          <div v-else class="mt-8 space-y-4 pb-24">
            <div class="h-40 rounded-2xl border border-zinc-200/60 bg-zinc-100 animate-pulse dark:border-zinc-800/60 dark:bg-zinc-900" />
            <div class="h-56 rounded-2xl border border-zinc-200/60 bg-zinc-100 animate-pulse dark:border-zinc-800/60 dark:bg-zinc-900" />
          </div>
        </div>
      </div>
    </UContainer>
  </main>
</template>
