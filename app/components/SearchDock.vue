<script setup lang="ts">
import { animate, useReducedMotion } from 'motion-v'
import { spotlight } from '~/utils/motion'

const searchQuery = defineModel<string>({ default: '' })

withDefaults(defineProps<{ resultCount?: number }>(), { resultCount: 0 })

const { t } = useI18n()

// The icon only takes over once the real search field has scrolled away, so the two never share the screen.
const SEARCH_FIELD_SELECTOR = '[data-search-anchor]'
const FIELD_GONE_AT = 0
const FIELD_BACK_AT = 24
const DOCK_REVEAL_AT = 60
const DOCK_DIRECTION_DELTA = 6

// The top field morphs IN PLACE: its width is a function of scroll over the last FIELD_SCRUB_W px
// before it reaches the top edge (full ↔ FIELD_ICON_MIN), with a short settle when the scroll stops
// mid-way. This gives the genuine expanding animation (and the real field's own leading glyph, so
// no mis-centred icon). The launcher then only carries the icon↔circle TRAVEL (narrow, anchored to
// the field), not the width. FIELD_FLY_MS governs that travel. Desktop only.
const FIELD_SCRUB_W = 180
const FIELD_MORPH_MS = 260
const FIELD_ICON_MIN = 52
const FIELD_FLY_MS = 500
// Ease-out-expo spent 49% of the size change in the first 46ms, so the morph read as a snap.
// Ease-out-cubic spreads the same motion across the whole duration.
const MORPH_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'
const BACKDROP_IN_MS = 260
const BACKDROP_OUT_MS = 200
const CONTENT_IN_MS = 220
const CONTENT_OUT_MS = 140
const CONTENT_DELAY_MS = 150
const DESKTOP_QUERY = '(min-width: 1024px)'
const LAUNCHER_MOTION = 'opacity 300ms ease, transform 300ms cubic-bezier(0.22, 1, 0.36, 1)'
const SCROLL_KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'])

const isCollapsed = ref(false)
const isDockVisible = ref(true)

// Sidebar-icon flight refs (see FIELD_FLY_MS). Both directions animate the real launcher as a
// `position: fixed` box at flyLeft/Top/W/H — an absolute viewport position, so the sticky sidebar's
// layout drift (which a transform inherits) can never misplace it, and the flex-centred glyph needs
// no transform so it never distorts. Only ever live on the desktop launcher while `flying`.
const flying = ref(false)
const flyTransition = ref('none')
const flyRadius = ref('')
const flyLeft = ref(0)
const flyTop = ref(0)
const flyW = ref(44)
const flyH = ref(44)

const overlayMounted = ref(false)
const overlayActive = ref(false)
const overlayClosing = ref(false)
const launcherTaken = ref(false)
const suppressLauncherMotion = ref(false)
const morphing = ref(false)

const backdropOpacity = ref(0)
const backdropTransition = ref(`opacity ${BACKDROP_IN_MS}ms ease`)
const contentOpacity = ref(0)
const contentTransition = ref(`opacity ${CONTENT_IN_MS}ms ease ${CONTENT_DELAY_MS}ms`)
const panelOpacity = ref(1)
const panelTransform = ref('none')
const panelTransition = ref('none')
const panelRadius = ref('')
const flyerTransform = ref('none')
const flyerTransition = ref('none')
const flyerBox = ref<{ left: string, top: string, size: string } | null>(null)

const desktopLauncherRef = ref<HTMLButtonElement | null>(null)
const mobileLauncherRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const overlayInputRef = ref<HTMLInputElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
const realGlyphRef = ref<HTMLElement | null>(null)
const flyerRef = ref<HTMLElement | null>(null)
const reduced = useReducedMotion()
// Phase E: the overlay FLIP is played by Motion, not a CSS transition + transitionend/settle timer.
// animate() writes the panel/flyer inline transform + radius directly; the reactive transform refs
// stay pinned at the start for the length of the spring (Vue only rewrites a style key whose bound
// value changed, so it never clobbers the running animation) and are snapped to the end value on
// `.finished`. Handles are kept so an interrupted morph is stopped and re-aimed, not stacked.
type OverlayAnim = { stop(): void, finished: Promise<unknown> }
let panelAnim: OverlayAnim | null = null
let flyerAnim: OverlayAnim | null = null

const panelStartTransform = ref('none')
const flyerStartTransform = ref('none')
const flyerColor = ref('')

let searchFieldEl: HTMLElement | null = null
let launcherGlyphColor = ''
let panelGlyphColor = ''
let collapsedRadius = ''
let restingRadius = ''
let originClickEvent: Event | null = null
let restoreFrame = 0
// Unified launcher flight (BOTH directions): one drift-free `position:fixed` rAF engine lerping the
// real launcher between the field's live rect and the sidebar slot. `flyTarget` is where it is
// heading; `flyFrom` is its box at (re)start; `flySidebar` is the launcher's static slot, refreshed
// while idle. Because a reversal re-aims from the CURRENT visual box (`flyFrom` when already flying)
// instead of restarting from an endpoint, interrupting a fly-up by scrolling down no longer teleports
// or displaces it — the root of the last two bug reports.
type FlyRect = { left: number, top: number, width: number, height: number }
let flyFrame = 0
let flyT0 = 0
let flyTarget: 'field' | 'sidebar' = 'sidebar'
let flyFrom: FlyRect | null = null
let flySidebar: FlyRect | null = null
// The field's last on-screen rect — a fresh collapse flight's origin.
let lastVisibleFieldRect: FlyRect | null = null
// Restore-specific: whether the launcher is mid up-flight, the real field hidden while it flies in,
// and whether the post-landing in-place expand still owns the width.
let upFlying = false
let returnTimer: ReturnType<typeof setTimeout> | null = null
let returnActive = false
let collapseFieldEl: HTMLElement | null = null
let collapseFieldWasFocused = false
// Scroll-linked field-width scrub state: fieldIdleTimer settles a mid-band width once the scroll
// stops; fieldNaturalW caches the class-driven full width so the scrub need not measure each frame.
let fieldIdleTimer: ReturnType<typeof setTimeout> | null = null
let fieldNaturalW = 0
let scrollTicking = false
let lastScrollY = 0
let scrollLocked = false
let lockedScrollY = 0

// The launchers fade in/out (isCollapsed). The scroll morph: the top FIELD animates its own width in
// place (updateFieldMorph), and the desktop launcher flies as a narrow fixed box between the field's
// icon footprint and the sidebar slot (startFly).
const desktopLauncherStyle = computed(() => {
  if (flying.value) {
    // A fixed box at an absolute viewport position (drift-free), flex-centred glyph → no transform,
    // no distortion, and a reversal re-aims from wherever it currently is.
    return {
      position: 'fixed' as const,
      margin: '0',
      left: `${flyLeft.value.toFixed(2)}px`,
      top: `${flyTop.value.toFixed(2)}px`,
      width: `${flyW.value.toFixed(2)}px`,
      height: `${flyH.value.toFixed(2)}px`,
      borderRadius: flyRadius.value,
      transform: 'none',
      opacity: 1,
      transition: flyTransition.value,
      pointerEvents: 'none' as const,
      willChange: 'left, top, width, height'
    }
  }
  const visible = isCollapsed.value && !launcherTaken.value
  return {
    opacity: visible ? 1 : 0,
    transform: visible ? 'scale(1)' : 'scale(0.92)',
    transition: launcherTaken.value || suppressLauncherMotion.value ? 'none' : LAUNCHER_MOTION,
    borderRadius: '',
    transformOrigin: '',
    pointerEvents: visible ? 'auto' as const : 'none' as const
  }
})

const mobileLauncherStyle = computed(() => {
  const visible = isCollapsed.value && isDockVisible.value && !launcherTaken.value
  return {
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0px) scale(1)' : 'translateY(18px) scale(0.92)',
    transition: launcherTaken.value || suppressLauncherMotion.value ? 'none' : LAUNCHER_MOTION,
    pointerEvents: visible ? 'auto' as const : 'none' as const
  }
})

const readScrollY = () => window.scrollY || document.documentElement.scrollTop || 0

// Hysteresis on the field's own position: it must clear the top edge to collapse, and return 24px to restore.
const searchField = () => {
  if (!searchFieldEl?.isConnected) searchFieldEl = document.querySelector<HTMLElement>(SEARCH_FIELD_SELECTOR)
  return searchFieldEl
}

const fieldIsOffScreen = () => {
  const field = searchField()
  if (!field) return false
  const limit = isCollapsed.value ? FIELD_BACK_AT : FIELD_GONE_AT
  return field.getBoundingClientRect().bottom <= limit
}

const handleScroll = () => {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(() => {
    const currentY = readScrollY()
    const wasCollapsed = isCollapsed.value
    isCollapsed.value = fieldIsOffScreen()

    // Keep the field's last on-screen rect — the collapse flight's origin (once it has scrolled
    // past the top its live rect is off-screen, so remember where the user last saw it).
    const field = searchField()
    if (field) {
      const r = field.getBoundingClientRect()
      if (r.width && r.top >= 0 && r.top < window.innerHeight)
        lastVisibleFieldRect = { left: r.left, top: r.top, width: r.width, height: r.height }
    }

    if (currentY < DOCK_REVEAL_AT) {
      isDockVisible.value = true
    } else {
      const delta = currentY - lastScrollY
      if (delta > DOCK_DIRECTION_DELTA) isDockVisible.value = false
      else if (delta < -DOCK_DIRECTION_DELTA) isDockVisible.value = true
    }
    lastScrollY = Math.max(0, currentY)

    // Desktop only, one flight engine both ways. A fresh edge flies field↔sidebar; an edge that
    // lands while a flight is already running (a fast/snappy scroll reversal) re-aims from the
    // launcher's live box, so it never teleports. `flySidebar` is the settled slot, refreshed while
    // the launcher is static so a collapse has an accurate destination.
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      if (!flying.value) flySidebar = launcherRestRect()
      if (isCollapsed.value && !wasCollapsed) startFly('sidebar')
      else if (!isCollapsed.value && wasCollapsed) startFly('field')
    }

    // Recompute the field's in-place width from scroll (the expanding animation), then a short
    // debounce settles a mid-morph width to the nearer endpoint once the scroll stops.
    updateFieldMorph()
    fieldIdleClear()
    if (window.matchMedia(DESKTOP_QUERY).matches)
      fieldIdleTimer = setTimeout(settleField, 120)

    scrollTicking = false
  })
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)
const smooth = (t: number) => t * t * (3 - 2 * t)

// The field's natural (class-driven) width: measured with any inline width temporarily cleared.
const naturalFieldWidth = () => {
  const field = searchField()
  if (!field) return 0
  const prev = field.style.width
  field.style.width = ''
  const w = field.getBoundingClientRect().width
  field.style.width = prev
  return w
}

// 0 when the field's top is a full FIELD_SCRUB_W below the edge (fully a field), 1 at/above the edge
// (fully the icon). Everything between is measured live off the field's own position.
const fieldScrubProgress = (top: number) => clamp01((FIELD_SCRUB_W - top) / FIELD_SCRUB_W)

// The field-side endpoint for BOTH flights: a narrow icon footprint (FIELD_ICON_MIN wide) at the
// field's leading edge, not the full rect — the launcher box centres its glyph, so a WIDE box would
// mis-place it; the full↔icon morph lives on the real field (whose glyph is genuinely leading).
const iconFootprint = (rect: FlyRect): FlyRect => ({
  left: rect.left,
  top: rect.top,
  width: Math.min(rect.width, FIELD_ICON_MIN),
  height: rect.height
})

// Recompute the field's IN-PLACE width from scroll every frame (the expanding animation), plus hide
// it whenever the launcher represents it (collapsed, or mid restore-flight). No CSS transition on the
// width: it is written straight from scroll, so it tracks the wheel and never lags/snaps.
const updateFieldMorph = () => {
  const field = searchField()
  if (!field) return
  // The restore flight + its in-place expand own the field entirely; scroll must not fight them.
  if (returnActive || upFlying) return
  if (!window.matchMedia(DESKTOP_QUERY).matches) { field.style.visibility = ''; revertFieldWidth(); return }
  field.style.visibility = isCollapsed.value ? 'hidden' : ''
  const p = fieldScrubProgress(field.getBoundingClientRect().top)
  if (p <= 0.002) {
    field.style.transition = 'none'
    field.style.overflow = ''
    field.style.width = ''
    fieldNaturalW = field.getBoundingClientRect().width
    return
  }
  if (!fieldNaturalW) fieldNaturalW = naturalFieldWidth()
  if (!fieldNaturalW) return
  field.style.transition = 'none'
  field.style.overflow = 'hidden'
  field.style.width = `${Math.round(lerp(fieldNaturalW, FIELD_ICON_MIN, smooth(p)))}px`
}

// Scroll stopped mid-scrub: glide the width to the nearer endpoint, then release a full expand back
// to the responsive classes. A stable target now (no scroll), so no chase. No-op at an endpoint.
const settleField = () => {
  const field = searchField()
  if (!field || !window.matchMedia(DESKTOP_QUERY).matches) return
  if (upFlying || returnActive) return
  const p = fieldScrubProgress(field.getBoundingClientRect().top)
  if (p <= 0.02 || p >= 0.98) return
  fieldIdleClear()
  const toField = p < 0.5
  field.style.overflow = 'hidden'
  field.style.transition = `width ${FIELD_MORPH_MS}ms ${MORPH_EASE}`
  field.style.width = toField ? `${fieldNaturalW || naturalFieldWidth()}px` : `${FIELD_ICON_MIN}px`
  if (toField) fieldIdleTimer = setTimeout(revertFieldWidth, FIELD_MORPH_MS + 40)
}

// Reconcile the field with the current breakpoint + scroll, no animation — mount / resize entry.
const applyFieldWidth = () => {
  fieldIdleClear()
  fieldNaturalW = 0
  updateFieldMorph()
}

// Hand the field back to its own class-driven width (expand settled, mobile, or unmount).
const revertFieldWidth = () => {
  fieldIdleTimer = null
  const field = searchField()
  if (!field) return
  field.style.transition = 'none'
  field.style.width = ''
  field.style.overflow = ''
}

const fieldIdleClear = () => {
  if (fieldIdleTimer) { clearTimeout(fieldIdleTimer); fieldIdleTimer = null }
}


// The launcher's static (sidebar) rect, neutralising any fade transform so we measure the slot, not
// the scaled/hidden state. Used as the collapse destination and the fresh-restore origin.
const launcherRestRect = (): FlyRect | null => {
  const el = desktopLauncherRef.value
  if (!el) return null
  const pt = el.style.transform
  const ptr = el.style.transition
  el.style.transition = 'none'
  el.style.transform = 'none'
  const r = el.getBoundingClientRect()
  el.style.transform = pt
  el.style.transition = ptr
  return r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
}

const readRect = (el: HTMLElement): FlyRect => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

// ---------------------------------------------------------------- launcher flight (both ways)
// One drift-free engine. The launcher becomes a `position: fixed` box at flyLeft/Top/W/H, lerped
// between two endpoints over FIELD_FLY_MS on a fixed rAF clock:
//   • flyTarget 'sidebar' (collapse): field's last rect → the sidebar slot.
//   • flyTarget 'field'   (restore):  the sidebar slot  → the field's LIVE rect, revealing the field
//     on arrival so it can never show alongside the flying icon.
// `flyFrom` is the launcher's CURRENT visual box when a flight is already running — so reversing
// direction mid-flight (fast/snappy scroll) re-aims from where the icon actually is instead of
// teleporting to an endpoint. That is the whole point of the rewrite: the old code had a transform
// collapse and a fixed restore that could not hand off to each other without a jump.
const startFly = (target: 'field' | 'sidebar') => {
  const launcher = desktopLauncherRef.value
  const field = searchField()
  if (!launcher || !field) return
  const origin: FlyRect | null = flying.value
    ? readRect(launcher)                                    // reversal: continue from the live box
    : target === 'sidebar' ? iconFootprint(lastVisibleFieldRect ?? readRect(field))  // collapse: field's icon footprint
    : (flySidebar ?? launcherRestRect())                    // fresh restore: from the sidebar slot
  if (!origin) { flyClear(); return }
  if (flyFrame) { cancelAnimationFrame(flyFrame); flyFrame = 0 }
  flyFrom = origin
  flyTarget = target
  upFlying = target === 'field'
  if (target === 'field') hideFieldForReturn(field)
  // Seed the box at its origin BEFORE showing it: the style branch reads flyLeft/Top, and if those
  // still held the last flight's (or default 0,0) values the fixed icon would flash at the top-left
  // for the frame before flyStep runs.
  flyLeft.value = origin.left
  flyTop.value = origin.top
  flyW.value = origin.width
  flyH.value = origin.height
  flyRadius.value = `${Math.round(Math.min(origin.width, origin.height) / 2)}px`
  flying.value = true
  flyTransition.value = 'none'
  flyT0 = performance.now()
  flyFrame = requestAnimationFrame(flyStep)
}

const flyStep = () => {
  if (!flying.value) return
  const launcher = desktopLauncherRef.value
  const field = searchField()
  const from = flyFrom
  if (!launcher || !field || !from) { flyFinish(); return }
  const elapsed = performance.now() - flyT0
  const t = Math.min(1, elapsed / FIELD_FLY_MS)
  const k = 1 - (1 - t) ** 3 // ease-out cubic
  // The field-side target is its live icon footprint (re-read each frame so the box lands wherever
  // the field is, even as it scrolls); the sidebar target is the captured slot. Straight-line lerp.
  const to: FlyRect = flyTarget === 'field'
    ? iconFootprint(readRect(field))
    : (flySidebar ?? readRect(launcher))
  flyLeft.value = lerp(from.left, to.left, k)
  flyTop.value = lerp(from.top, to.top, k)
  flyW.value = lerp(from.width, to.width, k)
  flyH.value = lerp(from.height, to.height, k)
  flyRadius.value = `${Math.round(Math.min(flyW.value, flyH.value) / 2)}px`
  if (elapsed < FIELD_FLY_MS) { flyFrame = requestAnimationFrame(flyStep); return }
  // One extra frame so the arrival box is PAINTED before `flying` is released (Vue would otherwise
  // batch the final position with the release and the icon would vanish short of its target).
  flyFrame = requestAnimationFrame(() => { flyFrame = 0; flyFinish() })
}


const flyFinish = () => {
  if (flyTarget === 'field') endFieldReturn()
  else endFlight()
}

// Collapse arrival: drop the fixed box; the launcher is already at its sidebar slot so the normal
// isCollapsed fade holds it. The field stays hidden (we are collapsed).
const endFlight = () => {
  flying.value = false
  flyTransition.value = 'none'
  flyRadius.value = ''
  flyLeft.value = 0; flyTop.value = 0; flyW.value = 44; flyH.value = 44
  const glyph = desktopLauncherRef.value?.querySelector('svg')
  if (glyph) { glyph.style.transition = ''; glyph.style.transform = '' }
}

// Full teardown (overlay open, resize, unmount): stop the flight and reveal any field hidden for a
// restore, so the real search is never left invisible.
const flyClear = () => {
  if (flyFrame) { cancelAnimationFrame(flyFrame); flyFrame = 0 }
  upFlying = false
  endFlight()
  abortFieldReturn()
}

// Hide the real field for the restore flight (it must not overlap the flying box) and pin it to the
// icon footprint so it can expand from there. `visibility` keeps layout + focus (collapse detection
// still measures it; a focused field survives).
const hideFieldForReturn = (field: HTMLElement) => {
  if (collapseFieldEl) return
  collapseFieldWasFocused = document.activeElement === field
  collapseFieldEl = field
  field.style.transition = 'none'
  field.style.overflow = 'hidden'
  field.style.width = `${FIELD_ICON_MIN}px` // start the expand from the icon footprint
  field.style.visibility = 'hidden'
}

// Re-show a field hidden for a restore; keep (or restore) focus so typing survives.
const revealSearchField = () => {
  const field = collapseFieldEl
  if (!field) return
  collapseFieldEl = null
  field.style.visibility = ''
  if (collapseFieldWasFocused && document.activeElement !== field) field.focus({ preventScroll: true })
  collapseFieldWasFocused = false
}

// Restore arrival: release the box IN PLACE (suppress its fade for one commit so it vanishes at the
// field rather than retracting to the drifted sidebar slot), reveal the field, then expand it in
// place from the icon footprint (the visible "expanding animation").
const endFieldReturn = () => {
  upFlying = false
  suppressLauncherMotion.value = true
  flying.value = false
  flyTransition.value = 'none'
  flyRadius.value = ''
  flyLeft.value = 0; flyTop.value = 0; flyW.value = 44; flyH.value = 44
  const glyph = desktopLauncherRef.value?.querySelector('svg')
  if (glyph) { glyph.style.transition = ''; glyph.style.transform = '' }
  requestAnimationFrame(() => requestAnimationFrame(() => { suppressLauncherMotion.value = false }))
  revealSearchField()
  if (returnTimer) { clearTimeout(returnTimer); returnTimer = null }
  returnActive = true
  const field = searchField()
  if (field) {
    field.style.overflow = 'hidden'
    field.style.transition = 'none'
    field.style.width = `${FIELD_ICON_MIN}px`
    void field.offsetWidth // commit the icon start so the transition has a concrete length
    const natural = fieldNaturalW || naturalFieldWidth()
    field.style.transition = `width ${FIELD_MORPH_MS}ms ${MORPH_EASE}`
    field.style.width = `${natural}px`
    returnTimer = setTimeout(finishFieldExpand, FIELD_MORPH_MS + 40)
  } else {
    returnActive = false
  }
}

const finishFieldExpand = () => {
  returnTimer = null
  returnActive = false
  fieldNaturalW = 0
  revertFieldWidth()
}

// Tear down a restore in progress (reversal to collapse, overlay open, resize, unmount): reveal the
// field and stop the expand so scroll-scrub takes over from wherever it landed.
const abortFieldReturn = () => {
  upFlying = false
  if (returnTimer) { clearTimeout(returnTimer); returnTimer = null }
  returnActive = false
  revealSearchField()
}




const activeLauncherEl = () => {
  if (typeof window === 'undefined') return null
  return window.matchMedia(DESKTOP_QUERY).matches ? desktopLauncherRef.value : mobileLauncherRef.value
}

// During a morph the panel reports its *transformed* box, and neutralising it through refs
// cannot flush before the read. Instead invert the panel's own matrix: origin is top left, so
// screen = layout + translate and size * scale.
const toLayoutRect = (rect: DOMRect, panelRect: DOMRect, m: DOMMatrix) => ({
  left: panelRect.left - m.e + (rect.left - panelRect.left) / m.a,
  top: panelRect.top - m.f + (rect.top - panelRect.top) / m.d,
  width: rect.width / m.a,
  height: rect.height / m.d
})

const measureScene = () => {
  const panel = panelRef.value
  const glyph = realGlyphRef.value
  if (!panel || !glyph) return null

  const panelRect = panel.getBoundingClientRect()
  const computed = getComputedStyle(panel).transform
  const m = computed === 'none' ? new DOMMatrix() : new DOMMatrix(computed)
  const glyphRect = toLayoutRect(glyph.getBoundingClientRect(), panelRect, m)
  panelGlyphColor = getComputedStyle(glyph).color

  return {
    panelRect: toLayoutRect(panelRect, panelRect, m),
    glyphRect
  }
}

const captureScene = (launcherEl: HTMLElement) => {
  const scene = measureScene()
  if (!scene) return false

  // The launcher is scaled down while the overlay owns its slot, so measure its resting box instead.
  const previousTransform = launcherEl.style.transform
  const previousTransition = launcherEl.style.transition
  launcherEl.style.transition = 'none'
  launcherEl.style.transform = 'none'

  const launcherRect = launcherEl.getBoundingClientRect()
  const launcherGlyph = launcherEl.querySelector('svg')
  const launcherGlyphRect = launcherGlyph?.getBoundingClientRect() ?? launcherRect
  launcherGlyphColor = launcherGlyph ? getComputedStyle(launcherGlyph).color : ''

  launcherEl.style.transform = previousTransform
  launcherEl.style.transition = previousTransition
  if (!launcherRect.width || !scene.panelRect.width || !scene.glyphRect.width) return false

  panelStartTransform.value = `translate3d(${launcherRect.left - scene.panelRect.left}px, ${launcherRect.top - scene.panelRect.top}px, 0) scale(${launcherRect.width / scene.panelRect.width}, ${launcherRect.height / scene.panelRect.height})`
  flyerStartTransform.value = `translate3d(${launcherGlyphRect.left + launcherGlyphRect.width / 2 - (scene.glyphRect.left + scene.glyphRect.width / 2)}px, ${launcherGlyphRect.top + launcherGlyphRect.height / 2 - (scene.glyphRect.top + scene.glyphRect.height / 2)}px, 0) scale(${launcherGlyphRect.width / scene.glyphRect.width})`
  flyerBox.value = { left: `${scene.glyphRect.left}px`, top: `${scene.glyphRect.top}px`, size: `${scene.glyphRect.width}px` }

  // A non-uniform scale squashes `rounded-full` into a rounded rectangle, so the radii are
  // pre-compensated per axis: the pill stays a pill and the icon lands on a true circle.
  const screenRadius = Math.min(launcherRect.width, launcherRect.height) / 2
  collapsedRadius = `${screenRadius * scene.panelRect.width / launcherRect.width}px / ${screenRadius * scene.panelRect.height / launcherRect.height}px`
  restingRadius = `${scene.panelRect.height / 2}px`

  return true
}

const blockScroll = (event: WheelEvent) => {
  event.preventDefault()
}

const keepScrollPosition = () => {
  const y = readScrollY()
  if (Math.abs(y - lockedScrollY) < 1) return
  // The stylesheet asks for smooth scrolling, which would turn this snap-back into a feedback loop.
  window.scrollTo({ top: lockedScrollY, left: 0, behavior: 'instant' })
}

// Blocking the scroll events instead of toggling `overflow: hidden` keeps the sticky sidebar stuck,
// so the launcher never moves while the overlay owns the screen.
const lockScroll = () => {
  if (scrollLocked) return
  scrollLocked = true
  lockedScrollY = readScrollY()
  window.addEventListener('wheel', blockScroll, { passive: false })
  window.addEventListener('touchmove', handleTouchMove, { passive: false })
  window.addEventListener('scroll', keepScrollPosition)
}

const unlockScroll = () => {
  if (!scrollLocked) return
  scrollLocked = false
  window.removeEventListener('wheel', blockScroll)
  window.removeEventListener('touchmove', handleTouchMove)
  window.removeEventListener('scroll', keepScrollPosition)
}

const focusOverlayInput = () => {
  overlayInputRef.value?.focus({ preventScroll: true })
}

const finishOpen = () => {
  if (overlayClosing.value || !morphing.value) return
  morphing.value = false
}

const isInsidePanel = (node: EventTarget | null) => {
  const panel = panelRef.value
  return !!panel && node instanceof Node && panel.contains(node)
}

// Outside clicks must reach the page (so listings still open) while the overlay dismisses itself.
const handleDocumentClick = (event: MouseEvent) => {
  if (event === originClickEvent || overlayClosing.value) return
  if (isInsidePanel(event.target)) return
  void closeOverlay()
}

const handleTouchMove = (event: TouchEvent) => {
  if (isInsidePanel(event.target)) return
  event.preventDefault()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeOverlay()
    return
  }
  // The page cannot scroll by events any more, but a focused button would still act on these.
  if (event.target !== overlayInputRef.value && SCROLL_KEYS.has(event.key)) event.preventDefault()
  if (event.key !== 'Tab') return

  const focusables = [overlayInputRef.value, closeButtonRef.value].filter(Boolean) as HTMLElement[]
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (!first || !last) return

  const active = document.activeElement as HTMLElement | null
  if (!active || !focusables.includes(active)) {
    event.preventDefault()
    first.focus()
    return
  }
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

const openOverlay = async (event: MouseEvent) => {
  if (overlayMounted.value) return
  const launcherEl = event.currentTarget as HTMLElement | null
  if (!launcherEl) return

  originClickEvent = event
  overlayMounted.value = true
  flyClear()
  overlayActive.value = false
  overlayClosing.value = false
  morphing.value = true
  panelOpacity.value = 1
  panelTransform.value = 'none'
  panelTransition.value = 'none'
  panelRadius.value = ''
  flyerTransform.value = 'none'
  flyerTransition.value = 'none'
  backdropOpacity.value = 0
  backdropTransition.value = `opacity ${BACKDROP_IN_MS}ms ease`
  contentOpacity.value = 0
  contentTransition.value = `opacity ${CONTENT_IN_MS}ms ease ${CONTENT_DELAY_MS}ms`

  lockScroll()
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleDocumentClick)

  await nextTick()
  if (overlayClosing.value) return

  if (!captureScene(launcherEl)) {
    overlayActive.value = true
    launcherTaken.value = true
    morphing.value = false
    panelRadius.value = ''
    backdropOpacity.value = 1
    contentOpacity.value = 1
    focusOverlayInput()
    return
  }

  // Start from the launcher's exact pixels: the pill and glyph take over the icon's place.
  panelTransform.value = panelStartTransform.value
  panelRadius.value = collapsedRadius
  flyerTransform.value = flyerStartTransform.value
  flyerColor.value = launcherGlyphColor
  overlayActive.value = true
  launcherTaken.value = true

  await nextTick()
  if (overlayClosing.value) return
  focusOverlayInput()

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!overlayMounted.value || overlayClosing.value) return
    // Motion plays the FLIP: the pill (transform + radius) and the glyph flyer (transform + color)
    // spring from the launcher's exact pixels to their resting spots. Backdrop and content keep their
    // own opacity fades, so text never stretches while the surface grows. Reduced motion swaps the
    // frame spring for a short eased duration. The reactive transform refs stay at the start for the
    // length of the spring (Vue skips rewriting an unchanged style key) and are snapped on finish.
    backdropOpacity.value = 1
    contentOpacity.value = 1
    const frame = reduced.value ? { duration: 0.2, ease: [0.16, 1, 0.3, 1] } : spotlight.frame
    const panel = panelRef.value
    const flyer = flyerRef.value
    if (panel) {
      const a = animate(
        panel,
        { transform: [panelStartTransform.value, 'translate3d(0px, 0px, 0) scale(1, 1)'], borderRadius: [collapsedRadius, restingRadius] },
        frame
      )
      panelAnim = a
      void a.finished.then(() => {
        if (panelAnim !== a) return
        panelAnim = null
        panelTransform.value = 'translate3d(0px, 0px, 0) scale(1, 1)'
        panelRadius.value = restingRadius
        finishOpen()
      })
    } else {
      finishOpen()
    }
    if (flyer) {
      const g = animate(
        flyer,
        { transform: [flyerStartTransform.value, 'translate3d(0px, 0px, 0) scale(1)'], color: [launcherGlyphColor, panelGlyphColor] },
        frame
      )
      flyerAnim = g
      void g.finished.then(() => {
        if (flyerAnim !== g) return
        flyerAnim = null
        flyerTransform.value = 'translate3d(0px, 0px, 0) scale(1)'
        flyerColor.value = panelGlyphColor
      })
    }
  }))
}

const finishClose = () => {
  if (!overlayMounted.value) return
  overlayMounted.value = false
  overlayActive.value = false
  overlayClosing.value = false
  morphing.value = false
  suppressLauncherMotion.value = true
  launcherTaken.value = false
  unlockScroll()
  restoreFrame = requestAnimationFrame(() => requestAnimationFrame(() => {
    suppressLauncherMotion.value = false
    restoreFrame = 0
  }))
}

const closeOverlay = async () => {
  if (!overlayMounted.value || overlayClosing.value) return
  overlayClosing.value = true
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
  originClickEvent = null

  contentTransition.value = `opacity ${CONTENT_OUT_MS}ms ease`
  contentOpacity.value = 0
  backdropTransition.value = `opacity ${BACKDROP_OUT_MS}ms ease`
  backdropOpacity.value = 0

  const launcherEl = activeLauncherEl()
  const launcherRect = launcherEl?.getBoundingClientRect()
  const frame = reduced.value ? { duration: 0.2, ease: [0.16, 1, 0.3, 1] } : spotlight.frame
  panelAnim?.stop()
  flyerAnim?.stop()

  // Fallback: no launcher to snap back onto — shrink in place and fade out, then unmount.
  if (!launcherEl || !launcherRect?.width || !captureScene(launcherEl)) {
    const panel = panelRef.value
    if (panel) {
      const a = animate(panel,
        { transform: ['translate3d(0px, 0px, 0) scale(1, 1)', 'translate3d(0px, 0px, 0) scale(0.97, 0.97)'], opacity: 0 },
        frame)
      panelAnim = a
      void a.finished.then(() => { if (panelAnim === a) panelAnim = null; finishClose() })
    } else {
      finishClose()
    }
    return
  }

  // Park the glyph at identity (its resting spot) unless a morph is already mid-flight carrying it.
  const wasMorphing = morphing.value
  morphing.value = true
  if (!wasMorphing) {
    flyerTransform.value = 'translate3d(0px, 0px, 0) scale(1)'
    flyerColor.value = panelGlyphColor
  }

  await nextTick()
  if (!overlayMounted.value) return

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!overlayMounted.value) return
    // The reverse FLIP: pill + glyph spring from their resting spots back onto the launcher's live
    // pixels, so a close that interrupts an open retraces the identical path (velocity-continuous).
    const panel = panelRef.value
    const flyer = flyerRef.value
    if (panel) {
      const a = animate(panel,
        { transform: ['translate3d(0px, 0px, 0) scale(1, 1)', panelStartTransform.value], borderRadius: [restingRadius, collapsedRadius] },
        frame)
      panelAnim = a
      void a.finished.then(() => { if (panelAnim === a) panelAnim = null; finishClose() })
    } else {
      finishClose()
    }
    if (flyer) {
      const g = animate(flyer,
        { transform: ['translate3d(0px, 0px, 0) scale(1)', flyerStartTransform.value], color: [panelGlyphColor, launcherGlyphColor] },
        frame)
      flyerAnim = g
      void g.finished.then(() => { if (flyerAnim === g) flyerAnim = null })
    }
  }))
}

const handleResize = () => {
  // Reconcile the field with the (possibly new) breakpoint/collapse, no animation, then let the
  // overlay re-capture the launcher's new position.
  flyClear()
  applyFieldWidth()
  if (!overlayMounted.value) return
  const launcherEl = activeLauncherEl()
  if (!launcherEl || !launcherEl.getBoundingClientRect().width) return
  captureScene(launcherEl)
}

onMounted(() => {
  lastScrollY = readScrollY()
  isCollapsed.value = fieldIsOffScreen() // pre-set so the first handleScroll sees no edge (no load anim)
  handleScroll()
  applyFieldWidth()
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
  panelAnim?.stop()
  flyerAnim?.stop()
  if (restoreFrame) cancelAnimationFrame(restoreFrame)
  fieldIdleClear()
  flyClear()
  const field = searchField()
  if (field) { field.style.visibility = ''; field.style.width = ''; field.style.overflow = ''; field.style.transition = '' }
  unlockScroll()
})
</script>

<template>
  <!-- Desktop: collapsed icon alongside the sticky category navigation -->
  <div class="pointer-events-none absolute inset-x-0 top-full hidden justify-center pt-6 lg:flex">
    <button
      ref="desktopLauncherRef"
      type="button"
      class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-zinc-200/80 bg-white text-zinc-950 shadow-xs transition-colors duration-200 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-800/80 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950"
      :style="desktopLauncherStyle"
      :aria-label="t('searchCatalog')"
      :aria-expanded="overlayMounted"
      aria-haspopup="dialog"
      @click="openOverlay"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-5 w-5"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  </div>

  <!-- Mobile: collapsed icon alongside the fixed bottom category navigation -->
  <Teleport to="body">
    <button
      ref="mobileLauncherRef"
      type="button"
      class="fixed right-4 bottom-[calc(5.25rem_+_env(safe-area-inset-bottom))] z-40 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-zinc-200/80 bg-white/95 text-zinc-950 shadow-xs backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 lg:hidden dark:border-zinc-800/80 dark:bg-zinc-950/95 dark:text-white dark:focus-visible:ring-white"
      :style="mobileLauncherStyle"
      :aria-label="t('searchCatalog')"
      :aria-expanded="overlayMounted"
      aria-haspopup="dialog"
      @click="openOverlay"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-5 w-5"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  </Teleport>

  <!-- Search interface -->
  <Teleport to="body">
    <div
      v-if="overlayMounted"
      class="pointer-events-none fixed inset-0 z-[60]"
      :style="{ opacity: overlayActive ? 1 : 0 }"
      role="dialog"
      aria-modal="true"
      :aria-label="t('searchProducts')"
    >
      <div
        class="absolute inset-0 bg-white/70 dark:bg-zinc-950/70"
        :style="{ opacity: backdropOpacity, transition: backdropTransition }"
      />

      <div class="pointer-events-none relative flex h-full flex-col items-center justify-start px-4 pt-[14vh]">
        <div
          ref="panelRef"
          class="pointer-events-auto flex h-14 w-full max-w-xl origin-top-left items-center gap-3 rounded-full border border-zinc-200/80 bg-white shadow-xs pr-2 pl-5 dark:border-zinc-800/80 dark:bg-zinc-900"
          :style="{ transform: panelTransform, transition: panelTransition, borderRadius: panelRadius, opacity: panelOpacity, willChange: 'transform' }"
        >
          <span
            ref="realGlyphRef"
            class="flex h-5 w-5 shrink-0 items-center justify-center text-zinc-400 dark:text-zinc-500"
            :style="{ opacity: morphing ? 0 : 1 }"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-5 w-5"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>

          <input
            ref="overlayInputRef"
            v-model="searchQuery"
            type="text"
            autocomplete="off"
            enterkeyhint="search"
            :spellcheck="false"
            :placeholder="t('searchCatalog')"
            class="h-full w-full min-w-0 border-0 bg-transparent p-0 text-base font-medium text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-white dark:placeholder:text-zinc-500"
            :style="{ opacity: contentOpacity, transition: contentTransition }"
          >

          <button
            ref="closeButtonRef"
            type="button"
            class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white dark:focus-visible:ring-white"
            :style="{ opacity: contentOpacity, transition: contentTransition }"
            :aria-label="t('close')"
            :title="t('close')"
            @click="closeOverlay"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <p
          class="mt-4 text-[10px] font-bold tracking-[0.22em] text-zinc-400 uppercase tabular-nums dark:text-zinc-500"
          :style="{ opacity: contentOpacity, transition: contentTransition }"
        >
          {{ resultCount }} {{ resultCount === 1 ? 'item' : 'items' }}
        </p>
      </div>

      <!-- The launcher glyph in flight while the pill expands into the search field -->
      <span
        v-if="morphing && flyerBox"
        ref="flyerRef"
        class="pointer-events-none fixed flex items-center justify-center"
        :style="{
          left: flyerBox.left,
          top: flyerBox.top,
          width: flyerBox.size,
          height: flyerBox.size,
          color: flyerColor,
          transform: flyerTransform,
          transition: flyerTransition
        }"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-full w-full"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
    </div>
  </Teleport>
</template>
