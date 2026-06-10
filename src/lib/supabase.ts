import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isCorruptCachedSessionBlob } from '@/lib/auth-recovery'

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

const PROJECT_REF = projectRef(supabaseUrl)
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

// Pre-client corrupt-token preflight. `createClient()` constructs a
// GoTrueClient whose constructor kicks off `_initialize()` against
// localStorage immediately — by the time useAuth's `initializeAuth()` runs,
// the SDK has already started reading the bad blob and may be stuck inside
// it. Clearing here, BEFORE createClient is called, is the only point where
// the recovery can pre-empt the SDK's first read.
//
// `preflightClearedCorruptToken` is read by useAuth to decide whether to
// short-circuit to `/login?reset=1` (protected path) or render through
// (public path).
export let preflightClearedCorruptToken = false
if (typeof window !== 'undefined') {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (isCorruptCachedSessionBlob(raw)) {
      preflightClearedCorruptToken = true
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const key = window.localStorage.key(i)
        if (key && key.startsWith('sb-')) {
          window.localStorage.removeItem(key)
        }
      }
      console.error('[supabase] Cleared corrupt cached auth token before client construction')
    }
  } catch (err) {
    // localStorage access denied (private mode, security policy) — ignore.
    console.error('[supabase] preflight token check failed:', err)
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
    storageKey: STORAGE_KEY,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
})
