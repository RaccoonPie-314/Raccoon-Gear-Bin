/**
 * Copy text, and report only what actually happened.
 *
 * Three ways a copy can lie, all of them silent: `navigator.clipboard` does not exist outside a
 * secure context, `writeText()` rejects when the document loses focus or the permission is
 * denied, and awaiting something that is not a promise resolves immediately. Each of those used
 * to end in "Message copied." while the clipboard still held whatever the visitor put there last.
 *
 * So availability is verified before anything is awaited, the write itself is awaited, and the
 * result is only reported as success when that promise fulfils. Callers turn `false` into the
 * failure they already have words for — no third-party clipboard dependency, no toast system.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false
  const clipboard = globalThis.navigator?.clipboard
  if (!clipboard || typeof clipboard.writeText !== 'function') return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
