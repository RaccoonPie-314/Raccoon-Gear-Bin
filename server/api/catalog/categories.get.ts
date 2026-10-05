/**
 * `/api/catalog/categories` — the public category list: active rows only, in the shop's own
 * `sort_order`, each with every locale's name embedded (the client resolves the locale, the same
 * division of labour `fetchCategories` always had).
 */
export default defineEventHandler(async (event) => {
  const sql = appSql(event)
  return await sql`
    select c.id, c.slug,
      (
        select coalesce(json_agg(json_build_object('id', t.id, 'locale', t.locale, 'name', t.name)), '[]'::json)
        from public.category_translations t
        where t.category_id = c.id
      ) as category_translations
    from public.categories c
    where c.is_active = true
    order by c.sort_order`
})
