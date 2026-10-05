<script setup lang="ts">
import { safeRedirectPath } from '~/utils/safe-redirect'

const { locale, t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { signUp, waitForUser } = useCustomerAuth()

const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')

const redirectTarget = computed(() => safeRedirectPath(route.query.redirect, localePath('/account')))

const handleSubmit = async () => {
  errorMessage.value = ''

  if (!email.value || !password.value) {
    errorMessage.value = t('requiredFields')
    return
  }

  if (password.value.length < 8) {
    errorMessage.value = t('passwordMin')
    return
  }

  if (password.value !== confirmPassword.value) {
    errorMessage.value = t('passwordsDoNotMatch')
    return
  }

  isSubmitting.value = true

  try {
    await signUp(email.value, password.value)
    // With email confirmation off (SPEC-identity decision) signUp returns a session. The wait covers
    // the module's async user refresh — without it the /account guard reads an empty user and
    // bounces back to /login, which is the defect the harness caught on the first run.
    await waitForUser()
    await navigateTo(redirectTarget.value, { replace: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    errorMessage.value = /already/i.test(message) ? t('emailTaken') : t('signUpError')
  } finally {
    isSubmitting.value = false
  }
}

const pageTitle = computed(() => `${t('signUp')} | ${t('appName')}`)
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
            {{ t('signUpTitle') }}
          </h1>
        </div>
      </div>

      <form class="space-y-5 pt-6" @submit.prevent="handleSubmit">
        <UFormField :label="t('email')" name="email">
          <UInput v-model="email" type="email" :placeholder="t('emailPlaceholderUser')" class="w-full" />
        </UFormField>

        <UFormField :label="t('password')" name="password">
          <UInput v-model="password" type="password" :placeholder="t('passwordPlaceholder')" class="w-full" />
        </UFormField>

        <UFormField :label="t('confirmPassword')" name="confirm-password">
          <UInput v-model="confirmPassword" type="password" :placeholder="t('passwordPlaceholder')" class="w-full" />
        </UFormField>

        <Transition name="reveal">
          <UAlert v-if="errorMessage" color="error" variant="soft" :title="errorMessage" />
        </Transition>

        <UButton
          type="submit"
          color="neutral"
          class="w-full justify-center py-2.5 font-semibold text-sm shadow-xs cursor-pointer"
          :loading="isSubmitting"
          :disabled="isSubmitting"
        >
          {{ isSubmitting ? t('creatingAccount') : t('createAccount') }}
        </UButton>

        <!-- Consent line, required by the compliance module before this page can deploy (G1). -->
        <p class="text-[11px] leading-relaxed text-center text-zinc-500 dark:text-zinc-400">
          {{ t('consentPrefix') }}
          <NuxtLink :to="localePath('/terms')" class="font-semibold text-zinc-950 dark:text-white hover:underline">{{ t('consentTerms') }}</NuxtLink>
          ·
          <NuxtLink :to="localePath('/privacy')" class="font-semibold text-zinc-950 dark:text-white hover:underline">{{ t('consentPrivacy') }}</NuxtLink>
        </p>

        <div class="space-y-2 text-center pt-2">
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            {{ t('alreadyHaveAccount') }}
            <NuxtLink :to="localePath('/login')" class="font-semibold text-zinc-950 dark:text-white hover:underline">
              {{ t('signIn') }}
            </NuxtLink>
          </p>
          <NuxtLink :to="localePath('/')" class="block text-xs font-semibold text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors">
            ← {{ t('home') }}
          </NuxtLink>
        </div>
      </form>
    </div>
  </main>
</template>
