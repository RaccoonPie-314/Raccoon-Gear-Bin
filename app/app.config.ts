export default defineAppConfig({
  ui: {
    colors: {
      primary: 'neutral',
      neutral: 'zinc'
    },
    // Every single-line control in the storefront is a pill at one shared elevation; multi-line
    // fields and panels keep their own radius and sit flat on the page. The button base also
    // carries the storefront's press idiom (0.97 at 150ms; `motion-safe:` drops the scale under
    // reduced motion and keeps the colour change) — one owner here instead of per-button copies.
    // `slots.base` is the typed Nuxt UI 4 form. A top-level `base` (tailwind-variants'
    // legacy single-base key) merges into the same slot at runtime, but only this form
    // typechecks — and both produce the identical class string.
    button: {
      slots: { base: 'rounded-full shadow-xs transition-[background-color,scale] duration-150 ease-out motion-safe:active:scale-[0.97]' }
    },
    input: {
      slots: { base: 'rounded-full shadow-xs' }
    },
    select: {
      slots: { base: 'rounded-full shadow-xs' }
    }
  }
})
