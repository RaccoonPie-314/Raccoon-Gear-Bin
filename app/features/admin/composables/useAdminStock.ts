/**
 * The stock desk: the list read — every non-archived product, drafts included, with its sold
 * count — the per-row drafts the owner is typing, and the one batch save behind them. The read is
 * one route and the save is one transaction of absolute numbers; authorisation is the claims-path
 * policy behind `/api/admin/stock` and `canMutate` only keeps the button honest before the server
 * has to say no, the same split as the other admin composables.
 */

/** The route's row shape (`server/api/admin/stock.get.ts` owns the SQL; the two must move together). */
export interface StockProductRow {
  id: string
  sku: string
  name: string
  status: string
  stock_quantity: number
  sold: number
}

/** The desk's own shape: snake_case stays on the wire. */
export interface StockDeskRow {
  id: string
  sku: string
  name: string
  status: string
  stockQuantity: number
  sold: number
}

const mapStockRow = (row: StockProductRow): StockDeskRow => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  status: row.status,
  stockQuantity: Number(row.stock_quantity),
  sold: Number(row.sold)
})

export const useAdminStock = (options: { canMutate?: () => boolean } = {}) => {
  const canMutate = options.canMutate ?? (() => false)
  const { t } = useI18n()

  const rows = ref<StockDeskRow[]>([])
  const isLoading = ref(true)
  const loadError = ref(false)
  const actionError = ref('')
  const saved = ref(false)
  const isSaving = ref(false)
  // What the owner has typed, keyed by product id — only touched rows appear. The reload clears it,
  // which is what makes "changed" a difference between a draft and its row rather than a dirty flag
  // a write has to remember to reset.
  const drafts = ref<Record<string, string>>({})

  // The desk's text search: client-side like the order desk's, over the rows already in memory —
  // a stock count is done against a name or the SKU printed on the box, so both match.
  const search = ref('')

  const loadStock = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      rows.value = (await $fetch<StockProductRow[]>('/api/admin/stock')).map(mapStockRow)
      drafts.value = {}
    } catch {
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  const valueFor = (row: StockDeskRow) => drafts.value[row.id] ?? String(row.stockQuantity)

  // The band follows what is on screen, not the saved value — but a half-typed number that no
  // longer parses (or an emptied field) falls back to the row's own quantity rather than pretending
  // the product is out of stock mid-keystroke.
  const bandValue = (row: StockDeskRow) => {
    const draft = drafts.value[row.id]
    if (draft === undefined || draft === '') return row.stockQuantity
    const parsed = Number(draft)
    return Number.isFinite(parsed) ? parsed : row.stockQuantity
  }

  const onInput = (row: StockDeskRow, value: unknown) => {
    drafts.value[row.id] = String(value ?? '')
    saved.value = false
    actionError.value = ''
  }

  // What the list paints: the query narrows name and SKU, case-insensitively, and an empty query is
  // the whole list. It filters what is *shown* only — `changed` still reads every row, so a row the
  // search is hiding is still saved.
  const visibleRows = computed(() => {
    const query = search.value.trim().toLowerCase()
    if (!query) return rows.value
    return rows.value.filter(row =>
      row.name.toLowerCase().includes(query) || row.sku.toLowerCase().includes(query))
  })

  // Only rows whose draft actually differs from the stored number — a typed-then-reverted value is
  // not a change, and the batch never carries a row the owner did not mean to touch.
  const changed = computed(() => rows.value.flatMap((row) => {
    const draft = drafts.value[row.id]
    if (draft === undefined || draft === String(row.stockQuantity)) return []
    return [{ row, draft }]
  }))

  // Digits only: an emptied field, a minus sign, a decimal point or exponent notation must fail
  // here — saving a different number than the one on screen is the one outcome this desk must never
  // produce, and a `NaN` would ride into the column the way `products.post.ts` documents.
  const hasInvalid = computed(() => changed.value.some(({ draft }) =>
    !/^\d{1,10}$/.test(draft) || Number(draft) > 2147483647))

  const saveStock = async () => {
    if (!canMutate() || isSaving.value || !changed.value.length) return
    if (hasInvalid.value) {
      actionError.value = t('stockInvalid')
      return
    }
    isSaving.value = true
    actionError.value = ''
    saved.value = false
    try {
      await $fetch('/api/admin/stock', {
        method: 'POST',
        body: { items: changed.value.map(({ row, draft }) => ({ id: row.id, stock_quantity: Number(draft) })) }
      })
      await loadStock()
      saved.value = true
    } catch {
      actionError.value = t('stockSaveError')
    } finally {
      isSaving.value = false
    }
  }

  return { rows, visibleRows, search, isLoading, loadError, actionError, saved, isSaving, hasChanges: computed(() => changed.value.length > 0), loadStock, valueFor, bandValue, onInput, saveStock }
}
