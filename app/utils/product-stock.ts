/** The one number the low band is decided by, and the only place it is written. It lives beside the
 * rule that reads it because there is no second reader to share it with. */
export const LOW_STOCK_THRESHOLD = 5

/** The three bands a quantity falls into. Named here because this file is the only place the
 * boundary between them is decided. */
export type ProductStockState = 'in' | 'low' | 'out'

/**
 * The stock rule, in one place: zero is out, up to and including `LOW_STOCK_THRESHOLD` is low,
 * anything else is in. It used to be written twice — once to colour the badge and once to word
 * the contact CTA — which is exactly the shape of problem that lets a label and the thing it
 * describes disagree.
 *
 * A plain function, not a composable: it reads nothing reactive, owns no state and touches no
 * browser API, so wrapping it would only add a call site.
 */
export const getProductStockState = (quantity: number): ProductStockState => {
  if (quantity <= 0) return 'out'
  if (quantity <= LOW_STOCK_THRESHOLD) return 'low'
  return 'in'
}
