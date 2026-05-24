import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

export interface AppUser {
  id: string
  email: string
  org_id: string
  full_name: string | null
  role: string
  email_signature: string | null
  voice_rules: string | null
  icp_config: Record<string, unknown>
  email_notifications: {
    morning_briefing: boolean
    briefing_time_hour: number
    morning_briefing_paused_until?: string | null
  }
  default_commission_pct: number | null
}

interface AuthState {
  session: Session | null
  user: AppUser | null
  loading: boolean
}

const SESSION_RESTORE_TIMEOUT_MS = 5_000

/** Derive the Supabase project ref from VITE_SUPABASE_URL.
 *  Supabase v2 SDK persists the session under `sb-<projectRef>-auth-token`.
 */
function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).host
    return host.split('.')[0] || null
  } catch {
    return null
  }
}

function clearStaleSupabaseAuthStorage() {
  const ref = projectRefFromUrl(import.meta.env.VITE_SUPABASE_URL)
  // Clear the canonical key, plus any other sb-*-auth-token keys lingering
  // from previous projects/refs (defensive).
  try {
    if (ref) {
      localStorage.removeItem(`sb-${ref}-auth-token`)
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        localStorage.removeItem(key)
      }
    }
  } catch (err) {
    console.error('[useAuth] localStorage clear failed:', err)
  }
}

function redirectToLogin() {
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.replace('/login')
  }
}

async function fetchUserProfile(userId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, org_id, full_name, email, role, email_signature, voice_rules, icp_config, email_notifications, default_commission_pct')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) return null

  const d = data as unknown as Record<string, unknown>
  return {
    id: d.id as string,
    email: (d.email as string | null) ?? '',
    org_id: d.org_id as string,
    full_name: d.full_name as string | null,
    role: (d.role as string | null) ?? 'member',
    email_signature: d.email_signature as string | null,
    voice_rules: d.voice_rules as string | null,
    icp_config: ((d.icp_config ?? {}) as Record<string, unknown>),
    email_notifications: ((d.email_notifications ?? { morning_briefing: true, briefing_time_hour: 7 }) as {
      morning_briefing: boolean
      briefing_time_hour: number
      morning_briefing_paused_until?: string | null
    }),
    default_commission_pct: d.default_commission_pct == null ? null : Number(d.default_commission_pct),
  }
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // Race getSession() against a 5s timeout. iOS Safari PWA cold-start has
    // been observed to hang here when the persisted session token is stale
    // or corrupted. Without the timeout, the app sits forever on "Loading…".
    const sessionPromise = supabase.auth.getSession()
    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), SESSION_RESTORE_TIMEOUT_MS)
    })

    Promise.race([sessionPromise, timeoutPromise])
      .then(async (result) => {
        if (!mounted) return

        if ('timedOut' in result) {
          // Timeout means getSession() is slow, not that the persisted token is corrupt.
          // We deliberately do NOT setLoading(false) here: with session still null,
          // RequireAuth would Navigate to /login, unmounting this hook and unsubscribing
          // the auth listener before the in-flight getSession() can settle. Instead we
          // keep the loading spinner up and let either (a) the still-running
          // getSession() eventually resolve, or (b) the onAuthStateChange listener below
          // fire INITIAL_SESSION, populate state, and clear loading naturally. The
          // .catch() branch below still handles real getSession() failures.
          console.warn(
            '[useAuth] getSession exceeded',
            SESSION_RESTORE_TIMEOUT_MS,
            'ms — leaving session intact, awaiting onAuthStateChange',
          )
          return
        }

        const { data: { session: s } } = result
        try {
          setSession(s)
          if (s?.user) {
            const profile = await fetchUserProfile(s.user.id)
            if (mounted) setUser(profile)
          }
        } catch (err) {
          console.error('[useAuth] Failed to load session profile:', err)
        } finally {
          if (mounted) setLoading(false)
        }
      })
      .catch((err) => {
        console.error(
          '[useAuth] getSession failed — clearing persisted session and redirecting to /login:',
          err,
        )
        if (!mounted) return
        clearStaleSupabaseAuthStorage()
        setSession(null)
        setUser(null)
        setLoading(false)
        toast.error('Session expired, please log in')
        redirectToLogin()
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!mounted) return
      setSession(s)
      if (s?.user) {
        try {
          const profile = await fetchUserProfile(s.user.id)
          if (mounted) setUser(profile)
        } catch (err) {
          console.error('[useAuth] Failed to load profile on auth change:', err)
        }
      } else {
        setUser(null)
      }
      // Clear the loading spinner once any auth event has been observed. Critical for
      // the timeout branch above, which intentionally leaves loading=true and relies
      // on Supabase's INITIAL_SESSION event (delivered here) to settle the UI.
      if (mounted) setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return { session, user, loading }
}
