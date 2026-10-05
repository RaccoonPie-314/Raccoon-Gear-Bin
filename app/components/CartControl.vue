<script setup lang="ts">
import { useReducedMotion } from 'motion-v'
import { iconPop, pulseScale } from '~/utils/motion'

/**
 * The cart control — the one way into /cart, mounted by the catalog masthead and the product
 * detail header. The count is a **prop**: pages own the `useCart` state, this stays
 * presentational. The badge renders only after mount, because the count is client state and a
 * server-rendered "0" hydrating into a different number is the mismatch trap.
 *
 * The count *rising* is an add being confirmed, so the badge pops once (`iconPop`, played by the
 * shared `pulseScale` WAAPI driver — motion-v's imperative shorthand keys are a measured no-op;
 * see `app/utils/motion.ts`). Owning it here is what gives every mount the pop for
 * free; reduced motion keeps it still, like every other `iconPop` call site.
 */
const props = defineProps<{ count: number }>()

const { t } = useI18n()
const localePath = useLocalePath()
const mounted = ref(false)
const badge = ref<HTMLElement | null>(null)
const reduced = useReducedMotion()
onMounted(() => { mounted.value = true })

watch(() => props.count, async (next, previous) => {
  if (!mounted.value || reduced.value || !next || next <= (previous ?? 0)) return
  // The badge `v-if`s on the count, so it exists one tick after the rise — not at watch time.
  await nextTick()
  if (badge.value) pulseScale(badge.value, iconPop.keyframes, iconPop.ms)
})
</script>

<template>
  <NuxtLink
    :to="localePath('/cart')"
    :aria-label="t('cart')"
    class="relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200/80 bg-zinc-100/90 hover:bg-zinc-200/80 dark:border-zinc-800/80 dark:bg-zinc-900/90 dark:hover:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 transition-[background-color,scale] duration-150 ease-out motion-safe:active:scale-[0.97] shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-white"
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5 sm:h-5 sm:w-5" aria-hidden="true">
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
      <path d="M2.5 3.5h2.2l2.4 12.2a1 1 0 0 0 1 .8h9.1a1 1 0 0 0 1-.8L20.5 8H6" />
    </svg>
    <span
      v-if="mounted && count > 0"
      ref="badge"
      data-cart-badge
      class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-950 px-1 text-[9px] font-bold tabular-nums text-white dark:bg-white dark:text-zinc-950"
    >
      {{ count }}
    </span>
  </NuxtLink>
</template>
