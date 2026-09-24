export default defineAppConfig({
  ui: {
    colors: {
      primary: 'neutral',
      neutral: 'zinc'
    },
    // Every single-line control in the storefront is a pill at one shared elevation; multi-line
    // fields and panels keep their own radius and sit flat on the page.
    button: {
      base: 'rounded-full shadow-xs'
    },
    input: {
      base: 'rounded-full shadow-xs'
    },
    select: {
      base: 'rounded-full shadow-xs'
    }
  }
})
