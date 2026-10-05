// scripts/db-migrate.mjs — applies db/migrations/*.sql to DATABASE_URL, in filename order,
// recording each file in schema_migrations. One transaction per file; a file already recorded is
// never re-run and (per repo discipline) never edited — changes land as new numbered files.
//
// The splitter is $$-aware on purpose: our SQL is full of function bodies whose semicolons are not
// statement boundaries. ponytail: no advisory lock — single-operator migrations; add one if CI
// ever migrates concurrently.
import { readFileSync, readdirSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => /^[A-Z]/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL missing from .env')
  process.exit(1)
}
const sql = neon(env.DATABASE_URL)

export function splitStatements(source) {
  const out = []
  let cur = ''
  let i = 0
  let inSingle = false
  let inDollar = null
  let inLine = false
  let inBlock = false
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (inLine) { cur += ch; if (ch === '\n') inLine = false; i++; continue }
    if (inBlock) {
      cur += ch
      if (ch === '*' && next === '/') { cur += next; i += 2; inBlock = false; continue }
      i++; continue
    }
    if (inSingle) {
      cur += ch
      if (ch === "'" && next === "'") { cur += next; i += 2; continue } // doubled quote escape
      if (ch === "'") inSingle = false
      i++; continue
    }
    if (inDollar) {
      if (source.startsWith(inDollar, i)) { cur += inDollar; i += inDollar.length; inDollar = null; continue }
      cur += ch; i++; continue
    }
    if (ch === '-' && next === '-') { cur += ch + next; i += 2; inLine = true; continue }
    if (ch === '/' && next === '*') { cur += ch + next; i += 2; inBlock = true; continue }
    if (ch === "'") { inSingle = true; cur += ch; i++; continue }
    if (ch === '$') {
      const tag = /^\$[A-Za-z0-9_]*\$/.exec(source.slice(i))
      if (tag) { inDollar = tag[0]; cur += tag[0]; i += tag[0].length; continue }
    }
    if (ch === ';') {
      const stmt = cur.trim()
      if (stmt) out.push(stmt)
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }
  const tail = cur.trim()
  if (tail) out.push(tail)
  return out
}

await sql`create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
)`

const applied = new Set((await sql`select version from schema_migrations`).map(r => r.version))
const files = readdirSync('db/migrations').filter(f => f.endsWith('.sql')).sort()

let ran = 0
for (const file of files) {
  const version = file.replace(/\.sql$/, '')
  if (applied.has(version)) {
    console.log('skip   ', version)
    continue
  }
  const statements = splitStatements(readFileSync(`db/migrations/${file}`, 'utf8'))
  await sql.transaction([
    sql`insert into schema_migrations (version) values (${version})`,
    // `sql.query` (not `unsafe`) — the only raw class the driver's transaction() accepts; the
    // endpoint refuses multi-statement strings, which is exactly why the splitter above exists.
    ...statements.map(s => sql.query(s))
  ])
  console.log('applied', version, `(${statements.length} statements)`)
  ran++
}
console.log(ran > 0 ? 'done' : 'up to date')
