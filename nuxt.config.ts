export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    pageTransition: { name: 'page', mode: 'out-in' }
  },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/color-mode', '@nuxtjs/i18n', '@nuxtjs/supabase'],
  // @nuxt/ui auto-registers @nuxt/fonts, whose default provider fetches fonts.googleapis.com at
  // build time. The CI runner cannot reach it, the fetch fails silently, and the page renders in
  // a wider system sans — enough to trip the harness's @320 overflow guards (254/256 on the
  // runner vs 257/257 locally). Empty providers = no network step; the real fonts are imported
  // hermetically from the @fontsource* devDependencies in app/assets/css/main.css, so every
  // machine measures identical metrics.
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
  runtimeConfig: {
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || 'demo-anon-key'
    }
  },
  supabase: {
    redirect: false,
    url: process.env.NUXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co',
    key: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || 'demo-anon-key',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
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
