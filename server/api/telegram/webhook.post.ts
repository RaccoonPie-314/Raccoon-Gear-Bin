import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { constantTimeEqual } from '../../utils/auth'
import { createServiceClient } from '../../utils/auth-service'
import { sendTelegramMessage } from '../../utils/telegram'

const START_RE = /^\/start(?:@\w+)?\s+lg_([A-Za-z0-9_-]{32})$/

interface TelegramUpdate {
  message?: {
    text?: string
    chat?: { id?: number }
    from?: { id?: number, username?: string, first_name?: string }
  }
}

/**
 * Telegram webhook (SPEC-identity.md amendment, capability 2 step 2). Only `/start lg_<nonce>`
 * messages are acted on — the bot's other duty (order push) is outbound and untouched, so every
 * other update is a 200 no-op. The secret header is the only authentication Telegram offers, and
 * it is compared timing-safely. Telegram retries non-2xx, so a bad secret deliberately answers
 * 401 (visible in logs) while everything we accepted answers 200.
 */
export default defineEventHandler(async (event) => {
  const secret = getHeader(event, 'x-telegram-bot-api-secret-token') ?? ''
  const expected = useRuntimeConfig(event).telegramWebhookSecret
  if (!expected || !constantTimeEqual(secret, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'BAD_SECRET' })
  }

  const update = await readBody(event).catch(() => null) as TelegramUpdate | null
  const text = update?.message?.text
  const chatId = update?.message?.chat?.id
  const from = update?.message?.from
  const match = typeof text === 'string' ? START_RE.exec(text.trim()) : null

  if (!match || typeof chatId !== 'number' || typeof from?.id !== 'number') return 'ok'

  const nonce = match[1] ?? ''
  const service = createServiceClient(event)
  const { data: request } = await service
    .from('telegram_login_requests')
    .select('nonce, status, expires_at')
    .eq('nonce', nonce)
    .maybeSingle()

  if (!request || request.status !== 'pending' || new Date(request.expires_at).getTime() <= Date.now()) {
    await sendTelegramMessage(
      service,
      chatId,
      'That sign-in link has expired or was already used. Start again from the website.'
    )
    return 'ok'
  }

  await service.from('telegram_login_requests').update({
    status: 'confirmed',
    tg_id: from.id,
    tg_username: from.username ?? null,
    tg_first_name: from.first_name ?? null
  }).eq('nonce', nonce)

  await sendTelegramMessage(service, chatId, 'You are signed in to Raccoon Gear Bin. Go back to the browser.')
  return 'ok'
})
