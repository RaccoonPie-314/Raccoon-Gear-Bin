import type { Database } from '~/types/database'

export const useAdminAuth = () => {
  const supabase = useSupabaseClient<Database>()
  const user = useSupabaseUser()

  const getCurrentUser = async () => {
    const { data, error } = await supabase.auth.getUser()
    if (!error && data.user?.id) {
      return data.user
    }

    return user.value?.id ? user.value : null
  }

  const isAdmin = async () => {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return false
    }

    const { data, error } = await supabase
      .from('admin_users')
      .select('role')
      .eq('user_id', currentUser.id)
      .maybeSingle()

    if (error) {
      console.error('Admin auth check failed:', error)
      return false
    }

    return Boolean(data)
  }

  const isSuperAdmin = async () => {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return false
    }

    const { data, error } = await supabase
      .from('admin_users')
      .select('role')
      .eq('user_id', currentUser.id)
      .maybeSingle()

    if (error) {
      console.error('Super admin check failed:', error)
      return false
    }

    return data?.role === 'super_admin'
  }

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      throw error
    }

    return data
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return {
    user,
    isAdmin,
    isSuperAdmin,
    signIn,
    signOut
  }
}
