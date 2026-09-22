export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/ui', '@nuxtjs/color-mode', '@nuxtjs/i18n', '@nuxtjs/supabase'],
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
    vueI18n: '~/i18n.config.ts',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'raccoon-gear-bin-locale',
      redirectOn: 'root'
    }
  }
})
