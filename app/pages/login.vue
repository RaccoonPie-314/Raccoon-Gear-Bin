<script setup lang="ts">
import { safeRedirectPath } from '~/utils/safe-redirect'

const { locale, t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { signIn, waitForUser, fetchProfile } = useCustomerAuth()

const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')

// `redirect` is written by customer-auth.global.ts. `safeRedirectPath` is the one place the value
// is judged; an explicit same-site target always wins. A BARE /login used to land on the profile
// editor every time — that page is the onboarding that sets a nickname, not a destination, so
// once the profile has one the sign-in lands on the storefront instead. The judge's empty-string
// form is how "no usable redirect" is spelled without a second copy of its rules; a failed
// profile read keeps the old landing, where the miss is visible.
const landingTarget = async () => {
  const judged = safeRedirectPath(route.query.redirect, '')
  if (judged) return judged
  try {
    const profile = await fetchProfile()
    return profile?.display_name?.trim() ? localePath('/') : localePath('/account')
  } catch {
    return localePath('/account')
  }
}
const showRedirectNotice = computed(() => typeof route.query.redirect === 'string')

const handleSubmit = async () => {
  errorMessage.value = ''

  if (!email.value || !password.value) {
    errorMessage.value = t('requiredFields')
    return
  }

  isSubmitting.value = true

  try {
    await signIn(email.value, password.value)
    // See useCustomerAuth.waitForUser: the guarded redirect needs the user state to have landed.
    await waitForUser()
    await navigateTo(await landingTarget(), { replace: true })
  } catch {
    errorMessage.value = t('invalidLogin')
  } finally {
    isSubmitting.value = false
  }
}

const pageTitle = computed(() => `${t('signIn')} | ${t('appName')}`)
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
            {{ t('signIn') }}
          </h1>
          <p v-if="showRedirectNotice" class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {{ t('loginRequired') }}
          </p>
        </div>
      </div>

      <form class="space-y-5 pt-6" @submit.prevent="handleSubmit">
        <UFormField :label="t('email')" name="email">
          <UInput v-model="email" type="email" :placeholder="t('emailPlaceholderUser')" class="w-full" />
        </UFormField>

        <UFormField :label="t('password')" name="password">
          <UInput v-model="password" type="password" :placeholder="t('passwordPlaceholder')" class="w-full" />
        </UFormField>

        <!-- The failure arrives with the same opacity-only `reveal` the catalog uses, so the
             message is not pasted onto the form between two frames. -->
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
          {{ isSubmitting ? t('signingIn') : t('signIn') }}
        </UButton>

        <div class="space-y-2 text-center pt-2">
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            {{ t('noAccountYet') }}
            <NuxtLink :to="localePath('/signup')" class="font-semibold text-zinc-950 dark:text-white hover:underline">
              {{ t('createAccount') }}
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
