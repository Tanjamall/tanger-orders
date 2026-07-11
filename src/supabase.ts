import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// The publishable key is safe in the browser. Never put a service-role key here.
export const supabase = url && key ? createClient(url, key) : null
