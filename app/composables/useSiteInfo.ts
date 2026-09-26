import type { Database, Json } from '~/types/database'
import type { SiteInfo, SiteInfoDraft, SiteLocationLabel, SiteSocialLink } from '~/types/site-info'

// The select string must stay an inline literal: supabase-js infers the result type by parsing
// the query text (same rule as PRODUCT_SELECT in useCatalog).
const SITE_INFO_SELECT = 'id, phone, location_url, location_translations, social_links'

type JsonObject = { [key: string]: Json | undefined }

const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null

const asString = (value: Json | undefined): string | null => typeof value === 'string' ? value : null

/**
 * The public site-info data layer: the only place the `site_settings` singleton row is read,
 * and the only place its two jsonb collections are understood. The catalog rule this mirrors
 * (one owner per data domain) is why a page must not `.from('site_settings')` directly.
 *
 * Two views of the same row, deliberately separate:
 * - `fetchSiteInfo` is the public model — the location label resolved to the current locale
 *   and disabled social links already dropped.
 * - `fetchSiteInfoDraft` is the admin model — every locale and every link, so the editor can
 *   round-trip the stored row without silently dropping what it does not render.
 */
export const useSiteInfo = () => {
  const supabase = useSupabaseClient<Database>()
  const { pickTranslation } = useCatalog()

  const siteInfoQuery = () => supabase.from('site_settings').select(SITE_INFO_SELECT).maybeSingle()

  // Row type derived from the query itself, exactly like useCatalog's rows: dropping a column
  // from the select breaks the mappers at compile time instead of handing a view `undefined`.
  type SiteInfoRow = Exclude<Awaited<ReturnType<typeof siteInfoQuery>>['data'], null>

  const parseLocationLabels = (value: SiteInfoRow['location_translations']): SiteLocationLabel[] => {
    if (!Array.isArray(value)) return []
    const labels: SiteLocationLabel[] = []
    for (const entry of value) {
      const item = asObject(entry)
      const locale = item ? asString(item.locale) : null
      const label = item ? asString(item.label) : null
      if (locale && label) labels.push({ locale, label })
    }
    return labels
  }

  const parseSocialLinks = (value: SiteInfoRow['social_links']): SiteSocialLink[] => {
    if (!Array.isArray(value)) return []
    const links: SiteSocialLink[] = []
    for (const [index, entry] of value.entries()) {
      const item = asObject(entry)
      const platform = item ? asString(item.platform) : null
      const url = item ? asString(item.url) : null
      if (!platform || !url) continue
      links.push({
        platform,
        url,
        enabled: item?.enabled !== false,
        sortOrder: typeof item?.sort_order === 'number' ? item.sort_order : index
      })
    }
    return links.sort((first, second) => first.sortOrder - second.sortOrder)
  }

  const mapSiteInfo = (row: SiteInfoRow): SiteInfo => ({
    phone: row.phone,
    locationLabel: pickTranslation(parseLocationLabels(row.location_translations))?.label || '',
    locationUrl: row.location_url,
    socialLinks: parseSocialLinks(row.social_links).filter((link) => link.enabled)
  })

  const mapSiteInfoDraft = (row: SiteInfoRow): SiteInfoDraft => ({
    id: row.id,
    phone: row.phone,
    locationUrl: row.location_url,
    locationLabels: parseLocationLabels(row.location_translations),
    socialLinks: parseSocialLinks(row.social_links)
  })

  const fetchSiteInfo = async (): Promise<SiteInfo | null> => {
    const { data, error } = await siteInfoQuery()
    if (error) throw error
    return data ? mapSiteInfo(data) : null
  }

  const fetchSiteInfoDraft = async (): Promise<SiteInfoDraft | null> => {
    const { data, error } = await siteInfoQuery()
    if (error) throw error
    return data ? mapSiteInfoDraft(data) : null
  }

  /** Column-facing: the admin editor's locale labels back into the stored [{ locale, label }] shape. */
  const locationLabelsToColumn = (labels: SiteLocationLabel[]): Json => labels
    .filter((entry) => entry.locale && entry.label.trim())
    .map((entry) => ({ locale: entry.locale, label: entry.label.trim() }))

  /** Column-facing: the editor's rows back into [{ platform, url, enabled, sort_order }], with
   * sort_order rewritten from display position so reordering never needs a manual number —
   * which is why the editor's rows do not carry one. */
  const socialLinksToColumn = (links: Array<Omit<SiteSocialLink, 'sortOrder'>>): Json => links
    .filter((link) => link.platform.trim() && link.url.trim())
    .map((link, index) => ({ platform: link.platform.trim().toLowerCase(), url: link.url.trim(), enabled: link.enabled, sort_order: index }))

  return { fetchSiteInfo, fetchSiteInfoDraft, locationLabelsToColumn, socialLinksToColumn }
}
