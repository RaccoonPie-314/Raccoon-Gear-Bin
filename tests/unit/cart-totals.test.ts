import { describe, expect, test } from 'bun:test'
import type { CatalogProduct } from '../../app/types/catalog'
import { CART_MAX_QUANTITY, cartTotals, parseCartLines, serializeCartLines } from '../../app/utils/cart-totals'

// The same hand-written expectations the orders module's SQL self-check pins `effective_unit_price`
// to (specs/ecommerce/SPEC-overview.md → pricing parity): a fixture case is written once and both
// sides must answer it. This file is the display side's half.

const NOW = Date.parse('2026-10-04T00:00:00Z')
const LIVE_PROMO = {
  promoPrice: 80,
  promoQuantity: 5,
  promoStartsAt: '2000-01-01T00:00:00.000Z',
  promoEndsAt: null
}

const product = (overrides: Partial<CatalogProduct> & { id: string }): CatalogProduct => ({
  categoryId: 'cat-1',
  categoryName: 'Keyboards',
  slug: 'p',
  sku: 'SKU-1',
  price: 100,
  currency: 'USD',
  stockQuantity: 10,
  status: 'published',
  promoPrice: null,
  promoLabel: null,
  promoQuantity: null,
  promoStartsAt: null,
  promoEndsAt: null,
  name: 'P',
  shortDescription: '',
  description: '',
  specifications: '',
  images: [],
  ...overrides
})

describe('cartTotals', () => {
  test('plain lines total at the stored price', () => {
    const { lines, itemCount, subtotal } = cartTotals([{ productId: 'a', quantity: 2 }], [product({ id: 'a' })], NOW)
    expect(lines[0].lineTotal).toBe(200)
    expect(lines[0].issue).toBe('ok')
    expect(subtotal).toBe(200)
    expect(itemCount).toBe(2)
  })

  test('a live promotion charges the promo price and caps at its remaining units', () => {
    const p = product({ id: 'a', ...LIVE_PROMO })
    const exact = cartTotals([{ productId: 'a', quantity: 5 }], [p], NOW)
    expect(exact.lines[0].lineTotal).toBe(400)
    expect(exact.subtotal).toBe(400)

    const capped = cartTotals([{ productId: 'a', quantity: 6 }], [p], NOW)
    expect(capped.lines[0].quantity).toBe(5)
    expect(capped.lines[0].issue).toBe('over-promo-cap')
    expect(capped.subtotal).toBe(400)
  })

  test('a closed promotion window charges the original price', () => {
    const p = product({ id: 'a', ...LIVE_PROMO, promoEndsAt: '2000-01-02T00:00:00.000Z' })
    const { lines } = cartTotals([{ productId: 'a', quantity: 2 }], [p], NOW)
    expect(lines[0].pricing?.price).toBe(100)
    expect(lines[0].lineTotal).toBe(200)
  })

  test('stock caps a line and says so', () => {
    const { lines } = cartTotals([{ productId: 'a', quantity: 9 }], [product({ id: 'a', stockQuantity: 3 })], NOW)
    expect(lines[0].quantity).toBe(3)
    expect(lines[0].issue).toBe('over-stock')
  })

  test('an out-of-stock line clamps to zero and is not counted', () => {
    const { lines, itemCount, subtotal } = cartTotals([{ productId: 'a', quantity: 2 }], [product({ id: 'a', stockQuantity: 0 })], NOW)
    expect(lines[0].quantity).toBe(0)
    expect(lines[0].issue).toBe('over-stock')
    expect(itemCount).toBe(0)
    expect(subtotal).toBe(0)
  })

  test('a product missing from the fresh rows is unavailable, not guessed at', () => {
    const { lines, subtotal } = cartTotals([{ productId: 'gone', quantity: 2 }], [], NOW)
    expect(lines[0].product).toBeNull()
    expect(lines[0].pricing).toBeNull()
    expect(lines[0].issue).toBe('unavailable')
    expect(subtotal).toBe(0)
  })

  test('two-decimal prices do not leak binary float noise into the subtotal', () => {
    const { subtotal } = cartTotals([{ productId: 'a', quantity: 3 }], [product({ id: 'a', price: 123.45 })], NOW)
    expect(subtotal).toBe(370.35)
  })

  test('an empty cart answers zeros in the store currency', () => {
    expect(cartTotals([], [product({ id: 'a' })], NOW)).toEqual({ lines: [], itemCount: 0, subtotal: 0, currency: 'USD' })
  })
})

describe('cart storage codec', () => {
  test('round-trips ids and quantities only — the payload has no price field to lose', () => {
    const lines = [{ productId: 'a', quantity: 2 }, { productId: 'b', quantity: 1 }]
    expect(parseCartLines(serializeCartLines(lines))).toEqual(lines)
    expect(serializeCartLines(lines)).not.toContain('price')
  })

  test('a corrupt payload resets to empty instead of throwing', () => {
    expect(parseCartLines('{oops')).toEqual([])
    expect(parseCartLines(null)).toEqual([])
    expect(parseCartLines('{"version":2,"items":[]}')).toEqual([])
    expect(parseCartLines('{"version":1,"items":"nope"}')).toEqual([])
    expect(parseCartLines('[]')).toEqual([])
  })

  test('malformed entries drop, duplicates collapse, quantities clamp', () => {
    const raw = JSON.stringify({
      version: 1,
      items: [
        { productId: 'a', quantity: 2.7 },
        { productId: 'a', quantity: 3 },
        { productId: 42, quantity: 1 },
        { productId: 'b', quantity: -4 },
        { productId: 'c', quantity: CART_MAX_QUANTITY + 500 },
        null
      ]
    })
    expect(parseCartLines(raw)).toEqual([
      { productId: 'a', quantity: 2 },
      { productId: 'c', quantity: CART_MAX_QUANTITY }
    ])
  })
})
