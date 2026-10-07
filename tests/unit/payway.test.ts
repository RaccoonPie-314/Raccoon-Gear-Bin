import { describe, expect, spyOn, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  PAYWAY_CODES,
  PAYWAY_PAYMENT_CODE,
  applyPaywayResult,
  buildPurchaseRequest,
  newTranId,
  parseCallback,
  signPurchaseFields,
  utcTimestamp,
  verifyCallback
} from '../../server/utils/payway'

// The vector is computed independently (node:crypto over the docs' fixed concat order), then
// pinned here — the test fails if the order, the encoding, or the algorithm drifts. Fields use
// the docs' own sample shapes (mid `ec000002` style shortened to ours, our return URL).
const FIXED_FIELDS: Record<string, string> = {
  req_time: '20261004130000',
  merchant_id: 'rgb000001',
  tran_id: 'RGBTEST00001',
  amount: '123.45',
  items: 'W3sibmFtZSI6IlZlcmlmeSBLZXlib2FyZCIsInF1YW50aXR5IjoxLCJwcmljZSI6MTIzLjQ1fV0=',
  type: 'purchase',
  return_url: 'https://shop.example.test/api/payments/payway/return',
  currency: 'USD',
  return_params: '{"order_id":"99999999-1111-4000-8000-000000000001"}',
  skip_success_page: '1'
}
const FIXED_KEY = 'test-api-key'
const FIXED_HASH = 'MJ16TYKemO+RGPQdcdaYUMFyZ5USf4Gt84jul9Xj9S2ylZC1LafwSk+0+3riMefxYYeOx5R8MRVqgUgyxRvWpA=='

/** The callback scheme, hand-built from the docs' password: sorted keys, values concatenated. */
const signSortedValues = (body: Record<string, unknown>, key: string) =>
  createHmac('sha512', key).update(Object.keys(body).sort().map((name) => {
    const value = body[name]
    if (value === null || value === undefined) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  }).join('')).digest('base64')

describe('the purchase hash', () => {
  test('reproduces the independently computed vector', async () => {
    expect(await signPurchaseFields(FIXED_FIELDS, FIXED_KEY)).toBe(FIXED_HASH)
  })

  test('is positional — the input object order does not matter', async () => {
    const reversed: Record<string, string> = {}
    for (const key of Object.keys(FIXED_FIELDS).reverse()) reversed[key] = FIXED_FIELDS[key] as string
    expect(await signPurchaseFields(reversed, FIXED_KEY)).toBe(FIXED_HASH)
  })

  test('agrees with node:crypto on the same concatenation (cross-runtime)', async () => {
    const concat = (await import('../../server/utils/payway')).paywayConcat(FIXED_FIELDS)
    const node = createHmac('sha512', FIXED_KEY).update(concat).digest('base64')
    expect(node).toBe(FIXED_HASH)
  })

  test('utcTimestamp formats the documented YYYYMMDDHHmmss UTC', () => {
    expect(utcTimestamp(new Date('2026-10-04T13:00:00Z'))).toBe('20261004130000')
  })
})

describe('the tran id', () => {
  test('fits the 20-char cap with the documented charset', () => {
    for (let i = 0; i < 20; i++) {
      const id = newTranId()
      expect(id.length).toBeLessThanOrEqual(20)
      expect(/^RGB[0-9a-z]+$/.test(id)).toBe(true)
    }
  })
})

describe('the signed purchase request', () => {
  test('composes the action, the fields, and a hash that verifies against them', async () => {
    const request = await buildPurchaseRequest({
      merchantId: 'rgb000001',
      apiKey: FIXED_KEY,
      orderId: '99999999-1111-4000-8000-000000000001',
      amount: 123.45,
      currency: 'USD',
      itemLines: [{ name: 'Verify Keyboard', quantity: 1, price: 123.45 }],
      returnUrl: 'https://shop.example.test/api/payments/payway/return',
      cancelUrl: 'https://shop.example.test/checkout/success',
      continueSuccessUrl: 'https://shop.example.test/checkout/pay-result'
    })
    expect(request.action).toBe('https://checkout.payway.com.kh/api/payment-gateway/v1/payments/purchase')
    expect(request.fields.amount).toBe('123.45')
    expect(request.fields.return_params).toBe('{"order_id":"99999999-1111-4000-8000-000000000001"}')
    const { hash, ...unsigned } = request.fields
    expect(hash).toBe(await signPurchaseFields(unsigned, FIXED_KEY))
  })
})

describe('the return-URL callback', () => {
  const body = {
    tran_id: 'RGBTEST00001',
    apv: '544415',
    status: '0',
    return_params: '{"order_id":"99999999-1111-4000-8000-000000000001"}',
    payment_amount: 123.45,
    total_amount: 123.45,
    payment_currency: 'USD',
    bank_ref: '100FT40074059022'
  }

  test('accepts a body signed with the sorted-values scheme', async () => {
    const raw = JSON.stringify(body)
    const verified = await verifyCallback(raw, signSortedValues(body, FIXED_KEY), FIXED_KEY)
    expect(verified.valid).toBe(true)
    const parsed = parseCallback(verified.body || {})
    expect(parsed).toEqual({ tranId: 'RGBTEST00001', orderId: '99999999-1111-4000-8000-000000000001', amount: 123.45 })
  })

  test('rejects a tampered body, a missing header, and non-JSON input', async () => {
    const raw = JSON.stringify(body)
    const good = signSortedValues(body, FIXED_KEY)
    expect((await verifyCallback(JSON.stringify({ ...body, payment_amount: 1 }), good, FIXED_KEY)).valid).toBe(false)
    expect((await verifyCallback(raw, null, FIXED_KEY)).valid).toBe(false)
    expect((await verifyCallback('not json', good, FIXED_KEY)).valid).toBe(false)
  })
})

describe('the error-code map', () => {
  test('covers the codes the routes handle', () => {
    expect(PAYWAY_CODES[4]).toBe('duplicate_tran_id')
    expect(PAYWAY_CODES[81]).toBe('return_url_not_whitelisted')
    expect(PAYWAY_CODES[429]).toBe('rate_limited')
    expect(PAYWAY_PAYMENT_CODE.approved).toBe(0)
    expect(PAYWAY_PAYMENT_CODE.cancelled).toBe(7)
  })
})

// A mutable fake — the store seam is what makes double-apply/replay honest without a project.
const makeStore = (payment: { id: string, orderId: string, status: string } | null, total: number | null) => {
  const calls: Array<Record<string, unknown>> = []
  const state = { payment: payment ? { ...payment } : null }
  const store = {
    findPayment: async () => state.payment ? { ...state.payment } : null,
    orderTotal: async () => total,
    markPayment: async (id: string, patch: { status: string, paidAt?: string, resultPayload: unknown }) => {
      calls.push({ markPayment: [id, patch.status] })
      if (state.payment) state.payment.status = patch.status
    },
    markOrderPaid: async (orderId: string) => { calls.push({ markOrderPaid: orderId }) }
  }
  return { store, calls }
}

const result = (code: number, amount: number | null) =>
  ({ tranId: 'RGBTEST00001', code, amount, payload: { raw: true } })

describe('applyPaywayResult', () => {
  test('approved + matching amount marks the attempt paid and the order paid', async () => {
    const warn = spyOn(console, 'warn')
    const { store, calls } = makeStore({ id: 'p1', orderId: 'o1', status: 'initiated' }, 123.45)
    expect(await applyPaywayResult(store, result(PAYWAY_PAYMENT_CODE.approved, 123.45))).toBe('paid')
    expect(calls).toEqual([{ markPayment: ['p1', 'paid'] }, { markOrderPaid: 'o1' }])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  test('a replay is a no-op: the second apply changes nothing', async () => {
    const { store, calls } = makeStore({ id: 'p1', orderId: 'o1', status: 'initiated' }, 123.45)
    await applyPaywayResult(store, result(PAYWAY_PAYMENT_CODE.approved, 123.45))
    const before = calls.length
    expect(await applyPaywayResult(store, result(PAYWAY_PAYMENT_CODE.approved, 123.45))).toBe('already-paid')
    expect(calls.length).toBe(before)
  })

  test('an amount mismatch marks the attempt failed and never the order', async () => {
    const warn = spyOn(console, 'warn')
    const { store, calls } = makeStore({ id: 'p1', orderId: 'o1', status: 'initiated' }, 123.45)
    expect(await applyPaywayResult(store, result(PAYWAY_PAYMENT_CODE.approved, 100))).toBe('amount-mismatch')
    expect(calls).toEqual([{ markPayment: ['p1', 'failed'] }])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  test('an unknown tran_id is rejected without any write', async () => {
    const { store, calls } = makeStore(null, 123.45)
    expect(await applyPaywayResult(store, result(PAYWAY_PAYMENT_CODE.approved, 123.45))).toBe('unknown-tran')
    expect(calls).toEqual([])
  })

  test('declined and cancelled map to their own terminal statuses; pending waits', async () => {
    const declined = makeStore({ id: 'p1', orderId: 'o1', status: 'initiated' }, 123.45)
    expect(await applyPaywayResult(declined.store, result(PAYWAY_PAYMENT_CODE.declined, 123.45))).toBe('failed')
    const cancelled = makeStore({ id: 'p1', orderId: 'o1', status: 'initiated' }, 123.45)
    expect(await applyPaywayResult(cancelled.store, result(PAYWAY_PAYMENT_CODE.cancelled, 123.45))).toBe('cancelled')
    const pending = makeStore({ id: 'p1', orderId: 'o1', status: 'initiated' }, 123.45)
    expect(await applyPaywayResult(pending.store, result(PAYWAY_PAYMENT_CODE.pending, null))).toBe('no-op')
    expect(pending.calls).toEqual([])
  })
})
