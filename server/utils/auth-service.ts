import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createError, getHeader, type H3Event } from 'h3'
import { serverSupabaseUser } from '#supabase/server'
import type { Database } from '~/types/database'

/**
 * The confined service tier for identity v2 — SPEC-identity.md amendment (2026-10-05); the
 * SPEC-payments.md "Secrets and runtime config" section is the confinement precedent.
 *
 * Rules this file exists to hold in one place: the service key never leaves the server, never
 * gets logged, and the client is per-flight with session persistence OFF (a Worker isolate is
 * shared across requests — a persisted session would leak between them). Only the /api/auth/**
 * routes and /api/telegram/webhook may import from here.
 */
export function createServiceClient(event: H3Event): SupabaseClient<Database> {
  const config = useRuntimeConfig(event)
  const url = config.public.supabaseUrl
  const key = config.supabaseServiceRoleKey
  if (!url || !key) throw new Error('AUTH_SERVICE_MISCONFIGURED')
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** The IP a Cloudflare Worker sees; `unknown` still throttles, just as one shared bucket. */
export function clientIp(event: H3Event): string {
  const cf = getHeader(event, 'cf-connecting-ip')
  if (cf) return cf
  const fwd = getHeader(event, 'x-forwarded-for')
  return fwd ? (fwd.split(',')[0] ?? 'unknown').trim() : 'unknown'
}

/**
 * The signed-in user's id, or null. `serverSupabaseUser` returns JWT *claims* — the id lives in
 * `sub` (the same trap the client guard documents) — and throws on an unreadable token, which is
 * just "no session" for every caller here.
 */
export async function currentUserId(event: H3Event): Promise<string | null> {
  try {
    const claims = await serverSupabaseUser(event)
    return typeof claims?.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

/**
 * Mints the one-time token the browser redeems with `verifyOtp({ token_hash, type: 'magiclink' })`.
 * `generateLink` only generates — it never sends mail (the synthetic addresses stay unreachable by
 * design). Shared by the code-login and Telegram flows; this is the whole session-mint surface.
 */
export async function mintSessionToken(client: SupabaseClient<Database>, email: string): Promise<string> {
  const { data, error } = await client.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = data?.properties?.hashed_token
  if (error || !tokenHash) throw createError({ statusCode: 502, statusMessage: 'AUTH_UPSTREAM' })
  return tokenHash
}

/**
 * Fixed-window bump: true = allowed, false = over the limit for this window. Read-then-write on
 * purpose — ponytail: a concurrent burst can overshoot by its own size; move to a SQL upsert if
 * abuse ever cares. Rows are keyed `<route>:<ip>` and reset themselves when stale (upsert).
 */
export async function withinRateLimit(
  client: SupabaseClient<Database>,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const now = Date.now()
  const { data } = await client
    .from('auth_rate_limits')
    .select('window_start, count')
    .eq('key', key)
    .maybeSingle()

  if (!data || now - new Date(data.window_start).getTime() > windowSeconds * 1000) {
    await client.from('auth_rate_limits').upsert({ key, window_start: new Date(now).toISOString(), count: 1 })
    return true
  }
  if (data.count >= limit) return false
  await client.from('auth_rate_limits').update({ count: data.count + 1 }).eq('key', key)
  return true
}
