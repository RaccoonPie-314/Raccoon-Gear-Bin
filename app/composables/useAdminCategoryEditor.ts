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
  /** Client-only identity, for the same reason the site-info social rows carry one: a row list can
   * only animate a reorder when its rows are keyed on identity rather than on slot, and an unsaved
   * row has no `id` to key on. It is never written — `saveCategories` builds its `values` and its
   * translation rows field by field. */
  uid: string
  id?: string
  slug: string
  nameEn: string
  nameKm: string
  isActive: boolean
  /** The names as they were loaded, so "the owner deleted this one" is distinguishable from "this
   * locale never had a name" — the first needs its row deleted, the second needs nothing. */
  namesBefore: Record<string, string>
}

// A monotonic local id, not a crypto uuid: the only thing it has to guarantee is that two rows in this
// one page session are never the same row.
let categoryUidSeq = 0
const nextCategoryUid = () => `category-${++categoryUidSeq}`

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
  uid: nextCategoryUid(),
  id: draft.id,
  slug: draft.slug,
  nameEn: draft.names.en || '',
  nameKm: draft.names.km || '',
  isActive: draft.isActive,
  namesBefore: { ...draft.names }
})

/** `products.category_id … on delete restrict`: Postgres is what decides whether a category may be
 * forgotten, and its answer is the one the shop needs to hear in its own words. The route carries
 * the refusal as a 409, which ofetch surfaces as `error.statusCode`. */
const isStillInUse = (error: any) => error?.statusCode === 409

/**
 * The admin category editor: the row list the Categories page binds to, the one-save POST that
 * rewrites the whole list (`/api/admin/categories`, one transaction server-side) and the delete
 * that only succeeds while nothing is filed under the category.
 *
 * It follows the shape of the two editors already here on purpose — `canMutate` is a UI guard and
 * authorization is the claims-path admin policy behind the route, the reads come from `useCatalog`
 * (the only owner of the `categories` table, in its admin view `fetchCategoryDrafts`) and no state
 * crosses between this and the product or site-info editors. Nothing new is stored: `categories`
 * and `category_translations` already exist, so adding a category is a write, not a migration.
 */
export const useAdminCategoryEditor = (options: { canMutate: () => boolean }) => {
  const { canMutate } = options
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
  const addCategoryRow = () => { categoryRows.value.push({ uid: nextCategoryUid(), slug: '', nameEn: '', nameKm: '', isActive: true, namesBefore: {} }) }

  const moveCategoryRow = (index: number, delta: number) => {
    const target = index + delta
    const moved = categoryRows.value[index]
    const other = categoryRows.value[target]
    if (!moved || !other) return
    categoryRows.value[index] = other
    categoryRows.value[target] = moved
  }

  // The drag's reorder — the same shape `reorderSocialLink` has, including the uid: the row is moved
  // rather than swapped, so dropping a row three slots down shifts the three past it instead of
  // exchanging two of them. Keyed on the uid because the list re-indexes the moment it moves.
  const reorderCategoryRow = (uid: string, toIndex: number) => {
    const rows = categoryRows.value
    const from = rows.findIndex((row) => row.uid === uid)
    const moved = from < 0 ? undefined : rows[from]
    if (!moved || from === toIndex) return
    rows.splice(from, 1)
    rows.splice(toIndex, 0, moved)
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
      await $fetch(`/api/admin/categories/${row.id}`, { method: 'DELETE' })
      categoryRows.value.splice(index, 1)
      savedNotice.value = t('categoryDeleted')
    } catch (error: any) {
      actionError.value = isStillInUse(error) ? t('categoryHasProducts') : (error?.data?.message || error?.message || t('categoryDeleteError'))
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
      // Display order is the payload's order; the route writes `sort_order` from it. A new row gets
      // its uuid here so the server can run every statement independently, in one transaction.
      const rows = categoryRows.value.map((row) => ({
        id: row.id ?? crypto.randomUUID(),
        slug: slugOf(row),
        isActive: row.isActive,
        names: { en: nameOf(row, 'en'), km: nameOf(row, 'km') },
        namesBefore: row.namesBefore
      }))
      await $fetch('/api/admin/categories', { method: 'POST', body: { rows } })
      savedNotice.value = t('categorySaved')
      await loadCategories()
    } catch (error: any) {
      actionError.value = error?.data?.message || error?.message || t('categorySaveError')
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
    reorderCategoryRow,
    removeCategoryRow
  }
}
