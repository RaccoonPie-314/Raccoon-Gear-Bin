/**
 * identity v2 pure helpers — task A2 of plans/004 (SPEC-identity.md amendment, 2026-10-05).
 *
 * Dependency-free on purpose (the payway convention): no `~` imports, no Nuxt globals, so the
 * unit suite imports it relatively and runs under plain `bun test`. Everything that decides what
 * a code or a nonce IS lives here; the routes only wire it to the database and Clerk. The
 * synthetic-email helpers died with Supabase — Clerk's sign-in tokens need no email, so phone
 * and Telegram accounts carry nothing but their alias username and the profile row.
 */

/** Crockford-style base32: no I, L, O, U — the letters a human misreads in a code they retype. */
export const LOGIN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const LOGIN_CODE_LENGTH = 12

/** How long a generated login code works (owner decision 2026-10-05: two weeks). */
export const LOGIN_CODE_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** The deep-link handshake window: long enough to open Telegram, short enough to not linger. */
export const TELEGRAM_REQUEST_TTL_MS = 10 * 60 * 1000

/**
 * Cambodia writes the same mobile number five ways. Strip the separators people type, accept the
 * three leadings (`0…`, `855…`, `+855…`), and return E.164 — the canonical shape the alias
 * username and `profiles.phone` are derived from.
 * A second leading zero (`+855012…` / `0012…`) is the classic typo: reject rather than guess.
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, '')
  const match = /^(?:\+?855|0)(\d{8,9})$/.exec(cleaned)
  const digits = match?.[1]
  if (!digits || digits.startsWith('0')) return null
  return `+855${digits}`
}

/**
 * 12 chars from the reduced alphabet. 32 divides 256 evenly, so masking a random byte carries no
 * modulo bias — no rejection loop needed.
 */
export function generateLoginCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LOGIN_CODE_LENGTH))
  let code = ''
  for (const byte of bytes) code += LOGIN_CODE_ALPHABET[byte & 31]
  return code
}

/** `XXXX-XXXX-XXXX` for display and copying; `normalizeCodeInput` undoes it. */
export function formatLoginCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

/**
 * Undo whatever the buyer typed: case, separators, and the two misreads the reduced alphabet
 * invites (O→0, I/L→1). Returns the canonical 12-char code, or null — the caller answers one
 * uniform `BAD_FORMAT` either way.
 */
export function normalizeCodeInput(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (cleaned.length !== LOGIN_CODE_LENGTH) return null
  for (const ch of cleaned) {
    if (!LOGIN_CODE_ALPHABET.includes(ch)) return null
  }
  return cleaned
}

/** sha256 hex — the only form of a login code that is ever stored. */
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 24 random bytes → 32-char base64url. Sized for Telegram's `/start` payload (64 chars; the
 * `lg_` prefix leaves plenty) and for a bearer nothing can guess.
 */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/**
 * Fixed-length digest comparison without an early exit. Length mismatch answers immediately on
 * purpose — both sides here are always 64-char sha256 hex, so the branch never leaks a secret.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
