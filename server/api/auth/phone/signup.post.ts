import { normalizePhone } from '../../../utils/auth'
import { clientIp, withinRateLimit } from '../../../utils/auth-service'
import { createAliasUser, phoneUsername } from '../../../utils/clerk'

/**
 * Phone signup (SPEC-identity.md amendment — capability 1), Clerk-shaped: the account is created
 * instantly on a `p<e164-digits>` username alias — no SMS by owner decision (Clerk rejects +855
 * identifiers anyway, P0), and the delivery call remains the real verification of the number.
 * The real number lands in `profiles.phone` (owner context); signing IN is a client Clerk
 * sign-in with the alias + password, which is why the alias is returned and the UI never shows it.
 *
 * ponytail: create-then-profile is not one transaction — a crash between the two leaves an
 * account without its phone row, and the retry answers PHONE_TAKEN. Acceptable rarity; a Clerk
 * webhook (the P9 receipts era) is where atomicity would live if it ever bites.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { phone?: unknown, password?: unknown } | null
  const phone = typeof body?.phone === 'string' ? normalizePhone(body.phone) : null
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!phone) throw createError({ statusCode: 400, statusMessage: 'INVALID_PHONE' })
  if (password.length < 8 || password.length > 72) {
    throw createError({ statusCode: 400, statusMessage: 'WEAK_PASSWORD' })
  }

  const sql = appSql(event)
  if (!await withinRateLimit(sql, `phone-signup:${clientIp(event)}`, 5, 600)) {
    throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })
  }

  const username = phoneUsername(phone)
  let userId: string
  try {
    userId = await createAliasUser(event, username, password)
  } catch (error) {
    const text = `${(error as Error)?.message ?? ''} ${JSON.stringify((error as { errors?: unknown }).errors ?? '')}`.toLowerCase()
    if (/already|exists|taken|unique/.test(text)) {
      throw createError({ statusCode: 409, statusMessage: 'PHONE_TAKEN' })
    }
    // The instance checks passwords against HaveIBeenPwned and answers `form_password_pwned`
    // ("Password has been found in an online data breach", verified live 2026-10-06) — that is
    // not a length problem, so it gets its own code and honest copy; the length case keeps
    // WEAK_PASSWORD.
    if (/pwned|breach/.test(text)) throw createError({ statusCode: 400, statusMessage: 'PASSWORD_BREACHED' })
    if (/password/.test(text)) throw createError({ statusCode: 400, statusMessage: 'WEAK_PASSWORD' })
    throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
  }

  await sql`insert into public.profiles (id, phone)
    values (${userId}, ${phone})
    on conflict (id) do update set phone = excluded.phone`

  return { ok: true, username }
})
