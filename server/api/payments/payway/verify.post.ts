/**
 * `POST /api/payments/payway/verify` — body `{ orderId }` (session path) or `{ tranId }` (the
 * payer-capability path). The reconciliation read behind the result page: PayWay's success
 * redirect arrives via `continue_success_url`, its return-URL notification may never reach us at
 * all (in dev it structurally cannot — localhost), and after a multi-minute excursion the
 * arriving session can lag, so the payer's own attempt id — minted by us, carried in the return
 * URLs the payer's browser followed — can verify WITHOUT any session. That path is bounded to
 * recent attempts and answers the status alone (no ids, no order data). Both paths apply through
 * the one idempotent door, `applyPaywayResult`.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event) as { paywayMerchantId?: string, paywayApiKey?: string, paywayBase?: string }
  const merchantId = config.paywayMerchantId?.trim() || ''
  const apiKey = config.paywayApiKey?.trim() || ''
  if (!merchantId || !apiKey) throw createError({ statusCode: 503, statusMessage: 'PAYMENT_CONFIG_MISSING' })

  const body = await readBody<{ orderId?: string, tranId?: string }>(event)
  const sql = appSql(event)
  const check = async (tranId: string) =>
    checkTransaction(config.paywayBase?.trim() || PAYWAY_BASE, merchantId, apiKey, tranId)

  // The payer-capability path: no session, one recent attempt, status-only reply.
  const tranId = typeof body?.tranId === 'string' && /^[A-Za-z0-9]{6,20}$/.test(body.tranId) ? body.tranId : ''
  if (tranId) {
    const attemptRows = await sql`select provider_txn_id from public.payments
      where provider_txn_id = ${tranId} and created_at > now() - interval '24 hours'`
    if (!attemptRows.length) throw createError({ statusCode: 404, statusMessage: 'PAYMENT_NOT_FOUND' })
    const result = await check(tranId)
    if (result) {
      await applyPaywayResult(storeFor(sql), { tranId, code: result.code, amount: result.amount, payload: result.raw })
    }
    const statusRows = await sql`select o.payment_status from public.orders o
      join public.payments p on p.order_id = o.id
      where p.provider_txn_id = ${tranId}`
    return { paymentStatus: (statusRows[0] as { payment_status?: string } | undefined)?.payment_status ?? 'unpaid' }
  }

  // The owner path (unchanged behaviour): the session answers ownership, and the attempt must
  // belong to this order.
  const userId = requireUser(event)
  const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
  if (!UUID_RE.test(orderId)) throw createError({ statusCode: 400, statusMessage: 'INVALID_ORDER' })

  const [, , orderRows, attemptRows] = await userTx(sql, userId, [
    sql`select payment_status from public.orders where id = ${orderId}::uuid`,
    sql`select provider_txn_id from public.payments
        where order_id = ${orderId}::uuid and status = 'initiated'
        order by created_at desc limit 1`
  ])
  const order = (orderRows as Array<{ payment_status: string }>)[0]
  if (!order) throw createError({ statusCode: 404, statusMessage: 'ORDER_NOT_FOUND' })
  const attemptTran = (attemptRows as Array<{ provider_txn_id: string }>)[0]?.provider_txn_id
  if (!attemptTran || order.payment_status === 'paid') return { paymentStatus: order.payment_status }

  const result = await check(attemptTran)
  if (result) {
    await applyPaywayResult(storeFor(sql), { tranId: attemptTran, code: result.code, amount: result.amount, payload: result.raw })
    const [, , freshRows] = await userTx(sql, userId, [
      sql`select payment_status from public.orders where id = ${orderId}::uuid`
    ])
    return { paymentStatus: (freshRows as Array<{ payment_status: string }>)[0]?.payment_status ?? order.payment_status }
  }
  return { paymentStatus: order.payment_status }
})
