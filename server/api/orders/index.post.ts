/**
 * `POST /api/orders` — the buyer's only order write. Body: `{ items, delivery, locale }`.
 *
 * The `create_order` RPC stays the authority on price, stock, the promo cap and delivery shape;
 * it raises machine codes (P0001), extracted here into the 400's message so the checkout's
 * code → copy map keeps working unread — the route never invents a sentence. Claims path: the
 * RPC reads `app.current_user_id()`, which is why the write runs inside `userTx`.
 */
export default defineEventHandler(async (event) => {
  const userId = requireUser(event)

  const sql = appSql(event)
  const body = await readBody<{ items?: unknown, delivery?: unknown, locale?: string }>(event)
  try {
    const [, , rows] = await userTx(sql, userId, [
      sql`select public.create_order(
        ${JSON.stringify(body?.items ?? [])}::jsonb,
        ${JSON.stringify(body?.delivery ?? {})}::jsonb,
        ${String(body?.locale || 'en')}
      ) as id`
    ])
    const created = (rows as { id: string }[])[0]
    if (!created) throw new Error('create_order returned no row')

    // The order push (order_telegram_text's Worker half — the Supabase trigger + Vault died with
    // the pivot): fire-and-forget AFTER the commit, because the order is the money path and the
    // push is decoration. A missing chat id means the feature is simply not configured.
    try {
      const chatId = (useRuntimeConfig(event) as { telegramChatId?: string }).telegramChatId
      if (chatId) {
        const [order] = await sql`select id, currency, total, delivery_name, delivery_phone, delivery_address, delivery_note
          from public.orders where id = ${created.id}`
        const items = await sql`select quantity, name_snapshot as name, sku_snapshot as sku
          from public.order_items where order_id = ${created.id}`
        await sendTelegramMessage(event, chatId, orderTelegramText({ ...(order as OrderPushInput), items: items as OrderPushInput['items'] }))
      }
    } catch (error) {
      console.warn('[orders] push skipped:', error instanceof Error ? error.message : error)
    }
    return created.id
  } catch (error) {
    // Only the RPC's own refusals carry the machine code (P0001 — every raise in 0001_schema.sql
    // uses it). Anything else — Neon unreachable, a bug in here — must answer 500 and reach the
    // logs instead of masquerading as the buyer's mistake.
    if ((error as { code?: string } | null)?.code !== 'P0001') throw error
    throw createError({ statusCode: 400, message: orderErrorCode(error) })
  }
})
