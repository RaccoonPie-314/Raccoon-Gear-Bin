# Git conventions

Branch: `main`, remote `origin`. Save points are lightweight tags under `backup/`.

## When to commit

Work is **two-phase**. During a task the tree is left uncommitted — no commits, no tag churn, no
pushing — even after verification passes, so the change can be reviewed or kept experimenting on.
Commit and push happen **only on explicit request**; never infer permission from a task having
finished green.

The shorthand **"CPC"** (also "CPC point") means all three at once: commit, push, and create the
checkpoint tag. Run them in sequence without re-asking per step:

```bash
git add <specific files> && git commit -F <msgfile>
git tag backup/<short-description>-working
git push origin main
git push origin backup/<short-description>-working
```

After pushing, confirm CI actually passed rather than assuming it did: `gh run watch`.

## Commit messages

- **Conventional prefixes**: `fix:` / `feat:` / `refactor:` / `docs:` / `chore:`, with a scope
  when it narrows the change (`refactor(admin): …`).
- **The body explains *why*, not what the diff already shows** — design rationale with concrete
  technical detail, and an explicit note of which tuned interactions were intentionally left
  untouched so reviewability survives.
- **State the real state of the code.** If something is unwired, unreachable, or ships with a
  known defect, the message says so. A green `build` is not evidence that a feature works.
- **One atomic scoped commit per task**: related changes (code, harness checks, docs touched by
  the same task) belong together rather than being split into noise.
- Multi-line bodies go through `git commit -F <msgfile>`. Put message files under the gitignored
  `.nuxt/` so they can never be staged by accident.

## Staging discipline

Stage only the files this session changed. Pre-existing working-tree edits that are not part of the
task stay uncommitted. When one file carries both, split inside it: copy the file aside, strip the
unrelated section, `git add` + `git commit -F <msgfile>`, then restore the copy so the unrelated
edit survives with its original bytes — including details like a missing trailing newline.

`git add -A` / `git commit -a` are not acceptable here: they silently commit `.env`-adjacent edits,
stray worktrees, and the generated wiki.

## Save-point tags

- Format: lightweight `backup/<short-description>-working`. Two naming shapes are in use:
  feature-descriptive (`backup/catalog-data-layer-unified`) and phase-scoped
  (`backup/phase4-spec-ownership-working`).
- Create one **before risky work** and, for a milestone, immediately after verification is green so
  the tag names a proven-stable restore point.
- Tags are pushed to `origin` alongside the branch — an unpushed tag is not a restore point.
- The nearest `backup/*` tag is the **baseline** a behaviour-preserving refactor is diffed
  against; see [TESTING_SPECS.md](TESTING_SPECS.md).
- Exception: `backup/searchdock-launcher-morph-rollback` marks a deliberate revert rather than a
  stable state. Keep that distinction — a tag named `-working` must be green.

## Never commit

| Path | Why |
|---|---|
| `.qoder/` | Gitignored generated output. It is rewritten wholesale on regeneration and has overwritten hand edits to its own knowledge cards. |
| `.output/`, `.nuxt/`, `.cache/`, `node_modules/` | Build and install artefacts. |
| `.env` and other local env files | Gitignored; `.env.example` **is** tracked and must stay in sync — see Dependencies. |
| `supabase/.temp/` | Supabase CLI local state, including the linked project ref. |
| `.verify-base/` | The harness baseline worktree. It is **not** in `.gitignore`, so an `add -A` commits a whole second checkout of the app. |

## Dependencies

- Package manager is **Bun** only: `package.json` + `bun.lock`. No npm/yarn/pnpm lockfiles.
- Dependency changes go through **Renovate** (`renovate.json`, extending the Nuxt preset) rather
  than ad-hoc edits, and must include a **regenerated `bun.lock`**. CI runs
  `bun install --frozen-lockfile` and **fails on a lockfile mismatch**.
- New env var → update **both** `.env.example` and `runtimeConfig` in `nuxt.config.ts`.
- `skills-lock.json` pins AI agent skills with a `computedHash`; treat it like a lockfile.

## Migrations and generated docs

- `supabase/migrations/**` are the security model (schema + RLS). **A pushed migration is never
  edited** — write a new one, named with an ISO timestamp prefix plus a descriptive slug.
- `ARCHITECTURE.md` is updated **in the same commit** as the design change. It is hand-maintained
  precisely because generated docs cannot carry intent; `.qoder/repowiki/` must not be committed
  as a substitute for it.
- Docs that quote harness check counts drift constantly (the count has been raised in its own
  `docs:` commits several times). Prefer pointing at the run's own `N/M checks passed` output over
  restating a number.
