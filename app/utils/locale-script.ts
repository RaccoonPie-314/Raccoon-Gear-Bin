const KHMER = /[\u1780-\u17FF]/

/**
 * Does this string render Khmer script?
 *
 * `locale === 'km'` is not the same question and cannot be substituted for it. A product or category
 * name comes from whichever translation row `pickTranslation` resolved (current locale → `en` → first
 * available), so on the English route a Khmer-only row prints Khmer through the Latin-tracking branch
 * of every locale-conditional eyebrow. Wide Latin letter-spacing pulls a Khmer cluster apart — the
 * marks sit above and below the base letter — so the guard has to read what actually rendered.
 *
 * Plain function, not a composable: this is neither reactive state nor a browser capability, and it
 * answers a question about a string handed to it.
 */
export function hasKhmerText(value: unknown): boolean {
  return typeof value === 'string' && KHMER.test(value)
}
