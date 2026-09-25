---
kind: build_system
name: Nuxt 3 + Bun Build Pipeline with GitHub Actions CI
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - .github/workflows/ci.yml
    - nuxt.config.ts
    - bun.lock
    - supabase/config.toml
---

## Build System Overview

This is a Nuxt 3 single-page application (catalog + admin) built and deployed as a static site. The build pipeline is minimal: Bun is the package manager and runtime, Nuxt provides the build tooling, and GitHub Actions runs a single CI job that installs dependencies and builds the app.

## Key Files

- `package.json` — declares scripts (`build`, `dev`, `generate`, `preview`) and all runtime/development dependencies. Uses `bun.lock` as the lockfile; `postinstall` runs `nuxt prepare` to generate types.
- `.github/workflows/ci.yml` — the only CI configuration. Triggers on every `push`, checks out code, installs Bun via `oven-sh/setup-bun@v2`, runs `bun install --frozen-lockfile`, then `bun run build`.
- `nuxt.config.ts` — configures Nuxt modules (`@nuxt/ui`, `@nuxtjs/color-mode`, `@nuxtjs/i18n`, `@nuxtjs/supabase`), runtime config for Supabase URLs/keys, i18n locales (`en`, `km`), and color mode defaults.
- `supabase/config.toml` and `supabase/migrations/*.sql` — backend schema and policies are managed via the Supabase CLI (installed under `supabase/.temp/cli-latest`); no local database build step in this repo.

## Architecture and Conventions

**Package manager:** Bun is used exclusively. The CI pins installation with `--frozen-lockfile` against `bun.lock`. There is no npm/yarn/pnpm fallback path.

**Build targets:** Three Nuxt scripts are exposed:
- `nuxt build` — production Node.js server build (used by CI).
- `nuxt generate` — static site generation (available but not wired into CI).
- `nuxt dev` / `nuxt preview` — local development and preview of the generated output.

The CI only invokes `bun run build`; there is no separate test or lint step in the workflow.

**Runtime configuration:** Supabase credentials are split between server-only (`SUPABASE_SERVICE_ROLE_KEY` → `runtimeConfig.supabaseServiceRoleKey`) and client-visible (`NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY` → `runtimeConfig.public`). Defaults point at `https://example.supabase.co` with a demo anon key, so the app can be opened locally without real credentials.

**Supabase migrations:** Managed through the Supabase CLI bundled under `supabase/.temp/cli-latest`. Project linkage state lives in `supabase/.temp/linked-project.json` and related metadata files (`pooler-url`, `postgres-version`, etc.).

**CI matrix:** Currently a single runner (`ubuntu-latest`); the matrix is declared but only contains one OS entry.

## Conventions and Constraints

- **Dependency resolution is locked:** CI enforces `bun install --frozen-lockfile`, so any change to `bun.lock` must be committed alongside dependency changes — otherwise CI fails.
- **Bun is the required runtime:** The CI explicitly installs Bun via `oven-sh/setup-bun@v2` with `bun-version: latest`; `node_modules` from other managers are not used.
- **No tests in CI:** The workflow has no test script invocation; it only validates that `bun run build` succeeds.
- **No Dockerfile or container image:** There is no containerization layer in this repository; the build produces a Nuxt Node.js bundle intended for an external host.
- **No Makefile or shell build scripts:** All orchestration goes through `package.json` scripts and the GitHub Actions YAML.
- **Postinstall hook:** `nuxt prepare` runs automatically after `bun install`, generating Nuxt types and internal assets before any subsequent command.