/**
 * `GET /api/admin-check` — the one bit `admin-auth.global.ts` needs: is the caller on the admin
 * allowlist? The browser has no read path to `admin_users` anymore (the old policy is SQL-side
 * only), so the guard asks this route and nothing else. A signed-out caller is simply `false` —
 * the guard turns that into the /admin/login redirect either way.
 */
export default defineEventHandler(async (event) => {
  const userId = currentUserId(event)
  if (!userId) return { admin: false }
  const sql = appSql(event)
  const [row] = await sql`select 1 from public.admin_users where user_id = ${userId} limit 1`
  return { admin: !!row }
})
