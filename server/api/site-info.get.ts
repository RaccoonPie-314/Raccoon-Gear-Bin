/**
 * `/api/site-info` — the singleton settings row, exactly the five columns `SITE_INFO_SELECT`
 * asked PostgREST for. Public (the masthead and the product page read it), so it is served from
 * the owner context; a missing row answers `null`, the caller's `maybeSingle` contract again.
 */
export default defineEventHandler(async (event) => {
  const sql = appSql(event)
  const rows = await sql`
    select id, phone, location_url, location_translations, social_links
    from public.site_settings
    where id = 1
    limit 1`
  return rows[0] ?? null
})
