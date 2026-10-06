<script setup lang="ts">
const { locale, t } = useI18n()
const localePath = useLocalePath()
const {
  user, fetchProfile, updateProfile, signOut,
  generateLoginCode, fetchTelegramLink, startTelegram, pollTelegram
} = useCustomerAuth()

const displayName = ref('')
const phone = ref('')
const isLoading = ref(true)
const isSaving = ref(false)
const isSigningOut = ref(false)
const errorMessage = ref('')
const savedMessage = ref('')

// The account's identifier: an email for email accounts, the alias username for phone accounts
// (whose real number sits in the profile's phone field — the buyer-facing story stays the number).
const identifier = computed(() => user.value?.primaryEmailAddress?.emailAddress || user.value?.username || '')

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
  fetchTelegramLink().then(link => { telegram.value = link }).catch(() => {})
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

// ---- Login code card (SPEC-identity.md amendment, capability 3) --------------------------------
const loginCode = ref('')
const isGeneratingCode = ref(false)
const codeNotice = ref('')

const generateCode = async () => {
  codeNotice.value = ''
  isGeneratingCode.value = true
  try {
    loginCode.value = (await generateLoginCode()).code
  } catch (error) {
    const codeValue = String((error as { data?: { message?: string } })?.data?.message || '')
    codeNotice.value = codeValue === 'THROTTLED' ? t('throttled') : t('codeError')
  } finally {
    isGeneratingCode.value = false
  }
}

// The plaintext exists in this component and nowhere else — saving it is the buyer's job, which
// is what codeShownOnce says out loud.
const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(loginCode.value)
    codeNotice.value = t('codeCopied')
  } catch {
    codeNotice.value = ''
  }
}

// ---- Telegram card (capability 2, connect arm) -------------------------------------------------
const telegram = ref<{ linked: boolean, username: string | null } | null>(null)
const telegramWaiting = ref(false)
const telegramNotice = ref('')
let telegramTimer: ReturnType<typeof setInterval> | null = null

const stopTelegramLink = (message = '') => {
  if (telegramTimer) { clearInterval(telegramTimer); telegramTimer = null }
  telegramWaiting.value = false
  if (message) telegramNotice.value = message
}

const connectTelegram = async () => {
  telegramNotice.value = ''
  telegramWaiting.value = true
  try {
    const { nonce, deepLink } = await startTelegram('link')
    window.open(deepLink, '_blank', 'noopener')
    const until = Date.now() + 10 * 60 * 1000
    telegramTimer = setInterval(async () => {
      if (Date.now() > until) { stopTelegramLink(t('telegramExpired')); return }
      try {
        const result = await pollTelegram(nonce)
        if (result.status === 'expired') { stopTelegramLink(t('telegramExpired')); return }
        if (result.status === 'linked') {
          stopTelegramLink()
          telegram.value = await fetchTelegramLink()
          telegramNotice.value = t('telegramLinked')
        }
      } catch { /* transient poll failure — keep polling until the window closes */ }
    }, 2000)
  } catch {
    stopTelegramLink(t('telegramFailed'))
  }
}

onUnmounted(() => stopTelegramLink())

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
        <UFormField :label="t('account')">
          <!-- ClientOnly: the identifier comes from clerk-js, which the server cannot know. The
               guard waits for the SDK before this page mounts, so a plain binding would render
               empty on the server and the alias during hydration — a mismatch. -->
          <p class="text-sm font-semibold text-zinc-950 dark:text-white" data-account-email>
            <ClientOnly>{{ identifier }}</ClientOnly>
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
        <!-- Login code: generate → show once → copy. One active code, two weeks. -->
        <section class="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-login-code-card>
          <p class="text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.25em]'">
            {{ t('loginCodeTitle') }}
          </p>
          <p class="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {{ t('loginCodeIntro') }}
          </p>
          <div v-if="loginCode" class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 dark:bg-zinc-950">
            <span class="font-mono text-sm font-semibold tracking-wide text-zinc-950 dark:text-white" data-login-code-value>{{ loginCode }}</span>
            <UButton type="button" size="xs" color="neutral" variant="outline" class="cursor-pointer" @click="copyCode">
              {{ t('copyCode') }}
            </UButton>
          </div>
          <p v-if="loginCode" class="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{{ t('codeShownOnce') }}</p>
          <p v-if="codeNotice" class="mt-2 text-[11px] font-semibold text-zinc-950 dark:text-white" data-code-notice>{{ codeNotice }}</p>
          <UButton
            type="button"
            size="sm"
            color="neutral"
            variant="outline"
            class="mt-3 cursor-pointer"
            :loading="isGeneratingCode"
            data-generate-code
            @click="generateCode"
          >
            {{ t('generateCode') }}
          </UButton>
        </section>

        <!-- Telegram: connect the account so the bot deep link can sign it in later. -->
        <section class="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40" data-telegram-card>
          <p class="text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500" :class="locale === 'km' ? '' : 'tracking-[0.25em]'">
            {{ t('telegramCardTitle') }}
          </p>
          <template v-if="telegram?.linked">
            <p class="mt-2 text-sm font-semibold text-zinc-950 dark:text-white" data-telegram-linked>
              {{ t('telegramConnected', { name: telegram.username || '—' }) }}
            </p>
          </template>
          <template v-else>
            <p class="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {{ t('telegramIntro') }}
            </p>
            <p v-if="telegramWaiting" class="mt-2 text-xs font-semibold text-zinc-950 dark:text-white">
              {{ t('telegramWaiting') }}
            </p>
            <p v-if="telegramNotice" class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{{ telegramNotice }}</p>
            <UButton
              type="button"
              size="sm"
              color="neutral"
              variant="outline"
              class="mt-3 cursor-pointer"
              :disabled="telegramWaiting"
              data-telegram-connect
              @click="connectTelegram"
            >
              {{ t('telegramConnect') }}
            </UButton>
          </template>
          <p v-if="telegramNotice && telegram?.linked" class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{{ telegramNotice }}</p>
        </section>

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
