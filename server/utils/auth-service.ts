import type { NeonQueryFunction } from '@neondatabase/serverless'
import { createError, getHeader, type H3Event } from 'h3'
import { appSql } from './db'

/**
 * Identity's server-side helpers (SPEC-identity.md amendment). The Supabase service-client and
 * the magiclink mint died with the pivot; what remains is the shared bookkeeping: request
 * hygiene for the anonymous routes and the signed-in user's id. Owner-context database work
 * imports `appSql` directly — there is no second client anymore.
 */

/** The IP a Cloudflare Worker sees; `unknown` still throttles, just as one shared bucket. */
export function clientIp(event: H3Event): string {
  const cf = getHeader(event, 'cf-connecting-ip')
  if (cf) return cf
  const fwd = getHeader(event, 'x-forwarded-for')
  return fwd ? (fwd.split(',')[0] ?? 'unknown').trim() : 'unknown'
}

/** The signed-in Clerk user's id, or null. No session and an unreadable one are the same answer. */
export function currentUserId(event: H3Event): string | null {
  try {
    return event.context.auth().userId ?? null
  } catch {
    return null
  }
}

/**
 * The signed-in gate every non-admin route opens with: the caller's id, or the 401 its client
 * already maps. `currentUserId` reads an unreadable session as signed-out, so every route answers
 * the one machine code instead of three spellings of it.
 */
export function requireUser(event: H3Event): string {
  const userId = currentUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: 'AUTH_REQUIRED' })
  return userId
}

/**
 * The admin gate every `/api/admin/**` route runs first: 401 without a session, 403 when the
 * session's user is absent from `admin_users`. It is the clear early answer, not the boundary —
 * the claims-path write that follows still passes through the admin policies.
 */
export async function requireAdmin(event: H3Event): Promise<string> {
  const userId = currentUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: 'AUTH_REQUIRED' })
  const sql = appSql(event)
  const rows = await sql`select 1 from public.admin_users where user_id = ${userId} limit 1`
  if (!rows.length) throw createError({ statusCode: 403, statusMessage: 'NOT_ADMIN' })
  return userId
}

/**
 * Fixed-window bump: true = allowed, false = over the limit for this window. Read-then-write on
 * purpose — ponytail: a concurrent burst can overshoot by its own size; move to a SQL upsert with
 * a `where count < limit` if abuse ever cares. Rows are keyed `<route>:<ip>` and the stale branch
 * resets them.
 */
export async function withinRateLimit(
  sql: NeonQueryFunction<false, false>,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const [row] = await sql`select window_start, count from public.auth_rate_limits where key = ${key}`
  const now = Date.now()
  if (!row || now - new Date(row.window_start).getTime() > windowSeconds * 1000) {
    await sql`insert into public.auth_rate_limits (key, window_start, count)
      values (${key}, now(), 1)
      on conflict (key) do update set window_start = now(), count = 1`
    return true
  }
  if (row.count >= limit) return false
  await sql`update public.auth_rate_limits set count = count + 1 where key = ${key}`
  return true
}
