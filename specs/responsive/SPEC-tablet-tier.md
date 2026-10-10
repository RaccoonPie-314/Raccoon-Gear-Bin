# SPEC: tablet tier (iPad gets the desktop layout)

Status: shipped. Owner of the rule: `app/assets/css/main.css` → `@custom-variant lg`.
Rationale lives in [ARCHITECTURE.md](../../ARCHITECTURE.md) → *Desktop vs mobile → Which viewport is
"desktop"*; this file is the acceptance contract, not a second explanation.

## Requirement

An iPad shows the storefront's **desktop** layout in both orientations. A phone keeps the mobile
layout, including held sideways. No second app, no separate route, no UA sniffing.

## The rule

```css
@custom-variant lg {
  @media ((width >= 744px) and (height >= 640px)) or (width >= 1024px) {
    @slot;
  }
}
```

| Bound | Why that number |
|---|---|
| `744px` | the smallest iPad portrait (mini, 744×1133); every larger iPad portrait starts at 810 |
| `640px` height | a sideways phone is 956×**440** — wide, but no room for a sticky rail plus two columns |
| `1024px` unchanged | every viewport that was desktop yesterday is desktop today, at any height |

Rejected: `pointer-coarse:` (an iPad with a Magic Keyboard reports a fine pointer, so it misses the
target device) and a user-agent gate (this app answers media features, per the font stack note).

## Tier map

| Viewport | Before | After |
|---|---|---|
| 744 / 810 / 820 / 834 portrait | mobile | **desktop** |
| 1024×1366 iPad Pro portrait | desktop | desktop |
| 1080–1366 iPad landscape | desktop | desktop |
| 956×440 phone landscape | mobile | mobile |
| 640×960, 390×844, 320×700 | mobile | mobile |
| ≥1024 wide, any height | desktop | desktop |

Because every desktop/mobile swap in the app is a breakpoint class (`hidden lg:flex` / `lg:hidden`,
`hidden lg:block`, `lg:h-screen`) with both mounts present in the DOM, the variant moves the whole
tier — category dock, Contact CTA mount, share surface shape, cart and checkout frames — and no page,
component or composable was edited.

## Acceptance

- `the desktop dock is the only painted one at 834x1112` and `the phone dock is the only painted one
  at 956x440` (`scripts/verify-ui.mjs`), read as painted rects because the hidden mount has none.
- `isDesktopTier()` in the harness restates the predicate so CSS is not its own oracle.
- `CONTACT_INSET[834]` moved `0 → 32` and the sticky-bar assertion is keyed to the predicate: both
  are the tier's own previous fingerprint, re-baselined in the same change.

## Known gap (not fixed here)

On a touch-only iPad the desktop rail works by tap but its fish-eye and drag never fire — they listen
for `mousemove`, which touch does not stream. Recorded in ARCHITECTURE.md; converting that engine is a
measured change to a hands-off component and needs its own budget.
