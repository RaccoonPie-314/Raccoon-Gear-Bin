<script setup lang="ts">
const { locale, t } = useI18n()
const localePath = useLocalePath()

// The sections the compliance spec requires (P1–P7), keyed by i18n prefix: each entry reads its
// `…Title` and `…Body`, so a section cannot exist in one locale and be missing in the other
// without the page showing an empty line.
const SECTIONS = [
  'privacyCollect',
  'privacyWhy',
  'privacyProcessors',
  'privacyRetention',
  'privacyRights',
  'privacyNo',
  'privacyChildren',
  'privacyContact'
] as const

const pageTitle = computed(() => `${t('privacyTitle')} | ${t('appName')}`)
useHead({ title: pageTitle })
</script>

<template>
  <main class="min-h-screen bg-zinc-50/50 dark:bg-zinc-950">
    <div class="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <header class="flex items-center justify-between gap-4">
        <NuxtLink :to="localePath('/')">
          <BrandLogo />
        </NuxtLink>
        <div class="flex items-center gap-2">
          <ColorModeToggle />
          <LanguageSwitcher />
        </div>
      </header>

      <h1 class="mt-10 text-3xl font-black text-zinc-950 dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
        {{ t('privacyTitle') }}
      </h1>
      <p class="mt-2 text-xs font-semibold text-zinc-400 dark:text-zinc-500">
        {{ t('legalUpdated') }}
      </p>
      <p class="mt-6 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        {{ t('privacyIntro') }}
      </p>

      <section v-for="key in SECTIONS" :key="key" class="mt-8">
        <h2 class="text-xs font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.22em]'">
          {{ t(`${key}Title`) }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          {{ t(`${key}Body`) }}
        </p>
      </section>

      <footer class="mt-12 flex items-center justify-center gap-3 border-t border-zinc-200/80 pt-6 text-[11px] font-semibold text-zinc-400 dark:border-zinc-800/80 dark:text-zinc-500">
        <NuxtLink :to="localePath('/terms')" class="transition-colors hover:text-zinc-950 dark:hover:text-white">
          {{ t('consentTerms') }}
        </NuxtLink>
        <span aria-hidden="true">·</span>
        <NuxtLink :to="localePath('/')" class="transition-colors hover:text-zinc-950 dark:hover:text-white">
          {{ t('home') }}
        </NuxtLink>
      </footer>
    </div>
  </main>
</template>
