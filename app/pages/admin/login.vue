<script setup lang="ts">
const supabase = useSupabaseClient()
const { signIn } = useAdminAuth()
const { t } = useI18n()

const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')

const redirectToCatalog = () => {
  return navigateTo('/', { replace: true })
}

const handleSubmit = async () => {
  errorMessage.value = ''

  if (!email.value || !password.value) {
    errorMessage.value = t('requiredFields')
    return
  }

  isSubmitting.value = true

  try {
    const { user } = await signIn(email.value, password.value)

    if (!user) {
      throw new Error(t('invalidLogin'))
    }

    const { data: adminRecord, error: adminError } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (adminError) {
      throw adminError
    }

    if (!adminRecord) {
      await supabase.auth.signOut()
      errorMessage.value = t('unauthorized')
      return
    }

    await redirectToCatalog()
  } catch (error: any) {
    errorMessage.value = error?.message || t('invalidLogin')
  } finally {
    isSubmitting.value = false
  }
}

const pageTitle = computed(() => `${t('adminLogin')} | ${t('appName')}`)
useHead({ title: pageTitle })
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-zinc-50/50 px-4 py-12 dark:bg-zinc-950">
    <div class="w-full max-w-md rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xl p-6 sm:p-8">
      <div class="space-y-4 pb-6 border-b border-zinc-100 dark:border-zinc-800/80">
        <div class="flex items-center justify-between gap-4">
          <NuxtLink to="/">
            <BrandLogo />
          </NuxtLink>
        <div class="flex items-center gap-2">
            <ColorModeToggle />
            <LanguageSwitcher />
          </div>
        </div>
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-400 dark:text-zinc-500">
            {{ t('adminAccess') }}
          </p>
          <h1 class="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-zinc-950 dark:text-white">
            {{ t('signIn') }}
          </h1>
        </div>
      </div>

      <form class="space-y-5 pt-6" @submit.prevent="handleSubmit">
        <UFormField :label="t('email')" name="email">
          <UInput v-model="email" type="email" :placeholder="t('emailPlaceholder')" class="w-full" />
        </UFormField>

        <UFormField :label="t('password')" name="password">
          <UInput v-model="password" type="password" :placeholder="t('passwordPlaceholder')" class="w-full" />
        </UFormField>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          :title="errorMessage"
        />

        <UButton
          type="submit"
          color="neutral"
          class="w-full justify-center rounded-xl py-2.5 font-semibold text-sm shadow-xs cursor-pointer"
          :loading="isSubmitting"
          :disabled="isSubmitting"
        >
          {{ isSubmitting ? t('signingIn') : t('signIn') }}
        </UButton>

        <div class="text-center pt-2">
          <NuxtLink
            to="/"
            class="text-xs font-semibold text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors"
          >
            ← {{ t('home') }}
          </NuxtLink>
        </div>
      </form>
    </div>
  </main>
</template>
