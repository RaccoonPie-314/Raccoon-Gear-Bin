<script setup lang="ts">
const { locale, setLocale } = useI18n()

type LocaleCode = 'en' | 'km'

const languages: { code: LocaleCode; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'km', label: 'ខ្មែរ' }
]
</script>

<template>
  <div
    class="inline-flex items-center rounded-full p-0.5 bg-zinc-100/90 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs"
    :aria-label="$t('language')"
  >
    <button
      v-for="language in languages"
      :key="language.code"
      type="button"
      class="rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wider transition-all duration-200 select-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:focus-visible:ring-white"
      :class="[
        locale === language.code
          ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
          : 'text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
      ]"
      @click="setLocale(language.code)"
    >
      {{ language.label }}
    </button>
  </div>
</template>
