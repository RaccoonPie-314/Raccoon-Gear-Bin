<script setup lang="ts">
/**
 * The storefront's legal-links strip — the only thing that makes /privacy and /terms reachable
 * from the catalog and detail pages. Deliberately inert: two links in a centred row with no
 * motion and no geometry of its own, so the tuned page layouts it sits under are undisturbed.
 */
const { t } = useI18n()
const localePath = useLocalePath()
// The account entry lives here, not in the tuned masthead: one reactive label, no measured geometry.
const signedIn = useSignedIn()
</script>

<template>
  <footer class="mt-16 pb-10">
    <div class="flex items-center justify-center gap-3 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">
      <NuxtLink :to="localePath(signedIn ? '/account' : '/login')" class="transition-colors hover:text-zinc-950 dark:hover:text-white">
        {{ signedIn ? t('myAccount') : t('signIn') }}
      </NuxtLink>
      <span aria-hidden="true">·</span>
      <NuxtLink :to="localePath('/privacy')" class="transition-colors hover:text-zinc-950 dark:hover:text-white">
        {{ t('consentPrivacy') }}
      </NuxtLink>
      <span aria-hidden="true">·</span>
      <NuxtLink :to="localePath('/terms')" class="transition-colors hover:text-zinc-950 dark:hover:text-white">
        {{ t('consentTerms') }}
      </NuxtLink>
    </div>
  </footer>
</template>
