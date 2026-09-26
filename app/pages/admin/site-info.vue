<script setup lang="ts">
const user = useSupabaseUser()
const { isAdmin } = useAdminAuth()
const { locale, t } = useI18n()

const isAdminMode = ref(false)

// Same boundary as the product editor: the page composes, `useAdminSiteInfoEditor` owns the
// form and every write, and authorisation stays in row-level security — `canMutate` is a UI
// guard, not the security boundary. Catalog editing is not touched by anything on this page.
const {
  siteForm,
  isLoading,
  isSaving,
  actionError,
  savedNotice,
  loadSiteInfo,
  saveSiteInfo,
  addSocialLink,
  removeSocialLink,
  moveSocialLink
} = useAdminSiteInfoEditor({ canMutate: () => isAdminMode.value })

const refreshAdminMode = async () => { isAdminMode.value = await isAdmin() }
watch(user, () => { void refreshAdminMode() }, { immediate: true })
onMounted(() => { void loadSiteInfo() })

useHead(() => ({ title: `${t('siteInfo')} | ${t('appName')}` }))
</script>

<template>
  <main class="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <!-- Same masthead idiom as the storefront, one row lighter: back-link where site info sits on the home header -->
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
        <p class="text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? 'tracking-[0.08em]' : 'tracking-[0.25em]'">
          {{ t('adminAccess') }}
        </p>
        <h1 class="mt-3 text-2xl font-bold tracking-tight text-balance text-zinc-950 sm:text-3xl dark:text-white">
          {{ t('siteInfo') }}
        </h1>
        <p class="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          {{ t('siteInfoHint') }}
        </p>
      </section>

      <UAlert v-if="actionError" class="mt-8" color="error" variant="soft" :title="actionError" />
      <UAlert v-if="savedNotice" class="mt-8" color="success" variant="soft" :title="savedNotice" />

      <form v-if="!isLoading" class="mt-8 space-y-8 pb-24" data-site-info-form @submit.prevent="saveSiteInfo">
        <div class="grid gap-5 rounded-2xl border border-zinc-200/80 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800/80 dark:bg-zinc-900">
          <UFormField :label="t('phone')" :hint="t('phoneHint')">
            <UInput v-model="siteForm.phone" type="tel" class="w-full" data-field="phone" />
          </UFormField>
          <UFormField :label="t('locationUrl')" :hint="t('locationUrlHint')">
            <UInput v-model="siteForm.locationUrl" type="url" class="w-full" data-field="location-url" />
          </UFormField>
          <UFormField :label="t('locationEnglish')">
            <UInput v-model="siteForm.locationLabels.en" class="w-full" data-field="location-en" />
          </UFormField>
          <UFormField :label="t('locationKhmer')">
            <UInput v-model="siteForm.locationLabels.km" class="w-full" data-field="location-km" />
          </UFormField>
        </div>

        <!-- Social links live in their own panel because they edit a collection, not a field:
             rows are added, toggled, reordered and removed, and the order shown here is the
             order the header renders. -->
        <section class="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-6 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-social-section>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-black text-zinc-950 dark:text-white">{{ t('socialLinks') }}</h2>
              <p class="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{{ t('socialLinksHint') }}</p>
            </div>
            <UButton type="button" color="neutral" variant="outline" size="sm" data-social-add @click="addSocialLink">
              ＋ {{ t('addSocialLink') }}
            </UButton>
          </div>

          <p v-if="!siteForm.socialLinks.length" class="mt-6 rounded-xl border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {{ t('noSocialLinks') }}
          </p>

          <ul v-else class="mt-6 space-y-3">
            <li
              v-for="(link, index) in siteForm.socialLinks"
              :key="index"
              class="flex flex-wrap items-center gap-2.5 rounded-xl border border-zinc-200/80 bg-white p-3 sm:flex-nowrap dark:border-zinc-800/80 dark:bg-zinc-900"
              :class="link.enabled ? '' : 'opacity-60'"
              data-social-row
            >
              <UInput v-model="link.platform" :placeholder="t('platform')" class="w-full min-w-0 sm:w-36" :data-social-platform="index" />
              <UInput v-model="link.url" :placeholder="t('linkUrl')" type="url" class="w-full min-w-0 flex-1" :data-social-url="index" />
              <USwitch v-model="link.enabled" color="neutral" :aria-label="t('enabledLabel')" class="shrink-0" :data-social-enabled="index" />
              <span class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                  :aria-label="t('moveUp')"
                  :disabled="index === 0"
                  :data-social-up="index"
                  @click="moveSocialLink(index, -1)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
                </button>
                <button
                  type="button"
                  class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                  :aria-label="t('moveDown')"
                  :disabled="index === siteForm.socialLinks.length - 1"
                  :data-social-down="index"
                  @click="moveSocialLink(index, 1)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <button
                  type="button"
                  class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  :aria-label="t('removeLink')"
                  :data-social-remove="index"
                  @click="removeSocialLink(index)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </span>
            </li>
          </ul>
        </section>

        <div class="flex items-center justify-end gap-3 border-t border-zinc-200/80 pt-6 dark:border-zinc-800/80">
          <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="isSaving" @click="navigateTo('/')">
            {{ t('cancel') }}
          </UButton>
          <UButton type="submit" color="neutral" size="sm" :loading="isSaving" data-site-save>
            {{ t('saveChanges') }}
          </UButton>
        </div>
      </form>

      <div v-else class="mt-8 space-y-4 pb-24">
        <div class="h-40 rounded-2xl border border-zinc-200/60 bg-zinc-100 animate-pulse dark:border-zinc-800/60 dark:bg-zinc-900" />
        <div class="h-56 rounded-2xl border border-zinc-200/60 bg-zinc-100 animate-pulse dark:border-zinc-800/60 dark:bg-zinc-900" />
      </div>
    </UContainer>
  </main>
</template>
