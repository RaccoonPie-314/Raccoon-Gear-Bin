import { requireAdmin } from '../../utils/auth-service'

/**
 * `/api/catalog/category-drafts` — the admin's unfiltered view of the same table: inactive rows
 * included, every locale's name intact. The one admin-scoped catalog read; `requireAdmin` carries
 * the route-layer check the old RLS admin policy used to provide (401 / 403) — the editor behind
 * it is not the boundary.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const sql = appSql(event)
  return await sql`
    select c.id, c.slug, c.sort_order, c.is_active,
      (
        select coalesce(json_agg(json_build_object('locale', t.locale, 'name', t.name)), '[]'::json)
        from public.category_translations t
        where t.category_id = c.id
      ) as category_translations
    from public.categories c
    order by c.sort_order`
})
