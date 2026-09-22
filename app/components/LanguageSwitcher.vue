<script setup lang="ts">
const { locale, setLocale } = useI18n()

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'km', label: 'ខ្មែរ' }
]
</script>

<template>
  <div class="inline-flex items-center border border-zinc-200 dark:border-zinc-800" :aria-label="$t('language')">
    <button v-for="language in languages" :key="language.code" type="button" class="px-2.5 py-1.5 text-[11px] font-bold tracking-[0.12em] transition-colors" :class="locale === language.code ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950' : 'text-zinc-500 hover:text-zinc-950 dark:hover:text-white'" @click="setLocale(language.code)">
      {{ language.label }}
    </button>
  </div>
</template>
