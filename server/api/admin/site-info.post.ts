import { requireAdmin } from '../../utils/auth-service'

/**
 * `POST /api/admin/site-info` — the Site Info editor's save. An upsert on purpose: the singleton
 * row exists from migration 0001 and this write repairs it if it was ever deleted out of band.
 * The jsonb columns arrive pre-serialized by the editor's own converters (`useSiteInfo` stays the
 * one owner of those shapes) and the claims path means the admin policies are still the boundary.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireAdmin(event)
  const body = await readBody<{ phone?: string, location_url?: string, location_translations?: unknown, social_links?: unknown }>(event)

  const sql = appSql(event)
  await userTx(sql, userId, [
    sql`insert into public.site_settings (id, phone, location_url, location_translations, social_links)
      values (1, ${String(body?.phone ?? '')}, ${String(body?.location_url ?? '')},
        ${JSON.stringify(body?.location_translations ?? [])}::jsonb,
        ${JSON.stringify(body?.social_links ?? [])}::jsonb)
      on conflict (id) do update set
        phone = excluded.phone,
        location_url = excluded.location_url,
        location_translations = excluded.location_translations,
        social_links = excluded.social_links`
  ])
  return null
})
