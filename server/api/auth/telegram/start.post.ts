import { createError, defineEventHandler, readBody } from 'h3'
import { TELEGRAM_REQUEST_TTL_MS, generateNonce } from '../../../utils/auth'
import { clientIp, createServiceClient, currentUserId, withinRateLimit } from '../../../utils/auth-service'
import { TELEGRAM_BOT_USERNAME } from '../../../utils/telegram'

/**
 * Telegram deep-link login handshake, step 1 (SPEC-identity.md amendment — capability 2). Creates
 * the nonce row and answers with the t.me link; the webhook confirms it when the buyer taps
 * Start, and poll mints the session. `mode: 'link'` connects the signed-in account instead —
 * same handshake, no session minted on confirmation.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { mode?: unknown } | null
  const mode = body?.mode === 'link' ? 'link' : 'login'

  const service = createServiceClient(event)
  if (!await withinRateLimit(service, `telegram-start:${clientIp(event)}`, 30, 600)) {
    throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })
  }

  let userId: string | null = null
  if (mode === 'link') {
    userId = await currentUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'AUTH_REQUIRED' })
  }

  // Opportunistic hygiene — the table only ever needs to hold live handshakes.
  await service.from('telegram_login_requests').delete().lt('expires_at', new Date().toISOString())

  const nonce = generateNonce()
  const expiresAt = new Date(Date.now() + TELEGRAM_REQUEST_TTL_MS).toISOString()
  const { error } = await service
    .from('telegram_login_requests')
    .insert({ nonce, user_id: userId, expires_at: expiresAt })
  if (error) throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })

  return {
    nonce,
    deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=lg_${nonce}`,
    expiresAt
  }
})
