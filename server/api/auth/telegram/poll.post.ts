import type { NeonQueryFunction } from '@neondatabase/serverless'
import type { H3Event } from 'h3'
import { createAliasUser, createSignInTicket, findAliasUser, randomPassword, telegramUsername } from '../../../utils/clerk'

const NONCE_RE = /^[A-Za-z0-9_-]{32}$/

/**
 * Resolves the Telegram-keyed account for a confirmed handshake, healing the one partial state a
 * crash can leave (account created, link row missing): the username alias is deterministic, so
 * the second create answers "already exists" and the alias lookup finds the account. A unique
 * violation on the insert means another poll won the race. The profile row is upserted here too —
 * no trigger creates profiles anymore, and without one the account could not place an order.
 */
async function resolveTelegramUser(
  sql: NeonQueryFunction<false, false>,
  event: H3Event,
  tgId: number,
  tgUsername: string | null,
  tgFirstName: string | null
): Promise<string> {
  const lookup = async () => {
    const [row] = await sql`select user_id from public.telegram_links where tg_id = ${tgId}`
    return row?.user_id ?? null
  }

  let userId = await lookup()
  if (userId) return userId

  const username = telegramUsername(tgId)
  try {
    userId = await createAliasUser(event, username, randomPassword())
  } catch (error) {
    const text = String((error as Error)?.message ?? '').toLowerCase()
    if (!/already|exists|taken|unique/.test(text)) {
      throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
    }
    userId = await findAliasUser(event, username)
  }
  if (!userId) throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })

  try {
    await sql`insert into public.telegram_links (tg_id, user_id, tg_username) values (${tgId}, ${userId}, ${tgUsername})`
  } catch (error) {
    if (!/duplicate|unique/i.test(String((error as Error)?.message ?? ''))) {
      throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
    }
    const raced = await lookup()
    if (!raced) throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
    return raced
  }
  if (tgFirstName) {
    await sql`insert into public.profiles (id, display_name) values (${userId}, ${tgFirstName})
      on conflict (id) do update set display_name = excluded.display_name`
  }
  return userId
}

/**
 * Telegram handshake, step 3: the browser asks whether the tap happened yet. Pending stays
 * pending; a confirmed request either links the signed-in account (`mode: 'link'`) or
 * finds-or-creates the Telegram-keyed account and answers the sign-in ticket the browser
 * completes in-page (hosted URL as fallback — the P0-pinned mint, now ticket-first). The request
 * is single-use: the first poll that reaches minting consumes it; every later poll answers
 * `expired`.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { nonce?: unknown } | null
  const nonce = typeof body?.nonce === 'string' && NONCE_RE.test(body.nonce) ? body.nonce : null
  if (!nonce) throw createError({ statusCode: 400, statusMessage: 'BAD_NONCE' })

  const sql = appSql(event)
  const [request] = await sql`select nonce, user_id, status, tg_id, tg_username, tg_first_name, expires_at
    from public.telegram_login_requests where nonce = ${nonce}`

  if (!request || new Date(request.expires_at).getTime() <= Date.now()) return { status: 'expired' }
  if (request.status === 'pending') return { status: 'pending' }
  if (request.status === 'consumed') return { status: 'expired' }

  // status === 'confirmed'
  const tgId = request.tg_id
  if (tgId === null) return { status: 'pending' } // defensive: confirmed implies tg_id

  if (request.user_id) {
    // Link mode: attach the Telegram identity to the account that started the handshake.
    try {
      await sql`insert into public.telegram_links (tg_id, user_id, tg_username)
        values (${tgId}, ${request.user_id}, ${request.tg_username})`
    } catch (error) {
      // A unique violation means this account already has a Telegram link or this Telegram account
      // is linked elsewhere; both surface as 'linked' — the account page shows whatever is true.
      if (!/duplicate|unique/i.test(String((error as Error)?.message ?? ''))) {
        throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
      }
    }
    await sql`update public.telegram_login_requests set status = 'consumed' where nonce = ${nonce}`
    return { status: 'linked' }
  }

  // Login mode: resolve the account, consume the handshake, mint the sign-in material.
  const userId = await resolveTelegramUser(sql, event, tgId, request.tg_username, request.tg_first_name)
  await sql`update public.telegram_login_requests set status = 'consumed' where nonce = ${nonce}`
  const mint = await createSignInTicket(event, userId)
  return { status: 'confirmed', ticket: mint.ticket, signInUrl: mint.url }
})
