import type { Json, SiteSettingsRow } from '~/types/database'
import type { SiteInfo, SiteInfoDraft, SiteLocationLabel, SiteSocialLink } from '~/types/site-info'

// The row `/api/site-info` answers with — the same five columns `SITE_INFO_SELECT` used to ask
// PostgREST for, hand-written now that the query lives on the server (server/api/site-info.get.ts;
// the two must move together).
type SiteInfoRow = Pick<SiteSettingsRow, 'id' | 'phone' | 'location_url' | 'location_translations' | 'social_links'>

type JsonObject = { [key: string]: Json | undefined }

const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null

const asString = (value: Json | undefined): string | null => typeof value === 'string' ? value : null

/**
 * The stored destination, but only when it is an http(s) URL — otherwise `null`.
 *
 * Both public views bind this text straight to `href`, and Vue assigns an `href` without filtering
 * its scheme, so a `javascript:` or `data:` value typed into the admin editor would run as the
 * visitor who clicked it. This is a scheme allowlist on the public read, not a rewrite: a
 * destination the site cannot link to is absent rather than re-aimed.
 */
const httpUrl = (value: string): string | null => {
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

/**
 * The public site-info data layer: the only place the `site_settings` singleton row is read,
 * and the only place its two jsonb collections are understood. The catalog rule this mirrors
 * (one owner per data domain) is why a page must not `.from('site_settings')` directly.
 *
 * Two views of the same row, deliberately separate:
 * - `fetchSiteInfo` is the public model — the location label resolved to the current locale, and
 *   the link collection narrowed twice over, once for the masthead (`socialLinks`) and once for
 *   the product page's contact channels (`contactLinks`).
 * - `fetchSiteInfoDraft` is the admin model — every locale and every link, so the editor can
 *   round-trip the stored row without silently dropping what it does not render.
 */
export const useSiteInfo = () => {
  const { pickTranslation } = useCatalog()

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
        // A row written before `contact_enabled` existed inherits `enabled` rather than becoming
        // contactable: the product page used to borrow the masthead's list, so inheriting keeps every
        // live shop's channel set exactly as it was. An explicit boolean always wins.
        contactEnabled: typeof item?.contact_enabled === 'boolean'
          ? item.contact_enabled
          : item?.enabled !== false,
        sortOrder: typeof item?.sort_order === 'number' ? item.sort_order : index
      })
    }
    return links.sort((first, second) => first.sortOrder - second.sortOrder)
  }

  // One parse, two narrowed lists: the settings are independent, so neither consumer may borrow the
  // other's filter. Doing it here is what lets `useProductContact` ask for `contactLinks` without
  // ever learning that a jsonb column or an `enabled` key exists.
  // The scheme allowlist and this enabled/contact split belong to the public model only:
  // `mapSiteInfoDraft` keeps every stored row, so the editor can still show a destination this view
  // refuses to link to and the shop can repair it.
  const mapSiteInfo = (row: SiteInfoRow): SiteInfo => {
    const links = parseSocialLinks(row.social_links).filter((link) => httpUrl(link.url))
    return {
      phone: row.phone,
      locationLabel: pickTranslation(parseLocationLabels(row.location_translations))?.label || '',
      locationUrl: httpUrl(row.location_url) ?? '',
      socialLinks: links.filter((link) => link.enabled),
      contactLinks: links.filter((link) => link.contactEnabled)
    }
  }

  const mapSiteInfoDraft = (row: SiteInfoRow): SiteInfoDraft => ({
    id: row.id,
    phone: row.phone,
    locationUrl: row.location_url,
    locationLabels: parseLocationLabels(row.location_translations),
    socialLinks: parseSocialLinks(row.social_links)
  })

  // The same shape as the catalog's public view: keep the row, resolve the label per read. The
  // masthead's location label is locale-resolved jsonb, so a locale switch that does not refetch has
  // to re-resolve it here or the header would keep naming the place in the language the visitor just
  // left. `fetchSiteInfo` still writes through on every real load, so nothing is served stale.
  const rawSiteRow = useState<SiteInfoRow | null>('site:row', () => null)
  const siteInfo = computed(() => (rawSiteRow.value ? mapSiteInfo(rawSiteRow.value) : null))

  const fetchSiteInfo = async (): Promise<SiteInfo | null> => {
    const data = await $fetch<SiteInfoRow | null>('/api/site-info')
    rawSiteRow.value = data ?? null
    return siteInfo.value
  }

  const fetchSiteInfoDraft = async (): Promise<SiteInfoDraft | null> => {
    const data = await $fetch<SiteInfoRow | null>('/api/site-info')
    return data ? mapSiteInfoDraft(data) : null
  }

  /** Column-facing: the admin editor's locale labels back into the stored [{ locale, label }] shape. */
  const locationLabelsToColumn = (labels: SiteLocationLabel[]): Json => labels
    .filter((entry) => entry.locale && entry.label.trim())
    .map((entry) => ({ locale: entry.locale, label: entry.label.trim() }))

  /** Column-facing: the editor's rows back into [{ platform, url, enabled, contact_enabled,
   * sort_order }], with sort_order rewritten from display position so reordering never needs a
   * manual number — which is why the editor's rows do not carry one. Both visibility flags are
   * always written explicitly, so a row saved by the current editor no longer depends on the
   * inheritance rule above. */
  const socialLinksToColumn = (links: Array<Omit<SiteSocialLink, 'sortOrder'>>): Json => links
    .filter((link) => link.platform.trim() && link.url.trim())
    .map((link, index) => ({ platform: link.platform.trim().toLowerCase(), url: link.url.trim(), enabled: link.enabled, contact_enabled: link.contactEnabled, sort_order: index }))

  return { fetchSiteInfo, fetchSiteInfoDraft, locationLabelsToColumn, socialLinksToColumn, siteInfo }
}
