/**
 * `/api/catalog/products` — the public list, or one product with `?id=`.
 *
 * The replacement for the browser's PostgREST reads: same rows, same embeds
 * (server/utils/catalog-queries.ts), same published-only filter, same `maybeSingle` contract —
 * a row that is missing (or not published) answers `null` (h3 turns the `null` return into a
 * 204), never a 404, because that is what the caller's `rawProduct.value = data` expects.
 */
export default defineEventHandler(async (event) => {
  const sql = appSql(event)
  const id = getQuery(event).id
  if (typeof id === 'string' && id) {
    // A malformed id is "no such product", not a 500: the uuid regex keeps Postgres from casting
    // garbage, and the answer a garbage id deserves is the same null a missing one gets.
    if (!UUID_RE.test(id)) return null
    const rows = await selectPublishedProduct(sql, id)
    return rows[0] ?? null
  }
  return selectPublishedProducts(sql)
})
