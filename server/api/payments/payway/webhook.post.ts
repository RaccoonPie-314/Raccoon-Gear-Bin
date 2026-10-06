/**
 * The server-to-server notification (ships regardless of whether the merchant profile enables
 * it — it is the retry-safe path). Same pipeline as the return; 200 for processed AND replayed
 * notifications so a provider retry storm stops on success, 503 when the provider or our config
 * is at fault so PayWay retries later, 400 only for unauthentic calls.
 */
export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event) ?? ''
  const signature = getHeader(event, 'x-payway-hmac-sha512') ?? null
  const result = await processPaywayCallback(event, raw, signature)

  if (!result.ok) {
    console.warn('[payway] webhook:', result.reason)
    throw createError({ statusCode: result.statusCode, statusMessage: result.reason })
  }
  if (result.outcome === 'unknown-tran') console.warn('[payway] webhook for an unknown tran_id — ignored')
  return 'OK'
})
