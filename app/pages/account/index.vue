<script setup lang="ts">
const { locale, t } = useI18n()
const localePath = useLocalePath()
const { user, fetchProfile, updateProfile, signOut } = useCustomerAuth()

const displayName = ref('')
const phone = ref('')
const isLoading = ref(true)
const isSaving = ref(false)
const isSigningOut = ref(false)
const errorMessage = ref('')
const savedMessage = ref('')

// Client-side on purpose: the profile read rides the session the supabase plugin holds in the
// browser, and this page sits behind customer-auth.global.ts anyway.
onMounted(async () => {
  try {
    const profile = await fetchProfile()
    displayName.value = profile?.display_name ?? ''
    phone.value = profile?.phone ?? ''
  } catch {
    errorMessage.value = t('accountLoadError')
  } finally {
    isLoading.value = false
  }
})

const handleSave = async () => {
  errorMessage.value = ''
  savedMessage.value = ''
  isSaving.value = true

  try {
    await updateProfile({
      displayName: displayName.value.trim() || null,
      phone: phone.value.trim() || null
    })
    savedMessage.value = t('accountSaved')
  } catch {
    errorMessage.value = t('accountSaveError')
  } finally {
    isSaving.value = false
  }
}

const handleSignOut = async () => {
  errorMessage.value = ''
  isSigningOut.value = true

  try {
    await signOut()
    await navigateTo(localePath('/'), { replace: true })
  } catch {
    errorMessage.value = t('signOutError')
    isSigningOut.value = false
  }
}

const pageTitle = computed(() => `${t('myAccount')} | ${t('appName')}`)
useHead({ title: pageTitle })
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-zinc-50/50 px-4 py-12 dark:bg-zinc-950">
    <div class="w-full max-w-md rounded-3xl bg-white dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xl p-6 sm:p-8">
      <div class="space-y-4 pb-6 border-b border-zinc-100 dark:border-zinc-800/80">
        <div class="flex items-center justify-between gap-4">
          <NuxtLink :to="localePath('/')">
            <BrandLogo />
          </NuxtLink>
          <div class="flex items-center gap-2">
            <ColorModeToggle />
            <LanguageSwitcher />
          </div>
        </div>
        <div>
          <p class="text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.25em]'">
            {{ t('account') }}
          </p>
          <h1 class="mt-1 text-2xl sm:text-3xl font-black text-zinc-950 dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
            {{ t('myAccount') }}
          </h1>
        </div>
      </div>

      <form class="space-y-5 pt-6" @submit.prevent="handleSave">
        <UFormField :label="t('email')">
          <p class="text-sm font-semibold text-zinc-950 dark:text-white" data-account-email>
            {{ user?.email }}
          </p>
        </UFormField>

        <UFormField :label="t('displayName')" name="display-name">
          <UInput v-model="displayName" type="text" :disabled="isLoading" class="w-full" />
        </UFormField>

        <UFormField :label="t('phoneOptional')" name="phone">
          <UInput v-model="phone" type="tel" :disabled="isLoading" class="w-full" />
        </UFormField>

        <Transition name="reveal">
          <UAlert v-if="errorMessage" color="error" variant="soft" :title="errorMessage" />
        </Transition>

        <Transition name="reveal">
          <UAlert v-if="savedMessage" color="success" variant="soft" :title="savedMessage" />
        </Transition>

        <UButton
          type="submit"
          color="neutral"
          class="w-full justify-center py-2.5 font-semibold text-sm shadow-xs cursor-pointer"
          :loading="isSaving"
          :disabled="isSaving || isLoading"
        >
          {{ t('saveChanges') }}
        </UButton>
      </form>

      <div class="mt-6 border-t border-zinc-100 dark:border-zinc-800/80 pt-5 space-y-4">
        <NuxtLink
          :to="localePath('/account/orders')"
          data-account-orders
          class="flex items-center justify-between rounded-2xl border border-zinc-200/80 bg-zinc-50/60 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-100 dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:text-white dark:hover:bg-zinc-900"
        >
          <span>{{ t('orders') }}</span>
          <span aria-hidden="true" class="text-zinc-400">→</span>
        </NuxtLink>

        <UButton
          color="neutral"
          variant="outline"
          class="w-full justify-center py-2.5 font-semibold text-sm cursor-pointer"
          :loading="isSigningOut"
          :disabled="isSigningOut"
          data-account-signout
          @click="handleSignOut"
        >
          {{ t('logout') }}
        </UButton>

        <div class="text-center">
          <NuxtLink :to="localePath('/')" class="text-xs font-semibold text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors">
            ← {{ t('home') }}
          </NuxtLink>
        </div>
      </div>
    </div>
  </main>
</template>
