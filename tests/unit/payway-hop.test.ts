import { describe, expect, test } from 'bun:test'
import { paywayHopQuery } from '../../app/utils/payway-hop'

// The Back-from-PayWay marker's parse. It has already cost two buyer-visible defects — a hijacked
// checkout visit and a "Order not found" over a paid order — so its shape rules are pinned here
// rather than left to whichever guard branch happens to run.

describe('the payway-hop marker', () => {
  const order = '2c5230c9-3b2f-4b7f-b0c0-1ddfd2ce72ff'

  test('order:tran is the armed shape, both halves kept', () => {
    expect(paywayHopQuery(`${order}:RGBmuz237x8uwq`)).toEqual({ order, tran: 'RGBmuz237x8uwq' })
  })

  test('the legacy order-only value still answers — a tab mid-flight is a real buyer', () => {
    expect(paywayHopQuery(order)).toEqual({ order })
  })

  test('a malformed order drops the whole marker, not just the bad half', () => {
    expect(paywayHopQuery('not-a-uuid')).toBeNull()
    expect(paywayHopQuery('not-a-uuid:RGBmuz237x8uwq')).toBeNull()
    expect(paywayHopQuery(`${order}extra:RGBmuz237x8uwq`)).toBeNull()
  })

  test('a malformed tran drops the tran, keeping the order — never the reverse', () => {
    expect(paywayHopQuery(`${order}:short`)).toEqual({ order })
    expect(paywayHopQuery(`${order}:`)).toEqual({ order })
    expect(paywayHopQuery(`${order}:has spaces`)).toEqual({ order })
  })

  test('absent or empty values answer nothing', () => {
    expect(paywayHopQuery(null)).toBeNull()
    expect(paywayHopQuery(undefined)).toBeNull()
    expect(paywayHopQuery('')).toBeNull()
  })
})
