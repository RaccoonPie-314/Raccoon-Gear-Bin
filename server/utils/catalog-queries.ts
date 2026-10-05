import type { NeonQueryFunction } from '@neondatabase/serverless'

/**
 * The catalog read SQL — server side, owner context (the route is the boundary now; RLS's public
 * policies serve the claims path, and public reads are role-agnostic by design).
 *
 * The JSON shape is deliberate and load-bearing: one row per product with `product_translations`,
 * `product_images` and `categories` embedded exactly as the old PostgREST selects returned them, so
 * the client mappers in `useCatalog.ts` — written against that shape — stay untouched. The pairing
 * that replaces supabase-js's select-derived types is the hand-written row type in `useCatalog.ts`:
 * if a column here changes, that type must change with it.
 */
const PRODUCT_SELECT = `
select
  p.id, p.category_id, p.slug, p.sku, p.price, p.currency, p.stock_quantity, p.status,
  p.promo_price, p.promo_label, p.promo_quantity, p.promo_starts_at, p.promo_ends_at,
  (
    select coalesce(json_agg(json_build_object(
      'id', t.id, 'locale', t.locale, 'name', t.name,
      'short_description', t.short_description, 'description', t.description,
      'specifications', t.specifications
    )), '[]'::json)
    from public.product_translations t
    where t.product_id = p.id
  ) as product_translations,
  (
    select coalesce(json_agg(json_build_object(
      'id', i.id, 'storage_path', i.storage_path, 'alt_text', i.alt_text, 'sort_order', i.sort_order
    ) order by i.sort_order), '[]'::json)
    from public.product_images i
    where i.product_id = p.id
  ) as product_images,
  case when c.id is null then null else json_build_object(
    'id', c.id, 'slug', c.slug,
    'category_translations', (
      select coalesce(json_agg(json_build_object('id', ct.id, 'locale', ct.locale, 'name', ct.name)), '[]'::json)
      from public.category_translations ct
      where ct.category_id = c.id
    )
  ) end as categories
from public.products p
left join public.categories c on c.id = p.category_id`

/** Every published product, newest first — the list branch of `/api/catalog/products`. */
export const selectPublishedProducts = (sql: NeonQueryFunction<false, false>) =>
  sql.query(`${PRODUCT_SELECT}
where p.status = 'published'
order by p.created_at desc`)

/** One published product, or no rows — the `?id=` branch of `/api/catalog/products`. */
export const selectPublishedProduct = (sql: NeonQueryFunction<false, false>, id: string) =>
  sql.query(`${PRODUCT_SELECT}
where p.status = 'published' and p.id = $1
limit 1`, [id])
