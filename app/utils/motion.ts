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
 * `popover` — the desktop anchored popover (the Share Sheet's desktop shape), unfolding on `scaleY`
 * out of whichever edge faces the trigger. A touch stiffer than the sheet (a smaller, faster surface)
 * but equally restrained — no overshoot.
 */
export const popover = {
  transition: { type: 'spring', stiffness: 380, damping: 34 }
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
