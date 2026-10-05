import { createError, defineEventHandler } from 'h3'
import { LOGIN_CODE_TTL_MS, formatLoginCode, generateLoginCode, hashCode } from '../../../utils/auth'
import { createServiceClient, currentUserId } from '../../../utils/auth-service'

/**
 * Generates (or replaces) the account's login code — SPEC-identity.md amendment, capability 3.
 * The plaintext exists only in this one response; the database keeps the sha256 digest, so a
 * lost code is regenerated, never recovered.
 */
export default defineEventHandler(async (event) => {
  const userId = await currentUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: 'AUTH_REQUIRED' })

  const service = createServiceClient(event)
  const raw = generateLoginCode()
  const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString()

  // Upsert on the user_id primary key: one active code per account, regenerate replaces.
  const { error } = await service
    .from('login_codes')
    .upsert({ user_id: userId, code_hash: await hashCode(raw), expires_at: expiresAt, attempts: 0 })

  if (error) throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })

  return { code: formatLoginCode(raw), expiresAt }
})
