// View models for the public site info, mirroring how catalog.ts separates presentation
// shapes from the snake_case row shapes. Everything here is produced by `useSiteInfo` only.

/** One entry of the `social_links` jsonb collection. `type`, not `interface`: values of this
 * shape are handed back to the jsonb column on save, which needs the implicit index signature. */
export type SiteSocialLink = {
  platform: string
  url: string
  /** Masthead visibility. */
  enabled: boolean
  /**
   * Offered as a "Contact to Order" channel. A separate setting on purpose: being visible in the
   * header and being a route to the shop about a product are different decisions an owner makes,
   * and a stored row may answer them differently. Rows written before the key existed fall back to
   * `enabled` in `useSiteInfo`, so no shop gains or loses a channel on upgrade.
   */
  contactEnabled: boolean
  sortOrder: number
}

/** One entry of the `location_translations` jsonb collection — the same { locale, … } array
 * shape `pickTranslation` resolves for product and category translations. */
export type SiteLocationLabel = {
  locale: string
  label: string
}

/** Public render model: locale already resolved, each collection already narrowed to what it shows. */
export interface SiteInfo {
  phone: string
  locationLabel: string
  locationUrl: string
  /** What the masthead renders: the links whose `enabled` is true, in stored order. */
  socialLinks: SiteSocialLink[]
  /** What Product → Contact to Order offers: the links whose `contact_enabled` is true. Deliberately
   * a second list rather than a second filter inside a component — the two settings answer different
   * questions, and `useSiteInfo` is the only place the row is understood. */
  contactLinks: SiteSocialLink[]
}

/** Admin editor model: every locale and every link (including disabled ones), so the editor
 * round-trips the stored row without losing anything it does not render. */
export interface SiteInfoDraft {
  id: number
  phone: string
  locationUrl: string
  locationLabels: SiteLocationLabel[]
  socialLinks: SiteSocialLink[]
}
