<script setup lang="ts">
import { accountHasName } from '~/utils/account-name'
// Clerk's OAuth callback lands here (the FAPI appends its `__clerk_` handshake params to our
// `redirect_url`, which is kept bare on purpose; the destination rides in sessionStorage).
// Rules, each from a shipped failure:
// (1) completion waits for clerk-js (`watch`); (2) `#clerk-captcha` must be mounted — an OAuth
// that resolves as a sign-up/transfer trips bot protection; (3) a transferable attempt is
// completed explicitly (`signUp.create({ transfer: true })`); (4) **never declare NO_SESSION
// early** — clerk-js's own load-time pass may be consuming the same callback in parallel, and
// the session can land seconds later (the 2026-10-07 run declared failure after a 3-second
// window and flashed the card on a sign-in that then succeeded — the transfer was still in
// flight). The page now waits 15 seconds, and a session that lands after the card shows still
// converts it into the destination; (5) when it truly fails, the card carries the whole trail —
// params seen, callback result, transfer status, wait length — so one screenshot names the cause.
const { t } = useI18n()
const localePath = useLocalePath()
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

// The `@landing` sentinel: the Google click happened signed-out, so the login page could not
// read the profile and could only guess '/account'. With the session present the verdict is
// answerable, and a nicknamed account belongs on the storefront, not back in onboarding (the
// live report of 2026-10-06). The read can face the same cookie-settle lag the order pages
// fight, so it retries — and a read that never lands no longer decides anything on its own, since
// the name clerk-js already carries answers the same question without the round trip (that lag is
// what kept nicknamed Gmail accounts on the profile editor: nothing upserts `profiles` for an
// OAuth sign-in, so the row itself is missing, not just unread). Shared by the main wait and the
// late-arrival watcher — a session is a session no matter which beat it lands on.
const resolveLanding = async (stored: string | null, fallback: string) => {
  if (stored !== '@landing') return fallback
  let profile: { display_name: string | null } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      profile = await $fetch<{ display_name: string | null } | null>('/api/profile')
      break
    } catch {
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  return accountHasName(profile, clerk.value?.user?.fullName) ? localePath('/') : fallback
}

// clerk-js may already have navigated (the plugin's routerPush); only land if still here.
const landIfStillHere = async (stored: string | null, to: string) => {
  const landing = await resolveLanding(stored, to)
  if (window.location.pathname.includes('sso-callback')) {
    await navigateTo(landing, { replace: true })
  }
}

// The failure card is not the last word: clerk-js's own pass can outlive the grace window below
// by an arbitrary margin, and its session deserves adoption whenever it lands. Poll while the
// card shows (bounded — a minute is beyond any measured transfer, and after that the card's
// retry path takes over) and convert a late session into the destination.
let latePoll: ReturnType<typeof setInterval> | undefined
let lateBusy = false
onUnmounted(() => clearInterval(latePoll))
watch(failure, (value) => {
  if (!value || latePoll) return
  let ticks = 0
  latePoll = setInterval(async () => {
    const instance = clerk.value
    ticks += 1
    if (!instance || ticks > 60 || lateBusy) return
    if (!instance.user && instance.client?.sessions?.length) {
      const pendingSession = instance.client.sessions[0]
      if (pendingSession) {
        lateBusy = true
        try {
          await instance.setActive({ session: pendingSession.id })
        } catch (error) {
          console.warn('[sso-callback] late setActive failed:', error)
        } finally {
          lateBusy = false
        }
      }
    }
    if (!instance.user) return
    clearInterval(latePoll)
    const stored = sessionStorage.getItem('sso-to')
    const to = stored && stored.startsWith('/') ? stored : '/account'
    await landIfStillHere(stored, to)
  }, 1000)
})

watch(clerk, async (instance) => {
  if (!instance) return
  const startedAt = Date.now()
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
    }
  } catch (error) {
    console.warn('[sso-callback] callback failed:', error)
    trail.push(`cbErr=${safe((error as Error)?.message)}`)
  }
  // Complete a transferable sign-up even when the `__clerk` params are already gone. An
  // UNREGISTERED Google account resolves as a transfer, and clerk-js's own load-time pass can
  // consume and strip those params while leaving the transferable attempt behind — so `params=no`
  // no longer means "nothing to transfer" (that gate is what orphaned unregistered sign-ins,
  // 2026-10-07). The throw is swallowed on purpose: a registered sign-in has no transferable
  // attempt and its session lands through clerk-js's pass, caught by the grace window below.
  if (!instance.user && instance.client) {
    try {
      const attempt = await instance.client.signUp.create({ transfer: true })
      console.warn('[sso-callback] transfer status:', attempt.status, attempt.missingFields)
      trail.push(`transfer=${attempt.status} missing=${safe(attempt.missingFields)}`)
      if (attempt.status === 'complete' && attempt.createdSessionId) {
        await instance.setActive({ session: attempt.createdSessionId })
      }
    } catch (error) {
      console.warn('[sso-callback] transfer failed:', error)
      trail.push(`transferErr=${safe((error as Error)?.message)}`)
    }
  }
  // Give clerk-js's own load-time pass a generous grace window before calling this a failure —
  // the two passes race, and the measured failure (2026-10-07) landed its session seconds AFTER
  // a 3-second window expired: the card flashed on a sign-in that then succeeded. 15 seconds
  // covers the transfer (captcha widget load + FAPI roundtrips); anything later is still caught
  // by the late-arrival watcher, so a longer wait is the only cost of the wider window.
  if (!instance.user) {
    const until = Date.now() + 15000
    while (!instance.user && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 200))
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
    await landIfStillHere(stored, to)
  } else {
    trail.push(`waited=${Math.round((Date.now() - startedAt) / 1000)}s`)
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
