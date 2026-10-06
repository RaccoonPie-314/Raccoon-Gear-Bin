import { requireAdmin } from '../../utils/auth-service'

const LOCALES = ['en', 'km'] as const

type SaveRow = {
  id?: string
  slug?: string
  isActive?: boolean
  names?: Record<string, string>
  namesBefore?: Record<string, string>
}

/**
 * `POST /api/admin/categories` — the Categories page's one save. The whole list arrives in display
 * order (that order IS `sort_order`, one-based) and runs as **one transaction**: the editor used to
 * write row-by-row over PostgREST, where a failure on row five left rows one to four saved. The
 * client generates the uuid for a new row, which is what keeps every statement here independent.
 *
 * Translation semantics mirror the editor's: a name present writes its locale, a name the owner
 * erased deletes the stored row (the drafts' `namesBefore` is what tells "erased" from "never
 * existed"), and locales the editor does not render are never touched.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireAdmin(event)
  const body = await readBody<{ rows?: SaveRow[] }>(event)
  const rows = Array.isArray(body?.rows) ? body.rows : []

  // The editor's own pre-flight, repeated here because the route is the boundary: no row without
  // a slug, and no two rows resolving to the same one.
  const slugs = new Set<string>()
  for (const row of rows) {
    const slug = String(row?.slug ?? '').trim()
    if (!slug) throw createError({ statusCode: 400, statusMessage: 'SLUG_REQUIRED' })
    if (slugs.has(slug)) throw createError({ statusCode: 409, statusMessage: 'SLUG_TAKEN' })
    slugs.add(slug)
    if (!row?.id || !UUID_RE.test(String(row.id))) throw createError({ statusCode: 400, statusMessage: 'INVALID_ID' })
  }

  const sql = appSql(event)
  const queries = []
  for (const [index, row] of rows.entries()) {
    const id = String(row.id)
    queries.push(sql`insert into public.categories (id, slug, sort_order, is_active)
      values (${id}::uuid, ${String(row.slug).trim()}, ${index + 1}, ${row.isActive !== false})
      on conflict (id) do update set slug = excluded.slug, sort_order = excluded.sort_order, is_active = excluded.is_active`)

    for (const locale of LOCALES) {
      const name = String(row.names?.[locale] ?? '').trim()
      if (name) {
        queries.push(sql`insert into public.category_translations (category_id, locale, name)
          values (${id}::uuid, ${locale}, ${name})
          on conflict (category_id, locale) do update set name = excluded.name`)
      } else if (String(row.namesBefore?.[locale] ?? '').trim()) {
        queries.push(sql`delete from public.category_translations
          where category_id = ${id}::uuid and locale = ${locale}`)
      }
    }
  }

  try {
    await userTx(sql, userId, queries)
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'SLUG_TAKEN' })
    }
    throw error
  }
  return null
})
