import type { SiteSocialLink } from '~/types/site-info'

/** Where a contact row actually goes, and whether the product message travels inside the link. */
export type SocialContactLink = {
  href: string
  /** True when this href carries the message itself, because the platform documents a prefill. */
  prefilled: boolean
}

const encode = (value: string) => encodeURIComponent(value)

/**
 * Which stored contact link can carry the product message on its own.
 *
 * The rule for everything not listed below — Facebook and Messenger, Instagram, TikTok, and any
 * platform the shop adds later — is that the stored destination opens unchanged and the message
 * stays available through the panel's explicit Copy action. That is not timidity: none of them
 * documents a public web parameter for a prefilled DM, and guessing one does not fail loudly. It
 * opens a chat with an empty box, which is worse than not trying, and it is precisely how a
 * "we copied your message" claim becomes a lie. So a stored URL is never rewritten into a compose
 * URL, and the only numbers ever placed into a documented parameter come from the shop's own
 * configured identity.
 */
export const socialContactLink = (
  link: SiteSocialLink,
  context: { phone: string, message: string, productUrl: string }
): SocialContactLink => {
  const stored = link.url.trim()
  const platform = link.platform.toLowerCase().replace(/[^a-z0-9]/g, '')
  const text = encode(context.message)

  if (platform === 'whatsapp') {
    // WhatsApp's click-to-chat form is `https://wa.me/<number>?text=<urlencoded>`, where the number
    // is international format without `+`, spaces or punctuation. The shop's own identity is taken
    // from its stored `wa.me` link when it has one, and otherwise from the configured phone. With
    // neither, there is no number to address, so the stored link opens as stored and prefills nothing.
    const number = whatsappNumber(stored, context.phone)
    if (number) return { href: `https://wa.me/${number}?text=${text}`, prefilled: true }
    return { href: stored, prefilled: false }
  }

  if (platform === 'telegram') {
    const first = telegramFirstSegment(stored)
    // Two documented forms of the same idea: `t.me/<username>?text=` and `t.me/+<phone>?text=`
    // open a draft to that chat with the text already in the composer.
    if (first && TELEGRAM_PHONE.test(first)) return { href: `https://t.me/${first}?text=${text}`, prefilled: true }
    if (first && TELEGRAM_USERNAME.test(first) && !TELEGRAM_RESERVED.has(first.toLowerCase())) {
      return { href: `https://t.me/${first}?text=${text}`, prefilled: true }
    }
    // A stored `t.me/share/…` link is already a compose endpoint, so filling in its documented
    // `url` and `text` parameters keeps the destination and adds the message.
    if (first && first.toLowerCase() === 'share') {
      return { href: `https://t.me/share/url?url=${encode(context.productUrl)}&text=${text}`, prefilled: true }
    }
    // An invite, a saved-message link, anything unrecognised: it stays where it pointed.
    return { href: stored, prefilled: false }
  }

  return { href: stored, prefilled: false }
}

// Telegram's own username syntax: 5–32 characters, a letter first, then letters, digits and
// underscores. Anything that is not a username is not a chat to draft a message to.
const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/
const TELEGRAM_PHONE = /^\+\d{6,20}$/
// `t.me/<word>` is ambiguous: these first segments are Telegram's own feature paths, not accounts.
const TELEGRAM_RESERVED = new Set([
  'share', 'msg', 's', 'joinchat', 'addstickers', 'addtheme', 'addlist', 'addemoji', 'addstatusemoji',
  'proxy', 'iv', 'login', 'setlanguage', 'boost', 'invoice', 'gift', 'premium', 'biz', 'confirmphone',
  'wallet', 'background', 'switch', 'startapp', 'resolve'
])

/** The first path segment of a `t.me` URL, or `null` when the URL is not on Telegram's host. */
const telegramFirstSegment = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 't.me' && !parsed.hostname.endsWith('.t.me')) return null
    return parsed.pathname.split('/').filter(Boolean)[0] ?? null
  } catch {
    return null
  }
}

/** The digits `wa.me` wants, from the shop's stored WhatsApp link or its configured phone. */
const whatsappNumber = (storedUrl: string, phone: string): string => {
  try {
    const parsed = new URL(storedUrl)
    if (parsed.hostname === 'wa.me' || parsed.hostname === 'api.whatsapp.com') {
      const digits = parsed.pathname.replace(/\D/g, '')
      if (digits) return digits
    }
  } catch { /* not a URL the browser will parse — fall through to the configured phone */ }
  return phone.replace(/\D/g, '')
}
