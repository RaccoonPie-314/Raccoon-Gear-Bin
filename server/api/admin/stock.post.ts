import { requireAdmin } from '../../utils/auth-service'

/** `integer`'s own ceiling — anything above it would be rejected by the column anyway. */
const MAX_STOCK = 2147483647

/**
 * `POST /api/admin/stock` — the stock desk's save: absolute quantities for the rows the owner
 * actually changed, applied in one transaction through the claims path (the same boundary the
 * product editor writes through). The guards exist for the same reason `products.post.ts` carries
 * its numeric ones — Postgres accepts a `NaN` in numeric positions, and a negative or fractional
 * number is the client's own slip, not a SQLSTATE a route should have to translate. Only numbers
 * pass: a JSON `null` or a string is a payload this route never produces, so it is refused.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireAdmin(event)
  const body = await readBody<{ items?: Array<{ id?: unknown, stock_quantity?: unknown }> }>(event)

  const items = (Array.isArray(body?.items) ? body.items : []).map(item => ({
    id: String(item?.id ?? ''),
    stock: typeof item?.stock_quantity === 'number' ? item.stock_quantity : Number.NaN
  }))
  if (!items.length || items.some(item =>
    !UUID_RE.test(item.id) || !Number.isInteger(item.stock) || item.stock < 0 || item.stock > MAX_STOCK)) {
    throw createError({ statusCode: 400, statusMessage: 'INVALID_STOCK' })
  }

  const sql = appSql(event)
  await userTx(sql, userId, [
    sql`update public.products p set stock_quantity = t.stock
      from jsonb_to_recordset(${JSON.stringify(items)}::jsonb) as t(id uuid, stock integer)
      where p.id = t.id`
  ])
  return { updated: items.length }
})
