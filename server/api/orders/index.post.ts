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
  // Request hygiene above the RPC: each order write decrements stock and fires the Telegram push.
  if (!await withinRateLimit(sql, `orders-create:${userId}`, 10, 60)) {
    throw createError({ statusCode: 429, statusMessage: 'THROTTLED' })
  }
  const body = await readBody<{ items?: unknown, delivery?: unknown, locale?: string, payNow?: unknown }>(event)
  try {
    // `orders.user_id` FKs to `profiles(id)`, so a signed-in identity needs a profiles row before
    // an order can reference it. Telegram and phone sign-up mint theirs at auth time; a Clerk
    // OAuth (Google) sign-in has no server hook, so the row was missing and the order INSERT died
    // on the FK — a non-P0001 that the handler below re-throws as a 500, which the checkout maps
    // to the generic "could not be placed". Bootstrap it here on the owner connection so the
    // money path holds for every provider, present or future.
    await sql`insert into public.profiles (id) values (${userId}) on conflict (id) do nothing`

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
        const [order] = await sql`select id, currency, total, payment_status, delivery_name, delivery_phone, delivery_address, delivery_location, delivery_note
          from public.orders where id = ${created.id}`
        const items = await sql`select quantity, name_snapshot as name, sku_snapshot as sku
          from public.order_items where order_id = ${created.id}`
        await sendTelegramMessage(event, chatId, orderTelegramText({
          ...(order as OrderPushInput),
          // The buyer's payment intent rides the push only (never the row — `payment_status` stays
          // the DB's truth until settlement): a pay-now order must not announce itself as Unpaid.
          paying: body?.payNow === true,
          items: items as OrderPushInput['items']
        }))
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
