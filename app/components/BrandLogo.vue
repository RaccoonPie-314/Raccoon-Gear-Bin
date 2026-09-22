<script setup lang="ts">
defineProps<{ compact?: boolean }>()
</script>

<template>
  <span class="inline-flex items-center gap-3">
    <img src="/rgb-logo.png" alt="Raccoon Gear Bin" class="h-11 w-11 object-contain" :class="compact ? 'sm:h-10 sm:w-10' : 'sm:h-14 sm:w-14'" />
    <span v-if="!compact" class="hidden text-xs font-bold uppercase tracking-[0.24em] sm:inline">Raccoon Gear Bin</span>
  </span>
</template>
