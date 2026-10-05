import { describe, expect, test } from 'bun:test'
import type { OrderStamps } from '../../app/utils/order-notices'
import { bumpOrdersSeen, latestOrderStamp, readOrdersSeen, unseenOrderCount } from '../../app/utils/order-notices'

const order = (over: Partial<OrderStamps> = {}): OrderStamps => ({
  id: 'o1',
  createdAt: '2026-10-04T02:00:00.000Z',
  confirmedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  ...over
})

// Contained to one test on purpose: `bun test` shares the process across files, and a globally
// leaked localStorage would change what the cart codec's own tests observe.
const withFakeStorage = <T>(run: (store: Map<string, string>) => T): T => {
  const store = new Map<string, string>()
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) }
  }
  try {
    return run(store)
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage
  }
}

describe('latestOrderStamp', () => {
  test('is the newest of the four lifecycle stamps', () => {
    expect(latestOrderStamp(order())).toBe('2026-10-04T02:00:00.000Z')
    expect(latestOrderStamp(order({ confirmedAt: '2026-10-04T05:00:00.000Z' }))).toBe('2026-10-04T05:00:00.000Z')
    expect(latestOrderStamp(order({ confirmedAt: '2026-10-04T05:00:00.000Z', deliveredAt: '2026-10-04T09:00:00.000Z' }))).toBe('2026-10-04T09:00:00.000Z')
  })
})

describe('unseenOrderCount', () => {
  const rows = [order(), order({ id: 'o2', confirmedAt: '2026-10-04T05:00:00.000Z' })]

  test('an empty marker counts every order', () => {
    expect(unseenOrderCount(rows, '')).toBe(2)
  })

  test('a marker at the newest stamp counts none', () => {
    expect(unseenOrderCount(rows, '2026-10-04T05:00:00.000Z')).toBe(0)
  })

  test('a marker between stamps counts only the newer order', () => {
    expect(unseenOrderCount(rows, '2026-10-04T03:00:00.000Z')).toBe(1)
  })
})

describe('the seen marker', () => {
  test('round-trips, is per-account, and only ever rises', () => {
    withFakeStorage(() => {
      expect(readOrdersSeen('u1')).toBe('')
      bumpOrdersSeen('u1', [order({ confirmedAt: '2026-10-04T05:00:00.000Z' })])
      expect(readOrdersSeen('u1')).toBe('2026-10-04T05:00:00.000Z')
      // A detail visit to an older order must not un-see the newer update.
      bumpOrdersSeen('u1', [order()])
      expect(readOrdersSeen('u1')).toBe('2026-10-04T05:00:00.000Z')
      // A newer stamp moves it forward.
      bumpOrdersSeen('u1', [order({ deliveredAt: '2026-10-05T00:00:00.000Z' })])
      expect(readOrdersSeen('u1')).toBe('2026-10-05T00:00:00.000Z')
      // Another account has its own marker.
      expect(readOrdersSeen('u2')).toBe('')
    })
  })

  test('an empty list leaves the marker untouched', () => {
    withFakeStorage(() => {
      bumpOrdersSeen('u1', [])
      expect(readOrdersSeen('u1')).toBe('')
    })
  })
})
