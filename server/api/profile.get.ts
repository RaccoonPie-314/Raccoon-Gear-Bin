/**
 * `GET /api/profile` — the caller's own profile row, or null. Claims path: the select-own policy
 * in the database is the boundary, and the route does not need a second filter the way orders did
 * (a profile has exactly one owner and no admin branch). A null answer is honest — accounts made
 * outside the phone/Telegram routes (client-side email signups) get their row on first save.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const sql = appSql(event)
  const [, , rows] = await userTx(sql, userId, [
    sql`select id, display_name, phone from public.profiles where id = ${userId}`
  ])
  return (rows as unknown[])[0] ?? null
})
