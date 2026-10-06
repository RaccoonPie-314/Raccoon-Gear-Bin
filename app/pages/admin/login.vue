<script setup lang="ts">
const { signIn, isAdmin } = useAdminAuth()
const { locale, t } = useI18n()

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
    await signIn(email.value, password.value)

    // The allowlist lives in Neon and the browser has no read path to it — `/api/admin-check` is
    // the guard's own question, asked after the session exists. A non-admin gets the sentence and
    // keeps their session: this is the same Clerk session as the storefront, and the admin pages
    // stay shut by the guard + RLS — signing them out from here would log them out of the shop,
    // and clerk's signOut navigates to afterSignOutUrl ('/'), which swallowed the message.
    if (!(await isAdmin())) {
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
    <!-- dark:bg-zinc-950, not zinc-900: the dark emblem ships with its own #09090b field, so a
         lighter card turns the logo into a black rectangle pasted onto gray. One near-black value
         for page, card and logo is the OLED treatment the rest of the site already uses, and it
         lifts the inputs (which stay zinc-900) off the surface instead of burying them in it. -->
    <div class="w-full max-w-md rounded-3xl bg-white dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xl p-6 sm:p-8">
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
          <p class="text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.25em]'">
            {{ t('adminAccess') }}
          </p>
          <h1 class="mt-1 text-2xl sm:text-3xl font-black text-zinc-950 dark:text-white" :class="locale === 'km' ? '' : 'tracking-tight'">
            {{ t('signIn') }}
          </h1>
        </div>
      </div>

      <form class="space-y-5 pt-6" @submit.prevent="handleSubmit">
        <UFormField :label="t('email')" name="email">
          <!-- text, not email: Clerk takes an email or the username alias the phone accounts
               carry, and type="email" would let native validation block the latter on submit. -->
          <UInput v-model="email" type="text" autocomplete="username" :placeholder="t('emailPlaceholder')" class="w-full" />
        </UFormField>

        <UFormField :label="t('password')" name="password">
          <UInput v-model="password" type="password" :placeholder="t('passwordPlaceholder')" class="w-full" />
        </UFormField>

        <!-- The failure arrives with the same opacity-only `reveal` the catalog grid uses, so the
             message is not pasted onto the form between two frames. -->
        <Transition name="reveal">
          <UAlert
            v-if="errorMessage"
            color="error"
            variant="soft"
            :title="errorMessage"
          />
        </Transition>

        <!-- Clerk bot protection's widget mount (see signup.vue) — a flagged sign-in without it
             would fail `captcha_invalid` the same way. -->
        <div id="clerk-captcha" />

        <UButton
          type="submit"
          color="neutral"
          class="w-full justify-center py-2.5 font-semibold text-sm shadow-xs cursor-pointer"
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
