/**
 * `POST /api/orders/:id/refund` — the desk's refund marker, and the only caller of
 * `mark_payment_refunded`. Body: `{ note? }`.
 *
 * The RPC is the boundary, not this route: it re-checks admin in SQL (`NOT_ADMIN`) and guards both
 * of its updates on `status = 'paid'`, so a double-click is a no-op rather than a second refund.
 * The money itself moves in the ABA merchant portal — recording it here is what the marker is for
 * (SPEC-payments.md criterion 5, v1 decision: no refund API integration).
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const id = getRouterParam(event, 'id')
  if (!id || !UUID_RE.test(id)) throw createError({ statusCode: 400, message: 'ORDER_NOT_FOUND' })

  const body = await readBody<{ note?: string | null }>(event)
  const sql = appSql(event)
  try {
    await userTx(sql, userId, [
      sql`select public.mark_payment_refunded(${id}::uuid, ${body?.note == null ? null : String(body.note)})`
    ])
    return null
  } catch (error) {
    // The same split the status route makes: only the RPC's own refusals carry P0001 (every raise
    // in 0001_schema.sql uses it), and anything else must reach the logs as a 500 instead of
    // masquerading as the admin's mistake.
    if ((error as { code?: string } | null)?.code !== 'P0001') throw error
    throw createError({ statusCode: 400, message: orderErrorCode(error) })
  }
})
