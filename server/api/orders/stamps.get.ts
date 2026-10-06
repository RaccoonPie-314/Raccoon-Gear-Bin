/**
 * `GET /api/orders/stamps` — the unseen badge's light read: the caller's own orders, stamp columns
 * only. The heavy embed would be waste for a count, exactly as it was under PostgREST.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const sql = appSql(event)
  const [, , rows] = await userTx(sql, userId, [
    sql.query(`${ORDERS_STAMPS}\nwhere o.user_id = $1`, [userId])
  ])
  return rows ?? []
})
