import { requireUser } from '../../../utils/auth-service'

/**
 * The account page's Telegram card state: whether the caller's account is linked and under which
 * @username. Claims path, own row only — the RLS select-own policy is the boundary, and this is
 * the only client read of `telegram_links` on the new stack.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const sql = appSql(event)
  const [, , rows] = await userTx(sql, userId, [
    sql`select tg_username from public.telegram_links where user_id = ${userId}`
  ])
  const row = (rows as { tg_username: string | null }[])[0]
  return { linked: !!row, username: row?.tg_username ?? null }
})
