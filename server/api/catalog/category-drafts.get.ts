/**
 * `/api/catalog/category-drafts` — the admin's unfiltered view of the same table: inactive rows
 * included, every locale's name intact. The one admin-scoped catalog read, so it carries the
 * route-layer check the old RLS admin policy used to provide: signed out answers 401, signed in
 * but absent from `admin_users` answers 403 — the editor behind it is not the boundary.
 */
export default defineEventHandler(async (event) => {
  const { userId } = event.context.auth()
  if (!userId) throw createError({ statusCode: 401, message: 'AUTH_REQUIRED' })

  const sql = appSql(event)
  const admin = await sql`select 1 from public.admin_users where user_id = ${userId} limit 1`
  if (!admin.length) throw createError({ statusCode: 403, message: 'NOT_ADMIN' })

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
