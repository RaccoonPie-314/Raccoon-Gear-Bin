import type { Database } from '~/types/database'
import type { CatalogCategoryDraft } from '~/types/catalog'

/**
 * The editor's copy of one category row.
 *
 * There is deliberately no `sortOrder` field: as with the site-info social links, **position in this
 * list is the order**, and `saveCategories` rewrites the stored `sort_order` from it. A number box
 * beside a list you can already reorder is two authorities over one fact, and they disagree the first
 * time a row moves.
 */
export type AdminCategoryRow = {
  id?: string
  slug: string
  nameEn: string
  nameKm: string
  isActive: boolean
  /** The names as they were loaded, so "the owner deleted this one" is distinguishable from "this
   * locale never had a name" — the first needs its row deleted, the second needs nothing. */
  namesBefore: Record<string, string>
}

/** The two locales the storefront renders. A blank Khmer name writes no row, so the public view's
 * English fallback is what a Khmer visitor gets — absent, never invented. */
const LOCALES = ['en', 'km'] as const

/**
 * The slug is load-bearing twice: it is what a category keeps its icon matched on, and it is the
 * stable identity a shop shares with itself ("monitors"), so an empty Slug field takes the English
 * name rather than storing nothing. Khmer-only names slugify to nothing, which is when the field
 * stops being optional and says so.
 */
const slugify = (value: string) => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** The slug a row will be written with. One function, because the pre-flight validation and the
 * write itself must not be able to disagree about what the admin meant. */
const slugOf = (row: AdminCategoryRow) => row.slug.trim() || slugify(row.nameEn.trim())

/** The name one locale holds after the admin is done with it. */
const nameOf = (row: AdminCategoryRow, locale: string) => (locale === 'en' ? row.nameEn : row.nameKm).trim()

const toRow = (draft: CatalogCategoryDraft): AdminCategoryRow => ({
  id: draft.id,
  slug: draft.slug,
  nameEn: draft.names.en || '',
  nameKm: draft.names.km || '',
  isActive: draft.isActive,
  namesBefore: { ...draft.names }
})

/** `products.category_id … on delete restrict`: Postgres is what decides whether a category may be
 * forgotten, and its answer is the one the shop needs to hear in its own words. */
const isStillInUse = (error: any) => error?.code === '23503' || error?.statusCode === 409

/**
 * The admin category editor: the row list the Categories page binds to, the two-table save
 * (`categories` then `category_translations`, one pair per locale) and the delete that only succeeds
 * while nothing is filed under the category.
 *
 * It follows the shape of the two editors already here on purpose — `canMutate` is a UI guard and
 * authorisation stays in row-level security, the reads come from `useCatalog` (the only owner of the
 * `categories` table, in its admin view `fetchCategoryDrafts`) and no state crosses between this and
 * the product or site-info editors. Nothing new is stored: `categories` and `category_translations`
 * already exist, so adding a category is a write, not a migration.
 */
export const useAdminCategoryEditor = (options: { canMutate: () => boolean }) => {
  const { canMutate } = options
  const supabase = useSupabaseClient<Database>()
  const { fetchCategoryDrafts } = useCatalog()
  const { t } = useI18n()

  const categoryRows = ref<AdminCategoryRow[]>([])
  const isLoading = ref(true)
  const isSaving = ref(false)
  const actionError = ref('')
  const savedNotice = ref('')

  const loadCategories = async () => {
    isLoading.value = true
    actionError.value = ''
    try {
      categoryRows.value = (await fetchCategoryDrafts()).map(toRow)
    } catch (error: any) {
      actionError.value = error?.message || t('categoryLoadError')
    } finally {
      isLoading.value = false
    }
  }

  // A new row starts visible: the owner hiding it is an edit they can see, and a row that appears
  // switched off would look like the save had failed.
  const addCategoryRow = () => { categoryRows.value.push({ slug: '', nameEn: '', nameKm: '', isActive: true, namesBefore: {} }) }

  const moveCategoryRow = (index: number, delta: number) => {
    const target = index + delta
    const moved = categoryRows.value[index]
    const other = categoryRows.value[target]
    if (!moved || !other) return
    categoryRows.value[index] = other
    categoryRows.value[target] = moved
  }

  /**
   * Drop a row: an unsaved one is only a form entry, so nothing is written; a saved one is a DELETE
   * and the database's reject is the guard rail, reported as "products are still filed here" rather
   * than as a Postgres sentence.
   */
  const removeCategoryRow = async (index: number) => {
    if (!canMutate()) return
    const row = categoryRows.value[index]
    if (!row) return
    if (!row.id) {
      categoryRows.value.splice(index, 1)
      return
    }
    isSaving.value = true
    actionError.value = ''
    savedNotice.value = ''
    try {
      const { error } = await supabase.from('categories').delete().eq('id', row.id)
      if (error) throw error
      categoryRows.value.splice(index, 1)
      savedNotice.value = t('categoryDeleted')
    } catch (error: any) {
      actionError.value = isStillInUse(error) ? t('categoryHasProducts') : (error?.message || t('categoryDeleteError'))
    } finally {
      isSaving.value = false
    }
  }

  const saveCategories = async () => {
    if (!canMutate()) return
    isSaving.value = true
    actionError.value = ''
    savedNotice.value = ''
    try {
      // One pre-flight pass over the whole list. The loop below is not a transaction, so a collision
      // discovered on row five would otherwise leave rows one to four already saved and the shop
      // looking at a dock order nobody asked for.
      const slugs = new Set<string>()
      for (const row of categoryRows.value) {
        const slug = slugOf(row)
        if (!slug) throw new Error(t('categoryNeedsSlug'))
        if (slugs.has(slug)) throw new Error(t('categorySlugTaken'))
        slugs.add(slug)
      }
      for (const [index, row] of categoryRows.value.entries()) {
        const slug = slugOf(row)
        // `sort_order` is the row's position, one-based, so the dock and this list cannot disagree.
        const values = { slug, sort_order: index + 1, is_active: row.isActive }
        const storedId = row.id
        let id = storedId
        if (id) {
          const { error } = await supabase.from('categories').update(values).eq('id', id)
          if (error) throw error
        } else {
          const { data, error } = await supabase.from('categories').insert(values).select('id').single()
          if (error) throw error
          id = data.id
          row.id = id
        }
        const translations = LOCALES.map((locale) => ({ locale, name: nameOf(row, locale) }))
          .filter((entry) => entry.name)
          .map((entry) => ({ category_id: id, locale: entry.locale, name: entry.name }))
        if (translations.length) {
          const { error } = await supabase.from('category_translations').upsert(translations, { onConflict: 'category_id,locale' })
          if (error) throw error
        }
        // An upsert only writes what is there, so a name the owner *deleted* has to be removed on
        // purpose: a stale Khmer row is a name still showing in the dock after it was erased here.
        if (storedId) {
          for (const locale of LOCALES) {
            if (!(row.namesBefore[locale] || '').trim() || nameOf(row, locale)) continue
            const { error } = await supabase.from('category_translations').delete().eq('category_id', storedId).eq('locale', locale)
            if (error) throw error
          }
        }
      }
      savedNotice.value = t('categorySaved')
      await loadCategories()
    } catch (error: any) {
      actionError.value = error?.message || t('categorySaveError')
    } finally {
      isSaving.value = false
    }
  }

  return {
    categoryRows,
    isLoading,
    isSaving,
    actionError,
    savedNotice,
    loadCategories,
    saveCategories,
    addCategoryRow,
    moveCategoryRow,
    removeCategoryRow
  }
}
