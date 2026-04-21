import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[supabase] Missing env vars:', {
    VITE_SUPABASE_URL: !!supabaseUrl,
    VITE_SUPABASE_ANON_KEY: !!supabaseAnonKey,
  })
  throw new Error(
    'Missing Supabase env vars: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. ' +
    'Add them in Vercel → Project Settings → Environment Variables, then redeploy.'
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
