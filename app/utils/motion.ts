/**
 * app/utils/motion.ts — the shared motion vocabulary for Motion for Vue (`motion-v`).
 *
 * One owner for the feel of a repeated interaction, so a press is decided once rather than
 * re-tuned per component — the same reason `app/utils/product-stock.ts` owns the stock band.
 * A rule that is neither reactive state nor a browser capability is a plain module here, not a
 * composable (see AGENTS.md / ARCHITECTURE "Where new code goes").
 *
 * Scope discipline (Phase B — first real consumer): only the preset that a migrated
 * interaction actually uses lives here. Hover and focus feedback on the storefront controls is a
 * *color / ring* change, which stays in Tailwind (`hover:bg-*`, `focus-visible:ring-*`) so the
 * design tokens keep their single home in CSS — Motion is used only for transform/opacity here.
 * A `micro` preset will be added when a genuine transform/opacity hover-or-focus migration needs
 * it, not before.
 */

/**
 * `press` — a button answering the finger on pointer-down.
 *
 * - scale `0.97`: the exact value the storefront shipped before Motion. It is deliberately tiny —
 *   tactile, not a jump (Phase B: "avoid large scaling", "do not make controls visually jump").
 * - spring `stiffness 400 / damping 30`: near-critically damped, so it settles in ~150–200ms with
 *   no overshoot. Bounce is reserved for momentum gestures, never for an ordinary button. This is
 *   the physical, interruptible replacement for the old CSS `active:scale` + 150ms ease-out — the
 *   press can be grabbed and reversed mid-flight instead of waiting for the transition to settle.
 *
 * The reduced-motion gate is applied at the call site (`useReducedMotion()`), because under
 * `prefers-reduced-motion` no press scale is emitted at all — the same contract the `motion-safe:`
 * variant enforced before, so the replacement is behavior-preserving.
 */
export const press = {
  scale: 0.97,
  transition: { type: 'spring', stiffness: 400, damping: 30 }
} as const

/**
 * `panel` — a surface that morphs out of its own trigger (the Contact-to-Order panel, on both the
 * inline and the sticky mount). Phase C moved its enter/exit off a fixed-duration CSS transition and
 * onto this spring so the morph is interruptible and velocity-continuous — a rapid open→close→reopen
 * retargets from where the panel actually is rather than restarting a curve.
 *
 * Restrained, near-critically damped (`damping 30`): it settles with no visible overshoot, because a
 * panel that bounces reads as a toy, not a tool. The *start transform is still measured against the
 * trigger in `ProductActions.vue` — Motion owns the physics, not the spatial anchoring.
 *
 * Reduced motion is applied at the call site (a short eased duration instead of this spring), keeping
 * the contained translate but dropping the springy character.
 */
export const panel = {
  transition: { type: 'spring', stiffness: 300, damping: 30 }
} as const

/**
 * `sheet` — the phone bottom sheet (the Share Sheet's mobile shape). Its whole vertical life — enter
 * from `100%`, the drag-follow, the snap-back and the dismiss-exit — rides this one spring on a single
 * `y`, so the panel `transform` has exactly one owner (Phase C.2). Damped just past critical: a sheet
 * that overshoots upward off the bottom edge reads as broken, not physical.
 */
export const sheet = {
  transition: { type: 'spring', stiffness: 300, damping: 34 }
} as const

/**
 * `lightbox` — the full-screen photo dialog's entry/exit. Opacity only, never transform:
 * the zoom maths reads the enlarged `<img>`'s and its frame's untransformed rects, and a
 * scaled/translated ancestor of that image would corrupt the focal-point geometry mid-flight
 * (this is a hard architectural invariant, not a taste call — see TOUCH_RESTRICTIONS).
 * So a modal that could otherwise pop on a spring deliberately just fades. A hard cut to
 * full-screen is a flash, not a movement, so the fade survives prefers-reduced-motion too.
 */
export const lightbox = {
  transition: { duration: 0.2, ease: [0.33, 1, 0.68, 1] }
} as const

/**
 * `spotlight` — the SearchDock overlay FLIP: the pill morphs out of the launcher icon into the
 * search field and back (Phase E). The frame spring is the pop-and-settle: stiffness 360 / damping
 * 28 / mass 0.8 is snappy with a hair of life but never overshoots into a wobble. Only `frame`
 * drives a transform (panel translate+scale+radius, glyph flyer); the backdrop and content are
 * opacity-only fades on their own elements, kept fast and independent so the text never stretches
 * while the surface grows. Reduced motion swaps the frame spring for a short eased duration at the
 * call site.
 */
export const spotlight = {
  frame: { type: 'spring', stiffness: 360, damping: 28, mass: 0.8 },
  backdrop: { duration: 0.22, ease: 'linear' },
  content: { duration: 0.16, ease: [0.16, 1, 0.3, 1] }
} as const

/**
 * `arrival` — the sidebar launcher "catching" the flying search bar (Phase E.2). A punchy impact
 * recoil with a settle bounce: it overshoots hard to 1.28 on impact, dips under to 0.92, gives a
 * small second bounce to 1.05, then rests — the box visibly absorbing a heavier projectile. Kept
 * short (stiffness 420 / damping 18 / mass 0.7) so the whole punctuation clears in well under half
 * a second. Skipped entirely under prefers-reduced-motion.
 */
export const arrival = {
  keyframes: [1, 1.28, 0.92, 1.05, 1],
  transition: { type: 'spring', stiffness: 420, damping: 18, mass: 0.7 }
} as const

/**
 * `iconPop` — the one-shot spring a category icon plays the moment its category becomes active
 * (Phase F). A single overshoot to 1.16 then rest at 1.0 — the icon acknowledging the selection,
 * not bouncing. Driven imperatively with `animate()` at the call site; it is pure decoration, so
 * nothing in the lifecycle waits on it and a stalled spring can only mean "no pop", never a strand.
 * Skipped entirely under prefers-reduced-motion.
 */
export const iconPop = {
  keyframes: [1, 1.16, 1],
  transition: { type: 'spring', stiffness: 500, damping: 16, mass: 0.7 }
} as const

/**
 * `dock` — the mobile category bar's scroll-reveal glide (Phase F). Replaces the fixed-duration
 * `transition-transform` with a spring so the bar eases in/out and can be interrupted by a
 * direction change mid-slide. Damped past critical (no overshoot): a bottom sheet that bounces up
 * past its resting edge reads as broken. Declarative transform (`y`) — the motion-v path that runs
 * in every environment (unlike imperative layout-property animation).
 */
export const dock = {
  transition: { type: 'spring', stiffness: 360, damping: 34, mass: 0.9 }
} as const

/**
 * `copyPop` — the tactile spring pulse when a link or message is copied (Phase G).
 * Snappy physical acknowledgement ([1, 1.05, 1]) that settles in < 250ms with no lingering wobble.
 * Fired on the `click` (after `while-press` has released on pointer-up), so it never races the press
 * scale for the same element. Skipped entirely under prefers-reduced-motion.
 */
export const copyPop = {
  keyframes: [1, 1.05, 1],
  transition: { type: 'spring', stiffness: 500, damping: 18, mass: 0.6 }
} as const

/**
 * `applePop` — the iOS / macOS menu bloom (Phase H), and the single owner of what that bloom *is*.
 *
 * A surface hangs off the control that opened it, so it starts slightly shrunk and pulled toward that
 * control, then settles to full size on a UNIFORM scale — no X/Y stretch, so a textarea or a channel
 * pill never distorts mid-pop. `below` / `above` name where the surface sits relative to its trigger,
 * which is also which edge `transform-origin` belongs to; the offset always points back at the trigger
 * (-8px for a menu dropping out of a button, +10px for one rising out of the bar).
 *
 * Opacity is deliberately NOT on the spring. It rides its own short curve (`opacity.in` / `.out`) so
 * the text is legible on the shrunk first frames while the transform stays interruptible — and the
 * exit is a shorter travel on a sharp ease-in, because a menu leaving is quicker than arriving and
 * never springs.
 *
 * The spring is tuned by integration, not by eye (Motion's own stepped spring, scale `0.93 → 1`):
 * `220/19/1` carries 90% of the travel at ~170ms and is at rest by ~450ms, peaking ~4.6% of the delta
 * past rest — a third of a percent of the panel's size, so the settle is felt as cushioning and never
 * seen as a bounce. The `400/26/0.8` it replaces did 90% in ~120ms and was at rest by ~330ms, which
 * read as a snap: a large text surface that arrives inside two frames has no travel to follow. The
 * harness's frame sampler is the cross-check — the popover's recorded bloom now runs
 * `0.932 → 0.959` over its first five frames, where the old spring was already at `0.949 → 0.982`.
 *
 * Two surfaces read it: the Contact-to-Order panel (`ProductActions`) and the Share Sheet's desktop
 * popover (`ProductShareSheet`). Both are menus opening from a control, so both get the same numbers
 * from the same place — that is the point of the preset. The sticky bar's panel reads the mirrored
 * `above` pair: it rises out of the bar, so it blooms from `center bottom` on the same spring. The
 * one thing that shape costs there — a scale inside the bar's `backdrop-filter` re-runs the filter
 * pass each frame, measured at 4× CPU throttle as ~2.5ms a play over a scale-free travel — is paid
 * deliberately, because a phone whose panel fades instead of blooming no longer reads as the same
 * surface as the desktop's. The phone share sheet stays on `sheet`: it is a dragged gesture surface,
 * so its spring has to carry release velocity.
 */
export const applePop = {
  rest: 'scale(1) translateY(0px)',
  below: { from: 'scale(0.93) translateY(-8px)', to: 'scale(0.95) translateY(-4px)' },
  above: { from: 'scale(0.94) translateY(10px)', to: 'scale(0.96) translateY(6px)' },
  /**
   * The genie collapse — where a *dismissed* menu goes when it is put back into its control.
   *
   * Deliberately non-uniform (`0.16` across, `0.34` down): the surface flattens into whichever corner
   * its trigger occupies, which is what makes it read as "it went back there" rather than "it vanished".
   * No translate: the anchor corner does the directional work, so one value serves a panel above its
   * control, below it, or beside it. This is the **fallback** — `collapseTransform` below computes the
   * real target from the two boxes, and a fixed fraction only ever fits the surface it was picked for.
   * Three desktop surfaces collapse on leave (`ContactDock`, the Contact-to-Order panel, the Share
   * popover); the two phone surfaces deliberately do not, because a scale there is the exact shape
   * measured expensive inside the frosted sticky bar, and the bottom sheet's transform is owned by the
   * drag.
   *
   * Enter is never this. Phase H removed a scale-onto-the-button from the *arrival* because a panel you
   * are about to read must not be distorted; a leaving panel is unreadable by definition, and
   * `opacity.out` (180ms) clears before the 240ms squash gets extreme — measured: opacity reaches 0 at
   * ~185ms while `scaleX` is still 0.65, so the most sheared frames are already transparent.
   */
  collapse: 'scale(0.16, 0.34)',
  transition: { type: 'spring', stiffness: 220, damping: 19, mass: 1 },
  exit: { duration: 0.24, ease: [0.32, 0, 0.67, 0] },
  opacity: { in: { duration: 0.2, ease: 'easeOut' }, out: { duration: 0.18, ease: 'easeIn' } }
} as const

/**
 * The genie's actual target: the dismissed surface collapses onto **its own trigger's size**, not a
 * fixed fraction. A constant cannot work across surfaces — the contact dock is 320×196 over a 48×48
 * button (`0.15 × 0.25`), while the inline Contact panel is 518×517 over a 199×44 CTA (`0.38 × 0.09`).
 * Both read as "sucked into the corner"; only the second one lands on the button.
 *
 * `offsetWidth`/`offsetHeight` are the layout box, so they are unaffected by the transform about to be
 * written — no settle-before-measure is needed here. Falls back to `applePop.collapse` when either box
 * is missing (a detached node, a shop with no configured channel), because a dismissal that refuses to
 * play is worse than one that lands slightly off.
 */
export const collapseTransform = (panel: HTMLElement | null | undefined, trigger: HTMLElement | null | undefined): string => {
  const pw = panel?.offsetWidth
  const ph = panel?.offsetHeight
  const tw = trigger?.offsetWidth
  const th = trigger?.offsetHeight
  if (!pw || !ph || !tw || !th) return applePop.collapse
  return `scale(${(tw / pw).toFixed(3)}, ${(th / ph).toFixed(3)})`
}
