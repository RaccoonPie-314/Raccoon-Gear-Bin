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
    errorMessage.value = `${t('email')} ${t('password')}`
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
  <main class="flex min-h-screen items-center justify-center bg-zinc-100 px-6 py-12 dark:bg-zinc-950">
    <UCard class="w-full max-w-md border-0 shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <template #header>
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-4"><BrandLogo /><LanguageSwitcher /></div>
          <p class="text-xs font-semibold uppercase tracking-[0.26em] text-zinc-500">{{ t('adminAccess') }}</p>
          <h1 class="text-2xl font-black text-zinc-950 dark:text-white">{{ t('signIn') }}</h1>
        </div>
      </template>

      <form class="space-y-5" @submit.prevent="handleSubmit">
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

        <UButton type="submit" class="w-full" :loading="isSubmitting" :disabled="isSubmitting">
          {{ isSubmitting ? t('signingIn') : t('signIn') }}
        </UButton>
      </form>
    </UCard>
  </main>
</template>
