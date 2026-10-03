import { textClusters } from '~/utils/text-scramble'

/**
 * The clear-away effect: pressing the field's ✕ does not delete the string, it lets the letters go.
 * Each grapheme of what was typed lifts, spins out and fades, one behind the other.
 *
 * Why a ghost layer instead of animating the input: an `<input>`'s value is not DOM content — there is
 * no per-letter element to move, and nothing CSS can reach inside the control. So the outgoing string is
 * mirrored into a throwaway layer positioned over the field, the real value is emptied by the caller in
 * the same click, and the mirror animates itself away. Only `transform` and `opacity` move, which keeps
 * every frame on the compositor.
 *
 * The mirror lays its glyphs out by *flowing the same string in the same font* rather than by measuring
 * each one: no per-glyph layout read, and the positions come out right for the common case — a query
 * shorter than the field. ponytail: a query long enough to be scrolled sideways inside its own box shows
 * ghosts the real field had hidden; Range-measuring every glyph would fix that and cost a layout read
 * per letter, which is the trade this file is not making until someone reports it.
 */
const GHOST_ATTR = 'data-clear-ghost'
/** How long one letter takes to go, and how far behind it the next one starts. */
const GLYPH_LIFE_MS = 320
const GLYPH_STAGGER_MS = 16

export function disintegrateText(input: HTMLInputElement | null | undefined): void {
  const value = input?.value ?? ''
  if (!input || !value) return
  // Reduced motion: the text simply goes. The scatter is decoration, and a flicker of flying letters is
  // exactly what the preference asks not to be forced on a visitor.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const cs = getComputedStyle(input)
  const rect = input.getBoundingClientRect()
  const layer = document.createElement('span')
  layer.setAttribute(GHOST_ATTR, '')
  layer.setAttribute('aria-hidden', 'true')
  // Fixed to the viewport because the field's own wrapper is not reliably a positioned ancestor, and
  // the layer must survive whatever the page reflows while it is playing.
  layer.style.cssText = `position:fixed;left:${rect.left + (parseFloat(cs.paddingLeft) || 0)}px;top:${rect.top}px;`
    + `height:${rect.height}px;display:flex;align-items:center;white-space:pre;overflow:visible;`
    + `pointer-events:none;z-index:60;font:${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily};`
    + `line-height:${cs.lineHeight};letter-spacing:${cs.letterSpacing};color:${cs.color}`
  for (const glyph of textClusters(value)) {
    const span = document.createElement('span')
    span.textContent = glyph
    layer.append(span)
  }
  document.body.append(layer)

  let left = layer.childElementCount
  const gone = () => { if (--left <= 0) layer.remove() }
  [...layer.children].forEach((span, i) => {
    // Upward and sideways, each letter its own way: a uniform slide would read as a wipe, not a
    // collapse. Random per press, so no two clears trace the same scatter.
    const dx = (Math.random() - 0.5) * 28
    const dy = -14 - Math.random() * 22
    const rotate = (Math.random() - 0.5) * 60
    const anim = (span as HTMLElement).animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg) scale(0.7)`, opacity: 0 },
      ],
      {
        duration: GLYPH_LIFE_MS,
        delay: i * GLYPH_STAGGER_MS,
        easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
        fill: 'forwards',
      },
    )
    // `finished` rejects when the animation is cancelled (a re-click, a page transition), and the layer
    // still has to leave — an orphaned ghost would sit over the field holding the old query.
    void anim.finished.then(gone).catch(gone)
  })
}
