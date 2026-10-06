import { requireAdmin } from '../../utils/auth-service'

const EDITOR_LOCALE = 'en'

/**
 * `POST /api/admin/products` — the product editor's save, one transaction: the product row (insert
 * or full update), the English translation, and the wholesale rewrite of the image rows. The
 * promotion columns are written only when the client sent them — `promo_price` present means the
 * section was on (values or explicit nulls to clear), absent means the product never had one and
 * this save must not touch those columns.
 *
 * The id arrives from the client for a new product (the editor already mints uuids for storage
 * paths), which is what keeps every statement here independent. Image *uploads* still go from the
 * browser to the legacy bucket — plans/005 P3 moves them to R2; this route owns only the rows.
 * The numeric guards exist because Postgres accepts `NaN` in `numeric` and `NaN >= 0` is true —
 * the CHECK constraints alone would not catch it.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireAdmin(event)
  const body = await readBody<{
    id?: string
    product?: Record<string, unknown>
    translation?: { name?: string, short_description?: string, description?: string, specifications?: unknown }
    images?: string[]
  }>(event)

  const id = String(body?.id ?? '')
  if (!UUID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: 'INVALID_PRODUCT' })

  const product = body?.product ?? {}
  const translation = body?.translation ?? {}
  const categoryId = String(product.category_id ?? '')
  const sku = String(product.sku ?? '').trim()
  const slug = String(product.slug ?? '').trim()
  const name = String(translation.name ?? '').trim()
  if (!UUID_RE.test(categoryId) || !sku || !slug || !name) {
    throw createError({ statusCode: 400, statusMessage: 'INVALID_PRODUCT' })
  }

  const price = Number(product.price)
  const stock = Number(product.stock_quantity)
  const status = String(product.status ?? 'draft')
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
    throw createError({ statusCode: 400, statusMessage: 'INVALID_PRODUCT' })
  }

  const hasPromo = 'promo_price' in product
  const promo = {
    price: product.promo_price == null ? null : Number(product.promo_price),
    label: product.promo_label == null ? null : String(product.promo_label),
    quantity: product.promo_quantity == null ? null : Number(product.promo_quantity),
    startsAt: product.promo_starts_at == null ? null : String(product.promo_starts_at),
    endsAt: product.promo_ends_at == null ? null : String(product.promo_ends_at)
  }
  if (hasPromo && (
    (promo.price !== null && (!Number.isFinite(promo.price) || promo.price < 0))
    || (promo.quantity !== null && (!Number.isInteger(promo.quantity) || promo.quantity <= 0))
  )) {
    throw createError({ statusCode: 400, statusMessage: 'PROMOTION_INVALID' })
  }

  const images = (Array.isArray(body?.images) ? body.images : []).map(String).filter(Boolean)

  const sql = appSql(event)
  const queries = hasPromo
    ? [sql`insert into public.products (id, category_id, sku, slug, price, stock_quantity, status,
        promo_price, promo_label, promo_quantity, promo_starts_at, promo_ends_at)
        values (${id}::uuid, ${categoryId}::uuid, ${sku}, ${slug}, ${price}, ${stock}, ${status},
          ${promo.price}, ${promo.label}, ${promo.quantity}, ${promo.startsAt}::timestamptz, ${promo.endsAt}::timestamptz)
        on conflict (id) do update set category_id = excluded.category_id, sku = excluded.sku,
          slug = excluded.slug, price = excluded.price, stock_quantity = excluded.stock_quantity,
          status = excluded.status, promo_price = excluded.promo_price, promo_label = excluded.promo_label,
          promo_quantity = excluded.promo_quantity, promo_starts_at = excluded.promo_starts_at,
          promo_ends_at = excluded.promo_ends_at`]
    : [sql`insert into public.products (id, category_id, sku, slug, price, stock_quantity, status)
        values (${id}::uuid, ${categoryId}::uuid, ${sku}, ${slug}, ${price}, ${stock}, ${status})
        on conflict (id) do update set category_id = excluded.category_id, sku = excluded.sku,
          slug = excluded.slug, price = excluded.price, stock_quantity = excluded.stock_quantity,
          status = excluded.status`]

  queries.push(sql`insert into public.product_translations (product_id, locale, name, short_description, description, specifications)
    values (${id}::uuid, ${EDITOR_LOCALE}, ${name}, ${String(translation.short_description ?? '')},
      ${String(translation.description ?? '')}, ${JSON.stringify(translation.specifications ?? [])}::jsonb)
    on conflict (product_id, locale) do update set name = excluded.name,
      short_description = excluded.short_description, description = excluded.description,
      specifications = excluded.specifications`)

  queries.push(sql`delete from public.product_images where product_id = ${id}::uuid`)
  if (images.length) {
    const rows = images.map((storage_path, index) => ({ storage_path, sort_order: index }))
    queries.push(sql`insert into public.product_images (product_id, storage_path, sort_order, is_primary)
      select ${id}::uuid, t.storage_path, t.sort_order, t.sort_order = 0
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as t(storage_path text, sort_order integer)`)
  }

  try {
    await userTx(sql, userId, queries)
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === '23514') throw createError({ statusCode: 400, statusMessage: 'PROMOTION_INVALID' })
    if (code === '23505') throw createError({ statusCode: 409, statusMessage: 'DUPLICATE' })
    if (code === '23503') throw createError({ statusCode: 400, statusMessage: 'INVALID_PRODUCT' })
    throw error
  }
  return { id }
})
