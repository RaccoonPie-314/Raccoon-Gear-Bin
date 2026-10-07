# 008 — `ci-gates`: the whole tree is linted, and the unit suite runs in CI

Status: **planned, then applied in the same session** (the user's "move to next step" after the
`admin-identity` + `doc-truth` slice landed as `9a605a5`). Module id `ci-gates` from the capability map
proposed earlier; this is a tooling slice, so it carries a plan and acceptance criteria rather than a
module spec — there is no schema, interface or user-facing behaviour to contract.

## Why

Two gaps the docs already name, both cheap to close and both making every later slice safer:

1. `scripts/lint` runs `eslint app`, so `server/**` — the tier that owns every data path since the Neon
   port — has never been linted. ARCHITECTURE.md calls extending it "the change that says the whole tree
   is linted".
2. `bun run test` (52 checks, ~0.2 s, pure rules: pricing parity, order transitions, PayWay hashing) is
   not wired into CI, so a rule can regress while `build`, `lint` and `verify` stay green.

Measured before touching anything: `eslint server` reports **1 error** (`no-useless-assignment`,
`server/utils/payway-callback.ts:64`) and **1 warning** (a stale `eslint-disable` directive in
`server/utils/db.ts:31`). One error, not a cleanup project.

## Changes and acceptance

| # | Change | Acceptance |
|---|---|---|
| C1 | `server/utils/payway-callback.ts` — `let payload: CheckPayload \| null = null` loses its dead initializer (every path either assigns it or returns) | `eslint server` reports 0 errors; `typecheck` still exit 0 |
| C2 | `server/utils/db.ts` — drop the `eslint-disable-next-line` that no longer disables anything | `eslint server` reports 0 warnings too |
| C3 | `scripts.lint` → `eslint app server` | `bun run lint` green on the whole tree, no new failures |
| C4 | `.github/workflows/ci.yml` — a `Test` step in the `lint` job (no Chrome, no `.output` needed) | CI's lint job runs `bun run test` and prints its own `N pass / 0 fail` |
| C5 | Docs that state the old scope — `AGENTS.md` (the verification block), `ARCHITECTURE.md` (both `lint` sentences) | No sentence claims `lint` is scoped to `app/` or that CI runs only build+lint+verify |

Not doing: **typecheck into CI.** It is a real gate (vue-tsc reads `.vue` templates, which nothing else
catches mechanically) but it is a CI-time decision with its own cost on a 2-core runner, and it is
explicitly out of this slice's scope. Raised as a question instead of smuggled in.

## Verification

`bun run lint` · `bun run typecheck` · `bun run build` · `bun run test` after the edits. No app source
changes, so the CDP harness cannot see this slice: `bun run verify` runs once at the end to prove the
tree still behaves, not to prove C1/C2.
