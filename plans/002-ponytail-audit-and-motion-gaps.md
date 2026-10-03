# 002 — Pay down the complexity debt, then give the four unanimated surfaces the vocabulary they already own

Status: **DRAFT v2 — replanned under one constraint: do not break what works.** The constraint is the
plan's primary ordering rule, not a caveat: Tier 1 is the only part cleared to run, Tier 2 needs a
named check first, Tier 3 is declined unless a row is named and the check below it is accepted.
Origin: two read-only passes on `main` at `0b389c8` — `ponytail-audit` (whole-repo, over-engineering
only) and `find-animation-opportunities` (interface sweep).
Severity: LOW-MEDIUM. No user-visible defect is being fixed; this change removes code that exists for
no caller, folds duplication that can drift, and closes four motion gaps with numbers the repo already
owns.
Files: `app/**`, `scripts/verify-ui.mjs` (read-only baseline), `nuxt.config.ts`, `package.json`,
`bun.lock`, `eslint.config.mjs`, `ARCHITECTURE.md`, `AGENTS.md`.

## Assumptions this spec is making

Correct me now or implementation proceeds with these:

1. **`bun run verify` is the only proof that "it works"**, and its check count is dynamic — the
   baseline is "the number this tree prints today, before any cut", not the 323 written in
   `plans/001`. Every task records the number before and after.
2. **Deleting a `verify-ui.mjs` assertion is out of scope.** If a cut drops a check, the cut is wrong
   or the check was guarding a surface the cut legitimately removed — that needs a human decision,
   not an edit to the harness (`TESTING_SPECS.md`).
3. **Tuned interaction engines are hands-off.** `SearchDock.vue`, `ProductGallery.vue`,
   `ProductActions.vue`, `ProductShareSheet.vue` carry device-measured motion. Refactors inside them
   are only allowed where this spec names the exact block.
4. **Khmer copy, `t()` keys, and every `data-*` selector the harness matches are contracts** and stay
   byte-identical.
5. **`supabase/migrations/**` is untouched by every module here**, and no service-role client appears
   anywhere in the result.
6. Dev server for feel-checks binds `:3000`, falling back to `:3001` (see
   `project_environment_configuration` memory); Chrome is available locally for `verify`.

## Capability map

Five modules, each independently shippable and independently verifiable. Ids are kebab-case and
final — tasks are selected by these ids.

| Module id | Responsibility | Depends on |
|---|---|---|
| `dead-code` | Delete code with zero callers, zero usages, or a documented successor | — |
| `dep-config` | `package.json` / `nuxt.config.ts` / `eslint.config.mjs`: deps that are not used directly, config nobody reads, a page that a platform rule replaces | — |
| `fold-duplication` | Fold N copies of one rule into the one owner that already exists, without changing behaviour | `dead-code` (motion.ts presets must be confirmed dead before the bloom fold touches the same file) |
| `motion-gaps` | Give 4 unanimated surfaces the existing `applePop` / `press` / `.reveal` vocabulary | `fold-duplication` (M1 reuses the `popIn`/`popOut` helpers that fold produces) |
| `native-icons` | Replace hand-inlined generic SVG and the 22 hand-drawn category glyphs with the lucide collection `@nuxt/icon` already resolves offline | `motion-gaps` (so the icon diff never has to be re-measured on top of a motion diff) |

Build order: `dead-code` → `dep-config` → `fold-duplication` → `motion-gaps` → `native-icons`.
`dead-code` and `dep-config` may run in parallel; nothing else may.

Total measured at plan time: **≈ -630 lines, -2 direct deps, -5 files** (2 of the 5 files are
`CategoryIcon.vue`-scale and belong to `native-icons`, which is the module most likely to be
declined on taste).

---

## Execution tiers (the answer to "some of this was really hard to get working")

The 630 lines are not equal in risk. Ordering is by **what can possibly change behaviour**, not by
size — which is why the two biggest cuts in this repo are at the bottom.

### Tier 1 — run now. Nothing in this tier is reachable at runtime.

Each row is dead in the literal sense: the code path does not exist today, so deleting it cannot
alter a path that does.

| Row | Cut | Why it cannot break a working feature |
|---|---|---|
| `D1` | `isSuperAdmin` | 0 callers in `app/` **and** `scripts/`. A function nobody calls has no behaviour to change. |
| `D2` | `spotlight`, `panel` presets | 0 importers. The live SearchDock morph reads `OPEN_MORPH_MS` + `MORPH_EASE`, not the preset — and `verify`'s two spotlight checks are the proof, so if the preset were load-bearing those checks fail and the commit is reverted. |
| `D4` | `.scrollbar-none` | No markup uses the class. Its working twin `.no-scrollbar` is untouched. |
| `D5` | unexport `ALL_CATEGORIES`, drop `fetchCategories` from `useCatalog`'s return | The function bodies and every call stay identical; only a name stops leaving the file. |
| `D6`, `D7` | `.agents/skills-disabled/`, empty `app/directives/` | Outside `app/`. Nothing imports them; `D6` isn't even in `skills-lock.json`. |
| `P3` | `supabase` CLI → `devDependencies` | Nothing in `app/` imports it, the deploy artifact is the built Worker, and CI runs a plain `bun install` (no `--production`), so dev deps still install. A dependency that never enters the bundle cannot change runtime. |
| `F6` | `ICON_BY_SLUG` identity map → a `const` array + `includes` | Pure data, one pure function, no DOM and no timing. Acceptance is the table below — every input must answer identically. |
| `P5` | `app/constants/catalog.ts` → into `product-stock.ts` | One constant, one importer, zero logic. The stock band's behaviour is asserted by the existing in/low/out checks on all six fixture cards. |

**Tier 1 total: ≈ -110 lines, -1 file, 9 commits.**

### Tier 1 — APPLIED, REVERTED, AND THE "BROKEN DECODE" WAS NOT THE CODE

The nine rows were applied and the gate was green (`verify` 429/429, same 429 checks as baseline;
`lint` 0 errors / 17 warnings; `build` green; `typecheck` 0). The user then reported the front-page
locale decode was broken, so the batch was reverted byte-for-byte to HEAD `0b389c8`. **The symptom
survived the revert — because the code was never the cause.**

Verified root cause: a `nuxt dev` server (pid 3872) had been running **7h56m** while four
`bun run build` / `bun run verify` runs regenerated `.nuxt` underneath it, and a dev server holds
that generated state in memory. With the source byte-identical to the checkpoint tag the whole time
(`git diff backup/phone-motion-fidelity-working --stat` → empty), the fix was: kill the server,
`rm -rf .nuxt .output`, `bun install --frozen-lockfile`, restart dev. The decode then measured
working — **372 `characterData` writes in the first 600ms** of an EN→KM switch, sample frames of
random glyphs (`"KΒΚវ# Δटជ¶가"`). Reproduce with `.nuxt/verify/decode-diag.mjs` (gitignored scratch).

What the plan's risk model still got wrong, and the harness with it:

- "Not reachable at runtime" was asserted from `grep` + `lint` + `build` + `typecheck` + `verify`, and
  `verify` has **no assertion that the decode runs** — its Khmer checks assert letter-spacing, ink
  clipping and caption fit, not the scramble cycle. So 429/429 was never evidence about the animation,
  and neither is any gate result. The gap is worth closing: ~15 lines reusing the harness's own CDP
  client, modelled on `decode-diag.mjs` (count `characterData` writes across a real EN→KM click).
- Two Node-side probe attempts reported "no decode" purely because of the instrument: the first did
  not force `prefers-reduced-motion: no-preference` (the plugin is gated on it), the second sampled
  with a Node-side CDP round-trip loop that is slower than the ~300ms window. **Sample in-page.**

The individual Tier-1 row remains irrelevant to that bug — none of them caused it, **and the user
confirmed the report was unrelated to the change.** Two further measurements from the same hunt, both
worth knowing before re-applying anything:

- An agent-started dev server holds `:3000`, so the user's own `bun run dev` falls back to `:3001`.
  Measure the port they are actually on, and never leave a second `nuxt dev` running — two of them
  share one `.nuxt`. (This is how the decode looked dead on a tree that was provably the checkpoint.)
- `category_translations` and `product_translations` hold **only `en` rows** (8 + 8, zero `km`), so
  category and product names are identical in both locales and never decode. That is a data gap, not
  an animation bug — do not chase it through `locale-decode.client.ts`.

If the batch is re-applied, the rule is still one row per commit with an EN→KM switch observed each
time, but for the normal reason (small diffs), not because a row was ever shown guilty.

Two things the plan got wrong, corrected during the work (still true):

- `F6` as first written (`as const` + `includes`) narrowed `CATEGORY_ICON_ITEMS` to the literal union
  and `bun run typecheck` failed on `categories.vue:161` — `:model-value="row.slug"` is a `string`.
  Final shape: `IconSlug = Exclude<CategoryIconName, 'all' | 'other'>`, a typed array, `find` for the
  lookup, and an explicit `{ label: string, value: string }[]` annotation on the picker list. That is
  **zero casts** (the first draft needed two) and the same widened type the `Record` + `Object.keys`
  version inferred. Verified with a 13-case assertion run against the real module.
- Criterion #5 assumed `ARCHITECTURE.md` names the dead presets and `app/constants/`. It does not
  (`grep -n spotlight ARCHITECTURE.md` → 0; `grep -n constants ARCHITECTURE.md` → 0), and
  `AGENTS.md:37` names `LOW_STOCK_THRESHOLD` rather than its path — so no doc edit was owed.

That batch's delta, before it was reverted: 11 files, **+27 / −428 (net −401)**, of which 337 lines
were the unlocked `skills-disabled` markdown (`app/` + config ≈ −64). It touched no `data-*`, no `t()`
key, no timing constant and no block on the hands-off list — and it still broke the decode, which is
the whole point: the hands-off list was drawn around the *animations the harness measures*.

`F6` acceptance table — run it as an assertion, not as a review:

| slug in | `categoryIconOf` out | `CATEGORY_ICON_ITEMS` |
|---|---|---|
| `'mice'`, `'Mice'`, `'KEYBOARDS'` | `'mice'`, `'mice'`, `'keyboards'` | **21** items (the audit said 22 — it counted the braces), `label === value`, declaration order preserved |
| `'  mice  '` | `'other'` — the original never trimmed, so neither does this. **The trim row in the first draft of this table was a plan bug, caught before code** | unchanged |
| `'monitors'` (a shop-added category) | `'other'` | unchanged |
| `undefined`, `''`, `'all'`, `'other'` | `'other'` | unchanged |

### Tier 1 — APPLIED, second pass, on base `7709820`

The base had moved two commits since the audit (`6cc8a68` search scatter, `7709820` launcher guards),
so every deadness grep was re-run rather than reused. All nine targets were still dead. `F6` picked up
one extra edit: the new `CategoryIcon.vue:13` comment names `ICON_BY_SLUG`, so it now names
`ICON_SLUGS`.

**Applied: D1, D2, D4, D5, F6, P3, P5 — 7 rows, +28 / −92 (net −64).**
**Skipped: D6, D7** — a directory named `skills-disabled` and an empty `app/directives/` are a
deliberate archive and a scaffold, not dead weight in the build; they save no app line and deleting
them can only surprise the owner.

All verification ran **outside** the main tree, so the two running dev servers were never handed a
rewritten `.nuxt` (the thing that made the last round look broken):

| check | baseline `7709820` | patched | where |
|---|---|---|---|
| `bun run verify` | 448/448 | **448/448, check-name diff = 0 lines** | worktree, with `.env` copied in |
| `bun run lint` | — | 0 errors / 17 warnings, identical set | worktree |
| `bun run typecheck` | — | 0 errors | worktree |
| `bun run build` | green | green | worktree |
| `bun install --frozen-lockfile` on the hand-edited `bun.lock` | — | "no changes" → CI-safe | worktree |
| live decode after HMR | — | 610 writes (`:3000`) / 635 (`:3001`), 24 cards, 40 icons, 0 console errors | the user's own servers |
| `F6` behaviour | — | 11-case assertion: casing, unknown slug, `undefined`, `''`, 21 items, order | `bun -e` on the real module |

One dead end worth recording: the first worktree run failed on **both** sides with
`Page.navigate timed out` — a gitignored `.env` does not come with `git worktree add`, and this repo's
harness gates on it. Copy `.env` in and it runs. Scratch for all of this is in `.cache/` (gitignored):
`decode-check.mjs`, `tier1-gate.sh`, `tier1-gate2.sh`, `verify-delta.txt`, four logs.

---

### Tier 2 — run only after its named check. Provably dead in code, but the harness cannot prove it

These touch Supabase wiring or the lockfile, and `verify-ui.mjs` stubs every network call — so a green
`verify` here proves **nothing** about the thing at risk. Each gets its own commit and its own
real-browser evidence.

| Row | Risk the harness cannot see | Required check before the commit is believed |
|---|---|---|
| `D3` (dead `runtimeConfig.public` keys) | The anon key is inlined at **build** time; a wrong edit ships a Worker that talks to `example.supabase.co` and the storefront shows an empty catalog — silently | `bun run dev` with the real `.env`, load `/` and `/admin/login` **before** and **after**: same products, same header, same Khmer route |
| `P1` (`@supabase/supabase-js` out of `dependencies`) | The client is constructed by `@nuxtjs/supabase`; if bun stops hoisting the transitive copy the build breaks — loudly, but only at build | `bun install && bun run build`, then confirm `node_modules/@supabase/supabase-js` still exists, then the same real-`.env` load as `D3` |
| `P2` (`vue-router` out; `locale-route.ts` takes `{ path: string }`) | `definePageMeta({ key, scrollToTop })` is the mechanism that keeps a locale switch from rebuilding the page and throwing the visitor to the top — the hardest-won routing behaviour in this repo | `bun run typecheck` **and** a manual EN↔KM toggle on a scrolled catalog page: scroll position, search text and the loaded catalog all survive exactly as today |
| `M2`, `M3` (fade the admin banners + the empty state) | Additive CSS and a `<Transition>` wrapper in files that also hold the drag-reorder row lists — but neither touches the rows, so the risk is a Vue "Transition children must be exactly one child" error at build, not a behaviour change | `bun run lint && bun run build && bun run verify --only=admin` + `bun run verify`; the check count must go **up** by the new asserts and no existing check may be edited |

### Tier 3 — declined unless you name the row

Every row here edits a surface that this repo's own docs, comments or `TOUCH_RESTRICTIONS.md` mark as
measured, device-tuned, or hard-won. The cut is real; the risk is not worth ~440 lines.

| Row | Why it stays alone |
|---|---|
| `F2` (fold the two category docks, −80) | Drag-select, magnification, the sliding indicator, edge auto-scroll and the `document.fonts.ready` re-measure are each fixed against a named bug. Merging them into one axis-flipped owner puts four tuned engines under one diff — the highest blast radius in this plan for the second-largest line saving. |
| `F3` (fold the applePop bloom, −35) | `ContactDock` and `ProductActions` share the *numbers* already (that is what `applePop` is). What they don't share is the reveal scroll, the column pin, the caret and `waitForReturn` — the parts that would have to be threaded through a callback. Folding gains 35 lines and adds a parameter surface to a device-measured pop. |
| `F1` (scroll-reveal, −54) | `ARCHITECTURE.md:473` already books this as a Known gap with a reason: SearchDock's scroll pass is interleaved with the collapse engine and the component is hands-off. Reopening it needs your decision, not an audit's. |
| `F4` (admin drag + `isAdminMode`, −30) | The social-link drag flicker and the category drag-reorder port were both fixed by *not* reordering on `dragover`. A shared helper is the right shape; it is not the safe one. |
| `F5` (kill the `any` sites, −18) | Touches 11 error paths on the admin write surface, which is the hardest-won feature here, and buys only typing hygiene while `no-explicit-any` is off. Zero user-visible gain. |
| `F7`, `F8` (SearchDock strings, decode twins, −33) | `F7` edits `SearchDock.vue` — a tuned engine — to remove duplicated strings. The duplication is 7 template strings that cannot drift independently of `MORPH_EASE`/`ms` because both are built from the same two locals in the same block. `F8` same shape. |
| `M1` (search popover bloom) | The best gap found, but it depends on `F3`'s helpers existing. Blocked twice over. |
| `M4` (press parity via `app.config.ts`) | One string in `app.config.ts` restyles **every** Nuxt UI control in the app — `UButton`, `UInput`, `USelect` triggers, alert dismiss buttons, both admin modals. `TOUCH_RESTRICTIONS.md` marks that file as tuned. It also puts a transform on controls whose neighbours the harness measures. |
| `M5` (card enter stagger) | 100+ card paints per filter keystroke; this is the one motion row whose frequency tier argues against it. |
| `N1`, `N2`, `N3` (icons, −367) | The largest cuts in the repo and the only ones that change what the eye sees on every screen. `verify` asserts these glyphs by **ink area and bounding box** because a truncated path still renders a valid `<svg>`. Lucide's default stroke is 2 against this art's 1.75. Right call is a taste decision with a screenshot, taken separately. |
| `P4` (`/products` → `routeRules`) | Routing under `prefix_except_default` is where this repo has been bitten (locale remount, `localePath`, the KH route decode). A 7-line page that works beats a platform rule that needs the `.output` server run to prove the `/km` twin. |

---

## Hands-off list — these blocks are not edited by any tier

Not "be careful". Do not open them.

| Block | Guarded today by |
|---|---|
| `SearchDock.vue` flight engine (`startFly`/`flyStep`/`endFlight`/`endFieldReturn`) and the overlay morph (`openOverlay`/`closeOverlay`/`captureScene`) | the launcher-flight, spotlight-morph, ESC-race and pill-invariant checks in `verify-ui.mjs` |
| `ProductGallery.vue` zoom + swipe + filmstrip (`ZOOM_SCALE`, the focal-point anchor maths, `windowStart` FLIP) | the gallery-swap, lightbox-zoom and swipe-cycle checks; `TOUCH_RESTRICTIONS` keeps any transform off the zoomed `<img>`'s ancestors |
| `ProductActions.vue` reveal/return (`pinColumnStatic`, `revealFrom`/`revealTo`, `waitForReturn`, `heldHost`) | `closing the panel returns the page to where it stood` and the two `a Share opened out of an open contact panel…` asserts |
| `ProductConversion.vue`'s `[data-sticky-frost]` sibling layer | the frost-is-not-an-ancestor trace; a `backdrop-filter` ancestor re-prices every bloom frame |
| `CategoryDesktop.vue` / `CategoryMobile.vue` drag, magnification, indicator measurement | the 18-item category-refactor checklist plus the dock and rail geometry asserts |
| `locale-decode.client.ts`'s `wrapDriver` box pinning and `MAX_WINDOW_MS` | the Khmer sweeps and the mobile decode-flicker checks |
| `app/utils/motion.ts`'s live preset **values** (`220/19/1`, `[0.22,1,0.36,1]`, every duration) | `the phone's enter is a bezier the compositor takes, not a generated spring curve` |
| every `data-*` attribute, every `aria-label` whose English value `verify` matches as a selector, every `t()` key | the harness's own selector strings, listed in `i18n.config.ts`'s comment |

## Safety rails (run in this order, every commit, no exceptions)

0. **Snapshot the baseline first:** `bun install && bun run build && bun run lint && bun run verify &&
   bun run typecheck` on a clean tree. Write the check count and the pass/fail lines down. `verify`'s
   count is dynamic — the number this tree prints is the number every later commit must match.
1. **One row = one commit.** Never bundle a Tier-1 row with a Tier-2 row, or two rows that touch the
   same file.
2. **Full gate before calling a row done** (`lint` → `build` → `verify` → `typecheck`). A green
   `build` means it compiled, not that it works.
3. **Check count must not drop.** If a row removes a passing check, the row is wrong — revert it.
   Never edit a `verify-ui.mjs` assertion or a threshold to get green (that is exactly what
   `constraint-driven-development` exists to catch).
4. **Tag each tier, not each commit:** `backup/ponytail-tier1-working` at the end of Tier 1. Rollback
   is `git revert <sha>` for one row, `git reset --hard backup/…` for a tier.
5. **Do not fix forward.** If Tier 1's last commit makes an unrelated check go red, revert that commit
   and re-read it — a "dead" export that turns out to have a consumer is information, not a nuisance.
6. Commit messages follow `docs/rules/GIT_CONVENTIONS.md` and carry the reason
   (`chore(storefront): drop the isSuperAdmin check — nothing calls it`), and `ARCHITECTURE.md` is
   updated in the same commit as the rows that change a boundary it describes (`D2`, `P5`, and
   `F6`'s icon-map note).

---

## Module: `dead-code`

The five module tables below are the **per-row detail** for everything the audit found — exact paths,
values, acceptance greps and verify commands. Which of them get run, and in what order, is decided by
§Execution tiers above; a row's module does not imply it is approved.

Every row was confirmed by `grep -r` over `app/` **and** `scripts/` — not by "looks unused".

| # | Cut | Where | Replacement | Acceptance | Verify |
|---|---|---|---|---|---|
| D1 | `isSuperAdmin` — zero callers, and a line-for-line copy of `isAdmin` with one different comparison | `app/composables/useAdminAuth.ts:36-55` + the `isSuperAdmin,` entry in the return object `:74` | nothing. `super_admin` is still compared in the stub (`verify-ui.mjs:145`) and still typed (`AdminRole`) | `grep -rn "isSuperAdmin" app scripts` → 0 hits | `bun run lint && bun run typecheck` |
| D2 | `spotlight` and `panel` presets — no importer exists; `ARCHITECTURE.md:519` already records the sibling decision "The `popover` preset is gone: nothing uses it" | `app/utils/motion.ts:49-51` (+ its doc block `:33-48`) and `:94-98` (+ doc `:85-93`) | nothing. SearchDock's morph is a CSS transition (`SearchDock.vue:32` says so; `OPEN_MORPH_MS` owns the number) | `grep -rn "spotlight\|panel" app/utils/motion.ts` → 0 exports; `grep -rn "from '~/utils/motion'" app` unchanged in name list | `bun run build && bun run verify` (the two spotlight morph checks must stay green) |
| D3 | `runtimeConfig.public.supabaseUrl` / `supabaseKey` — nothing reads them; `@nuxtjs/supabase` reads `runtimeConfig.public.supabase.{url,key}`, which it fills from the `supabase:` block (`node_modules/@nuxtjs/supabase/dist/module.mjs:43,58,78`) | `nuxt.config.ts:82-87` — both keys are dead, so the whole `runtimeConfig` block goes with them | the `supabase.url/key` lines already there. **Keep `secretKey: ''`** — that one is load-bearing (defu skips `undefined`, so only a set value stops the service-role key being inlined) | `grep -rn "runtimeConfig" app` → 0 hits; `.nuxt/types/runtime-config.d.ts` still lists `supabase: { url, key }` and no longer lists `supabaseUrl`/`supabaseKey` | `bun run build && bun run verify`, then a dev-server load of `/` **with a real `.env`** to prove the anon key still resolves (the harness stubs the network and cannot prove this) |
| D4 | `.scrollbar-none` — zero usages; `no-scrollbar` is the class the docks use | `app/assets/css/main.css:54-62` (drop the `, .scrollbar-none` selector from both rules) | nothing | `grep -rn "scrollbar-none" app` → 0 hits | `bun run lint && bun run verify` |
| D5 | `ALL_CATEGORIES` and `fetchCategories` are exported with zero importers (`fetchCategories` is only called inside `fetchCatalog`) | `app/composables/useCatalogBrowse.ts:7` → drop `export`; `app/composables/useCatalog.ts:229` → drop `fetchCategories` from the return object | nothing; the function stays, unexported | both names have 0 hits outside their own file | `bun run lint && bun run typecheck` |
| D6 | `.agents/skills-disabled/liquidglass-design/SKILL.md` — committed, disabled, **not present in `skills-lock.json`** (so nothing governs or verifies it), and `glassmorphism` is installed and locked | the whole `skills-disabled/` tree | nothing | `git ls-files .agents/skills-disabled` → empty | `python3 -c "import json;print(len(json.load(open('skills-lock.json'))['skills']))"` unchanged at 69 |
| D7 | `app/directives/` — empty directory. Untracked (git cannot track it), so this is local housekeeping only, not a commit | `rmdir app/directives` | nothing | `ls app/directives` → no such directory | n/a |

**Doc impact (same commit, per AGENTS.md):** `ARCHITECTURE.md:46` keeps the `useScrollReveal.ts` line
(untouched here); the `app/utils/motion.ts` rows must not list `spotlight`/`panel` as available
presets — grep the file for both names and drop any sentence that describes them as live.

---

## Module: `dep-config`

| # | Change | Where | Acceptance | Verify |
|---|---|---|---|---|
| P1 | `@supabase/supabase-js` out of `dependencies` — no file imports it; the client comes from `useSupabaseClient()`, and `@nuxtjs/supabase@2.0.10` depends on `^2.112.2` itself | `package.json:21` + regenerated `bun.lock` | `grep -rn "@supabase/supabase-js" app scripts` → 0 hits; `node_modules/@supabase/supabase-js` still resolves (transitive) | `bun install && bun run build && bun run verify` — the harness's fetch stub exercises the real client construction path |
| P2 | `vue-router` out of `dependencies` — its only use is one **type** import, and the two functions that use it read nothing but `.path` | `package.json:28`; `app/utils/locale-route.ts:1` → `type RoutePath = { path: string }` and both signatures take `RoutePath`. `definePageMeta` still accepts them (`nuxt/dist/pages/runtime/composables.d.ts:47`: `scrollToTop?: boolean \| ((to, from) => boolean)`) | `grep -rn "'vue-router'" app` → 0 hits | `bun run typecheck` (the `key`/`scrollToTop` page-meta bindings are what would break) |
| P3 | `supabase` (the CLI) from `dependencies` → `devDependencies`. CI runs `bun install --frozen-lockfile` with no `--production` flag (`.github/workflows/ci.yml:50,87`), so nothing changes for CI; `app/` never imports it | `package.json:25` | it is no longer in `dependencies` | `bun install && bun run build && bun run lint` |
| P4 | `app/pages/products/index.vue` (7 lines whose entire body is `await navigateTo('/', { replace: true })`) → a declarative Nitro redirect | delete the page; add `nitro: { routeRules: { '/products': { redirect: '/' }, '/km/products': { redirect: '/km' } } }` next to the existing `nitro.sourceMap` in `nuxt.config.ts` | `GET /products` and `GET /km/products` answer a 301/302 to the catalog, both locales | `bun run build && node .output/server/index.mjs` locally (or `bun run preview`), then `curl -si http://localhost:3000/products \| head -3` and the `/km` twin → expect a `location` header; `bun run verify` unchanged (`--only=guest` never visits `/products`) |
| P5 | `app/constants/` — a directory, a file and an `import` for one number that has exactly one reader (`app/utils/product-stock.ts:1`); `AGENTS.md:37` and `ARCHITECTURE.md:826` both name the constant, not the folder | move `LOW_STOCK_THRESHOLD = 5` into `app/utils/product-stock.ts`, delete `app/constants/catalog.ts`, drop the import | `grep -rn "constants/catalog" app docs ARCHITECTURE.md AGENTS.md` → 0 hits; the band test in `verify` still finds in/low/out on all six fixture cards | `bun run lint && bun run build && bun run verify` |
| `P6` | Re-enable `@typescript-eslint/no-explicit-any` as `'warn'` and delete the eslint comment block that exists only to excuse the current hits — **blocked on `F5`, so Tier 3 with it** | `eslint.config.mjs:7-13` (the comment) and `:16` (the rule) | `bun run lint` prints 0 `no-explicit-any` warnings | `bun run lint` |

**Ask first (per Boundaries):** P1–P4 all touch `package.json`/`bun.lock`/`nuxt.config.ts`, which is
the CI gate (`--frozen-lockfile`). They are one commit each.

---

## Module: `fold-duplication`

Each fold has **one owner already in the tree**. No new composable is introduced anywhere: a rule
that is neither reactive state nor a browser capability is a plain function in `app/utils/`
(`AGENTS.md:37`, `ARCHITECTURE.md:778`).

| # | Duplication | Fold into | Net |
|---|---|---|---|
| F1 | **Scroll-reveal rule.** `useScrollReveal.ts` (54 lines) has exactly one consumer (`CategoryMobile.vue:218`); `SearchDock.vue:15-16` + `:222-229` carry a hand copy of the same rule (`60` / `6` / same `readScrollY` / same rAF gate). `ARCHITECTURE.md:473` already books this as a **Known gap** ("the component is hands-off"), so this is a decision, not a discovery: **(a)** delete the file and inline 8 lines in `CategoryMobile`, or **(b)** move SearchDock's four constants + the rAF branch onto the composable and leave its other scroll work alone. Default to (a) — SearchDock's scroll pass is interleaved with the collapse engine and hands-off is the documented rule. | one copy | (a) -54, -1 file / (b) -14 |
| F2 | **Category docks are one component on two axes.** `findDesktopItemIndex` (`CategoryDesktop.vue:66-97`) and `findMobileItemIndex` (`CategoryMobile.vue:64-95`) are the same three-pass algorithm with `left/right/top/bottom` swapped (~30 lines ×2); also duplicated verbatim-but-renamed: `isVisualActive`, `popActiveIcon`, `handleSelect`, `setItemRef` (`:205-209` / `:220-224`), the `indicatorStyle` object, the `ResizeObserver` + `window.resize` + `document.fonts.ready` lifecycle (`:316-340` / `:290-321`), and `watch(activeIndex)` / `watch(computedItems)`. | `findIndexOnAxis(refs, coord, 'x' \| 'y')` + `useDockIndicator({ navEl, itemRefs, update })` **in the existing `useCategoryItems.ts`** (it is already the shared half of the two docks, and it is documented as "deliberately free of pointers/geometry" — so that sentence and the boundary move with the fold) | -80 |
| F3 | **The applePop bloom is orchestrated twice.** `ContactDock.vue:95-134` and `ProductActions.vue:216-371` both: stop the running animation → clear inline transform/opacity → set `transform-origin` → `will-change` for the pop only → `animate(opacity)` on `applePop.opacity.in/out` **separate from** `animate(transform)` on the spring → track `running` → restore on finish → genie via `collapseTransform(p, trigger)`. | two plain functions in `app/utils/motion.ts`, beside `collapseTransform`: `popIn(el, { origin, red, pair, spring })` and `popOut(el, trigger, { red, pair, to })`, each returning the `Animation` so the caller can still chain its own `finished` work (ProductActions' reveal/`waitForReturn`/caret stays at the call site — **it is not part of the fold**) | -35 |
| F4 | **Admin list plumbing.** The HTML5 drag block is copy-pasted between `categories.vue:30-47` and `site-info.vue:35-53` (`dragUid`, dragStart with `setData`+`effectAllowed`+`setDragImage` off `closest(row)`, inert dragOver, drop, dragEnd), and `isAdminMode` + `refreshAdminMode` + `watch(user, …, { immediate: true })` appears in three pages (`index.vue:25,53,63`, `site-info.vue:6,57,58`, `categories.vue:8,51,52`). | `useAdminListDrag(rowSelector, reorder)` in `app/composables/` — returns the four handlers, **no DOM ownership**; and `isAdminMode` as a computed inside `useAdminAuth`, which already returns `user`. Keep the two "why `dragover` is inert" comments — they are the reason this idiom exists, and they get copied **once** into the new file. | -30 |
| F5 | **Every explicit `any` in `app/`** — 11 × `catch (error: any)` (`useAdminSiteInfoEditor.ts:79,131`, `useAdminCategoryEditor.ts:94,147,204`, `useAdminProductEditor.ts:180,191`, `index.vue:41,50`, `[id].vue:27`, `login.vue:49`) + `isStillInUse(error: any)` (`useAdminCategoryEditor.ts:64`) + 4 × `(document as any).fonts` (`CategoryDesktop.vue:335-336`, `CategoryMobile.vue:317-318` — `document.fonts` is typed in the DOM lib, the cast invents a hole) + 4 × the template-ref pair (`el: any` and `(el as any).$el`, `CategoryDesktop.vue:205-207`, `CategoryMobile.vue:220-222`) | one `errorMessage(err: unknown, fallback: string): string` in `app/utils/` next to `clipboard.ts` (same shape as its siblings: a plain function, one owner for a rule four surfaces read); `document.fonts.ready.then(...)` uncast; `setDesktopItemRef(el: unknown, …)` narrowed once through the `ComponentPublicInstance` union `ProductActions.vue:9` already imports — keep the `.$el` unwrap, it is how motion-v reaches the element | -18 |
| F6 | **`ICON_BY_SLUG` is an identity map**: 22 lines of `foo: 'foo'`. | `const ICON_SLUGS = ['controllers', …] as const` + `categoryIconOf = (slug) => (ICON_SLUGS as readonly string[]).includes((slug \|\| '').toLowerCase()) ? … : 'other'` + `CATEGORY_ICON_ITEMS = ICON_SLUGS.map(s => ({ label: s, value: s }))`. The slug-vs-name matching rule and the lowercase/hyphen-free admin contract both survive verbatim. | -16 |
| F7 | **SearchDock repeated strings/blocks.** The 5-property panel morph transition string is rebuilt at `:787`, `:851`, `:875`, `:899` and the flyer's at `:793`, `:853`, `:903`; `endFlight` (`:451-461`) and `endFieldReturn` (`:518-528`) reset the same fixed box + glyph style by hand; `:780` is a `!overlayMounted.value` guard immediately superseded by `:781`. | `morphTransition(ms)` and `flyerTransition(ms)` local functions, `resetFlyBox()`, delete the dead guard. **No timing constant, no rAF structure, no geometry changes** — this is a string-extraction diff only. | -25 |
| F8 | **`collect` / `collectAttr`** in `app/plugins/locale-decode.client.ts:216-239` are one function with an optional `attr`. | `collect(node, value, attr, fresh)` | -8 |

---

## Module: `motion-gaps`

Numbers come from `applePop`, `press`, and `main.css` only. Frequency-gated: nothing in this module
animates a keyboard-initiated or 100+/day action, and nothing animates data the visitor is reading.

| # | Surface | Change | Reduced motion | Verify |
|---|---|---|---|---|
| M1 | `app/components/CatalogSearchBox.vue:102` — `v-if="isOpen"` results panel is the only surface in the app with no relationship to the control that opened it | Wrap in `<Transition>` and reuse `F3`'s `popIn`/`popOut`: `applePop.below` pair (`scale(0.93) translateY(-8px)` → `rest`) on `applePop.transition` (spring 220/19/1), `transform-origin: top left` (the panel is `left-0 top-full`, so its top-left *is* the field's left edge), opacity on `applePop.opacity.in` 0.2 / `.out` 0.18, exit `applePop.exit` 240ms `cubic-bezier(0.32,0,0.67,0)` into `collapseTransform(p, fieldEl)`. The `v-if="query"` clear glyph (`:87`) gets `@starting-style { opacity: 0; scale: 0.8 }` → settled, 140ms `ease-out`, never `scale(0)`. | `{ duration: 0.2, ease: 'easeOut' }` in / `{ duration: 0.16, ease: 'easeIn' }` out — the same fallback pair `ContactDock` uses, so the setting keeps a contained move and loses the spring character | `bun run verify` (the `[data-catalog-search]` popover checks and the clear-glyph check are existing selectors — a new frame-sampled check `the catalog search popover blooms out of the field and collapses back into it` is added in the same commit, modelled on the existing bloom/`collapsedIntoTrigger` asserts in `verify-ui.mjs`) |
| M2 | 7 × `UAlert v-if` (categories.vue:99,100 · site-info.vue:106,107 · AdminProductEditor.vue:51 · index.vue:234) appear and vanish as a hard cut while the grid next to one of them already fades | one `<Transition name="reveal">` per alert; `main.css`'s existing `.reveal-enter-active` (200ms `ease-out`) is reused unchanged, and its mirror is added next to it: `.reveal-leave-active { transition: opacity 180ms cubic-bezier(0.42, 0, 1, 1) }`, `.reveal-leave-to { opacity: 0 }`. **No translate** — the banners push the rows below them, so a travelling banner would move the form. | needs no gate: opacity only, exactly as `.reveal` already behaves | `bun run lint && bun run verify --only=admin` + `bun run verify` |
| M3 | `index.vue:247-252` — the grid fades in but the skeleton and the empty state hard-cut in the same three-condition slot | the empty state joins the `<Transition name="reveal">` slot (Vue allows one condition per Transition child); the skeleton gets **no** leave animation — `TESTING_SPECS`' top-left flash guard is the reason, and a fading skeleton grid paints a half-grid over the real one | n/a | `bun run verify` (`no products match this view` is matched by text, so the check count must not move) |
| M4 | Press-feedback parity: `ProductGallery.vue` has 8 buttons and zero press states; the admin rows and `AdminProductEditor`'s `UButton`s press silently while 13 storefront controls answer the finger | **owner change, not 20 call sites**: add `active:scale-[0.97] transition-[transform,background-color,color,border-color] duration-150 ease-out` to the existing `button.slots.base` string in `app/app.config.ts:13`, so every Nuxt UI control gets it from the place that already themes them; for the raw `<button>`s (gallery, admin grip/edit/delete rows) the same Tailwind pair. **Not `motion-v` and not `while-press`**: the gallery's zoom maths reads the enlarged `<img>`'s untransformed rect and its ancestors (`TOUCH_RESTRICTIONS` invariant — a transform on an ancestor of the zoomed image corrupts the focal point mid-flight), and 0.97 is below the threshold where a spring is perceptible anyway. | `motion-safe:` prefix on the raw buttons; the `app.config.ts` string uses `motion-safe:active:scale-[0.97]` so the theme owns the gate in one place | `bun run lint && bun run verify`; then the `dark/light mode painted geometry` and `masthead` invariants must stay green — this is the only row in this spec that touches `app.config.ts`, which `TOUCH_RESTRICTIONS` marks as a tuned file |
| M5 | `index.vue:257-262` — filtering adds and drops cards instantly; the container fades only on an empty→non-empty transition | enter-only, no move: `@starting-style { opacity: 0; transform: translateY(6px) }` with `transition: opacity 180ms cubic-bezier(0.33, 1, 0.68, 1), transform 180ms cubic-bezier(0.33, 1, 0.68, 1)` on the card root, stagger capped at `min(index, 6) * 25ms` so a 60-card refilter is never a queue. **Deliberately not `TransitionGroup`** — move transitions on a CSS grid re-import the two traps this repo already documents (a grid item's `min-width:auto` overflow; `ProductCard`'s own transform-owned `reveal` wrapper fighting a second writer). | `@media (prefers-reduced-motion: reduce)` → drop the translate, keep 120ms opacity, matching the page-level floor in `main.css` | `bun run verify`; card-count and grid geometry asserts must not move; then `bun run typecheck` |

---

## Module: `native-icons`

The two biggest cuts in the repo and the only two that touch painted geometry. **Ship last, alone,
and be ready to decline either row on taste.** `@nuxt/icon` is installed transitively via
`@nuxt/ui`, and lucide is already resolved **offline** — proof: `.nuxt/cache/nuxt/icon/lucide_{x,
check,chevrondown,loadercircle,pencil,sun,arrowupright}_*.json` exist, which is how Nuxt UI's own
controls render icons today.

| # | Change | Acceptance | Verify |
|---|---|---|---|
| N1 | Replace the hand-inlined **generic** glyphs with `<UIcon>`: magnifier ×6 (`SearchDock.vue` ×4, `CatalogSearchBox.vue`, `index.vue`), X ×6 files, phone ×3 (`SiteInfoContact.vue`, `ContactDock.vue`, `ProductActions.vue`), map-pin, chevron-down ×3, message-square ×2, sun/moon, arrow-up-right. ~150 lines of 13-line SVG blocks → one `name` + the caller's existing `class`. | `grep -rc "<svg" app/**/*.vue` drops by ~14; every `aria-hidden="true"` stays on the icon element; **`SocialBrandIcon.vue` and `CategoryIcon.vue` are untouched by this row** | `bun run lint && bun run build && bun run verify`, then the harness's painted-area assert (`iconAlpha` / `solid(p, n)`) per icon — `SocialBrandIcon`'s comment states the rule: a truncated path still renders a valid `<path>` and 1.4px of speck, so "the icon is there" is only provable by ink area |
| N2 | `app/components/category/CategoryIcon.vue` (217 lines) re-draws shapes that **are** lucide's (`headphones`, the controller, `keyboard`, the mouse, `monitor`, `cpu`, `hard-drive`, `fan`, `plug-zap`, `wifi`, `mic`, `webcam`, `speaker`, `printer`, `layout-grid`) — the crate fallback included. Replace the `<template>` with a slug → `i-lucide-*` map (22 strings) rendered by `UIcon`. | the dock still renders one glyph per category at the same box size, `other` still falls through for an unknown slug, and the admin icon picker (`CATEGORY_ICON_ITEMS`) is unchanged | `bun run verify` — the category checks are the harness's densest (18-item refactor checklist), so this row is gated on the full green run plus a phone-viewport screenshot |
| N3 | The one real blocker on N1/N2: the repo draws at `stroke-width: 1.75` (`CategoryIcon.vue:23`) and lucide's collection default is 2. Resolve via Iconify's `#stroke-width` customization in `nuxt.config.icon` (or `:stroke-width` on `UIcon`) so **one** config owns the number, rather than keeping 367 lines of inline SVG to preserve it. | `getComputedStyle(svg).strokeWidth === '1.75px'` on any storefront icon | add the assert to `verify-ui.mjs` in the same commit as N1, before N2 lands |

---

## Commands

```bash
bun install                                                # deps; P1-P3 regenerate bun.lock
bun run build                                              # CI job 1: compiles, .output produced
bun run lint                                               # CI job 2: eslint app, fails on NEW errors
bun run verify                                             # scripts/verify-ui.mjs, needs Chrome
bun run verify --only=guest                                # storefront half only
bun run verify --only=admin                                # admin write path only
./node_modules/.bin/tsc -p .nuxt/tsconfig.app.json --noEmit # .ts only
bun run typecheck                                          # vue-tsc: checks .vue templates too
bun run dev                                                # feel-checks (:3000, else :3001)
```

**Per-commit gate (in this order, every time):** `bun run lint` → `bun run build` →
`bun run verify` → `bun run typecheck`. A green `build` means it compiled, not that it works.
Before each module's first commit, run the full gate on a clean tree and write down the check count;
after, the count must be identical (or the diff must be explained in the commit body).

## Project structure

Unchanged by Tier 1 and 2 except: `app/constants/` is deleted by `P5`, `app/directives/` disappears by
`D7`. Source stays `app/**`, backend schema stays `supabase/migrations/**`, the harness stays
`scripts/verify-ui.mjs` + `scripts/fixtures.json`, design stays `ARCHITECTURE.md`.

## Code style

One owner per rule, plain functions over composables, comments that name the measurement rather than
the intention. The Tier-1 shape, and the repo's own reference for it, is `app/utils/product-stock.ts`:
a plain function, one owner for one rule, and the comment says why it is not a composable.

```ts
/**
 * The glyphs `CategoryIcon.vue` draws, and the slugs the admin's picker writes. One list, because the
 * slug and the glyph were always the same word — a map from `mice` to `mice` is a list wearing a coat.
 * Matched on the stored slug and never on a translated name, so a Khmer label keeps its icon.
 */
const ICON_SLUGS = ['controllers', 'keyboards', 'mice', /* … */] as const

export const categoryIconOf = (slug?: string): CategoryIconName =>
  (ICON_SLUGS as readonly string[]).includes((slug || '').toLowerCase().trim())
    ? (slug!.toLowerCase().trim() as CategoryIconName)
    : 'other'
```

Tier-3 rows, if they are ever un-declined, land in the same shape but must not invent a composable for
a rule that reads nothing reactive (`AGENTS.md:37`) — that is `F3`'s `popIn`/`popOut` as plain
functions in `app/utils/motion.ts`, beside `collapseTransform`.

- `type` (never `interface`) for anything handed to a Supabase row or jsonb value; `Views`/`Functions`/
  `Enums`/`CompositeTypes` stay `{ [_ in never]: never }`.
- Select strings stay inline literals.
- No `as any` on any Supabase client or query — and after `F5`/`P6`, nowhere at all.
- Every user-facing string goes through `t()` in en **and** km.

## Testing strategy

- **Framework:** the repo's own raw-CDP harness, `scripts/verify-ui.mjs`, against the built `.output`,
  with a browser-level `fetch` stub answering every `/rest|auth|storage/v1` call from
  `scripts/fixtures.json`. There is no unit-test suite and this spec does not add one.
- **For every fold (`F*`)** the standard is *behaviour-preserving proof*: the same check count and the
  same painted geometry before and after. Where the repo has a precedent, use it — `plans/001` shows
  the frame-recorder probe pattern for a mid-flight measurement, and `verify-ui.mjs` already carries
  `bloomed` / `collapsedIntoTrigger` frame-sampled asserts to copy.
- **For every motion addition (`M*`)** add exactly one assert per surface, in the same commit as the
  change, and keep it effect-gated (a settled popover reads identity whatever curve got it there — the
  assert must sample a frame).
- **Refactor cross-check** (optional, when a fold touches a tuned engine): rebuild the pre-change tag
  in a worktree and diff the `PASS/FAIL` lines, the method `plans/001` used.
- **Coverage:** not measured; the harness's own "what it covers" list lives in
  `docs/rules/TESTING_SPECS.md:36`.

## Boundaries

- **Always:** run the full gate before calling any row done; update `ARCHITECTURE.md` in the same
  commit that alters a boundary it describes (`D2`, `P5` in Tier 1; `F1`–`F3` only if un-declined);
  keep `bun.lock` in sync with `package.json` in the same commit; one atomic scoped commit per numbered
  row; record the baseline check count before the first cut.
- **Ask first:** any Tier-3 row, each one named individually; any edit to `scripts/verify-ui.mjs` that
  deletes or weakens a check; adding or removing a dependency (`P1`, `P2`); anything in `nuxt.config.ts`,
  `app/app.config.ts` or `wrangler.jsonc`.
- **Never:** edit a pushed `supabase/migrations/**` file; introduce a service-role client to resolve
  a permission error; add `as any` to a Supabase client or query; call `.from('products')` /
  `.from('categories')`, map a row, or build a storage URL outside `app/composables/useCatalog.ts`;
  put a data composable in `app/components/`; hand a `t()`-less user-facing string to a template;
  modify a tuned animation, a gesture engine or a `data-*` contract this spec does not name.

## Success criteria

Per tier — a tier is done when its own criteria hold, and Tier 1 can be done without Tier 2 or 3
existing.

**Tier 1**

1. `app/` + `scripts/` + `package.json` + `nuxt.config.ts` line count drops by **≥ 100**.
2. `grep -rn "isSuperAdmin\|scrollbar-none\|constants/catalog\|skills-disabled" app scripts package.json nuxt.config.ts .agents` → **0 hits**.
3. `bun run lint`, `bun run build`, `bun run typecheck` all green, and `bun run verify` green with a
   check count **exactly equal to baseline** — Tier 1 adds no behaviour and no assert. A count that
   moves means a "dead" thing was not dead: revert, do not fix forward.
4. The `F6` acceptance table above holds as an assertion (it does — 13 cases run against the real
   module), and `CATEGORY_ICON_ITEMS` still writes the same 21 slugs from the admin picker.
5. ~~`ARCHITECTURE.md` no longer lists `spotlight`/`panel` as available presets and no longer references
   `app/constants/`.~~ Not owed: neither is named there (verified by grep).
6. Unchanged, provably: the storefront renders the same catalog, the category docks still drag, the
   admin write path still saves, and every icon still has ink.

**Tier 2** — all of Tier 1's criteria plus: `bun run typecheck` 0, and for `D3`/`P1` the real-`.env`
dev-server load shows the same products and header as before the commit; for `P2`, the manual EN↔KM
toggle still preserves scroll position, search text and the loaded catalog.

**Tier 3** — not applicable; nothing is planned until a row is named.

## Risks and rollback

| Risk | Mitigation |
|---|---|
| A Tier-1 "dead" name turns out to have a consumer the greps missed (a dynamic import, an auto-import by name, a string in the harness) | This is the main reason Tier 1 lands one row per commit: `verify` + `typecheck` is the net. Revert the commit; do not patch around it. `D5` is the row most exposed to Nuxt's auto-import, so it lands last in Tier 1. |
| `F6` changes a function the storefront dock **and** the admin icon picker both call | The acceptance table above is run as an assertion before commit; the two docks render live from `computedItems`, so a `verify` category check failing is immediate and unambiguous |
| `P3`/`P1`/`P2` break CI's `--frozen-lockfile` | Regenerate `bun.lock` in the same commit and push the branch to confirm CI **before** merging to `main` — CI is the deploy gate |
| `D3` removes a key a future server route would want | 2 lines in `nuxt.config.ts`; `git revert` restores it, and the reason (RLS is the authorisation boundary) stays in the file's own comment |
| Something in Tier 1 looks harmless and isn't | Nothing in Tier 1 is on a runtime path. If the doubt is bigger than that, the row belongs in Tier 2 with a named check — say so and move it, don't skip the tier |

Rollback is per-row (`git revert <sha>`) and per-tier (`git reset --hard backup/ponytail-tier1-working`).
Tier tags follow `docs/rules/GIT_CONVENTIONS.md` and are cut on a clean tree.

## Decisions taken (the constraint answered the open questions)

The instruction "do not break working features — the core was hard to get working" resolves all five,
so nothing here is still blocking:

1. **`F1`** → Tier 3. It is a documented Known gap with a reason attached, not an oversight.
2. **`N2`** → Tier 3. 217 lines of hand-drawn art stays until you decide it is brand-expendable.
3. **`M5`** → declined outright (100+ paints per keystroke is the frequency tier that says don't).
4. **`P4`** → Tier 3. The 7-line page works; a routing change under `prefix_except_default` does not
   earn its risk here.
5. **Scope** → Tier 1 now, 9 commits; Tier 2 after it, 4 commits, each with its named check.

If you want any Tier-3 row, name it and I will plan that one on its own terms — with the harness
asserts written **before** the change, which is the only way a tuned engine can be folded safely.

## Out of scope, but found and worth a normal review pass

Correctness and i18n, not complexity — deliberately **not** in any module above:

- `app/components/ColorModeToggle.vue:16-17` — hardcoded English `aria-label`/`title` ("Switch to
  light/dark mode") bypass `t()`, against `AGENTS.md:41`. Needs two new keys in en **and** km.
- `app/composables/useAdminAuth.ts:7-13` (`getCurrentUser`) reads only `user.id`, while
  `app/middleware/admin-auth.global.ts:14-19` documents that client-side navigation carries JWT
  claims where the user is `sub`, not `id`. The middleware learned this the hard way; `isAdmin()` may
  not have.
- `app/components/category/Category{Desktop,Mobile}.vue` — the controls are `role="tab"` with
  `aria-selected` inside a plain `<nav>`, with no `role="tablist"` and no tab panel.
