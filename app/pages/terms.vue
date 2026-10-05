<script setup lang="ts">
const { locale, t } = useI18n()
const localePath = useLocalePath()

// The sections the compliance spec requires (T1–T8), keyed by i18n prefix. `termsWarranty` is the
// one section the owner still has to word (the project records mark the returns policy as
// undecided); the placeholder text says so out loud instead of pretending a policy exists.
const SECTIONS = [
  'termsShop',
  'termsOrders',
  'termsPayment',
  'termsShipping',
  'termsCancel',
  'termsWarranty',
  'termsLaw',
  'termsContact'
] as const

const pageTitle = computed(() => `${t('termsTitle')} | ${t('appName')}`)
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
        {{ t('termsTitle') }}
      </h1>
      <p class="mt-2 text-xs font-semibold text-zinc-400 dark:text-zinc-500">
        {{ t('legalUpdated') }}
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
        <NuxtLink :to="localePath('/privacy')" class="transition-colors hover:text-zinc-950 dark:hover:text-white">
          {{ t('consentPrivacy') }}
        </NuxtLink>
        <span aria-hidden="true">·</span>
        <NuxtLink :to="localePath('/')" class="transition-colors hover:text-zinc-950 dark:hover:text-white">
          {{ t('home') }}
        </NuxtLink>
      </footer>
    </div>
  </main>
</template>
