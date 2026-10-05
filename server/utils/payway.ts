/**
 * The PayWay contract, in one dependency-free place (specs/ecommerce/SPEC-payments.md, including
 * the 2026-10-04 P0 amendment). Every fact below was re-retrieved from developer.payway.com.kh at
 * P0; the fixed hash order and the callback scheme are pinned by `tests/unit/payway.test.ts` with
 * an independently computed vector, so drift fails `bun test` rather than the sandbox run.
 *
 * No `~` imports on purpose: the unit test imports this file relatively, and the root tsconfig
 * cannot resolve Nuxt aliases under `bun test`. DB access in `applyPaywayResult` arrives as an
 * injected store; the routes (P3) wire the typed Supabase client into it.
 */

/** Production and sandbox bases (P0: the sandbox host is `checkout-sandbox`, not `checkout-uat`). */
export const PAYWAY_BASE = 'https://checkout.payway.com.kh'
export const PAYWAY_SANDBOX_BASE = 'https://checkout-sandbox.payway.com.kh'
export const PAYWAY_PURCHASE_PATH = '/api/payment-gateway/v1/payments/purchase'
export const PAYWAY_CHECK_PATH = '/api/payment-gateway/v1/payments/check-transaction-2'

/**
 * The fixed concatenation order of the purchase-request hash — the docs' own order, verbatim.
 * Absent fields hash as empty strings; the order is positional, so a reordering of the input
 * object must NOT change the hash (the test proves both directions).
 */
export const PAYWAY_HASH_FIELDS = [
  'req_time', 'merchant_id', 'tran_id', 'amount', 'items', 'shipping', 'firstname', 'lastname',
  'email', 'phone', 'type', 'payment_option', 'return_url', 'cancel_url', 'continue_success_url',
  'return_deeplink', 'currency', 'custom_fields', 'return_params', 'payout', 'lifetime',
  'additional_params', 'google_pay_token', 'skip_success_page'
] as const

/** `YYYYMMDDHHmmss` in UTC — the shape every PayWay request field uses. */
export const utcTimestamp = (date: Date = new Date()): string =>
  date.toISOString().replace(/[-:T]/g, '').slice(0, 14)

/** UTF-8-safe base64 (btoa alone mangles non-ASCII — product names can be Khmer). */
export const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** WebCrypto HMAC-SHA512 → base64. Both Workers and bun expose `crypto.subtle`. */
export const paywayHash = async (concat: string, apiKey: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiKey), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(concat))
  let binary = ''
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Concatenate the fields in the documented order; absent fields contribute the empty string. */
export const paywayConcat = (fields: Record<string, string | undefined>): string =>
  PAYWAY_HASH_FIELDS.map(name => fields[name] ?? '').join('')

export const signPurchaseFields = (fields: Record<string, string | undefined>, apiKey: string): Promise<string> =>
  paywayHash(paywayConcat(fields), apiKey)

/**
 * `tran_id`: `RGB` + base36(epoch ms) + 3 random base36 chars ≈ 14 of the 20 allowed. Duplicates
 * are possible in principle; PayWay answers code `4` and the create route regenerates once —
 * that is the documented handling, not a reason to widen the generator.
 */
export const newTranId = (): string =>
  `RGB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5).padEnd(3, '0')}`

export type PurchaseInput = {
  merchantId: string
  apiKey: string
  orderId: string
  amount: number
  currency: string
  itemLines: Array<{ name: string, quantity: number, price: number }>
  returnUrl: string
  cancelUrl: string
  continueSuccessUrl: string
  /** Defaults to production; the sandbox base is passed in dev/sandbox environments. */
  base?: string
}

/**
 * The signed purchase request. Per the P0 amendment there is no server-callable URL: the create
 * route returns `{ action, fields }` and the browser submits the multipart form (hosted view).
 * `order_id` rides in `return_params` — the field PayWay echoes to the return URL — never in the
 * hash-invisible `custom_fields` (that one is dashboard metadata).
 */
export const buildPurchaseRequest = async (input: PurchaseInput) => {
  const tranId = newTranId()
  const fields: Record<string, string> = {
    req_time: utcTimestamp(),
    merchant_id: input.merchantId,
    tran_id: tranId,
    amount: input.amount.toFixed(2),
    items: toBase64(JSON.stringify(input.itemLines.map(line => ({ name: line.name, quantity: line.quantity, price: line.price })))),
    type: 'purchase',
    return_url: input.returnUrl,
    cancel_url: input.cancelUrl,
    skip_success_page: '1',
    continue_success_url: input.continueSuccessUrl,
    currency: input.currency,
    return_params: JSON.stringify({ order_id: input.orderId })
  }
  return {
    action: `${input.base ?? PAYWAY_BASE}${PAYWAY_PURCHASE_PATH}`,
    fields: { ...fields, hash: await signPurchaseFields(fields, input.apiKey) },
    tranId
  }
}

/** Constant-time-ish comparison: length leaks (standard), content does not. */
const timingSafeEqual = (expected: string, received: string): boolean => {
  if (expected.length !== received.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i)
  return diff === 0
}

/**
 * The callback signature (P0): header `X-PAYWAY-HMAC-SHA512`, recomputed as
 * `base64(hmac_sha512(values in ascending KEY order, api_key))` — sorted keys, not the purchase
 * fixed order; arrays/objects are JSON-encoded, `null` contributes ''. A body that is not JSON,
 * or a missing header, is simply invalid — never a throw.
 */
export const verifyCallback = async (
  rawBody: string,
  signature: string | null,
  apiKey: string
): Promise<{ valid: boolean, body: Record<string, unknown> | null }> => {
  if (!signature) return { valid: false, body: null }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return { valid: false, body: null }
  }
  const concat = Object.keys(body).sort().map((key) => {
    const value = body[key]
    if (value === null || value === undefined) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  }).join('')
  return { valid: timingSafeEqual(await paywayHash(concat, apiKey), signature), body }
}

/** The few callback fields the return/webhook path needs; everything else stays raw in the row. */
export const parseCallback = (body: Record<string, unknown>) => {
  const tranId = typeof body.tran_id === 'string' ? body.tran_id : null
  let orderId: string | null = null
  if (typeof body.return_params === 'string') {
    try {
      const parsed = JSON.parse(body.return_params) as { order_id?: unknown }
      if (parsed && typeof parsed.order_id === 'string') orderId = parsed.order_id
    } catch { /* an unparsable carrier leaves orderId null — the tran lookup still matches */ }
  }
  const amount = typeof body.payment_amount === 'number'
    ? body.payment_amount
    : typeof body.total_amount === 'number' ? body.total_amount : null
  return { tranId, orderId, amount }
}

/**
 * The create-response `status.code` values this module maps (the docs' full table has ~90 rows;
 * the rest are provider-side faults the route surfaces as generic failures).
 */
export const PAYWAY_CODES: Record<number, string> = {
  1: 'wrong_hash',
  4: 'duplicate_tran_id',
  6: 'domain_not_whitelisted',
  12: 'currency_not_allowed',
  13: 'invalid_items',
  81: 'return_url_not_whitelisted',
  200: 'cancelled',
  201: 'declined',
  429: 'rate_limited',
  503: 'maintenance'
}

/** check-transaction `data.payment_status_code` (a NUMBER — its `status.code` sibling is a string). */
export const PAYWAY_PAYMENT_CODE = {
  approved: 0,
  pending: 2,
  declined: 3,
  refunded: 4,
  cancelled: 7
} as const

/**
 * The DB seam, injected. The routes build it from the typed Supabase client; the tests build it
 * from a mutable fake — which is what makes the idempotency cases (double-apply, replay) honest
 * without a live project.
 */
export type PaywayResultStore = {
  findPayment: (tranId: string) => Promise<{ id: string, orderId: string, status: string } | null>
  orderTotal: (orderId: string) => Promise<number | null>
  markPayment: (id: string, patch: { status: string, paidAt?: string, resultPayload: unknown }) => Promise<void>
  markOrderPaid: (orderId: string) => Promise<void>
}

export type ApplyOutcome =
  | 'paid'
  | 'already-paid'
  | 'amount-mismatch'
  | 'failed'
  | 'cancelled'
  | 'no-op'
  | 'unknown-tran'

/**
 * The one place a provider result changes state — idempotent by design, because the return URL and
 * the webhook both land here and PayWay retries. Rules (SPEC-payments): an unknown tran_id is
 * rejected (the caller logs the payload); an already-paid attempt is a no-op; the provider amount
 * must equal `orders.total` or the attempt is marked `failed` and **never** `paid`; only
 * `approved` flips the order. `pending` waits; `refunded` is owned by the admin marker in v1.
 * Epsilon comparison, not `===`: both sides are 2-dp decimals that travel through JSON numbers.
 */
export const applyPaywayResult = async (
  store: PaywayResultStore,
  result: { tranId: string, code: number, amount: number | null, payload: unknown }
): Promise<ApplyOutcome> => {
  const payment = await store.findPayment(result.tranId)
  if (!payment) return 'unknown-tran'
  if (payment.status === 'paid') return 'already-paid'
  if (payment.status === 'refunded') return 'no-op'

  if (result.code === PAYWAY_PAYMENT_CODE.approved) {
    const total = await store.orderTotal(payment.orderId)
    const matches = total !== null && result.amount !== null && Math.abs(total - result.amount) < 0.005
    if (!matches) {
      await store.markPayment(payment.id, { status: 'failed', resultPayload: result.payload })
      return 'amount-mismatch'
    }
    await store.markPayment(payment.id, { status: 'paid', paidAt: new Date().toISOString(), resultPayload: result.payload })
    await store.markOrderPaid(payment.orderId)
    return 'paid'
  }

  if (result.code === PAYWAY_PAYMENT_CODE.declined) {
    await store.markPayment(payment.id, { status: 'failed', resultPayload: result.payload })
    return 'failed'
  }
  if (result.code === PAYWAY_PAYMENT_CODE.cancelled) {
    await store.markPayment(payment.id, { status: 'cancelled', resultPayload: result.payload })
    return 'cancelled'
  }

  return 'no-op' // pending (2) waits for the next read; provider-side refund (4) is the admin's marker
}
