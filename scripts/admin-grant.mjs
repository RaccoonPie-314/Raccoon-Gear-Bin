// scripts/admin-grant.mjs — grant (or list) storefront admins.
//
// Admin-ness is exactly one row in public.admin_users, keyed by the Clerk user id — the browser
// can never self-grant, and there is no admin UI for it (a future invite flow would own this).
// Until then this script is the writer path:
//
//   bun scripts/admin-grant.mjs tg7759554016      # by Clerk username (Telegram / phone alias)
//   bun scripts/admin-grant.mjs user_3KIAvE35...  # by Clerk user id
//   bun scripts/admin-grant.mjs --list            # current admins with their profile names
//
// The username is on the account page's identifier line (phone accounts: p<digits>, Telegram
// accounts: tg<id>). Revoking is the reverse one-liner:
//   delete from public.admin_users where user_id = '<id>';
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL missing from .env')
  process.exit(1)
}
const sql = neon(env.DATABASE_URL)

async function resolveUser(arg) {
  const sk = env.NUXT_CLERK_SECRET_KEY
  if (!sk) throw new Error('NUXT_CLERK_SECRET_KEY missing from .env')
  const headers = { Authorization: `Bearer ${sk}` }
  // The list filters (`username[]=` / `user_id[]=`) are silently IGNORED by the API — it answers
  // with every user, so trusting the first result would grant the wrong account on a typo. The
  // single-user endpoint is exact, and `query` is the only search that actually filters.
  if (arg.startsWith('user_')) {
    const res = await fetch(`https://api.clerk.com/v1/users/${arg}`, { headers })
    if (!res.ok) throw new Error(`no Clerk user ${arg} (API ${res.status})`)
    const user = await res.json()
    return { id: user.id, label: user.username || user.first_name || user.id }
  }
  const res = await fetch(`https://api.clerk.com/v1/users?query=${encodeURIComponent(arg)}`, { headers })
  if (!res.ok) throw new Error(`Clerk API ${res.status}: ${await res.text()}`)
  const users = await res.json()
  const exact = users.find(u => u.username === arg)
  if (!exact) {
    const near = users.map(u => u.username || u.first_name || u.id).join(', ')
    throw new Error(`no Clerk user with username "${arg}"${near ? ` (query matched: ${near})` : ''}`)
  }
  return { id: exact.id, label: exact.username || exact.first_name || exact.id }
}

const args = process.argv.slice(2)

if (args[0] === '--list') {
  const rows = await sql`select a.user_id, a.role, p.display_name
    from public.admin_users a left join public.profiles p on p.id = a.user_id
    order by a.created_at`
  for (const r of rows) console.log(`${r.role.padEnd(10)} ${r.user_id}  ${r.display_name ?? ''}`)
} else if (args[0]) {
  const user = await resolveUser(args[0])
  const [row] = await sql`insert into public.admin_users (user_id, role)
    values (${user.id}, 'admin')
    on conflict (user_id) do update set role = excluded.role
    returning user_id, role`
  console.log(`admin granted: ${user.label} (${row.user_id}) role=${row.role}`)
} else {
  console.log('usage: bun scripts/admin-grant.mjs <username|user_id> | --list')
  process.exit(1)
}
