/**
 * `GET /api/orders` — the admin desk's list: every row the claims policy grants (a customer's own
 * rows, an admin's whole desk), newest first. The buyer pages never call this one — they use the
 * self-scoped `/api/orders/mine`, so an admin's own account does not list the shop.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const sql = appSql(event)
  const [, , rows] = await userTx(sql, userId, [
    sql.query(`${ORDERS_WITH_ITEMS}\norder by o.created_at desc`)
  ])
  return rows ?? []
})
