/**
 * `PATCH /api/profile` — the account page's save. Upsert on purpose: email accounts are created
 * client-side by Clerk (no server route runs for them), so this write is where their profile row
 * first exists — the 0002 migration's insert-own policy is what lets the claims path do it. The
 * response is the stored row, so the page reads back exactly what was written.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const body = await readBody<{ displayName?: string | null, phone?: string | null }>(event)
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() || null : null
  const phone = typeof body?.phone === 'string' ? body.phone.trim() || null : null

  const sql = appSql(event)
  const [, , rows] = await userTx(sql, userId, [
    sql`insert into public.profiles (id, display_name, phone) values (${userId}, ${displayName}, ${phone})
      on conflict (id) do update set display_name = excluded.display_name, phone = excluded.phone
      returning id, display_name, phone`
  ])
  return (rows as unknown[])[0] ?? null
})
