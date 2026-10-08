<script setup lang="ts">
import { safeRedirectPath } from '~/utils/safe-redirect'
import { accountHasName } from '~/utils/account-name'

const { locale, t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const {
  user, signIn, phoneIdentifier, verifyLoginCode,
  startTelegram, pollTelegram, completeOnHosted, completeTicket, signInWithGoogle, waitForUser, fetchProfile
} = useCustomerAuth()

// The three ways in (SPEC-identity.md amendment): password by email, password by phone (the
// alias lives server-side), and the saved login code. Telegram is a button beside all of them.
const mode = ref<'email' | 'phone' | 'code'>('email')
const modes = [
  { value: 'email' as const, label: 'email' },
  { value: 'phone' as const, label: 'phone' },
  { value: 'code' as const, label: 'loginCode' }
]

const email = ref('')
const phone = ref('')
const password = ref('')
const code = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')

// `redirect` is written by customer-auth.global.ts. `safeRedirectPath` is the one place the value
// is judged; an explicit same-site target always wins. A BARE /login used to land on the profile
// editor every time — that page is the onboarding that sets a nickname, not a destination, so
// once the profile has one the sign-in lands on the storefront instead. The judge's empty-string
// form is how "no usable redirect" is spelled without a second copy of its rules; a failed
// profile read keeps the old landing, where the miss is visible. It only ever answers once a
// session exists — `fetchProfile` declines while signed out — which is why the ticket branches
// below judge after the session rather than before the hop.
const landingTarget = async () => {
  const judged = safeRedirectPath(route.query.redirect, '')
  if (judged) return judged
  try {
    const profile = await fetchProfile()
    return accountHasName(profile, user.value?.fullName) ? localePath('/') : localePath('/account')
  } catch {
    return localePath('/account')
  }
}
const showRedirectNotice = computed(() => typeof route.query.redirect === 'string')

// A session adopted by clerk-js can get bounced here by the server branch of the guard before
// the server's cookie catches up (the dev-browser lag) — or the visitor simply navigates here
// while signed in. Either way, a signed-in visitor has no business on the form: land them where
// they were headed. `useSignedIn` or-s the server-seeded truth with the client user, so this
// fires exactly when the browser (or the server) knows a session exists.
const signedIn = useSignedIn()
// `watch`, not a one-shot mount check: when this page lands from a guard bounce, clerk-js is
// still loading and the client user arrives a beat later. `!isSubmitting` is load-bearing: during
// an in-page sign-in this watcher and the submit handler would otherwise BOTH navigate on the
// same tick (two concurrent router pushes, one with `replace`) — the walking harness observed
// the form parking on /login. The submit handler owns the landing it started; this watcher only
// lands visitors who arrived here already signed in.
watch(signedIn, async (value) => {
  if (!value || isSubmitting.value || !route.path.startsWith('/login')) return
  await navigateTo(await landingTarget(), { replace: true })
}, { immediate: true })

// The route's machine codes → copy, one map for every mode (the checkout's convention).
const failFor = (error: unknown): string => {
  const codeValue = String((error as { data?: { message?: string } })?.data?.message || '')
  if (codeValue === 'INVALID_PHONE') return t('phoneInvalid')
  if (codeValue === 'THROTTLED') return t('throttled')
  if (codeValue === 'INVALID_CODE' || codeValue === 'BAD_FORMAT') return t('codeInvalid')
  if (codeValue === 'EXPIRED') return t('codeExpired')
  return t('invalidLogin')
}

const handleSubmit = async () => {
  errorMessage.value = ''

  if (mode.value === 'code') {
    if (!code.value.trim()) {
      errorMessage.value = t('requiredFields')
      return
    }
    isSubmitting.value = true
    try {
      // The mint's ticket completes the session in-page (a password sign-in's own mechanism);
      // Clerk's hosted page is the fallback, and only that fallback has to pick its landing
      // before leaving this document.
      const mint = await verifyLoginCode(code.value)
      // The ticket first, the verdict after: while signed out there is no name to read, so
      // judging here used to answer "/account" for every account that already had one (the live
      // report of 2026-10-07 — it is the same defect the Google leg had, on the other door).
      if (await completeTicket(mint.ticket)) {
        await navigateTo(await landingTarget(), { replace: true })
        return
      }
      const landing = await landingTarget()
      await navigateTo(completeOnHosted(mint.signInUrl, window.location.origin + landing), { external: true })
    } catch (error) {
      errorMessage.value = failFor(error)
    } finally {
      isSubmitting.value = false
    }
    return
  }

  if (!password.value || (mode.value === 'email' ? !email.value : !phone.value)) {
    errorMessage.value = t('requiredFields')
    return
  }

  isSubmitting.value = true
  try {
    const identifier = mode.value === 'email' ? email.value : await phoneIdentifier(phone.value)
    await signIn(identifier, password.value)
    // See useCustomerAuth.waitForUser: the guarded redirect needs the user state to have landed.
    await waitForUser()
    await navigateTo(await landingTarget(), { replace: true })
  } catch (error) {
    errorMessage.value = failFor(error)
  } finally {
    isSubmitting.value = false
  }
}

// ---- Google: OAuth out, callback back ---------------------------------------------------------
// The same arm signs in and signs up (Clerk creates the account on first consent), so the login
// and signup pages both offer it.
const beginGoogle = async () => {
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    // Only the explicit redirect is decided pre-auth. The storefront-vs-onboarding verdict needs
    // the profile read, which answers null without a session — judging it here is what sent every
    // nicknamed Google sign-in back to /account (live report, 2026-10-06). Empty = "no explicit
    // destination"; the callback judges once the session exists.
    await signInWithGoogle(safeRedirectPath(route.query.redirect, ''))
  } catch (error) {
    console.warn('[google] sign-in failed:', error)
    errorMessage.value = t('invalidLogin')
  } finally {
    isSubmitting.value = false
  }
}

// ---- Telegram: deep link out, poll back -------------------------------------------------------
const telegramOpen = ref(false)
const telegramWaiting = ref(false)
const telegramError = ref('')
let telegramTimer: ReturnType<typeof setInterval> | null = null

const stopTelegram = (message = '') => {
  if (telegramTimer) { clearInterval(telegramTimer); telegramTimer = null }
  telegramWaiting.value = false
  telegramError.value = message
}

const beginTelegram = async () => {
  telegramError.value = ''
  telegramWaiting.value = true
  try {
    const { nonce, deepLink } = await startTelegram('login')
    // `window.open` after an await has lost the user gesture, and mobile browsers refuse it
    // silently — the live phone report (2026-10-06) was exactly this: the button did nothing.
    // Desktop opens the tab; a refused open falls back to a same-tab navigation, the mobile-native
    // path (t.me opens the Telegram app; this tab keeps polling underneath). No `noopener` here:
    // its presence makes the return value null by spec, which the check below would read as
    // "blocked" and double-navigate.
    const telegramTab = window.open(deepLink, '_blank')
    if (!telegramTab) window.location.href = deepLink
    const until = Date.now() + 10 * 60 * 1000
    telegramTimer = setInterval(async () => {
      if (Date.now() > until) { stopTelegram(t('telegramExpired')); return }
      try {
        const result = await pollTelegram(nonce)
        if (result.status === 'expired') { stopTelegram(t('telegramExpired')); return }
        if (result.status === 'confirmed') {
          stopTelegram()
          // Ticket first, verdict after — see the code branch: the name cannot be read while
          // signed out. The hosted page is the fallback, and it must be aimed before the hop.
          if (result.ticket && await completeTicket(result.ticket)) {
            await navigateTo(await landingTarget(), { replace: true })
            return
          }
          if (result.signInUrl) {
            const landing = await landingTarget()
            await navigateTo(completeOnHosted(result.signInUrl, window.location.origin + landing), { external: true })
          } else {
            telegramError.value = t('telegramFailed')
          }
        }
      } catch { /* transient poll failure — keep polling until the window closes */ }
    }, 2000)
  } catch {
    stopTelegram(t('telegramFailed'))
  }
}

onUnmounted(() => stopTelegram())

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

      <div class="pt-6 space-y-5">
        <!-- The mode switch: email | phone | saved code. Telegram below works in every mode. -->
        <div class="grid grid-cols-3 gap-1 rounded-full border border-zinc-200/80 bg-zinc-100/70 p-1 dark:border-zinc-800/80 dark:bg-zinc-900/60" data-login-modes>
          <button
            v-for="option in modes"
            :key="option.value"
            type="button"
            class="cursor-pointer rounded-full px-2 py-1.5 text-xs font-semibold transition-colors"
            :class="mode === option.value
              ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
              : 'text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'"
            :data-login-mode="option.value"
            :aria-pressed="mode === option.value"
            @click="mode = option.value; errorMessage = ''"
          >
            {{ t(option.label) }}
          </button>
        </div>

        <form class="space-y-5" @submit.prevent="handleSubmit">
          <template v-if="mode === 'email'">
            <UFormField :label="t('email')" name="email">
              <UInput v-model="email" type="email" :placeholder="t('emailPlaceholderUser')" class="w-full" />
            </UFormField>
            <UFormField :label="t('password')" name="password">
              <UInput v-model="password" type="password" :placeholder="t('passwordPlaceholder')" class="w-full" />
            </UFormField>
          </template>

          <template v-else-if="mode === 'phone'">
            <UFormField :label="t('phone')" name="phone">
              <UInput v-model="phone" type="tel" :placeholder="t('phoneNumberPlaceholder')" class="w-full" />
            </UFormField>
            <UFormField :label="t('password')" name="password">
              <UInput v-model="password" type="password" :placeholder="t('passwordPlaceholder')" class="w-full" />
            </UFormField>
          </template>

          <template v-else>
            <UFormField :label="t('loginCode')" name="code">
              <UInput v-model="code" type="text" :placeholder="t('loginCodePlaceholder')" class="w-full font-mono" data-login-code />
            </UFormField>
          </template>

          <!-- The failure arrives with the same opacity-only `reveal` the catalog uses, so the
               message is not pasted onto the form between two frames. -->
          <Transition name="reveal">
            <UAlert v-if="errorMessage" color="error" variant="soft" :title="errorMessage" />
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
        </form>

        <!-- Social, one button each in every mode. Google first: it is also a sign-up, and it
             returns via /sso-callback on this origin. Telegram opens the bot, the poll completes. -->
        <div class="space-y-3 border-t border-zinc-100 pt-5 dark:border-zinc-800/80">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            class="w-full justify-center py-2.5 font-semibold text-sm cursor-pointer"
            :disabled="isSubmitting"
            data-google-login
            @click="beginGoogle"
          >
            <span class="inline-flex items-center gap-2">
              <SocialBrandIcon platform="google" />
              {{ t('continueWithGoogle') }}
            </span>
          </UButton>

          <UButton
            type="button"
            color="neutral"
            variant="outline"
            class="w-full justify-center py-2.5 font-semibold text-sm cursor-pointer"
            :disabled="telegramWaiting"
            data-telegram-login
            @click="telegramOpen = true; beginTelegram()"
          >
            <span class="inline-flex items-center gap-2">
              <SocialBrandIcon platform="telegram" />
              {{ t('continueWithTelegram') }}
            </span>
          </UButton>

          <Transition name="reveal">
            <div v-if="telegramOpen" class="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4 text-sm dark:border-zinc-800/80 dark:bg-zinc-900/40" data-telegram-panel>
              <p class="font-semibold text-zinc-950 dark:text-white">{{ t('telegramWaiting') }}</p>
              <p v-if="telegramError" class="mt-2 text-zinc-500 dark:text-zinc-400">{{ telegramError }}</p>
              <div class="mt-3 flex items-center gap-2">
                <UButton
                  v-if="telegramError || !telegramWaiting"
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  class="cursor-pointer"
                  @click="beginTelegram()"
                >
                  {{ t('continueWithTelegram') }}
                </UButton>
                <UButton
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  class="cursor-pointer"
                  @click="telegramOpen = false; stopTelegram()"
                >
                  {{ t('cancel') }}
                </UButton>
              </div>
            </div>
          </Transition>
        </div>

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
      </div>
    </div>
  </main>
</template>
