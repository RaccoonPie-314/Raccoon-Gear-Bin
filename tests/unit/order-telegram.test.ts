import { describe, expect, test } from 'bun:test'
import { orderTelegramText } from '../../server/utils/telegram'

// Mirrors the Supabase migration's self-check fixture (20261005120000_order_telegram_push.sql) —
// the SQL function retired with the project, and this test is what keeps the Worker's port honest:
// a drifted format fails here the way it used to fail the migration itself.
describe('the order push body (order_telegram_text fixture parity)', () => {
  test('reproduces the pinned fixture line for line', () => {
    expect(orderTelegramText({
      id: 'a1b2c3d4-0000-0000-0000-000000000000',
      currency: 'USD',
      total: '123.45',
      delivery_name: 'Test Buyer',
      delivery_phone: '012345678',
      delivery_address: 'Street 271',
      delivery_note: null,
      items: [{ quantity: 2, name: 'Widget', sku: 'W-1' }, { quantity: 1, name: 'Gadget', sku: 'G-2' }]
    })).toBe('New order #A1B2C3D4 — USD 123.45\nTest Buyer · 012345678\nStreet 271\n2× Widget [W-1]\n1× Gadget [G-2]')
  })

  test('the note rides its own line and an empty item list says so', () => {
    const text = orderTelegramText({
      id: 'a1b2c3d4-0000-0000-0000-000000000000',
      currency: 'USD',
      total: 42,
      delivery_name: 'T',
      delivery_phone: null,
      delivery_address: 'A',
      delivery_note: 'Leave at the gate',
      items: []
    })
    expect(text).toContain('Note: Leave at the gate\n(no items)')
  })

  test('fallbacks and thousands separators match to_char(FM999,999,990.00)', () => {
    expect(orderTelegramText({
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      currency: 'USD',
      total: 1234.5,
      delivery_name: null,
      delivery_phone: null,
      delivery_address: null,
      delivery_note: null,
      items: []
    })).toBe('New order #AAAAAAAA — USD 1,234.50\n(no name) · -\n(no address)\n(no items)')
  })
})
