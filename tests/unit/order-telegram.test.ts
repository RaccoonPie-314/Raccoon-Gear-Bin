import { describe, expect, test } from 'bun:test'
import { orderTelegramText } from '../../server/utils/telegram'

// The Worker's order-push format. Each shape is pinned line for line, the way the retired SQL
// migration's self-check did: a drifted format (or a dropped label) fails here, not in the seller's
// Telegram at 6am.
describe('the order push body', () => {
  test('labels every field and puts the location link on its own line', () => {
    expect(orderTelegramText({
      id: 'a1b2c3d4-0000-0000-0000-000000000000',
      currency: 'USD',
      total: '123.45',
      payment_status: 'unpaid',
      delivery_name: 'Test Buyer',
      delivery_phone: '012345678',
      delivery_address: 'Street 271',
      delivery_location: 'https://maps.google.com/?q=11.55,104.92',
      delivery_note: null,
      items: [{ quantity: 2, name: 'Widget', sku: 'W-1' }, { quantity: 1, name: 'Gadget', sku: 'G-2' }]
    })).toBe(
      'New order #A1B2C3D4 — USD 123.45\n'
      + 'Buyer:  Test Buyer · 012345678\n'
      + 'Address: Street 271\n'
      + 'Location: https://maps.google.com/?q=11.55,104.92\n'
      + 'Payment: Unpaid\n'
      + 'Items (2):\n'
      + '  2× Widget [W-1]\n'
      + '  1× Gadget [G-2]'
    )
  })

  test('the note rides its own line, above the item count', () => {
    const text = orderTelegramText({
      id: 'a1b2c3d4-0000-0000-0000-000000000000',
      currency: 'USD',
      total: 42,
      payment_status: 'paid',
      delivery_name: 'T',
      delivery_phone: null,
      delivery_address: 'A',
      delivery_location: 'https://maps.google.com/?q=1,2',
      delivery_note: 'Leave at the gate',
      items: []
    })
    expect(text).toContain('Payment: Paid\nNote: Leave at the gate\nItems (0):\n  (no items)')
  })

  test('a pay-now order announces "Paying online", never Unpaid', () => {
    expect(orderTelegramText({
      id: 'b1b2c3d4-0000-0000-0000-000000000000',
      currency: 'USD',
      total: 9.99,
      payment_status: 'unpaid',
      paying: true,
      delivery_name: 'T',
      delivery_phone: null,
      delivery_address: 'A',
      delivery_location: 'L',
      delivery_note: null,
      items: []
    })).toContain('Payment: Paying online\n')
  })

  test('nulls fall back and the total keeps to_char-style thousands separators', () => {
    expect(orderTelegramText({
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      currency: 'USD',
      total: 1234.5,
      payment_status: 'refunded',
      delivery_name: null,
      delivery_phone: null,
      delivery_address: null,
      delivery_location: null,
      delivery_note: null,
      items: []
    })).toBe(
      'New order #AAAAAAAA — USD 1,234.50\n'
      + 'Buyer:  (no name) · -\n'
      + 'Address: (no address)\n'
      + 'Location: -\n'
      + 'Payment: Refunded\n'
      + 'Items (0):\n'
      + '  (no items)'
    )
  })
})
