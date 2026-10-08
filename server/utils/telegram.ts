import type { H3Event } from 'h3'
import type { NeonQueryFunction } from '@neondatabase/serverless'

/** The storefront's existing bot — order push and the login handshake share it. */
export const TELEGRAM_BOT_USERNAME = 'RGBin_Bot'

/**
 * Outbound Telegram sends go straight to the Bot API from the Worker now — the Vault/pg_net
 * indirection died with the pivot (its only job was keeping the token out of the database). The
 * token is a Worker runtime secret with an empty default; without it the send is skipped with one
 * warning, because a failed courtesy message must never fail a sign-in — and the order push is
 * wrapped by its caller for the same reason (the order is the money path; the push is decoration).
 */
export async function sendTelegramMessage(event: H3Event, chatId: number | string, text: string): Promise<void> {
  const token = (useRuntimeConfig(event) as { telegramBotToken?: string }).telegramBotToken
  if (!token) {
    console.warn('[telegram] send skipped: no bot token configured')
    return
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Telegram rejects bodies over 4096 chars; the SQL trigger clipped at 4000 so the worst case
      // (50 items with long names) still landed readable — the clip rides the send, as it did there.
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) })
    })
    if (!res.ok) console.warn('[telegram] send failed:', res.status)
  } catch (error) {
    console.warn('[telegram] send failed:', error instanceof Error ? error.message : error)
  }
}

export interface OrderPushInput {
  id: string
  currency: string
  total: number | string
  payment_status: string
  /** True when the money arrived online: the settlement push, and (before it) any pay-now intent. */
  paying?: boolean
  delivery_name: string | null
  delivery_phone: string | null
  delivery_address: string | null
  delivery_location: string | null
  delivery_note: string | null
  items: Array<{ quantity: number, name: string, sku: string }>
}

/**
 * The push's input, loaded once for both senders — the creation push and the settlement one. The
 * SELECT shape IS the message's contract, so it lives beside the builder instead of being spelled
 * twice and drifting apart.
 */
export async function orderPushInput(sql: NeonQueryFunction<false, false>, orderId: string): Promise<OrderPushInput> {
  const [order] = await sql`select id, currency, total, payment_status, delivery_name, delivery_phone, delivery_address, delivery_location, delivery_note
    from public.orders where id = ${orderId}`
  const items = await sql`select quantity, name_snapshot as name, sku_snapshot as sku
    from public.order_items where order_id = ${orderId}`
  return { ...(order as Omit<OrderPushInput, 'items'>), items: items as OrderPushInput['items'] }
}

/**
 * The order push's message body — `order_telegram_text`'s TS port (the SQL function retired with
 * the Supabase project; its fixture is the parity test's `tests/unit/order-telegram.test.ts`).
 * Plain text only: no Telegram markup, so buyer-entered text can never break the message. Labelled
 * lines, so the seller's phone reads as a form — the shop calls the phone and a courier follows the
 * location link; both were previously undistinguishable from the address.
 *
 * The money rides TWO lines, and they answer different questions on purpose: `Method:` is how it
 * was paid (online, or the shop's cash-on-delivery default) while `Payment:` is the row's own
 * state. One line carrying both made each answer hide the other — a pay-now order said "Paying
 * online" with no way to see that it was still unpaid, and a settled order said "Paid" with no way
 * to see how it was paid (owner report, 2026-10-08).
 *
 * Two kinds, one body: `new` is the order as placed (the pay-later path, announced immediately),
 * `paid` is the same order re-sent by the settlement door under a "Payment received" header. The
 * pay-now path only ever sends the second one — its buyer is on the gateway when the order row is
 * written, so an "Unpaid" line about money already in flight is stale by the time the seller reads
 * it (owner decision, 2026-10-08). Same body, so nothing the seller needs is lost with the ping.
 */
export function orderTelegramText(order: OrderPushInput, kind: 'new' | 'paid' = 'new'): string {
  const total = Number(order.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const reference = order.id.slice(0, 8).toUpperCase()
  const lines = [
    kind === 'paid'
      ? `Payment received — #${reference}, ${order.currency} ${total}`
      : `New order #${reference} — ${order.currency} ${total}`,
    `Buyer:  ${order.delivery_name ?? '(no name)'} · ${order.delivery_phone ?? '-'}`,
    `Address: ${order.delivery_address ?? '(no address)'}`,
    `Location: ${order.delivery_location ?? '-'}`
  ]
  lines.push(`Method: ${order.paying ? 'Paying online' : 'Pay on delivery'}`)
  lines.push(`Payment: ${order.payment_status === 'paid' ? 'Paid' : order.payment_status === 'refunded' ? 'Refunded' : 'Unpaid'}`)
  if (order.delivery_note) lines.push(`Note: ${order.delivery_note}`)
  lines.push(`Items (${order.items.length}):`)
  lines.push(order.items.length
    ? order.items.map(item => `  ${item.quantity}× ${item.name} [${item.sku}]`).join('\n')
    : '  (no items)')
  return lines.join('\n')
}
