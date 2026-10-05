import { createError, defineEventHandler, readBody } from 'h3'
import { normalizePhone, syntheticEmail } from '../../../utils/auth'
import { clientIp, createServiceClient, withinRateLimit } from '../../../utils/auth-service'

/**
 * Phone signup (SPEC-identity.md amendment — capability 1). The account is created instantly:
 * there is no SMS step by owner decision, and the delivery call remains the real verification of
 * the number — the same reasoning v1 used for email confirmation being off. Signing IN afterwards
 * is native `signInWithPassword({ phone })` on the client; no route is involved.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { phone?: unknown, password?: unknown } | null
  const phone = typeof body?.phone === 'string' ? normalizePhone(body.phone) : null
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!phone) throw createError({ statusCode: 400, statusMessage: 'INVALID_PHONE' })
  if (password.length < 8 || password.length > 72) {
    throw createError({ statusCode: 400, statusMessage: 'WEAK_PASSWORD' })
  }

  const service = createServiceClient(event)
  if (!await withinRateLimit(service, `phone-signup:${clientIp(event)}`, 5, 600)) {
    throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })
  }

  const { error } = await service.auth.admin.createUser({
    phone,
    password,
    phone_confirm: true,
    // Synthetic, non-deliverable, never shown: the session-mint path (generateLink) is
    // email-flavored, and every capability that mints needs one (spec Schema section).
    email: syntheticEmail('phone', phone),
    email_confirm: true
  })

  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes('already') || message.includes('exists') || message.includes('registered')) {
      throw createError({ statusCode: 409, statusMessage: 'PHONE_TAKEN' })
    }
    if (message.includes('password')) throw createError({ statusCode: 400, statusMessage: 'WEAK_PASSWORD' })
    throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
  }

  return { ok: true }
})
