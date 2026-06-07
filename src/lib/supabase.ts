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

function projectRef(url: string): string {
  try {
    return new URL(url).host.split('.')[0] || 'sb'
  } catch {
    return 'sb'
  }
}

// Single module-scoped client. Explicit auth config so defaults can't drift
// between SDK upgrades — the storageKey/storage combo is what useAuth's
// stale-token cleanup matches against.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: `sb-${projectRef(supabaseUrl)}-auth-token`,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
})
