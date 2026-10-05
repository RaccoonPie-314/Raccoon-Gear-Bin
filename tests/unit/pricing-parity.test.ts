import { describe, expect, test } from 'bun:test'
import type { CatalogProduct } from '../../app/types/catalog'
import { getProductPricing } from '../../app/utils/product-pricing'

// The four fixtures written in the orders migration's self-check (the `do $$` block in
// supabase/migrations/20261004050806_orders_and_checkout.sql) — same inputs, same expectations,
// one rule written down in two languages. The migration asserts the SQL half on every db reset;
// this asserts the display half. If the two ever disagree, one of these fails.

const AT = Date.parse('2026-10-04T00:00:00Z')

const product = (overrides: Partial<CatalogProduct>): CatalogProduct => ({
  id: 'pricing-fixture',
  categoryId: 'cat-1',
  categoryName: null,
  slug: 'fixture',
  sku: 'FIXTURE',
  price: 100,
  currency: 'USD',
  stockQuantity: 10,
  status: 'published',
  promoPrice: null,
  promoLabel: null,
  promoQuantity: null,
  promoStartsAt: null,
  promoEndsAt: null,
  name: 'Fixture',
  shortDescription: '',
  description: '',
  specifications: '',
  images: [],
  ...overrides
})

describe('the written pricing rule (mirrors the migration self-check fixtures)', () => {
  test('no promo → the stored price', () => {
    expect(getProductPricing(product({}), AT).price).toBe(100)
  })

  test('live promo → the promo price', () => {
    const live = product({ promoPrice: 80, promoQuantity: 5, promoStartsAt: '2000-01-01T00:00:00.000Z', promoEndsAt: null })
    expect(getProductPricing(live, AT).price).toBe(80)
  })

  test('closed window → the stored price', () => {
    const closed = product({ promoPrice: 80, promoQuantity: 5, promoStartsAt: null, promoEndsAt: '2000-01-02T00:00:00.000Z' })
    expect(getProductPricing(closed, AT).price).toBe(100)
  })

  test('exhausted cap → the stored price', () => {
    const spent = product({ promoPrice: 80, promoQuantity: 0, promoStartsAt: null, promoEndsAt: null })
    expect(getProductPricing(spent, AT).price).toBe(100)
  })
})
