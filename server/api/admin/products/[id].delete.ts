import { requireAdmin } from '../../../utils/auth-service'

/**
 * `DELETE /api/admin/products/:id` — the editor's confirmation delete. Translations and image rows
 * go with it (`on delete cascade`); a missing row is a no-op, same as the PostgREST delete was.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id || !UUID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: 'INVALID_ID' })

  const sql = appSql(event)
  await userTx(sql, userId, [sql`delete from public.products where id = ${id}::uuid`])
  return null
})
