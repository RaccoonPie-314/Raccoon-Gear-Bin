---
kind: frontend_style
name: Tailwind v4 + @nuxt/ui Design System with Dark Mode and i18n
category: frontend_style
scope:
    - '**'
source_files:
    - package.json
    - nuxt.config.ts
    - app/assets/css/main.css
    - app/app.vue
    - app/components/ColorModeToggle.vue
    - app/components/LanguageSwitcher.vue
    - app/components/ProductCard.vue
    - app/components/BrandLogo.vue
---

## Approach

The Raccoon Gear Bin frontend is styled exclusively through **Tailwind CSS v4** (`tailwindcss@^4.3.3`, `@tailwindcss/vite@^4.3.3`) loaded via the Nuxt 4 `css` entry in `nuxt.config.ts`, which registers `~/assets/css/main.css`. The stylesheet imports Tailwind's new `@import "tailwindcss"` directive (v4 style) and the component library `@nuxt/ui@^4.11.1`.

There is no separate `tailwind.config.*` file — all configuration lives in `nuxt.config.ts` under the `ui.theme` block, which restricts the palette to five semantic color tokens: `primary`, `success`, `warning`, `error`, `neutral`. Typography and global styles are defined directly in `app/assets/css/main.css` using Tailwind v4's `@theme static { ... }` block for the font stack.

No SCSS/Sass, PostCSS plugins, or custom CSS-in-JS is used; styling is utility-first across every `.vue` component.

## Key Files

- `package.json` — declares `tailwindcss`, `@tailwindcss/vite`, `@nuxt/ui`, `@nuxtjs/color-mode`, `@nuxtjs/i18n` as dependencies.
- `nuxt.config.ts` — wires modules, sets `ui.theme.colors`, configures `colorMode` (classSuffix `''`, preference `system`, fallback `dark`), and registers the CSS entry.
- `app/assets/css/main.css` — single source of global styles: theme token overrides, base `html`/`body`, selection colors, dark-mode backgrounds, scrollbar suppression utilities (`.no-scrollbar`, `.scrollbar-none`), page transition classes (`.page-enter-*`, `.page-leave-*`), and custom keyframe animations for Nuxt UI select popovers (`select-morph-in`, `select-morph-out`).
- `app/components/*.vue` — all visual components use inline Tailwind utility classes; no per-component `<style>` blocks are present.

## Architecture and Conventions

### Color system
- Semantic tokens from `@nuxt/ui`: `primary`, `success`, `warning`, `error`, `neutral` are declared in `nuxt.config.ts` `ui.theme.colors`.
- The actual zinc palette (`zinc-50`/`zinc-950`, `zinc-200`/`zinc-800`, etc.) is used throughout components as the neutral scale.
- Dark mode is applied via a root `html.dark` class (configured by `@nuxtjs/color-mode`); components pair light/dark variants with `dark:` prefixes (e.g. `bg-zinc-100/90 dark:bg-zinc-900/90`, `text-zinc-700 dark:text-zinc-200`).
- Background defaults: white (`#ffffff`) in light mode, zinc-950 (`#09090b`) in dark mode, set in `main.css`.

### Typography
- Font family is overridden at the theme level in `main.css`:
  ```css
  @theme static {
    --font-sans: 'Public Sans', 'Noto Sans Khmer', 'Khmer OS System', sans-serif;
  }
  ```
- Body-level font rendering flags (`optimizeLegibility`, antialiasing) are also set there.
- Component text uses Tailwind utilities like `font-bold`, `tracking-[0.2em]`, `uppercase`, `tabular-nums`, `line-clamp-2`; sizes are responsive with `sm:` breakpoints (e.g. `text-[10px] sm:text-[11px]`, `text-sm sm:text-base`).

### Layout & spacing
- Flexbox and grid are used via Tailwind utilities (`flex`, `items-center`, `justify-between`, `gap-4`, `grid` not observed but implied by the methodology).
- Spacing follows Tailwind's default scale (`mt-1`, `pt-4`, `p-0.5`, `h-9 w-9`).
- Border radius is consistently rounded: `rounded-full` for buttons/toggles, `rounded-2xl` for product cards, `rounded-3xl` for category nav.

### Responsive strategy
- Mobile-first Tailwind breakpoints (`sm:`, `lg:`) are used throughout components.
- Category navigation splits into desktop/mobile variants via dedicated components (`CategoryDesktop.vue`, `CategoryMobile.vue`) selected conditionally rather than via media queries.

### Component library integration
- `@nuxt/ui` is imported globally in `main.css` (`@import "@nuxt/ui"`), making its primitives available without per-import.
- Custom CSS in `main.css` augments Nuxt UI's built-in animations, specifically overriding the select popover transform-origin behavior so panels unfold from the trigger pill instead of scaling from center.

### Animations & transitions
- Page transitions are configured in `nuxt.config.ts` as `{ name: 'page', mode: 'out-in' }` and implemented in `main.css` via `.page-enter-active`, `.page-leave-active`, `.page-enter-from`, `.page-leave-to` (opacity + translateY 4px over 180ms).
- Selection highlight and view-transition timing are tuned in `main.css` (`::selection`, `::view-transition-old/new(root)`).
- Hover/focus states on interactive elements use `transition-all duration-200` plus specific transforms (e.g. `hover:rotate-45`, `hover:-rotate-12`, `hover:scale-105`).

### Accessibility
- Focus management uses Tailwind's focus-visible ring utilities: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950` (light) / `focus-visible:ring-white` (dark).
- Components include `cursor-pointer` on clickable elements and `select-none` on toggle chips.

### Internationalization
- i18n is provided by `@nuxtjs/i18n` with locales `en` and `km` (`ខ្មែរ`), default locale `en`, strategy `prefix_except_default`, browser language detection stored in cookie `raccoon-gear-bin-locale`.
- Fonts include `Noto Sans Khmer` and `Khmer OS System` to support Khmer script.

## Conventions and Constraints

- **All styling is done with Tailwind utility classes inside Vue SFC templates**; no component-scoped `<style>` blocks were found in the component inventory.
- **Dark mode is opt-in per element** via the `dark:` prefix against the root `html.dark` class toggled by `@nuxtjs/color-mode`.
- **Semantic colors come from `@nuxt/ui` tokens** (`primary`, `success`, `warning`, `error`, `neutral`) declared in `nuxt.config.ts`; the zinc palette is used for neutrals.
- **Global CSS is centralized** in `app/assets/css/main.css`, which is the only CSS entry point registered in `nuxt.config.ts`.
- **Typography is controlled centrally** through the `@theme static` block in `main.css`; components should not define their own font families.
- **Responsive design uses Tailwind's mobile-first breakpoint prefixes** (`sm:`, `lg:`) rather than custom media queries.
- **Scrollbar hiding is exposed as reusable utility classes** `.no-scrollbar` and `.scrollbar-none` defined in `main.css` for horizontal scrollers.