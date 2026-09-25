---
kind: external_dependency
name: Supabase — Postgres + Auth + Storage backend
slug: supabase
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
scope:
    - '**'
---

### Identity
Supabase is the project's database, authentication, and object storage provider.

### Role in this repo
- Database: PostgreSQL (major_version 15 per `supabase/config.toml`) with migrations under `supabase/migrations/`.
- Auth: Supabase Auth (`@nuxtjs/supabase` module) drives admin login via email/password; RLS policies are applied through migrations.
- Storage: configured with a 50 MiB file-size limit (`supabase/config.toml`).

### Integration points
- Client wiring: `nuxt.config.ts` configures the `@nuxtjs/supabase` Nuxt module with URL, anon key, and service role key; runtime config exposes both public and server-only keys.
- Admin client: `server/utils/supabase.ts` creates a server-side Supabase client using the service-role key with session persistence disabled.
- Frontend auth: `app/composables/useAdminAuth.ts` uses `useSupabaseClient` / `useSupabaseUser` for sign-in/sign-out and role checks against the `admin_users` table.
- Route guard: `app/middleware/admin-auth.global.ts` protects `/admin/*` by verifying the user exists in `admin_users`.
- Local dev: `supabase/config.toml` starts local Studio on port 54323, API on 54321, DB on 54322, shadow DB on 54320.

### Durable usage model
- Three env vars are required: `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`).
- The service-role key is used exclusively on the server side to bypass RLS; the anon key is used on the client.
- Admin authorization is a two-layer check: Supabase Auth session + existence of a row in `admin_users` (with optional `role = 'super_admin'`).
- Verify exact migration contents and RLS policy names against the SQL files under `supabase/migrations/`.