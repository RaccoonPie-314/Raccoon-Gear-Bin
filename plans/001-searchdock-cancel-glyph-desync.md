# 001 — SearchDock cancel: glyph outruns the circle (asymmetric interrupt)

Status: DONE (applied; verify 323/323)
Commit: 116f678
Severity: MEDIUM (Interruptibility / Physicality — desync between two elements that must move as one)
File: `app/components/SearchDock.vue` — `closeOverlay`, the mid-expansion reverse block (~L843–868)

## Symptom
Normal open and normal close are in sync. But when the open expansion is **cancelled** (ESC /
outside-click mid-flight), the magnifying-glass flyer reaches the icon noticeably before the
transforming circle (the panel) finishes shrinking — the glyph "leads" the circle.

## Root cause (confirmed at file:line)
The reverse block treats the two elements differently:

- **Panel** (L846–852): manually frozen — `transition = 'none'`, write the live `getBoundingClientRect()`
  into `left/top/width/height`, `void panel.offsetWidth` (forced synchronous reflow), then re-arm a
  transition (L859) and set the target (L860).
- **Flyer** (L863–865): a plain reactive retarget — set `flyerTransition`, `flyerBox = iconGlyphBox`,
  `flyerColor`. No freeze, no forced reflow.

A CSS transition **already retargets from the current interpolated value** when you change its target
mid-flight. The panel's manual freeze is therefore unnecessary, and the forced reflow + the
freeze→rearm split makes the panel's reverse begin one layout pass after the flyer's. Same duration
(`CLOSE_MORPH_MS`), same easing (`MORPH_EASE`), different start frame → the glyph arrives first.

## Fix (a deletion — make the two paths symmetric)
Drop the panel freeze so the panel retargets from its current value exactly like the flyer.

**Before** (`app/components/SearchDock.vue`, inside `if (morphing.value) { … if (!openPlaying) … }`):
```ts
    const panel = panelRef.value
    const r = panel.getBoundingClientRect()
    const rad = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || r.height / 2
    panel.style.transition = 'none'
    panel.style.left = `${r.left}px`
    panel.style.top = `${r.top}px`
    panel.style.width = `${r.width}px`
    panel.style.height = `${r.height}px`
    panel.style.borderRadius = `${rad}px`
    void panel.offsetWidth // commit the frozen box before arming the reverse
    if (openTimer) { clearTimeout(openTimer); openTimer = 0 }
    contentTransition.value = `opacity ${CONTENT_OUT_MS}ms ease`
    contentOpacity.value = 0
    backdropTransition.value = `opacity ${BACKDROP_OUT_MS}ms ease`
    backdropOpacity.value = 0
    const ms = reduced.value ? 160 : CLOSE_MORPH_MS
    panel.style.transition = `left ${ms}ms ${MORPH_EASE}, top ${ms}ms ${MORPH_EASE}, width ${ms}ms ${MORPH_EASE}, height ${ms}ms ${MORPH_EASE}, border-radius ${ms}ms ${MORPH_EASE}`
    applyPanelGeom(startGeom)
    flyerTransition.value = `left ${ms}ms ${MORPH_EASE}, top ${ms}ms ${MORPH_EASE}, width ${ms}ms ${MORPH_EASE}, height ${ms}ms ${MORPH_EASE}, color ${ms}ms ${MORPH_EASE}`
    flyerBox.value = iconGlyphBox
    flyerColor.value = launcherGlyphColor
    clearTimeout(closeTimer)
    closeTimer = window.setTimeout(() => { closeTimer = 0; finishClose() }, ms + 40)
    return
```

**After** (freeze removed; panel and flyer both retarget from their current rendered value in the
same frame — no `getBoundingClientRect` read, no `transition:none`, no forced reflow):
```ts
    if (openTimer) { clearTimeout(openTimer); openTimer = 0 }
    contentTransition.value = `opacity ${CONTENT_OUT_MS}ms ease`
    contentOpacity.value = 0
    backdropTransition.value = `opacity ${BACKDROP_OUT_MS}ms ease`
    backdropOpacity.value = 0
    const ms = reduced.value ? 160 : CLOSE_MORPH_MS
    const panel = panelRef.value
    if (panel) panel.style.transition = `left ${ms}ms ${MORPH_EASE}, top ${ms}ms ${MORPH_EASE}, width ${ms}ms ${MORPH_EASE}, height ${ms}ms ${MORPH_EASE}, border-radius ${ms}ms ${MORPH_EASE}`
    applyPanelGeom(startGeom)
    flyerTransition.value = `left ${ms}ms ${MORPH_EASE}, top ${ms}ms ${MORPH_EASE}, width ${ms}ms ${MORPH_EASE}, height ${ms}ms ${MORPH_EASE}, color ${ms}ms ${MORPH_EASE}`
    flyerBox.value = iconGlyphBox
    flyerColor.value = launcherGlyphColor
    clearTimeout(closeTimer)
    closeTimer = window.setTimeout(() => { closeTimer = 0; finishClose() }, ms + 40)
    return
```

Notes:
- `startGeom` and `iconGlyphBox` are already set by the open's `captureScene` — no re-measure needed.
- `applyPanelGeom(startGeom)` still sets `border-radius = height/2`, so the pill invariant holds.
- `r` / `rad` locals and the `getComputedStyle` read become dead — remove them.
- The normal-close path (below this block) already retargets without a freeze; this makes the cancel
  path match it. One mechanism everywhere.

## Why it works
Both the panel (imperative `style.transition` + new target) and the flyer (reactive `flyerTransition`
+ new `flyerBox`) now change target in the same tick with no intervening forced reflow, so the browser
starts both reverse transitions from their current interpolated values on the same frame → they move
together.

## Scope boundaries
- Touch ONLY the `if (morphing.value) { … openPlaying … }` reverse block in `closeOverlay`.
- Do NOT change `applyPanelGeom`, `captureScene`, the open rAF, the normal-close path, the flight
  engine, or any timing constants.
- Do NOT reintroduce motion-v on this surface (it stalls in the user's dev/HMR browser — see
  ARCHITECTURE "Spotlight open / close morph").

## Verification
1. `bun run build && bun run lint && node scripts/verify-ui.mjs` — expect no regressions
   (baseline 323/323; the existing `Escape mid-expansion reverses the panel and still completes`
   and `spotlight opens with a live morph` pill-invariant checks must stay green).
2. Feel-check the cancel (this is the part code can't prove): open the dev server, scroll so the
   field is the sidebar icon, click it, then hit ESC ~120 ms in. Watch the magnifying glass and the
   circle land on the icon **together**. If the glyph still leads, record per-frame positions with the
   frame-recorder probe below and compare the two curves — they must overlap.
3. Frame-recorder probe (paste in DevTools, then trigger a cancel):
   ```js
   const P = document.querySelector('[data-search-panel]')
   const F = [...document.querySelectorAll('[role="dialog"] span')].find(s => s.querySelector('svg circle'))
   const t0 = performance.now(); const rows = []
   const tick = () => { rows.push([Math.round(performance.now()-t0),
     Math.round(P.getBoundingClientRect().left), Math.round(F.getBoundingClientRect().left)]);
     if (performance.now()-t0 < 500) requestAnimationFrame(tick); else console.table(rows) }
   requestAnimationFrame(tick)
   ```
   The panel-left and flyer-left columns should decrease in lockstep (a roughly constant offset), not
   have the flyer pull ahead early.
