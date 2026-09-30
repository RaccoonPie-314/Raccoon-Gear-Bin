import type { CatalogProduct } from '~/types/catalog'

/** What a price display needs: what to charge, what to cross out, and how to name the reason. */
export type ProductPricing = {
  /** What the visitor pays: the promo price while a promotion runs, the stored price otherwise. */
  price: number
  /** The price the promotion replaced, or `null` when nothing is discounted — what renders struck. */
  originalPrice: number | null
  /** The campaign's own name, or `null` to fall back to the generic wording. */
  label: string | null
  /** Units left at the promo price, or `null` when the promotion is not quantity-limited. */
  remainingUnits: number | null
}

/** A product with no promotion, in the shape the views already render. */
const fullPrice = (product: CatalogProduct): ProductPricing => ({
  price: product.price,
  originalPrice: null,
  label: null,
  remainingUnits: null
})

/**
 * The promotion rule, in one place — the same shape of problem the stock band already solved: a
 * price shown in four places (card, detail, header search, the prepared contact message) and sorted
 * by in a fifth, every one of which must answer with the same number.
 *
 * A promotion is live when it has a price below the stored one, its window has opened and not
 * passed, and its unit cap has not run out. Anything else — including a timestamp that will not
 * parse — falls back to the full price, because a discount nobody asked for is worse than no
 * discount at all.
 *
 * A plain function, not a composable: it reads nothing reactive and touches no browser API.
 * `now` is a parameter rather than a private `Date.now()` so the rule can be asked about a moment
 * it was not called in; callers leave it out and resolve the window against the current time, which
 * means a promotion that expires while the page sits open is corrected by the next navigation, not
 * by a timer.
 */
export const getProductPricing = (product: CatalogProduct, now: number = Date.now()): ProductPricing => {
  const promo = product.promoPrice
  if (promo === null || promo >= product.price) return fullPrice(product)
  if (product.promoQuantity !== null && product.promoQuantity <= 0) return fullPrice(product)
  if (product.promoStartsAt !== null && !(Date.parse(product.promoStartsAt) <= now)) return fullPrice(product)
  if (product.promoEndsAt !== null && !(Date.parse(product.promoEndsAt) > now)) return fullPrice(product)
  return { price: promo, originalPrice: product.price, label: product.promoLabel, remainingUnits: product.promoQuantity }
}
