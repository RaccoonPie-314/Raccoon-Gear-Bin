import { hashCode, normalizeCodeInput } from '../../../utils/auth'
import { clientIp, withinRateLimit } from '../../../utils/auth-service'
import { createSignInTicket } from '../../../utils/clerk'

/**
 * Code login (SPEC-identity.md amendment, capability 3): the code is looked up by its sha256
 * digest. A miss cannot be attributed to any particular code row — identifiers simply do not
 * exist until a code matches — so the guard is the per-IP throttle plus ~60 bits of entropy,
 * not a per-code counter (recorded in the spec). Success answers the sign-in ticket the browser
 * completes in-page, with the hosted URL as fallback — the mint both this and the Telegram flow
 * share now.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { code?: unknown } | null
  const normalized = typeof body?.code === 'string' ? normalizeCodeInput(body.code) : null
  if (!normalized) throw createError({ statusCode: 400, statusMessage: 'BAD_FORMAT' })

  const sql = appSql(event)
  if (!await withinRateLimit(sql, `code-verify:${clientIp(event)}`, 20, 600)) {
    throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })
  }

  const [row] = await sql`select user_id, expires_at from public.login_codes where code_hash = ${await hashCode(normalized)}`
  if (!row) throw createError({ statusCode: 400, statusMessage: 'INVALID_CODE' })
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw createError({ statusCode: 410, statusMessage: 'EXPIRED' })
  }

  const mint = await createSignInTicket(event, row.user_id)
  return { ticket: mint.ticket, signInUrl: mint.url }
})
