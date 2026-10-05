// scripts/db-seed.mjs — loads scripts/seed-catalog.json (the exported test catalog) into
// DATABASE_URL. Dev seed for the Neon port (plans/005 P4), and idempotent: rows upsert by primary
// key and each product's image rows are replaced wholesale, so a re-run converges on the fixture
// instead of accumulating strays.
//
// Run: bun scripts/db-seed.mjs
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => /^[A-Z]/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL missing from .env')
  process.exit(1)
}
const sql = neon(env.DATABASE_URL)
const seed = JSON.parse(readFileSync('scripts/seed-catalog.json', 'utf8'))

const statements = []

for (const category of seed.categories) {
  statements.push(sql`
    insert into public.categories (id, slug, sort_order, is_active)
    values (${category.id}, ${category.slug}, ${category.sort_order}, ${category.is_active})
    on conflict (id) do update set slug = excluded.slug, sort_order = excluded.sort_order, is_active = excluded.is_active`)
  for (const translation of category.category_translations) {
    statements.push(sql`
      insert into public.category_translations (category_id, locale, name)
      values (${category.id}, ${translation.locale}, ${translation.name})
      on conflict (category_id, locale) do update set name = excluded.name`)
  }
}

for (const product of seed.products) {
  // `created_at` is written once — a re-run must not reshuffle the list order the pages read.
  statements.push(sql`
    insert into public.products (id, category_id, slug, sku, price, currency, stock_quantity, status, is_featured, promo_price, promo_label, promo_quantity, promo_starts_at, promo_ends_at, created_at)
    values (${product.id}, ${product.category_id}, ${product.slug}, ${product.sku}, ${product.price}, ${product.currency}, ${product.stock_quantity}, ${product.status}, ${product.is_featured}, ${product.promo_price}, ${product.promo_label}, ${product.promo_quantity}, ${product.promo_starts_at}, ${product.promo_ends_at}, ${product.created_at})
    on conflict (id) do update set category_id = excluded.category_id, slug = excluded.slug, sku = excluded.sku, price = excluded.price, currency = excluded.currency, stock_quantity = excluded.stock_quantity, status = excluded.status, is_featured = excluded.is_featured, promo_price = excluded.promo_price, promo_label = excluded.promo_label, promo_quantity = excluded.promo_quantity, promo_starts_at = excluded.promo_starts_at, promo_ends_at = excluded.promo_ends_at`)
  for (const translation of product.product_translations) {
    statements.push(sql`
      insert into public.product_translations (product_id, locale, name, short_description, description, specifications)
      values (${product.id}, ${translation.locale}, ${translation.name}, ${translation.short_description}, ${translation.description}, ${JSON.stringify(translation.specifications)}::jsonb)
      on conflict (product_id, locale) do update set name = excluded.name, short_description = excluded.short_description, description = excluded.description, specifications = excluded.specifications`)
  }
  statements.push(sql`delete from public.product_images where product_id = ${product.id}`)
  for (const [index, image] of product.product_images.entries()) {
    statements.push(sql`
      insert into public.product_images (product_id, storage_path, alt_text, sort_order, is_primary)
      values (${product.id}, ${image.storage_path}, ${image.alt_text}, ${image.sort_order ?? index}, ${image.is_primary ?? index === 0})`)
  }
}

const site = seed.siteSettings
statements.push(sql`
  insert into public.site_settings (id, phone, location_url, location_translations, social_links)
  values (1, ${site.phone}, ${site.location_url}, ${JSON.stringify(site.location_translations)}::jsonb, ${JSON.stringify(site.social_links)}::jsonb)
  on conflict (id) do update set phone = excluded.phone, location_url = excluded.location_url, location_translations = excluded.location_translations, social_links = excluded.social_links`)

await sql.transaction(statements)

// Read-back self-check: a seed that half-applied must fail loudly, not look done.
const productIds = new Set((await sql`select id from public.products`).map(row => row.id))
const missingProducts = seed.products.filter(product => !productIds.has(product.id)).map(product => product.sku)
const categoryIds = new Set((await sql`select id from public.categories`).map(row => row.id))
const missingCategories = seed.categories.filter(category => !categoryIds.has(category.id)).map(category => category.slug)
const imageCounts = Object.fromEntries((await sql`select product_id, count(*)::int as n from public.product_images group by product_id`).map(row => [row.product_id, row.n]))
const badImages = seed.products.filter(product => (imageCounts[product.id] ?? 0) !== product.product_images.length).map(product => product.sku)

if (missingProducts.length || missingCategories.length || badImages.length) {
  console.error('seed incomplete', { missingProducts, missingCategories, badImages })
  process.exit(1)
}
console.log(`seeded ${seed.categories.length} categories + ${seed.products.length} products (${seed.products.reduce((n, p) => n + p.product_images.length, 0)} images) + the site-settings row`)
