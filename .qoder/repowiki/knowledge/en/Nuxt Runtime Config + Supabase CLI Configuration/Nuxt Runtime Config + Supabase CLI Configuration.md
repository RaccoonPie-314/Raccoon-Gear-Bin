---
kind: configuration_system
name: Nuxt Runtime Config + Supabase CLI Configuration
category: configuration_system
scope:
    - '**'
source_files:
    - nuxt.config.ts
    - .env.example
    - server/utils/supabase.ts
    - app/app.config.ts
    - i18n.config.ts
    - supabase/config.toml
---

## What system/approach is used

The project uses Nuxt 3's built-in **runtime configuration** (`nuxt.config.ts` `runtimeConfig`) layered over environment variables, plus the Supabase CLI configuration for local backend tooling. There is no custom config loader — all runtime values are sourced from `process.env` at build/serve time and exposed through Nuxt's typed runtime config API.

## Key files and packages

- `nuxt.config.ts` — central application configuration: declares `runtimeConfig`, wires `@nuxtjs/supabase`, `@nuxtjs/i18n`, `@nuxtjs/color-mode`, UI theme, and cookie options.
- `.env.example` — documents the required environment variables (no checked-in secrets).
- `server/utils/supabase.ts` — server-side utility that reads `useRuntimeConfig()` to construct a Supabase admin client; enforces presence of both URL and service role key.
- `app/app.config.ts` — Nuxt app-level static config for the Nuxt UI theme (colors, button/input radius/elevation).
- `i18n.config.ts` — i18n messages and locale defaults (en/km), loaded via `@nuxtjs/i18n`.
- `supabase/config.toml` — Supabase CLI local dev configuration (DB port, Studio, auth redirect URLs, storage limits).

## Architecture and conventions

### Environment variable naming
All external secrets and endpoints follow the `NUXT_PUBLIC_*` prefix convention for values exposed to the browser, and an unprefixed form for server-only secrets:
- `NUXT_PUBLIC_SUPABASE_URL` — Supabase project URL (public, available in client code).
- `NUXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key (public).
- `SUPABASE_SERVICE_ROLE_KEY` — server-only service role key (never sent to the browser).

These are declared in `.env.example` as the single source of truth for required env vars.

### Runtime config layering
`nuxt.config.ts` defines two layers under `runtimeConfig`:
- Top-level keys (e.g. `supabaseServiceRoleKey`) are **server-only**.
- The nested `public` object (e.g. `public.supabaseUrl`, `public.supabaseKey`) is **client-accessible**.

Defaults are provided inline using `|| 'https://example.supabase.co'` / `|| 'demo-anon-key'` so the app can start without env vars set, but production usage requires overriding them.

### Supabase client construction
- Client-side: the `@nuxtjs/supabase` module is configured directly in `nuxt.config.ts` with `url`, `key`, `serviceKey`, and cookie options (`name: 'raccoon-admin-auth'`, `lifetime: 8h`, `sameSite: 'lax'`).
- Server-side: `server/utils/supabase.ts` builds a dedicated admin client via `createSupabaseAdminClient()`, reading `config.public.supabaseUrl` and `config.supabaseServiceRoleKey` from `useRuntimeConfig()`. It throws `'Missing Supabase service configuration'` if either value is missing — this is the only place where missing config is treated as a hard error rather than falling back to defaults.

### App-level static config
`app/app.config.ts` uses `defineAppConfig` to override Nuxt UI tokens (primary color mapped to `neutral`, neutral to `zinc`; buttons/inputs/selects use `rounded-full shadow-xs`). This is a compile-time/static config, not runtime-configurable.

### i18n configuration
Locale list (`en`, `km`), default locale (`en`), strategy (`prefix_except_default`), and message bundles are defined in `i18n.config.ts` and referenced from `nuxt.config.ts` via `vueI18n: '../i18n.config.ts'`. Browser language detection stores the chosen locale in a cookie named `raccoon-gear-bin-locale` and redirects on root.

### Supabase CLI config
`supabase/config.toml` pins local development ports (API 54321, DB 54322, Studio 54323), sets Postgres major version to 15, enables Studio, caps storage at 50MiB, and configures auth redirect URLs to `http://localhost:3000`. This file is purely for the Supabase CLI and does not affect deployed runtime behavior.

## Conventions and constraints

- **No secrets in source control**: only `.env.example` is committed; actual `.env` is gitignored.
- **Public vs private split**: anything needed by the browser goes under `runtimeConfig.public.*`; everything else stays at the top level of `runtimeConfig`.
- **Server-only enforcement**: `createSupabaseAdminClient()` explicitly checks for both `url` and `serviceRoleKey` and throws if either is absent — this is the enforced invariant for server-side Supabase access.
- **Cookie-based admin session**: the Supabase module cookie name is fixed to `raccoon-admin-auth` with an 8-hour lifetime and `sameSite: lax`.
- **Default fallbacks**: public Supabase values fall back to placeholder strings (`example.supabase.co`, `demo-anon-key`) so the app boots without env vars; these should be overridden in any real deployment.
- **Single source of env var names**: `.env.example` documents every required variable; adding a new env var requires updating both `.env.example` and the corresponding `runtimeConfig` entry.