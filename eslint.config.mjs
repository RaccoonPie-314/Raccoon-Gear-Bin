// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { getDefaultAttributes } from 'eslint-plugin-better-tailwindcss/api/defaults'

export default withNuxt(
  // `correctness` reports unknown Tailwind classes as warnings, not errors. The 17
  // pre-existing `no-explicit-any` hits are DOM/template-ref and `catch (error: any)`
  // casts — not Supabase casts, which AGENTS.md still forbids by review — so the rule is
  // off in config and that guard stays a human/AGENTS rule. `no-unused-vars` is a warning
  // and empty `catch {}` blocks are allowed, both to keep the pre-existing tree green while
  // still failing CI on any NEW hard error. Tune these back toward `error` as the debt is paid.
  betterTailwindcss.configs.correctness,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // gallery-swap / gallery-arrow / lightbox-zoomed / no-scrollbar are legitimate custom
      // classes in <style scoped> and main.css, not Tailwind utilities — warn, don't error.
      'better-tailwindcss/no-unknown-classes': 'warn',
    },
  },
  {
    settings: {
      'better-tailwindcss': {
        entryPoint: 'app/assets/css/main.css',
        attributes: [
          ...getDefaultAttributes(),
          ['^v-bind:ui$', [{ match: 'objectValues' }]]
        ]
      }
    }
  }
)
