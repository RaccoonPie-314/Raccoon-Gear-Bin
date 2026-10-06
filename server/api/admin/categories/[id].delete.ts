import { requireAdmin } from '../../../utils/auth-service'

/**
 * `DELETE /api/admin/categories/:id` — the row list's trash can. `products.category_id` is
 * `on delete restrict`, so Postgres is what decides whether a category may be forgotten; its
 * refusal (23503) answers 409 CATEGORY_IN_USE, which the editor renders as "products are still
 * filed here" instead of a Postgres sentence.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id || !UUID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: 'INVALID_ID' })

  const sql = appSql(event)
  try {
    await userTx(sql, userId, [sql`delete from public.categories where id = ${id}::uuid`])
  } catch (error) {
    // RESTRICT raises 23001 (restrict_violation), not 23503 — PostgREST used to translate both to
    // a 409 for the old client; this route owns that translation now.
    const code = (error as { code?: string })?.code
    if (code === '23001' || code === '23503') {
      throw createError({ statusCode: 409, statusMessage: 'CATEGORY_IN_USE' })
    }
    throw error
  }
  return null
})
