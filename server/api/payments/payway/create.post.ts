/**
 * `POST /api/payments/payway/create` — body `{ orderId }`.
 *
 * Signs the purchase request (the api_key never leaves this tier) and answers `{ action, fields }`
 * for the browser's multipart form submit — the P0-amended flow; PayWay has no "payment URL"
 * mode. One `payments` attempt row per call. `tran_id` collisions are handled where they can
 * actually happen in this flow: the DB's unique index (we never see PayWay's code `4`).
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)
  const config = useRuntimeConfig(event) as { paywayMerchantId?: string, paywayApiKey?: string, paywayBase?: string }
  const merchantId = config.paywayMerchantId?.trim() || ''
  const apiKey = config.paywayApiKey?.trim() || ''
  if (!merchantId || !apiKey) throw createError({ statusCode: 503, statusMessage: 'PAYMENT_CONFIG_MISSING' })

  const body = await readBody<{ orderId?: string }>(event)
  const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
  if (!UUID_RE.test(orderId)) throw createError({ statusCode: 400, statusMessage: 'INVALID_ORDER' })

  const sql = appSql(event)
  // Each create mints a tran, adds a payments row and runs one signed provider round trip.
  if (!await withinRateLimit(sql, `payway-create:${userId}`, 5, 60)) {
    throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })
  }
  // userTx answers [set_config, set_role, ...queries] — two leading entries, not one.
  const [, , orderRows, itemRows] = await userTx(sql, userId, [
    sql`select id, total, currency, status, payment_status from public.orders where id = ${orderId}::uuid`,
    sql`select name_snapshot as name, quantity, unit_price as price from public.order_items where order_id = ${orderId}::uuid`
  ])
  const order = (orderRows as Array<{ total: string | number, currency: string, status: string, payment_status: string }>)[0]
  // The claims path answers ownership: another buyer's order is simply not visible → not found.
  if (!order) throw createError({ statusCode: 404, statusMessage: 'ORDER_NOT_FOUND' })
  if (order.status !== 'pending' || order.payment_status !== 'unpaid') {
    throw createError({ statusCode: 409, statusMessage: 'ORDER_NOT_PAYABLE' })
  }

  const origin = getRequestURL(event).origin
  const amount = Number(order.total)
  // The tran is minted HERE, before the URLs that carry it: the payer-capability `tran` rides the
  // cancel/continue URLs so the result page can verify WITHOUT a session (after a multi-minute
  // PayWay excursion the arriving session can lag) — the payer's own unguessable attempt id,
  // bounded + status-only at the verify route. The collision retry rebuilds both together.
  const makeInput = (tranId: string) => ({
    merchantId,
    apiKey,
    orderId,
    amount,
    currency: order.currency,
    itemLines: (itemRows as Array<{ name: string, quantity: number, price: string | number }>)
      .map(line => ({ name: line.name, quantity: line.quantity, price: Number(line.price) })),
    returnUrl: `${origin}/api/payments/payway/return`,
    cancelUrl: `${origin}/checkout/pay-result?order=${orderId}&tran=${tranId}`,
    continueSuccessUrl: `${origin}/checkout/pay-result?order=${orderId}&tran=${tranId}`,
    base: config.paywayBase?.trim() || undefined,
    tranId,
    // NO payment_option: the merchant profile then shows PayWay's own "Choose way to pay" page
    // with ALL enabled methods (ABA KHQR + card) in one gate — the owner's requested shape, and
    // it deletes every piece of our own mobile tab-steering. Probed live: the response is the
    // 302 to that hosted page, which the location branch below returns.
  })

  const insert = async (purchase: Awaited<ReturnType<typeof buildPurchaseRequest>>) => {
    // request_payload carries the signed fields; the hash itself is recomputable and not stored.
    const payload = JSON.stringify({ ...purchase.fields, hash: '[signed]' })
    await sql`insert into public.payments (order_id, provider_txn_id, amount, currency, status, request_payload)
      values (${orderId}::uuid, ${purchase.tranId}, ${amount}, ${order.currency}, 'initiated', ${payload}::jsonb)`
  }

  let purchase = await buildPurchaseRequest(makeInput(newTranId()))
  try {
    await insert(purchase)
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== '23505') throw error
    // tran_id collision — the one documented regenerate (fresh tran, fresh URLs), then a real
    // failure is a real failure.
    purchase = await buildPurchaseRequest(makeInput(newTranId()))
    await insert(purchase)
  }

  // The purchase itself runs SERVER-SIDE: with the khqr-deeplink option the endpoint answers
  // JSON (probed live), and the browser must never see the signed fields at all. The two shapes
  // handled: JSON (checkout_qr_url + abapay_deeplink) and — if the profile ever routes
  // differently — a 3xx to the hosted page, which stays the fallback path.
  const form = new FormData()
  for (const [name, value] of Object.entries(purchase.fields)) form.append(name, value)
  const response = await fetch(purchase.action, {
    method: 'POST',
    body: form,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000)
  })
  const location = response.headers.get('location')
  const contentType = response.headers.get('content-type') || ''
  if (location) {
    // The branded "ABA' PAYWAY" checkout — the merchant panel centered, the pre-pivot look —
    // lives at the bare-root URL; the /checkout/ pair renders the same state as a stripped
    // full-width list (verified live side by side). The old form-POST flow landed on the branded
    // one, so the path is rewritten to keep that look.
    return { checkoutUrl: location.replace('/checkout/', '/'), deeplink: null }
  }
  if (contentType.includes('json')) {
    const payload = await response.json() as {
      status?: { code?: string | number }
      checkout_qr_url?: string
      abapay_deeplink?: string
    }
    if (String(payload.status?.code ?? '') !== '00' || !payload.checkout_qr_url) {
      console.warn('[payway] purchase refused:', payload.status?.code)
      throw createError({ statusCode: 502, statusMessage: 'PAYWAY_PURCHASE_REFUSED' })
    }
    return { checkoutUrl: payload.checkout_qr_url, deeplink: payload.abapay_deeplink ?? null }
  }
  console.warn('[payway] unexpected purchase response:', response.status, contentType)
  throw createError({ statusCode: 502, statusMessage: 'PAYWAY_UNEXPECTED_RESPONSE' })
})
