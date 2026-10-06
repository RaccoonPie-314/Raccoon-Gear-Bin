/**
 * `GET /api/orders/pending` — the desk badge's count. The claims policy scopes it: an admin
 * counts the shop's pending queue, anyone else their own pending orders (which the masthead never
 * asks for as a buyer, but the answer stays honest either way).
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const sql = appSql(event)
  const [, , rows] = await userTx(sql, userId, [
    sql`select count(*)::int as count from public.orders where status = 'pending'`
  ])
  return (rows as { count: number }[])[0]?.count ?? 0
})
