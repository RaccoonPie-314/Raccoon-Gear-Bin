/**
 * PayWay's browser return (`POST`, JSON body, `X-PAYWAY-HMAC-SHA512` header). Never trusted
 * alone: the shared pipeline re-verifies the signature and reads the authoritative status via
 * Check Transaction before any state change. Then 303 to the result page, which reads the order.
 *
 * An unauthentic call (`signature`/`no-tran`) answers 400; a provider/config fault still lands
 * the browser on the result page (it renders unpaid) with the reason in the logs.
 */
export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event) ?? ''
  const signature = getHeader(event, 'x-payway-hmac-sha512') ?? null
  const result = await processPaywayCallback(event, raw, signature)

  if (!result.ok) {
    if (result.statusCode === 400) throw createError({ statusCode: 400, statusMessage: result.reason })
    console.warn('[payway] return could not complete:', result.reason)
    return sendRedirect(event, '/checkout/pay-result', 303)
  }
  return sendRedirect(event, result.orderId ? `/checkout/pay-result?order=${result.orderId}` : '/checkout/pay-result', 303)
})
