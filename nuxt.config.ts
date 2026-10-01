export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    pageTransition: { name: 'page', mode: 'out-in' },
    // Tab icon follows the browser's own theme, no JS: `media` on <link rel="icon"> is the native
    // platform feature and matches the BrandLogo mapping (light theme -> rgb-logo-light, dark ->
    // rgb-logo-dark). Every file is a crop of the raccoon head out of the 1254px master
    // (`Logo/RGB Logo*.png`, 460px at offset 60/520) — at tab size the full lockup's wordmark and
    // circle collapse into one grey square. Two sizes are declared:
    // - 64px, transparent: what desktop paints, and the pair that can honour `media`.
    // - 192px: Google's favicon guidance asks for more than 48px because the same file is reused on
    //   surfaces far bigger than a desktop tab (a phone strip is 2-3x that), and a picker that
    //   ignores `media` cannot be predicted — so each of this pair carries its own background (white
    //   tile / the storefront's zinc-950 tile) and is readable whichever one gets chosen.
    // `favicon.ico` is the legacy fallback for clients that request it directly and ignore `media`;
    // it holds 16/32/48/64 transparent PNG entries of the light art, and `verify` asserts that.
    //
    // `?v=2` is not decoration: a browser keys its saved icon by URL and does not re-check it when
    // the bytes behind that URL change, so a redeploy alone cannot dislodge the framework default an
    // earlier build served (the iPhone in particular keeps it in the Safari/SpringBoard store until
    // the history entry goes away). Changing the URL is the only thing that reaches visitors who
    // already cached the wrong icon. Bump it whenever the artwork changes; leave it alone otherwise,
    // because Google's guidance is that a favicon URL should be stable. `favicon.ico` carries no
    // version because a blind request never reads the declaration it would have to copy.
    head: {
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon-light.png?v=2', sizes: '64x64', media: '(prefers-color-scheme: light)' },
        { rel: 'icon', type: 'image/png', href: '/favicon-dark.png?v=2', sizes: '64x64', media: '(prefers-color-scheme: dark)' },
        { rel: 'icon', type: 'image/png', href: '/favicon-192-light.png?v=2', sizes: '192x192', media: '(prefers-color-scheme: light)' },
        { rel: 'icon', type: 'image/png', href: '/favicon-192-dark.png?v=2', sizes: '192x192', media: '(prefers-color-scheme: dark)' },
        // iOS puts a letterbox behind a transparent home-screen icon instead of compositing it, so
        // this one is opaque by design — unlike the 64px favicons.
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png?v=2', sizes: '180x180' }
      ]
    }
  },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/color-mode', '@nuxtjs/i18n', '@nuxtjs/supabase', 'motion-v/nuxt'],
  // @nuxt/ui auto-registers @nuxt/fonts, whose default provider fetches fonts.googleapis.com at
  // build time. The CI runner cannot reach it, and the fetch fails silently. Empty providers = no
  // network step. Latin UI text needs no webfont at all: the theme stack is the native system UI
  // font (see app/assets/css/main.css), so there is nothing hermetic left to bundle for it. The
  // one real @fontface still imported is Noto Sans Khmer — Windows and the runner ship no Khmer
  // font and a missing cluster is broken rendering, not a fallback.
  fonts: {
    // Keep only @nuxt/fonts' offline `local` provider (it resolves families from installed
    // packages — the @fontsource* devDependencies). The string keys set to `false` are the
    // network providers @nuxt/fonts registers by default; on CI they fail to fetch.
    providers: {
      google: false,
      fontsource: false,
      bunny: false,
      adobe: false,
      fontshare: false,
      googleicons: false,
    },
  },
  // The Cloudflare preset fails to bundle with server sourcemaps on (`Multiple conflicting
  // contents for sourcemap source i18n.config.ts`), and nothing here reads production server
  // traces, so no preset gets them.
  nitro: {
    sourceMap: false
  },
  // A feature keeps its UI and the logic only it uses in one folder. Neither half is reachable by
  // auto-import from `app/features` on its own, so each is registered: the component dir with no
  // directory prefix (the file name is the component name) and the composable dir exactly like
  // app/composables/. Naming `dirs` replaces Nuxt's default component scan, so `~/components`
  // has to stay in the list — dropping it silently unregisters every shared component.
  components: {
    dirs: [
      '~/components',
      // no prefix: the file name is the component name
      { path: '~/features/admin/components', pathPrefix: false },
      { path: '~/features/product/components', pathPrefix: false }
    ]
  },
  imports: { dirs: ['~/features/admin/composables', '~/features/product/composables'] },
  // No service-role key anywhere in the runtime config, and that is deliberate: `nuxt build` inlines
  // whatever is read here straight into the uploaded Worker bundle, so a key that bypasses RLS would
  // live in the deploy artifact. Authorisation is RLS in Postgres and the browser holds the anon key.
  runtimeConfig: {
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || 'demo-anon-key'
    }
  },
  supabase: {
    redirect: false,
    url: process.env.NUXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co',
    key: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || 'demo-anon-key',
    // Blank on purpose. The module's own default for `secretKey` falls back to
    // `process.env.SUPABASE_SERVICE_ROLE_KEY`, and server runtime config is inlined into the
    // uploaded bundle — so leaving it unset still ships the key whenever `.env` has one. `''` is
    // what actually stops it: defu skips `undefined`, so only a set value overrides the default.
    secretKey: '',
    cookieOptions: {
      name: 'raccoon-admin-auth',
      lifetime: 60 * 60 * 8,
      sameSite: 'lax'
    }
  },
  ui: {
    theme: {
      colors: ['primary', 'success', 'warning', 'error', 'neutral']
    }
  },
  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'dark'
  },
  i18n: {
    locales: [
      { code: 'en', name: 'English' },
      { code: 'km', name: 'ខ្មែរ' }
    ],
    defaultLocale: 'en',
    strategy: 'prefix_except_default',
    vueI18n: '../i18n.config.ts',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'raccoon-gear-bin-locale',
      redirectOn: 'root'
    }
  }
})
