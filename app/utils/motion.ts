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
