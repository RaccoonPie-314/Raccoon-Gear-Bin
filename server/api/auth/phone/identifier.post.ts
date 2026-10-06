import { normalizePhone } from '../../../utils/auth'
import { clientIp, withinRateLimit } from '../../../utils/auth-service'
import { phoneUsername } from '../../../utils/clerk'

/**
 * Phone → alias resolution for the phone LOGIN mode. The client cannot own the mapping (Clerk
 * rejects +855 identifiers and `normalizePhone` is the server's single owner), so the form asks
 * this route and hands the answer to Clerk's client sign-in. No existence lookup on purpose: the
 * route answers the same alias for a number with no account, and Clerk's "could not find" and
 * "wrong password" surface as the same login copy — no account oracle on the side.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { phone?: unknown } | null
  const phone = typeof body?.phone === 'string' ? normalizePhone(body.phone) : null
  if (!phone) throw createError({ statusCode: 400, statusMessage: 'INVALID_PHONE' })

  const sql = appSql(event)
  if (!await withinRateLimit(sql, `phone-identify:${clientIp(event)}`, 20, 600)) {
    throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })
  }

  return { username: phoneUsername(phone) }
})
