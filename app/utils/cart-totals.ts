import type { CatalogProduct } from '~/types/catalog'
import { getProductPricing, type ProductPricing } from './product-pricing'

/**
 * The cart's whole arithmetic, in one pure place (specs/ecommerce/SPEC-cart.md).
 *
 * The cart stores *intents* — a product id and a quantity — never prices: what a line costs is a
 * question asked of the fresh rows, and the answer comes from `getProductPricing`, the same rule
 * the cards and the detail page display. The order RPC recomputes the same rule server-side under
 * row locks; this file is the display half of that pair, and the storage codec lives here too so
 * `bun test` can exercise both without a Nuxt context.
 */

/** Per-line quantity ceiling — a typo guard, not a business rule (stock caps a line long before this). */
export const CART_MAX_QUANTITY = 999

/** What the cart persists per line: intent only. */
export type CartLine = { productId: string, quantity: number }

/** Why a line is not simply quantity × price. Mirrors the order RPC's rejection taxonomy. */
export type CartLineIssue = 'ok' | 'unavailable' | 'over-stock' | 'over-promo-cap'

export type CartLineView = {
  line: CartLine
  /** `null` when no published row matches the id any more (deleted, archived or unpublished). */
  product: CatalogProduct | null
  /** The stored quantity clamped to the live cap — what the steppers and the badge must show. */
  quantity: number
  pricing: ProductPricing | null
  lineTotal: number
  issue: CartLineIssue
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : null

const round2 = (value: number) => Math.round(value * 100) / 100

// ---- the storage codec --------------------------------------------------------------------------
// Versioned, defensive, ids-only: a corrupt payload resets to empty rather than throwing, and the
// shape has no field a price could smuggle into.

export const serializeCartLines = (lines: CartLine[]): string =>
  JSON.stringify({ version: 1, items: lines.map(({ productId, quantity }) => ({ productId, quantity })) })

export const parseCartLines = (raw: string | null): CartLine[] => {
  if (!raw) return []
  try {
    const parsed = asRecord(JSON.parse(raw))
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return []
    const seen = new Set<string>()
    const lines: CartLine[] = []
    for (const item of parsed.items) {
      const record = asRecord(item)
      const productId = record?.productId
      const quantity = Math.floor(Number(record?.quantity))
      if (typeof productId !== 'string' || !productId || seen.has(productId)) continue
      if (!Number.isFinite(quantity) || quantity < 1) continue
      seen.add(productId)
      lines.push({ productId, quantity: Math.min(quantity, CART_MAX_QUANTITY) })
    }
    return lines
  } catch {
    return []
  }
}

// ---- the totals ---------------------------------------------------------------------------------

/** One line's live state: unavailable, capped (and by which cap), or fine. */
const lineView = (line: CartLine, product: CatalogProduct | null, now: number): CartLineView => {
  if (!product) {
    return { line, product: null, quantity: line.quantity, pricing: null, lineTotal: 0, issue: 'unavailable' }
  }

  const pricing = getProductPricing(product, now)
  const promoCap = pricing.remainingUnits // non-null exactly while a promotion is live *and* unit-capped
  const binding = promoCap === null ? product.stockQuantity : Math.min(product.stockQuantity, promoCap)
  const quantity = Math.max(0, Math.min(line.quantity, binding))
  const issue: CartLineIssue = line.quantity > product.stockQuantity
    ? 'over-stock'
    : promoCap !== null && line.quantity > promoCap
      ? 'over-promo-cap'
      : 'ok'

  return { line, product, quantity, pricing, lineTotal: round2(pricing.price * quantity), issue }
}

/**
 * Lines × the fresh product rows → what the cart page renders. A line is either `unavailable` or
 * carries a decided price; there is no third state for a view to guess about.
 */
export const cartTotals = (lines: CartLine[], products: CatalogProduct[], now: number = Date.now()) => {
  const byId = new Map(products.map(product => [product.id, product]))
  const views = lines.map(line => lineView(line, byId.get(line.productId) ?? null, now))
  const itemCount = views.reduce((sum, view) => sum + (view.product ? view.quantity : 0), 0)
  const subtotal = round2(views.reduce((sum, view) => sum + view.lineTotal, 0))
  const currency = views.find(view => view.product)?.product?.currency ?? 'USD'
  return { lines: views, itemCount, subtotal, currency }
}
