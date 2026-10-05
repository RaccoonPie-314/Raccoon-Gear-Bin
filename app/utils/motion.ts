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
 * `sheet` — the phone bottom sheet (the Share Sheet's mobile shape). Enter and dismiss ride this
 * bezier through an **imperative `animate()` on the slide host** (`data-share-slide`) — the same
 * shape `applePop` gives the contact panel — and that is the point: a declarative `y` is not on
 * Motion's accelerated list, so it animates through its JS frameloop and writes inline style every
 * frame (probed mid-slide: an inline `translateY(28.67%)`, no WAAPI animation — and the phone read
 * even the layer-promoted version as choppy). `animate()` on the literal `transform` key takes the
 * accelerated path, so the slide is a compositor move with the main thread idle. It is a bezier
 * rather than the spring it used to be for `applePop.phone`'s reason — a Motion spring compiles to
 * a WAAPI `linear(...)` easing, which iOS runs off the compositor — and the curve keeps the
 * spring's arrival (90% of the slide at ~170ms, settled by ~450ms) and its no-overshoot rule: a
 * sheet that bounces up off the bottom edge reads as broken. The drag host inside keeps one owner
 * of its own transform: 1:1 follow while the finger is down, the below-gate snap-back is the
 * drag's own transition, and a dismiss plays from wherever the finger lifted (the finger's offset
 * on the inner host and the slide on the outer one simply add).
 */
export const sheet = {
  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] }
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
 * `arrival` — the sidebar launcher "catching" the flying search bar (Phase E.2). A punchy impact
 * recoil with a settle bounce: it overshoots hard to 1.28 on impact, dips under to 0.92, gives a
 * small second bounce to 1.05, then rests — the box visibly absorbing a heavier projectile. Kept
 * short (stiffness 420 / damping 18 / mass 0.7) so the whole punctuation clears in well under half
 * a second. Skipped entirely under prefers-reduced-motion.
 *
 * Two destinations catch with it: SearchDock's launcher, and — through the shared `pulseScale`
 * WAAPI driver, which is why the settle is also spelled as `ms` — the cart badge when the
 * fly-to-cart ghost is swallowed.
 */
export const arrival = {
  keyframes: [1, 1.28, 0.92, 1.05, 1],
  transition: { type: 'spring', stiffness: 420, damping: 18, mass: 0.7 },
  /** The catch, as the WAAPI driver's duration — inside the "well under half a second" the spring holds. */
  ms: 450
} as const

/**
 * `iconPop` — the one-shot spring a category icon plays the moment its category becomes active
 * (Phase F), and what the cart badge plays when the count rises. A single overshoot to 1.16 then
 * rest at 1.0 — the icon acknowledging the selection, not bouncing. Driven by `pulseScale`; it is
 * pure decoration, so nothing in the lifecycle waits on it and a stalled pulse can only mean
 * "no pop", never a strand. Skipped entirely under prefers-reduced-motion.
 */
export const iconPop = {
  keyframes: [1, 1.16, 1],
  /** The spring's measured settle, as the WAAPI driver's duration. */
  ms: 450
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
  ms: 240
} as const

/**
 * The one-shots' driver, and the reason it is not motion-v's imperative `animate()`.
 *
 * That call does not advance for the **shorthand keys** (`x`, `y`, `scale`) in this repo's
 * environments: measured 2026-10-05, the badge/category/copy pops and the filmstrip's `x` slide
 * were total no-ops (no WAAPI animation, no computed transform, keyframes or tween) in dev **and**
 * the built output, while every consumer of the **literal `transform` key** demonstrably plays —
 * the panel bloom and the phone sheet ride it, harness-framed — and SearchDock's field was
 * stranded by the shorthand path in its dev/HMR era. So the rule is: imperative keyframe work
 * uses the literal `transform` key (or declarative motion components, whose `.$el` also animates);
 * the shorthands are not to be trusted. Raw WAAPI drives the pops — off the main thread, no
 * spring-vs-three-keyframes caveat, no `fill`, so the element returns to its own styles when the
 * pulse ends.
 */
export function pulseScale(el: HTMLElement | null | undefined, keyframes: readonly number[], durationMs: number): void {
  if (!el || keyframes.length < 2) return
  el.animate(
    keyframes.map((scale, index) => ({ transform: `scale(${scale})`, offset: index / (keyframes.length - 1) })),
    { duration: durationMs, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }
  )
}

/**
 * `shake` — the checkout's refusal nudge: the first field that failed the required-check is
 * shaken (its caller also scrolls it into view) so the next action is obvious. Pure decoration,
 * self-guarding — under reduced motion it does nothing, because the message and the scroll (in
 * `useCheckout`) already carry the fact. Raw WAAPI on the literal `transform` for the same
 * measured reason every other imperative pulse does; no `fill`, so the field returns to its own
 * styles. The element is usually a `UFormField` wrapper, hence `Element`, not `HTMLElement`.
 */
export function shake(el: Element | null | undefined): void {
  if (!el) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' }
    ],
    { duration: 400, easing: 'ease-out' }
  )
}

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
 * One consumer reads it now: the panel slot in `ProductActions` — the contact panel on both mounts
 * and, on a desktop, the share panel that shares the slot. They are menus opening from a control, so
 * they get the same numbers from the same place — that is the point of the preset. The sticky bar's
 * panel reads the mirrored `above` pair: it rises out of the bar, so it blooms from `center bottom`
 * — on `phone` below, the one enter here that is not a spring. And the bar's frost is deliberately
 * not an ancestor of the panel either (a `-z-10` layer beside the controls, `data-sticky-frost`,
 * ProductConversion.vue), because a scale inside a `backdrop-filter` element re-runs that element's
 * filter pass every frame. The phone share sheet reads `sheet`, whose own doc carries the same
 * bezier reasoning.
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
  /**
   * The phone mount's enter — the one surface in this file whose move is NOT a spring.
   *
   * The device report drew the line: on an iPhone this pop read as low fps while its own exit — a
   * plain bezier — was smooth on the same element in the same session, and the sheet (a spring in
   * both directions) read low fps both ways. The only difference between the two paths is the easing
   * Motion hands to WAAPI: a spring compiles to a generated `linear(...)` curve, a tween to a
   * `cubic-bezier`, and `linear(...)` is the shape WebKit runs off its compositor — so a 55vh,
   * 3×-DPR text surface re-rasterises on the main thread for the length of the pop.
   *
   * The curve is the spring's own profile in bezier form: `[0.22, 1, 0.36, 1]` carries 90% of its
   * travel at ~37% of its duration, so over 0.45s that is 90% at ~170ms and settled by ~450ms —
   * `applePop.transition`'s two measured numbers. Desktop keeps the spring: nothing was reported
   * there, and it has the GPU headroom the phone does not.
   */
  phone: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
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
