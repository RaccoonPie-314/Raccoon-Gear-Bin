/**
 * `POST /api/orders` — the buyer's only order write. Body: `{ items, delivery, locale, payNow }`.
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
    //
    // A PAY-NOW order is deliberately silent here (owner decision, 2026-10-08): its buyer is on
    // the gateway at this moment, so a "Paying online / Unpaid" ping is stale before the seller
    // reads it — the message waits for the result and goes out from `notifyPaymentReceived`,
    // carrying this same body with `Payment: Paid`. An abandoned attempt therefore sends nothing
    // at all; the desk's pending queue is where it stays visible. Pay-later announces here, as it
    // always has: nothing external has to happen before the shop can act on it.
    try {
      const chatId = (useRuntimeConfig(event) as { telegramChatId?: string }).telegramChatId
      if (chatId && body?.payNow !== true) {
        await sendTelegramMessage(event, chatId, orderTelegramText(await orderPushInput(sql, created.id)))
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
