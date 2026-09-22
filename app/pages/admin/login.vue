<script setup lang="ts">
const supabase = useSupabaseClient()
const { signIn } = useAdminAuth()

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
    errorMessage.value = 'Please enter both email and password.'
    return
  }

  isSubmitting.value = true

  try {
    const { user } = await signIn(email.value, password.value)

    if (!user) {
      throw new Error('Login failed. Please check your credentials.')
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
      errorMessage.value = 'This account is not authorized as an admin.'
      return
    }

    await redirectToCatalog()
  } catch (error: any) {
    errorMessage.value = error?.message || 'Login failed. Please try again.'
  } finally {
    isSubmitting.value = false
  }
}

const pageTitle = computed(() => 'Admin Login')
useHead({ title: pageTitle })
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-zinc-100 px-6 py-12 dark:bg-zinc-950">
    <UCard class="w-full max-w-md border-0 shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <template #header>
        <div class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-[0.26em] text-zinc-500">Admin access</p>
          <h1 class="text-2xl font-black text-zinc-950 dark:text-white">Sign in</h1>
        </div>
      </template>

      <form class="space-y-5" @submit.prevent="handleSubmit">
        <UFormField label="Email" name="email">
          <UInput v-model="email" type="email" placeholder="admin@raccoon.com" class="w-full" />
        </UFormField>

        <UFormField label="Password" name="password">
          <UInput v-model="password" type="password" placeholder="Your password" class="w-full" />
        </UFormField>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          :title="errorMessage"
        />

        <UButton type="submit" class="w-full" :loading="isSubmitting" :disabled="isSubmitting">
          {{ isSubmitting ? 'Signing in...' : 'Login' }}
        </UButton>
      </form>
    </UCard>
  </main>
</template>
