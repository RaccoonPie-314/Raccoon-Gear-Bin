import { createClient } from '@supabase/supabase-js'

export function createSupabaseAdminClient() {
  const config = useRuntimeConfig()

  const url = config.public.supabaseUrl
  const serviceRoleKey = config.supabaseServiceRoleKey

  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase service configuration')
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}
