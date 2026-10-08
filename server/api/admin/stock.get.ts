import { requireAdmin } from '../../utils/auth-service'

/**
 * `GET /api/admin/stock` — the stock desk's read: every non-archived product, drafts included,
 * with its English name (sku fallback, the same rule the catalog mapping uses) and how many units
 * have left the shop. `sold` mirrors stock's own movement: every order that is not cancelled
 * counted the product down at `create_order`, and cancelling is the only transition that puts it
 * back — so the two numbers can never disagree about which sales happened.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireAdmin(event)

  const sql = appSql(event)
  const [, , rows] = await userTx(sql, userId, [
    sql`select
      p.id, p.sku, p.status, p.stock_quantity,
      coalesce(t.name, p.sku) as name,
      coalesce((
        select sum(i.quantity) from public.order_items i
        join public.orders o on o.id = i.order_id
        where i.product_id = p.id and o.status <> 'cancelled'
      ), 0)::int as sold
    from public.products p
    left join public.product_translations t on t.product_id = p.id and t.locale = 'en'
    where p.status <> 'archived'
    order by name`
  ])
  return rows ?? []
})
