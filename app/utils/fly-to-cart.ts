/**
 * The add-to-cart flight: a small ghost lifts from the button and is caught by the cart badge.
 * Pure decoration — the cart state changed in the same click, and nothing in the lifecycle waits
 * on the ghost; a stalled animation can only mean "no flight", never a strand.
 *
 * This is the SearchDock launcher's own flight replayed, not a lookalike: the engine's ease-out
 * cubic lerp bent by a `sin(t·π)` bow whose lateral and lift are drawn INDEPENDENTLY each flight —
 * in sign and in magnitude — so the arc leans either way off the straight line and can loop wide or
 * cut close to it (lateral 0.6× against the travel, lift 0.5×), its aerodynamic scale
 * `1 + apex·0.16 − t·0.10`, its apex bank riding the lateral draw, and its FIELD_FLY_MS 500ms. The
 * bow is zero at both endpoints whatever it drew, so launch and landing stay pixel-exact and only
 * the middle of the arc moves.
 * The engine re-aims a fixed launcher box on a rAF loop; the ghost is disposable, so the whole
 * curve is SAMPLED into one WAAPI path and rides the compositor instead of the main thread (the
 * engine's per-frame floating box-shadow is dropped for the same reason — transform/opacity
 * only). The landing is the engine's `catchLanding`: the badge plays the shared `arrival` recoil
 * as the ghost is swallowed. Reduced motion skips the flight and the catch both — the count
 * still moves.
 *
 * Why a ghost instead of the product image: the real image lives in a scroll-flow column whose
 * reflow would drag a clone around, and a fixed overlay is immune to the page moving underneath
 * it — the same reason the clear-away ghost is fixed.
 */
import { arrival, pulseScale } from '~/utils/motion'

const GHOST_ATTR = 'data-fly-ghost'
/** The engine's FIELD_FLY_MS: one flight in the app, one length. */
const FLIGHT_MS = 500
/** The engine's ARC_BOW_PX — the peak of the sin(t·π) bow, in px (zero at t=0 and t=1). */
const ARC_BOW_PX = 80
/**
 * One axis of this flight's arc: a magnitude in [0.5, 1.6] with a random sign, so the same gesture
 * can loop wide left, wide right, or cut close to the straight line. Drawn per flight, never per
 * frame — a per-frame draw is a walk, not a trajectory.
 *
 * The magnitude FLOOR is the load-bearing half: at 0.5 the apex bank is 4° (matrix.b 0.070, where
 * the harness asserts > 0.02), and a draw that could reach zero would fly straight — which reads as
 * broken, not as random. The sign is free to be random because the bank rides the same draw, so the
 * projectile still banks INTO whichever turn it drew.
 */
const drawBow = () => (0.5 + Math.random() * 1.1) * (Math.random() < 0.5 ? -1 : 1)
/** The engine's bow coefficients: sideways against the travel, and the mid-flight lift. */
const BOW_LATERAL = 0.6
const BOW_LIFT = 0.5
/** The engine's apex bank, its restore magnitude — opposite the lateral bow, like the launcher. */
const BANK_DEG = 8
/** Curve samples for the one WAAPI path: chord error stays under a pixel at this size. */
const SAMPLES = 16
const GHOST_PX = 16

/**
 * Flies a ghost from `from` (the pressed control) to `to` (the cart badge) and plays the badge's
 * landing catch. Returns whether a flight actually started — `false` means reduced motion, or a
 * missing endpoint, and the caller is expected to have confirmed the cart some other way (it
 * always has: the click itself).
 */
export function flyToCart(from: Element | null | undefined, to: Element | null | undefined): boolean {
  if (!from || !to) return false
  // Reduced motion: the ghost simply does not exist, and neither does the catch.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false

  const source = from.getBoundingClientRect()
  const target = to.getBoundingClientRect()
  const dx = (target.left + target.width / 2) - (source.left + source.width / 2)
  const dy = (target.top + target.height / 2) - (source.top + source.height / 2)

  const ghost = document.createElement('span')
  ghost.setAttribute(GHOST_ATTR, '')
  ghost.setAttribute('aria-hidden', 'true')
  // Inline styles on a body-level node: nothing to add to the global sheet, and the element
  // leaves with the flight. The dot borrows the badge's own computed ink, so it reads as the
  // same object arriving there in dark mode too.
  ghost.style.cssText = `position:fixed;left:${source.left + source.width / 2 - GHOST_PX / 2}px;`
    + `top:${source.top + source.height / 2 - GHOST_PX / 2}px;width:${GHOST_PX}px;height:${GHOST_PX}px;`
    + `border-radius:9999px;background:${getComputedStyle(to).backgroundColor};`
    + 'opacity:0.9;pointer-events:none;z-index:60;will-change:transform,opacity'
  document.body.append(ghost)

  // The engine, sampled: eased lerp (k) for the spine, the bow swinging against the travel and
  // lifting, the bank and the scale riding the same apex. Every term is zero-magnitude at the
  // endpoints, so the first frame sits on the button and the last on the badge.
  // Two independent draws — one per axis — because the RATIO of lateral to lift is what reads as
  // the angle. One shared factor would only make the same arc bigger or smaller, which is the thing
  // nobody can see. The bank rides the lateral draw so the lean still matches the turn. All of it
  // computed before the 16 samples, on the click frame, so nothing here costs a frame.
  const bowX = drawBow()
  const bowY = drawBow()
  const frames = Array.from({ length: SAMPLES }, (_, i) => {
    const t = i / (SAMPLES - 1)
    const k = 1 - (1 - t) ** 3
    const apex = Math.sin(t * Math.PI)
    const x = dx * k - apex * ARC_BOW_PX * bowX * BOW_LATERAL
    const y = dy * k - apex * ARC_BOW_PX * bowY * BOW_LIFT
    const scale = 1 + apex * 0.16 - t * 0.10
    // Opaque through the arc, then swallowed over the last stretch so the removal is never a cut.
    const opacity = t < 0.5 ? 0.95 : 0.95 - ((t - 0.5) / 0.5) * 0.9
    return {
      transform: `translate(${x}px, ${y}px) rotate(${apex * BANK_DEG * bowX}deg) scale(${scale})`,
      opacity,
      offset: t,
    }
  })

  // `linear`: the samples carry the curve. `fill: forwards` pins the swallowed last frame until
  // the removal, so a late `finished` can never flash the ghost back at the button.
  const flight = ghost.animate(frames, { duration: FLIGHT_MS, easing: 'linear', fill: 'forwards' })
  // `finished` rejects when the animation is cancelled (a page transition mid-flight), and the
  // ghost still has to leave — an orphan would sit over the page forever. The catch only plays on
  // a real landing, never on a teardown.
  void flight.finished
    .then(() => {
      ghost.remove()
      if (to instanceof HTMLElement) pulseScale(to, arrival.keyframes, arrival.ms)
    })
    .catch(() => ghost.remove())
  return true
}
