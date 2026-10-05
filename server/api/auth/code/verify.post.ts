import { createError, defineEventHandler, readBody } from 'h3'
import { hashCode, normalizeCodeInput } from '../../../utils/auth'
import { clientIp, createServiceClient, mintSessionToken, withinRateLimit } from '../../../utils/auth-service'

/**
 * Code login (SPEC-identity.md amendment, capability 3): the code is looked up by its sha256
 * digest. A miss cannot be attributed to any particular code row — identifiers simply do not
 * exist until a code matches — so the guard is the per-IP throttle plus ~60 bits of entropy,
 * not a per-code counter (recorded in the spec).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { code?: unknown } | null
  const normalized = typeof body?.code === 'string' ? normalizeCodeInput(body.code) : null
  if (!normalized) throw createError({ statusCode: 400, statusMessage: 'BAD_FORMAT' })

  const service = createServiceClient(event)
  if (!await withinRateLimit(service, `code-verify:${clientIp(event)}`, 20, 600)) {
    throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })
  }

  const { data: row } = await service
    .from('login_codes')
    .select('user_id, expires_at')
    .eq('code_hash', await hashCode(normalized))
    .maybeSingle()

  if (!row) throw createError({ statusCode: 400, statusMessage: 'INVALID_CODE' })
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw createError({ statusCode: 410, statusMessage: 'EXPIRED' })
  }

  // Minting is email-flavored, so the account's real (or synthetic) address is the one lookup
  // the mint needs — and the one place code login touches the user record at all.
  const { data: userData } = await service.auth.admin.getUserById(row.user_id)
  const email = userData.user?.email
  if (!email) throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })

  return { tokenHash: await mintSessionToken(service, email) }
})
