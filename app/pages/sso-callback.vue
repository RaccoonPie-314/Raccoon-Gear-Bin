<script setup lang="ts">
// Clerk's OAuth callback lands here (the FAPI appends its `__clerk_` handshake params to our
// `redirect_url`, which is kept bare on purpose; the destination rides in sessionStorage).
// Rules, each from a shipped failure:
// (1) completion waits for clerk-js (`watch`); (2) `#clerk-captcha` must be mounted — an OAuth
// that resolves as a sign-up/transfer trips bot protection; (3) a transferable attempt is
// completed explicitly (`signUp.create({ transfer: true })`); (4) **never declare NO_SESSION
// immediately** — clerk-js's own load-time pass may be consuming the same callback in parallel,
// and the session can land a beat later (declaring failure early is how a valid session got
// orphaned); (5) when it does fail, the card carries the whole trail — params seen, callback
// result, transfer status — so one screenshot names the cause.
const { t } = useI18n()
const clerk = useClerk()
const failure = ref('')

const retry = () => navigateTo('/login', { replace: true })

// Short, safe rendering of whatever a resource or error turns out to be.
const safe = (value: unknown) => {
  try {
    const text = JSON.stringify(value)
    return (text ?? String(value)).slice(0, 200)
  } catch {
    return String(value).slice(0, 200)
  }
}

watch(clerk, async (instance) => {
  if (!instance) return
  const stored = sessionStorage.getItem('sso-to')
  const to = stored && stored.startsWith('/') ? stored : '/account'
  const trail: string[] = [
    `params=${window.location.search.includes('__clerk') ? 'yes' : 'no'}`,
    `url=${(window.location.pathname + window.location.search).slice(0, 120)}`
  ]
  try {
    if (window.location.search.includes('__clerk')) {
      const result = await instance.handleRedirectCallback({
        signInFallbackRedirectUrl: to,
        signUpFallbackRedirectUrl: to
      })
      console.warn('[sso-callback] handleRedirectCallback:', result)
      trail.push(`cb=${safe(result)}`)
      if (!instance.user && instance.client) {
        const attempt = await instance.client.signUp.create({ transfer: true })
        console.warn('[sso-callback] transfer status:', attempt.status, attempt.missingFields)
        trail.push(`transfer=${attempt.status} missing=${safe(attempt.missingFields)}`)
        if (attempt.status === 'complete' && attempt.createdSessionId) {
          await instance.setActive({ session: attempt.createdSessionId })
        }
      }
    }
  } catch (error) {
    console.warn('[sso-callback] completion failed:', error)
    failure.value = `${(error as Error)?.message || String(error)}\n${trail.join(' | ')}`
    return
  }
  // Give clerk-js's own load-time pass a grace window before calling this a failure — the two
  // passes race, and the session can arrive a beat after ours looked.
  if (!instance.user) {
    const until = Date.now() + 3000
    while (!instance.user && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  // The measured failure (2026-10-06): the FAPI created the session and this client can see it,
  // but nobody ever adopted it — clerk-js's auto-pass and the handshake both skipped, and the
  // browser stayed signed out. `setActive` is the one missing verb.
  if (!instance.user && instance.client?.sessions?.length) {
    const pendingSession = instance.client.sessions[0]
    trail.push(`adopting=${pendingSession?.id ?? '?'}`)
    try {
      if (pendingSession) await instance.setActive({ session: pendingSession.id })
    } catch (error) {
      console.warn('[sso-callback] setActive failed:', error)
      trail.push(`adoptFailed=${safe((error as Error)?.message)}`)
    }
  } else {
    trail.push(`clientSessions=${instance.client?.sessions?.length ?? '?'}`)
  }
  if (instance.user) {
    // clerk-js may already have navigated (the plugin's routerPush); only land if still here.
    if (window.location.pathname.includes('sso-callback')) {
      await navigateTo(to, { replace: true })
    }
  } else {
    failure.value = `NO_SESSION\n${trail.join(' | ')}`
  }
}, { immediate: true })

useHead({ title: `${t('signingIn')} | ${t('appName')}` })
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-zinc-50/50 px-4 dark:bg-zinc-950">
    <div v-if="failure" class="w-full max-w-md rounded-2xl border border-zinc-200/80 bg-white px-6 py-5 text-center dark:border-zinc-800/80 dark:bg-zinc-950">
      <p class="text-sm font-semibold text-zinc-950 dark:text-white">{{ t('ssoFailed') }}</p>
      <p class="mt-2 break-all font-mono text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{{ failure }}</p>
      <UButton class="mt-4 justify-center cursor-pointer" color="neutral" @click="retry">
        {{ t('signIn') }}
      </UButton>
    </div>
    <p v-else class="animate-pulse text-sm font-semibold text-zinc-500 dark:text-zinc-400">{{ t('signingIn') }}</p>
    <!-- Clerk bot protection's widget mount (see signup.vue) — a sign-up transfer lands on this
         page and cannot complete without it. -->
    <div id="clerk-captcha" />
  </main>
</template>
