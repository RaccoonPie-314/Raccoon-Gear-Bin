import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { H3Event } from 'h3'

/**
 * The data layer's two contexts (SPEC-pivot plan 005, P0-proven):
 *
 * - `appSql(event)` — the owner connection. System operations only: profile creation, login
 *   codes, telegram handshakes, rate limits, admin seeds. RLS is bypassed here by ownership.
 * - `userTx(sql, userId, queries)` — the claims path. One transaction per request: set the claim,
 *   switch to the non-owner role so the policies actually filter, run the queries. Everything a
 *   signed-in user's data touches goes through here, so a route bug that forgets a WHERE still
 *   cannot read another user's rows.
 */
const clients = new Map<string, NeonQueryFunction<false, false>>()

export function appSql(event: H3Event): NeonQueryFunction<false, false> {
  // The app-side tsconfig does not carry server-only runtime keys; the server tsconfig does.
  const url = (useRuntimeConfig(event) as { databaseUrl?: string }).databaseUrl
  if (!url) throw new Error('DATABASE_URL_MISSING')
  let client = clients.get(url)
  if (!client) {
    client = neon(url)
    clients.set(url, client)
  }
  return client
}

export function userTx(
  sql: NeonQueryFunction<false, false>,
  userId: string,
  // `any[]` is the honest shape here: these are Neon tagged-template fragments whose type is not
  // exported. The `no-explicit-any` rule is off in eslint.config.mjs, so the disable directive that
  // used to sit here was stale — and now that `server/` is linted, a stale one is a failure signal.
  queries: any[]
): Promise<unknown[]> {
  return sql.transaction([
    sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`,
    sql`set local role app_authenticated`,
    ...queries
  ])
}
