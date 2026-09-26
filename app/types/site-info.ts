// View models for the public site info, mirroring how catalog.ts separates presentation
// shapes from the snake_case row shapes. Everything here is produced by `useSiteInfo` only.

/** One entry of the `social_links` jsonb collection. `type`, not `interface`: values of this
 * shape are handed back to the jsonb column on save, which needs the implicit index signature. */
export type SiteSocialLink = {
  platform: string
  url: string
  enabled: boolean
  sortOrder: number
}

/** One entry of the `location_translations` jsonb collection — the same { locale, … } array
 * shape `pickTranslation` resolves for product and category translations. */
export type SiteLocationLabel = {
  locale: string
  label: string
}

/** Public render model: locale already resolved, disabled links already dropped. */
export interface SiteInfo {
  phone: string
  locationLabel: string
  locationUrl: string
  socialLinks: SiteSocialLink[]
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
