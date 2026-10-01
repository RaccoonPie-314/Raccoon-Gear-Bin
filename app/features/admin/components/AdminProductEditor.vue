<script setup lang="ts">
import type { CatalogCategory, CatalogProduct } from '~/types/catalog'

/**
 * The admin product editor's UI: the error banner, the form modal and the delete confirmation.
 * It is the feature's only view — it owns the editor composable and exposes the two ways in
 * (`openAddEditor` / `openEditEditor`), so the page keeps a ref instead of the editor's state.
 * What it cannot own arrives as props: the category options, the product list the delete button
 * resolves the form's id against, and whether this visitor may mutate at all. Writes stay in the
 * composable, and authorisation stays in row-level security — `isAdminMode` only gates the
 * affordance, and `mutated` is the page's cue to reload what the grid shows.
 */
const props = defineProps<{
  categories: CatalogCategory[]
  products: CatalogProduct[]
  isAdminMode: boolean
}>()

const emit = defineEmits<{ mutated: [] }>()

const { locale, t } = useI18n()

const {
  editorForm,
  editorOpen,
  deleteTarget,
  isSaving,
  actionError,
  openAddEditor,
  openEditEditor,
  handleImageSelection,
  saveProduct,
  confirmDelete
} = useAdminProductEditor({
  categories: () => props.categories,
  canMutate: () => props.isAdminMode,
  onMutated: () => emit('mutated')
})

// The delete affordance sits in the form modal but hands off to the confirmation, which is keyed
// off a product rather than the form: closing one and opening the other is one user intent.
const deleteEditedProduct = () => {
  deleteTarget.value = props.products.find((product) => product.id === editorForm.value.id) || null
  editorOpen.value = false
}

defineExpose({ openAddEditor, openEditEditor })
</script>

<template>
  <UAlert v-if="actionError" class="mt-6" color="error" variant="soft" :title="actionError" />

  <!-- Admin Edit Modal. The `modal` transition fades the scrim and scales the card in (see
       `main.css`); the wrapper shares the overlay's opening and closing lines so a hundred and thirty
       lines of form markup do not shift two spaces for a cosmetic indent.
       The overlay's direct child is the card in both modals, which is what `.modal-*  > section`
       aims at — no new `data-*` hook, and no rule that could reach the Share Sheet or the contact
       panel (both are `<motion>` surfaces whose transform has one owner). -->
  <Transition name="modal"><div
    v-if="editorOpen"
    class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm overflow-y-auto"
    @click.self="editorOpen = false"
  >
    <section
      class="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800/80 my-auto overflow-hidden flex flex-col max-h-[90vh]"
      role="dialog"
      aria-modal="true"
      :aria-label="t('editProduct')"
    >
      <div class="flex items-center justify-between gap-4 border-b border-zinc-200/80 px-6 py-5 dark:border-zinc-800/80">
        <div>
          <p class="text-[10px] font-bold uppercase text-zinc-400" :class="locale === 'km' ? 'tracking-[0.08em]' : 'tracking-[0.2em]'">{{ t('catalog') }}</p>
          <h2 class="mt-1 text-xl font-black">{{ editorForm.id ? t('editProduct') : t('addProduct') }}</h2>
        </div>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          :aria-label="t('close')"
          @click="editorOpen = false"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <form class="flex-1 overflow-y-auto p-6 sm:p-8 space-y-5" @submit.prevent="saveProduct">
        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField :label="t('productName')" required>
            <UInput v-model="editorForm.name" required class="w-full" />
          </UFormField>
          <UFormField :label="t('category')" required>
            <USelect
              v-model="editorForm.categoryId"
              :items="categories.map((category) => ({ label: category.name, value: category.id }))"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('sku')" required>
            <UInput v-model="editorForm.sku" required class="w-full" />
          </UFormField>
          <UFormField :label="t('slug')" required>
            <UInput v-model="editorForm.slug" required class="w-full" />
          </UFormField>
          <UFormField :label="t('price')" required>
            <UInput v-model.number="editorForm.price" type="number" min="0" step="0.01" required class="w-full" />
          </UFormField>
          <UFormField :label="t('stock')" required>
            <UInput v-model.number="editorForm.stockQuantity" type="number" min="0" step="1" required class="w-full" />
          </UFormField>
        </div>

        <!-- Promotion: switched off by default, because most products have none and an owner here
             to correct a price should not have to read past five empty fields to find it. The four
             kinds of offer are fields on one record, not four modes: a price cut on its own, a named
             campaign, a campaign that stops at a time, and one that stops at a count. -->
        <div class="border-t border-zinc-200/80 pt-5 dark:border-zinc-800/80">
          <UFormField :label="t('applyPromotion')">
            <USwitch v-model="editorForm.promotionEnabled" />
          </UFormField>
          <div v-if="editorForm.promotionEnabled" class="mt-4 grid gap-5 sm:grid-cols-2">
            <UFormField :label="t('discountedPrice')" required>
              <UInput v-model="editorForm.promoPrice" type="number" min="0" step="0.01" class="w-full" />
            </UFormField>
            <UFormField :label="t('promotionName')">
              <UInput v-model="editorForm.promoLabel" class="w-full" />
            </UFormField>
            <UFormField :label="t('promotionStarts')">
              <UInput v-model="editorForm.promoStartsAt" type="datetime-local" class="w-full" />
            </UFormField>
            <UFormField :label="t('promotionEnds')">
              <UInput v-model="editorForm.promoEndsAt" type="datetime-local" class="w-full" />
            </UFormField>
            <UFormField :label="t('promotionUnits')" :hint="t('promotionUnitsHint')" class="sm:col-span-2">
              <UInput v-model="editorForm.promoQuantity" type="number" min="1" step="1" class="w-full" />
            </UFormField>
          </div>
        </div>

        <UFormField :label="t('shortDescription')" required>
          <UInput v-model="editorForm.shortDescription" required class="w-full" />
        </UFormField>

        <UFormField :label="t('fullDescription')" required>
          <UTextarea v-model="editorForm.description" :rows="4" required class="w-full" />
        </UFormField>

        <UFormField :label="t('specs')" :hint="t('specificationsHint')">
          <UTextarea v-model="editorForm.specifications" :rows="4" class="w-full font-mono text-xs" />
        </UFormField>

        <UFormField :label="t('imagePaths')" :hint="t('imagePathsHint')">
          <UTextarea v-model="editorForm.imagePaths" :rows="3" class="w-full font-mono text-xs" />
        </UFormField>

        <UFormField :label="t('uploadImages')">
          <input
            type="file"
            accept="image/*"
            multiple
            class="block w-full text-xs text-zinc-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-zinc-100 dark:file:bg-zinc-800 file:text-zinc-700 dark:file:text-zinc-300 hover:file:bg-zinc-200 cursor-pointer"
            @change="handleImageSelection"
          />
        </UFormField>

        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 pt-5 dark:border-zinc-800/80">
          <UButton
            v-if="editorForm.id"
            type="button"
            color="error"
            variant="ghost"
            size="sm"
            @click="deleteEditedProduct"
          >
            {{ t('deleteProduct') }}
          </UButton>
          <span v-else />
          <div class="flex gap-2.5">
            <UButton type="button" color="neutral" variant="ghost" size="sm" @click="editorOpen = false">
              {{ t('cancel') }}
            </UButton>
            <UButton type="submit" color="neutral" size="sm" :loading="isSaving">
              {{ t('saveChanges') }}
            </UButton>
          </div>
        </div>
      </form>
    </section>
  </div></Transition>

  <!-- Delete Confirmation Modal: same `modal` transition, because closing the form and opening this
       is one intent (see `deleteEditedProduct`) and the two surfaces must therefore move alike. -->
  <Transition name="modal"><div
    v-if="deleteTarget"
    class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
    @click.self="deleteTarget = null"
  >
    <section
      class="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800/80 p-6 sm:p-8"
      role="alertdialog"
      aria-modal="true"
    >
      <h2 class="text-xl font-black text-zinc-950 dark:text-white">
        {{ t('deleteConfirm', { name: deleteTarget.name }) }}
      </h2>
      <p class="mt-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        {{ t('deleteWarning') }}
      </p>
      <div class="mt-6 flex justify-end gap-3">
        <UButton color="neutral" variant="ghost" size="sm" @click="deleteTarget = null">
          {{ t('cancel') }}
        </UButton>
        <UButton color="error" size="sm" :loading="isSaving" @click="confirmDelete">
          {{ t('deleteProduct') }}
        </UButton>
      </div>
    </section>
  </div></Transition>
</template>
