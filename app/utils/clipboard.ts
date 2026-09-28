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

/**
 * Select a revealed link the moment it takes focus.
 *
 * This is the manual half of the copy story: when the clipboard refused the write, the page shows the
 * address as read-only text and asks the visitor to copy it themselves. Selecting on focus makes that
 * one keystroke or one click instead of a drag across the string, and it belongs beside the clipboard
 * rule rather than being written twice — the contact row and the Share Sheet both reveal a link.
 */
export const selectOnFocus = (event: FocusEvent) => {
  (event.target as HTMLInputElement | null)?.select()
}
