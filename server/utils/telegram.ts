import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'

/** The storefront's existing bot — order push lives in Postgres; this file adds the inbound half. */
export const TELEGRAM_BOT_USERNAME = 'RGBin_Bot'

/**
 * Courtesy replies from the webhook. The bot token never reaches the Worker: the RPC reads the
 * same Vault secret pg_net's order push uses and queues the request itself (fire-and-forget — a
 * failed courtesy message must never fail a sign-in).
 */
export async function sendTelegramMessage(
  client: SupabaseClient<Database>,
  chatId: number,
  text: string
): Promise<void> {
  const { error } = await client.rpc('telegram_send_message', { p_chat_id: chatId, p_text: text })
  // A failed courtesy message must never fail a sign-in — but silence hid a missing RPC once;
  // one warning line is the diagnosability this feature can afford.
  if (error) console.warn('[telegram] courtesy send skipped:', error.message)
}
