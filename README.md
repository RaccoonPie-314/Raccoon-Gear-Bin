# Raccoon Gear Bin

Product catalog storefront with a Supabase-backed admin editing flow, built as a single Nuxt
app (Tailwind v4 + Nuxt UI, i18n in English and Khmer, light and dark themes).

**Start with [ARCHITECTURE.md](ARCHITECTURE.md)** — it states the layer boundaries, the
Supabase typing rules that fail silently, the interaction invariants that no test protects,
and where new code belongs. Agents should also read [AGENTS.md](AGENTS.md) for the operational
rules. Both are hand-maintained and tracked. The `.qoder/repowiki/` documentation is generated
locally, is not in this repository, and loses to both files on any disagreement.

Requires `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY` and a row in
`admin_users` for the account you sign in with — see `.env.example`. Admin editing is reached
through `/admin/login`; the catalog itself is public and served under row-level security.

## Setup

Make sure to install dependencies:

```bash
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
bun run dev
```

## Production

Build the application for production:

```bash
bun run build
```

Locally preview production build:

```bash
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.
