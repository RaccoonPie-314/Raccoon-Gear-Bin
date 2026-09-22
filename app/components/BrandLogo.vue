<script setup lang="ts">
defineProps<{ compact?: boolean }>()
</script>

<template>
  <span class="inline-flex items-center gap-3">
    <img src="/rgb-logo.png" :alt="$t('appName')" class="h-16 w-16 object-contain" :class="compact ? 'sm:h-14 sm:w-14' : 'sm:h-20 sm:w-20'" />
    <span v-if="!compact" class="hidden text-xs font-bold uppercase tracking-[0.24em] sm:inline">Raccoon Gear Bin</span>
  </span>
</template>
