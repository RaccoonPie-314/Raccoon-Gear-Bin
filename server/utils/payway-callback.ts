/**
 * The shared PayWay callback pipeline (SPEC-payments): verify the signature → read the
 * AUTHORITATIVE status via Check Transaction → apply idempotently. The browser return and the
 * server-to-server webhook both enter here, so replays and retries converge on one transition.
 *
 * Failures are typed, never thrown: `signature`/`no-tran` answer 400; `config`/`check` answer
 * 503 so a provider retry can succeed later. The api_key and any recomputed hash stay in this
 * process — nothing here is ever logged or echoed.
 */
import type { H3Event } from 'h3'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import {
  PAYWAY_BASE,
  PAYWAY_CHECK_PATH,
  applyPaywayResult,
  parseCallback,
  signPurchaseFields,
  utcTimestamp,
  verifyCallback,
  type PaywayResultStore
} from './payway'

type CallbackOutcome =
  | { ok: true, outcome: string, orderId: string | null }
  | { ok: false, statusCode: 400 | 503, reason: string }

/** The DB seam from SPEC-payments, built on the owner connection (the sanctioned server tier). */
export const storeFor = (sql: NeonQueryFunction<false, false>): PaywayResultStore => ({
  findPayment: async (tranId) => {
    const rows = await sql`select id, order_id, status from public.payments where provider_txn_id = ${tranId}`
    const row = rows[0] as { id: string, order_id: string, status: string } | undefined
    return row ? { id: row.id, orderId: row.order_id, status: row.status } : null
  },
  orderTotal: async (orderId) => {
    const rows = await sql`select total from public.orders where id = ${orderId}::uuid`
    const row = rows[0] as { total: string | number } | undefined
    return row ? Number(row.total) : null
  },
  markPayment: async (id, patch) => {
    await sql`update public.payments
      set status = ${patch.status}, paid_at = ${patch.paidAt ?? null}, result_payload = ${JSON.stringify(patch.resultPayload)}::jsonb
      where id = ${id}::uuid`
  },
  markOrderPaid: async (orderId) => {
    await sql`update public.orders set payment_status = 'paid' where id = ${orderId}::uuid and payment_status = 'unpaid'`
  }
})

/**
 * The authoritative read: same hash scheme as the request (`req_time . merchant_id . tran_id`),
 * JSON body, `status.code` is a STRING here (the purchase-exception sibling is a number — the
 * trap the P0 amendment records). Any non-`00` answer or transport failure returns null.
 */
export const checkTransaction = async (
  base: string,
  merchantId: string,
  apiKey: string,
  tranId: string
): Promise<{ code: number, amount: number | null, raw: unknown } | null> => {
  type CheckPayload = { data?: Record<string, unknown>, status?: { code?: string } }
  const fields = { req_time: utcTimestamp(), merchant_id: merchantId, tran_id: tranId }
  const hash = await signPurchaseFields(fields, apiKey)
  let payload: CheckPayload | null = null
  try {
    const response = await fetch(`${base}${PAYWAY_CHECK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, hash }),
      signal: AbortSignal.timeout(15_000)
    })
    payload = await response.json() as CheckPayload
  } catch (error) {
    console.warn('[payway] check-transaction unreachable:', error instanceof Error ? error.message : error)
    return null
  }
  const statusCode = String(payload?.status?.code ?? '')
  const data = payload?.data
  if (statusCode !== '00' || !data) {
    console.warn('[payway] check-transaction refused:', statusCode)
    return null
  }
  const amount = typeof data.payment_amount === 'number'
    ? data.payment_amount
    : typeof data.total_amount === 'number' ? data.total_amount : null
  return { code: Number(data.payment_status_code), amount, raw: payload }
}

export const processPaywayCallback = async (
  event: H3Event,
  rawBody: string,
  signature: string | null
): Promise<CallbackOutcome> => {
  const config = useRuntimeConfig(event) as { paywayMerchantId?: string, paywayApiKey?: string, paywayBase?: string }
  const merchantId = config.paywayMerchantId?.trim() || ''
  const apiKey = config.paywayApiKey?.trim() || ''
  if (!merchantId || !apiKey) return { ok: false, statusCode: 503, reason: 'config' }

  const { valid, body } = await verifyCallback(rawBody, signature, apiKey)
  if (!valid || !body) return { ok: false, statusCode: 400, reason: 'signature' }

  const { tranId, orderId: carriedOrderId } = parseCallback(body)
  if (!tranId) return { ok: false, statusCode: 400, reason: 'no-tran' }

  const check = await checkTransaction(config.paywayBase?.trim() || PAYWAY_BASE, merchantId, apiKey, tranId)
  if (!check) return { ok: false, statusCode: 503, reason: 'check' }

  const sql = appSql(event)
  const outcome = await applyPaywayResult(storeFor(sql), { tranId, code: check.code, amount: check.amount, payload: check.raw })

  let orderId = carriedOrderId
  if (!orderId) {
    const rows = await sql`select order_id from public.payments where provider_txn_id = ${tranId}`
    orderId = (rows[0] as { order_id?: string } | undefined)?.order_id ?? null
  }
  return { ok: true, outcome, orderId }
}
