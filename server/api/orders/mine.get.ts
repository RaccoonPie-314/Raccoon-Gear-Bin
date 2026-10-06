/**
 * `GET /api/orders/mine` — the buyer's own history, newest first. Access alone is not ownership:
 * without the explicit `user_id` predicate an admin's own account would list the whole shop (the
 * policy grants that access), which is the desk's view, not this page's.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const sql = appSql(event)
  const [, , rows] = await userTx(sql, userId, [
    sql.query(`${ORDERS_WITH_ITEMS}\nwhere o.user_id = $1\norder by o.created_at desc`, [userId])
  ])
  return rows ?? []
})
