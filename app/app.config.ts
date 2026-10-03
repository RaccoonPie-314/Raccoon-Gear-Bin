export default defineAppConfig({
  ui: {
    colors: {
      primary: 'neutral',
      neutral: 'zinc'
    },
    // Every single-line control in the storefront is a pill at one shared elevation; multi-line
    // fields and panels keep their own radius and sit flat on the page.
    // `slots.base` is the typed Nuxt UI 4 form. A top-level `base` (tailwind-variants'
    // legacy single-base key) merges into the same slot at runtime, but only this form
    // typechecks — and both produce the identical class string.
    button: {
      slots: { base: 'rounded-full shadow-xs' }
    },
    input: {
      slots: { base: 'rounded-full shadow-xs' }
    },
    select: {
      slots: { base: 'rounded-full shadow-xs' }
    }
  }
})
