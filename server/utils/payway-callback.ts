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
import { sendTelegramMessage, orderPushInput, orderTelegramText } from './telegram'
import { withinRateLimit } from './auth-service'
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
  // No initializer: every path either assigns it or returns, which is exactly what the
  // `no-useless-assignment` rule reads as "the `= null` was never used".
  let payload: CheckPayload
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

/**
 * The seller's "paid" notice, and for a pay-now order the ONLY one it ever gets: the creation push
 * is silent for that path by design (see `orders/index.post.ts`), so this message has to carry the
 * whole order — buyer, address, items — not a one-line receipt, or deferring the ping would trade a
 * stale message for an unusable one. Every door that can flip `orders.payment_status` calls this —
 * the browser return, the server-to-server webhook, and the buyer's own reconciliation poll on
 * `/api/payments/payway/verify` — and none of them sends it twice, because `applyPaywayResult`
 * answers `paid` only for the FIRST transition (`already-paid` on every replay). The poll is the
 * one that mattered: it flips the row in the same window as the webhook, and in dev the
 * return/webhook legs cannot reach localhost at all, so the poll was the only door left. Pay-later
 * orders paid online from the success page land here too — a second, richer message about an order
 * the shop already knows, which is exactly the "this one is paid now" update it wants.
 * Exception-wrapped like the creation push — the payment is the money path, the push is decoration.
 */
export const notifyPaymentReceived = async (
  event: H3Event,
  sql: NeonQueryFunction<false, false>,
  orderId: string
): Promise<void> => {
  try {
    const chatId = (useRuntimeConfig(event) as { telegramChatId?: string }).telegramChatId
    if (!chatId) return
    // Sequential replays cannot double-push (the door answers `paid` once), but two doors can win
    // the SAME flip in the same instant — the result page polls while the webhook lands — and the
    // row guard settles who wrote, not who read first. So the notice is deduped on the order: one
    // per minute, whichever door arrives. After the chat-id check, so an unconfigured shop never
    // burns a bucket. ponytail: a bucket rather than a per-order flag; move it into
    // `markOrderPaid`'s row count if a real double ever shows up.
    if (!await withinRateLimit(sql, `payment-push:${orderId}`, 1, 60)) return
    await sendTelegramMessage(event, chatId, orderTelegramText({ ...(await orderPushInput(sql, orderId)), paying: true }, 'paid'))
  } catch (error) {
    console.warn('[payway] payment push skipped:', error instanceof Error ? error.message : error)
  }
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

  // A fresh paid transition is the one moment the seller's Telegram learns the order is paid (the
  // creation push announces it as Unpaid). The helper owns the once-only rule; the verify poll
  // calls the same helper off the same outcome, so whichever door wins the race owns the push.
  if (outcome === 'paid' && orderId) await notifyPaymentReceived(event, sql, orderId)
  return { ok: true, outcome, orderId }
}
