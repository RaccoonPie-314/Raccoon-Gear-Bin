<script setup lang="ts">
import { safeRedirectPath } from '~/utils/safe-redirect'

const { locale, t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { signUp, signUpWithPhone, signInWithGoogle, waitForUser } = useCustomerAuth()

// Email or phone (SPEC-identity.md amendment: “gains a phone mode beside email”). Phone signup
// creates the alias account server-side — no SMS by owner decision — then signs in with it.
const mode = ref<'email' | 'phone'>('email')

const email = ref('')
const phone = ref('')
const password = ref('')
const confirmPassword = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')

const redirectTarget = computed(() => safeRedirectPath(route.query.redirect, localePath('/account')))

// The route's machine codes first, Clerk's own errors after: Clerk answers an email collision
// with a message, and the one UI rule is that every refusal ends as a typed sentence.
const failFor = (error: unknown): string => {
  const codeValue = String((error as { data?: { message?: string } })?.data?.message || '')
  if (codeValue === 'PHONE_TAKEN') return t('phoneTaken')
  if (codeValue === 'WEAK_PASSWORD') return t('weakPassword')
  if (codeValue === 'PASSWORD_BREACHED') return t('passwordBreached')
  if (codeValue === 'INVALID_PHONE') return t('phoneInvalid')
  if (codeValue === 'THROTTLED') return t('throttled')
  const clerkMessage = String((error as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message || (error as Error)?.message || '')
  return /already|exists|taken/i.test(clerkMessage) ? t('emailTaken') : t('signUpError')
}

const handleSubmit = async () => {
  errorMessage.value = ''

  if (!password.value || (mode.value === 'email' ? !email.value : !phone.value)) {
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
    if (mode.value === 'email') await signUp(email.value, password.value)
    else await signUpWithPhone(phone.value, password.value)
    // With email confirmation off (SPEC-identity decision) the signup returns a session. The wait
    // covers the session state landing — without it the /account guard bounces to /login, the
    // defect the harness caught on the first run.
    await waitForUser()
    await navigateTo(redirectTarget.value, { replace: true })
  } catch (error) {
    errorMessage.value = failFor(error)
  } finally {
    isSubmitting.value = false
  }
}

const pageTitle = computed(() => `${t('signUp')} | ${t('appName')}`)

// Google OAuth: the same arm creates the account on first consent and merely signs in afterwards.
const handleGoogle = async () => {
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    await signInWithGoogle(redirectTarget.value)
  } catch (error) {
    console.warn('[google] sign-up failed:', error)
    errorMessage.value = t('signUpError')
  } finally {
    isSubmitting.value = false
  }
}
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

      <div class="pt-6 space-y-5">
        <div class="grid grid-cols-2 gap-1 rounded-full border border-zinc-200/80 bg-zinc-100/70 p-1 dark:border-zinc-800/80 dark:bg-zinc-900/60" data-signup-modes>
          <button
            v-for="option in [{ value: 'email' as const, label: 'email' }, { value: 'phone' as const, label: 'phone' }]"
            :key="option.value"
            type="button"
            class="cursor-pointer rounded-full px-2 py-1.5 text-xs font-semibold transition-colors"
            :class="mode === option.value
              ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
              : 'text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'"
            :data-signup-mode="option.value"
            :aria-pressed="mode === option.value"
            @click="mode = option.value; errorMessage = ''"
          >
            {{ t(option.label) }}
          </button>
        </div>

        <form class="space-y-5" @submit.prevent="handleSubmit">
          <UFormField v-if="mode === 'email'" :label="t('email')" name="email">
            <UInput v-model="email" type="email" :placeholder="t('emailPlaceholderUser')" class="w-full" />
          </UFormField>
          <UFormField v-else :label="t('phone')" name="phone">
            <UInput v-model="phone" type="tel" :placeholder="t('phoneNumberPlaceholder')" class="w-full" />
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

          <!-- Clerk bot protection (`auth_attack_protection.bot_protection.captcha_enabled`,
               widget type `smart`) mounts its widget into this element; a custom flow without it
               cannot complete sign-up at all (FAPI answers `captcha_invalid`). -->
          <div id="clerk-captcha" />

          <UButton
            type="submit"
            color="neutral"
            class="w-full justify-center py-2.5 font-semibold text-sm shadow-xs cursor-pointer"
            :loading="isSubmitting"
            :disabled="isSubmitting"
          >
            {{ isSubmitting ? t('creatingAccount') : t('createAccount') }}
          </UButton>

          <UButton
            type="button"
            color="neutral"
            variant="outline"
            class="w-full justify-center py-2.5 font-semibold text-sm cursor-pointer"
            :disabled="isSubmitting"
            data-google-signup
            @click="handleGoogle"
          >
            <span class="inline-flex items-center gap-2">
              <SocialBrandIcon platform="google" />
              {{ t('continueWithGoogle') }}
            </span>
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
    </div>
  </main>
</template>
