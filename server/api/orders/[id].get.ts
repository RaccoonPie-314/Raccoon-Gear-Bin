/**
 * `GET /api/orders/:id` — one order, the caller's own only. The `user_id` predicate is explicit
 * for the reason the list is: an admin's policy access must not turn their account pages into the
 * desk. A missing (or malformed) id answers `null`, the caller's `maybeSingle` contract.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const id = getRouterParam(event, 'id')
  if (!id || !UUID_RE.test(id)) return null

  const sql = appSql(event)
  const [, , rows] = await userTx(sql, userId, [
    sql.query(`${ORDERS_WITH_ITEMS}\nwhere o.id = $1 and o.user_id = $2\nlimit 1`, [id, userId])
  ])
  return (rows as unknown[])[0] ?? null
})
