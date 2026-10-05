import { createError, defineEventHandler, readBody } from 'h3'
import { syntheticEmail } from '../../../utils/auth'
import { createServiceClient, mintSessionToken } from '../../../utils/auth-service'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'

const NONCE_RE = /^[A-Za-z0-9_-]{32}$/

/**
 * Resolves the Telegram-keyed account for a confirmed handshake, healing the one partial state an
 * earlier crash can leave (account created, link row missing): `createUser` answers "already
 * registered" then, and `generateLink` — whose response carries the user — is the id lookup the
 * email allows. A unique violation on the link insert just means another poll won the race.
 */
async function resolveTelegramUser(
  service: SupabaseClient<Database>,
  tgId: number,
  tgUsername: string | null,
  tgFirstName: string | null
): Promise<string> {
  const email = syntheticEmail('telegram', String(tgId))
  const lookup = async () => {
    const { data } = await service.from('telegram_links').select('user_id').eq('tg_id', tgId).maybeSingle()
    return data?.user_id ?? null
  }

  let userId = await lookup()
  if (userId) return userId

  const { data: created, error } = await service.auth.admin.createUser({ email, email_confirm: true })
  if (error && !/already|exists|registered/i.test(error.message)) {
    throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
  }
  userId = created?.user?.id ?? await lookup()
  if (!userId) {
    const { data: generated } = await service.auth.admin.generateLink({ type: 'magiclink', email })
    userId = generated?.user?.id ?? null
  }
  if (!userId) throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })

  const { error: linkError } = await service
    .from('telegram_links')
    .insert({ tg_id: tgId, user_id: userId, tg_username: tgUsername })
  if (linkError) {
    const raced = await lookup()
    if (!raced) throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
    return raced
  }
  if (tgFirstName) {
    await service.from('profiles').update({ display_name: tgFirstName }).eq('id', userId)
  }
  return userId
}

/**
 * Telegram handshake, step 3: the browser asks whether the tap happened yet. Pending stays
 * pending; a confirmed request either links the signed-in account (`mode: 'link'`) or
 * finds-or-creates the Telegram-keyed account and mints the session token. The request is
 * single-use: the first poll that reaches minting consumes it; every later poll answers
 * `expired`.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { nonce?: unknown } | null
  const nonce = typeof body?.nonce === 'string' && NONCE_RE.test(body.nonce) ? body.nonce : null
  if (!nonce) throw createError({ statusCode: 400, statusMessage: 'BAD_NONCE' })

  const service = createServiceClient(event)
  const { data: request } = await service
    .from('telegram_login_requests')
    .select('nonce, user_id, status, tg_id, tg_username, tg_first_name, expires_at')
    .eq('nonce', nonce)
    .maybeSingle()

  if (!request || new Date(request.expires_at).getTime() <= Date.now()) return { status: 'expired' }
  if (request.status === 'pending') return { status: 'pending' }
  if (request.status === 'consumed') return { status: 'expired' }

  // status === 'confirmed'
  const tgId = request.tg_id
  if (tgId === null) return { status: 'pending' } // defensive: confirmed implies tg_id

  if (request.user_id) {
    // Link mode: attach the Telegram identity to the account that started the handshake.
    const { error } = await service
      .from('telegram_links')
      .insert({ tg_id: tgId, user_id: request.user_id, tg_username: request.tg_username })
    await service.from('telegram_login_requests').update({ status: 'consumed' }).eq('nonce', nonce)
    // A unique violation means this account already has a Telegram link or this Telegram account
    // is linked elsewhere; both surface as 'linked' — the account page shows whatever is true.
    if (error && !/duplicate|unique/i.test(error.message)) {
      throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
    }
    return { status: 'linked' }
  }

  // Login mode: resolve the account, consume the handshake, mint the one-time session token.
  // The account's email is deterministic (synthetic) — no read-back needed before minting.
  await resolveTelegramUser(service, tgId, request.tg_username, request.tg_first_name)
  await service.from('telegram_login_requests').update({ status: 'consumed' }).eq('nonce', nonce)
  const tokenHash = await mintSessionToken(service, syntheticEmail('telegram', String(tgId)))
  return { status: 'confirmed', tokenHash }
})
