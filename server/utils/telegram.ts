import type { H3Event } from 'h3'

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
  delivery_name: string | null
  delivery_phone: string | null
  delivery_address: string | null
  delivery_note: string | null
  items: Array<{ quantity: number, name: string, sku: string }>
}

/**
 * The order push's message body — `order_telegram_text`'s TS port (the SQL function retired with
 * the Supabase project; its fixture is the parity test's `tests/unit/order-telegram.test.ts`).
 * Plain text only: no Telegram markup, so buyer-entered text can never break the message.
 */
export function orderTelegramText(order: OrderPushInput): string {
  const total = Number(order.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const items = order.items.length
    ? order.items.map(item => `${item.quantity}× ${item.name} [${item.sku}]`).join('\n')
    : '(no items)'
  const note = order.delivery_note !== null ? `\nNote: ${order.delivery_note}` : ''
  return `New order #${order.id.slice(0, 8).toUpperCase()} — ${order.currency} ${total}\n`
    + `${order.delivery_name ?? '(no name)'} · ${order.delivery_phone ?? '-'}\n`
    + `${order.delivery_address ?? '(no address)'}${note}\n`
    + items
}
