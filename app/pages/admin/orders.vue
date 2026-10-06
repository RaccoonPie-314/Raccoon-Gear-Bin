<script setup lang="ts">
const { user } = useUser()
const { isAdmin } = useAdminAuth()
const { locale, t } = useI18n()

const isAdminMode = ref(false)

// Same boundary as the other admin pages: the page composes, `AdminOrdersPanel` owns the desk and
// every write, and authorisation stays in row-level security — `isAdminMode` is a UI guard, not
// the security boundary. The list itself is scoped by RLS: admins see every order there.
const refreshAdminMode = async () => { isAdminMode.value = await isAdmin() }
watch(user, () => { void refreshAdminMode() }, { immediate: true })

useHead(() => ({ title: `${t('orders')} | ${t('appName')}` }))
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <UContainer class="pt-5 sm:pt-6">
      <header class="flex items-center justify-between gap-4 border-b border-zinc-200/80 pb-4 dark:border-zinc-800/80">
        <NuxtLink to="/" :aria-label="t('appName')" class="shrink-0">
          <BrandLogo size="sm" />
        </NuxtLink>
        <div class="flex items-center gap-2 sm:gap-3 shrink-0">
          <ColorModeToggle />
          <LanguageSwitcher />
          <NuxtLink
            to="/"
            class="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            <span>{{ t('backToCatalog') }}</span>
          </NuxtLink>
        </div>
      </header>

      <section class="pt-10 sm:pt-14">
        <p class="text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.25em]'">
          {{ t('adminAccess') }}
        </p>
        <h1 class="mt-3 text-2xl font-bold text-balance text-zinc-950 sm:text-3xl dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
          {{ t('orders') }}
        </h1>
      </section>

      <div class="lg:flex lg:items-start lg:gap-10">
        <aside class="lg:w-44 lg:shrink-0 lg:pt-8">
          <AdminTabs />
        </aside>
        <div class="min-w-0 flex-1 pb-24">
          <AdminOrdersPanel :is-admin-mode="isAdminMode" />
        </div>
      </div>
    </UContainer>
  </main>
</template>
