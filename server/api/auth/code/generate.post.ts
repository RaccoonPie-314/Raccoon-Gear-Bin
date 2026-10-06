import { LOGIN_CODE_TTL_MS, formatLoginCode, generateLoginCode, hashCode } from '../../../utils/auth'
import { requireUser } from '../../../utils/auth-service'

/**
 * Generates (or replaces) the account's login code — SPEC-identity.md amendment, capability 3.
 * The plaintext exists only in this one response; the database keeps the sha256 digest, so a
 * lost code is regenerated, never recovered.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const sql = appSql(event)
  const raw = generateLoginCode()
  const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString()

  // Upsert on the user_id primary key: one active code per account, regenerate replaces.
  await sql`insert into public.login_codes (user_id, code_hash, expires_at, attempts)
    values (${userId}, ${await hashCode(raw)}, ${expiresAt}, 0)
    on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`

  return { code: formatLoginCode(raw), expiresAt }
})
