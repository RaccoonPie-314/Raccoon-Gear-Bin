/**
 * `POST /api/orders/:id/status` — the desk's single transition door. `set_order_status` re-checks
 * admin and legality in SQL, so this route only carries the call; a refusal's machine code
 * (NOT_ADMIN, INVALID_TRANSITION, ORDER_NOT_FOUND) rides a 400 the same way the create route's
 * does. Body: `{ status, note? }` — the note belongs to the cancel arm alone.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const id = getRouterParam(event, 'id')
  if (!id || !UUID_RE.test(id)) throw createError({ statusCode: 400, message: 'ORDER_NOT_FOUND' })

  const body = await readBody<{ status?: string, note?: string | null }>(event)
  const sql = appSql(event)
  try {
    await userTx(sql, userId, [
      sql`select public.set_order_status(${id}::uuid, ${String(body?.status || '')}, ${body?.note == null ? null : String(body.note)})`
    ])
    return null
  } catch (error) {
    // Only the RPC's own refusals carry the machine code (P0001 — every raise in 0001_schema.sql
    // uses it). Anything else — Neon unreachable, a bug in here — must answer 500 and reach the
    // logs instead of masquerading as the buyer's mistake.
    if ((error as { code?: string } | null)?.code !== 'P0001') throw error
    throw createError({ statusCode: 400, message: orderErrorCode(error) })
  }
})
