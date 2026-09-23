<script setup lang="ts">
const colorMode = useColorMode()

const isDark = computed(() => colorMode.value === 'dark')

const toggle = () => {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}
</script>

<template>
  <ClientOnly>
    <button
      type="button"
      class="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-zinc-200/80 bg-zinc-100/90 hover:bg-zinc-200/80 dark:border-zinc-800/80 dark:bg-zinc-900/90 dark:hover:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 transition-all shadow-2xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-white shrink-0"
      :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
      :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="toggle"
    >
      <!-- Sun icon (shown in dark mode) -->
      <svg
        v-if="isDark"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-4.5 w-4.5 sm:h-5 sm:w-5 text-amber-400 transition-transform duration-200 hover:rotate-45"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>

      <!-- Moon icon (shown in light mode) -->
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-4.5 w-4.5 sm:h-5 sm:w-5 text-zinc-700 transition-transform duration-200 hover:-rotate-12"
        aria-hidden="true"
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    </button>

    <template #fallback>
      <div class="h-9 w-9 sm:h-10 sm:w-10 rounded-full border border-zinc-200/80 bg-zinc-100/90 dark:border-zinc-800/80 dark:bg-zinc-900/90 shrink-0" />
    </template>
  </ClientOnly>
</template>
