import { describe, expect, test } from 'bun:test'
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES, ORDER_TRANSITIONS, orderTransitions, PAYMENT_STATUS_KEYS } from '../../app/utils/order-status'

// The SQL half of this table lives in `set_order_status`
// (supabase/migrations/20261004050806_orders_and_checkout.sql) and refuses any transition this
// object does not list — the same table written twice, pinned once here.

describe('the order status machine', () => {
  test('matches the written table case for case', () => {
    expect(ORDER_TRANSITIONS).toEqual({
      pending: ['confirmed', 'cancelled'],
      confirmed: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: []
    })
  })

  test('terminal states stay terminal', () => {
    expect(orderTransitions('delivered')).toEqual([])
    expect(orderTransitions('cancelled')).toEqual([])
  })

  test('every state is a key, so a new status cannot be added half-way', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual(['cancelled', 'confirmed', 'delivered', 'pending'])
  })

  test('every state has exactly one label key and one tone', () => {
    const states = ['cancelled', 'confirmed', 'delivered', 'pending']
    expect(Object.keys(ORDER_STATUS_KEYS).sort()).toEqual(states)
    expect(Object.keys(ORDER_STATUS_TONES).sort()).toEqual(states)
    expect(new Set(Object.values(ORDER_STATUS_KEYS)).size).toBe(states.length)
  })

  test('every payment status has a label key', () => {
    expect(Object.keys(PAYMENT_STATUS_KEYS).sort()).toEqual(['paid', 'refunded', 'unpaid'])
  })
})
