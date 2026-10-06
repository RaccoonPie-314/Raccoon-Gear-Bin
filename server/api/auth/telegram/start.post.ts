import { TELEGRAM_REQUEST_TTL_MS, generateNonce } from '../../../utils/auth'
import { clientIp, currentUserId, withinRateLimit } from '../../../utils/auth-service'
import { TELEGRAM_BOT_USERNAME } from '../../../utils/telegram'

/**
 * Telegram deep-link login handshake, step 1 (SPEC-identity.md amendment — capability 2). Creates
 * the nonce row and answers with the t.me link; the webhook confirms it when the buyer taps
 * Start, and poll mints the Clerk sign-in URL. `mode: 'link'` connects the signed-in account
 * instead — same handshake, no session minted on confirmation.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { mode?: unknown } | null
  const mode = body?.mode === 'link' ? 'link' : 'login'

  const sql = appSql(event)
  if (!await withinRateLimit(sql, `telegram-start:${clientIp(event)}`, 30, 600)) {
    throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })
  }

  let userId: string | null = null
  if (mode === 'link') {
    userId = currentUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'AUTH_REQUIRED' })
  }

  // Opportunistic hygiene — the table only ever needs to hold live handshakes.
  await sql`delete from public.telegram_login_requests where expires_at < now()`

  const nonce = generateNonce()
  const expiresAt = new Date(Date.now() + TELEGRAM_REQUEST_TTL_MS).toISOString()
  await sql`insert into public.telegram_login_requests (nonce, user_id, expires_at)
    values (${nonce}, ${userId}, ${expiresAt})`

  return {
    nonce,
    deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=lg_${nonce}`,
    expiresAt
  }
})
