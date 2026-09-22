import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { createSessionReadRecovery } from './sessionRecovery'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// The publishable key is safe in the browser. Never put a service-role key here.
export const supabase = url && key ? createClient(url, key, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: !Capacitor.isNativePlatform(),
  },
}) : null

export const recoverSessionRead = createSessionReadRecovery(async () => {
  if (!supabase) throw new Error('Sign-in is unavailable.')
  const { data, error } = await supabase.auth.refreshSession()
  if (error) throw error
  if (!data.session) throw new Error('Your session ended. Please sign in again.')
})
