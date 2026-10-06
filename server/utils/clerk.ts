import { clerkClient } from '@clerk/nuxt/server'
import type { H3Event } from 'h3'

// @clerk/nuxt ships its own nested h3 copy, so `clerkClient(event)` is typed against THAT copy
// while our routes pass the app's h3 event — the same runtime object (the client only reads
// runtime config off it), two type identities. One cast at this boundary, documented, beats three
// at the call sites; drop it when @clerk/nuxt stops bundling h3.
type ClerkEvent = Parameters<typeof clerkClient>[0]
const forClerk = (event: H3Event): ClerkEvent => event as unknown as ClerkEvent

/**
 * The Clerk backend surface identity's routes need — three calls, all confined here so the
 * username-alias mapping lives in one place. P0-proven: Clerk rejects +855 identifiers, so the
 * phone rides a `p<e164-digits>` username and the real number lives in `profiles.phone`; the
 * buyer-facing screens never mention the alias.
 */
export const phoneUsername = (e164: string): string => `p${e164.replace('+', '')}`
export const telegramUsername = (tgId: number): string => `tg${tgId}`

/**
 * Creates the username-keyed account and answers its Clerk id. The caller owns error mapping
 * (409 on a duplicate username). Telegram accounts get a thrown-away random password: the
 * instance requires one at creation, nothing can guess it, and the account only ever enters
 * through the Telegram/code mint.
 */
export async function createAliasUser(event: H3Event, username: string, password: string): Promise<string> {
  const user = await clerkClient(forClerk(event)).users.createUser({ username, password })
  return user.id
}

export const randomPassword = (): string => `${crypto.randomUUID()}${crypto.randomUUID()}`

/** Looks the deterministic alias up after a crashed create — the heal half of resolveTelegramUser. */
export async function findAliasUser(event: H3Event, username: string): Promise<string | null> {
  const { data } = await clerkClient(forClerk(event)).users.getUserList({ username: [username] })
  return data.find(user => user.username === username)?.id ?? null
}

/**
 * The one session-mint surface for Telegram login and login codes (the P0-pinned shape): a
 * sign-in token, returned as BOTH its raw ticket and its hosted URL. The browser completes the
 * ticket in-page — `signIn.create({ strategy: 'ticket' })` establishes the session on the app
 * origin exactly like a password sign-in — and only falls back to the hosted URL if that fails;
 * the hosted page's cross-domain dev-browser hop was observed burning tickets without creating
 * sessions in some browsers (2026-10-06). 30 days, the owner's session decision.
 */
export async function createSignInTicket(event: H3Event, userId: string): Promise<{ ticket: string, url: string }> {
  const token = await clerkClient(forClerk(event)).signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 30 * 24 * 60 * 60
  })
  return { ticket: token.token, url: token.url }
}
