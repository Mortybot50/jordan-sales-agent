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
  notify_whatsapp_e164: string | null
  notify_warm_replies: boolean
  notify_quiet_hours_start: number | null
  notify_quiet_hours_end: number | null
}

interface AuthState {
  session: Session | null
  user: AppUser | null
  loading: boolean
}

// Hard cap for the case where Supabase's internal session restore truly hangs
// (no INITIAL_SESSION ever delivered). After this we treat it as the 22/04/2026
// corrupt-token failure mode: wipe storage and redirect to /login.
const SESSION_RESTORE_HARD_CAP_MS = 25_000

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
    .select('id, org_id, full_name, email, role, email_signature, voice_rules, icp_config, email_notifications, default_commission_pct, notify_whatsapp_e164, notify_warm_replies, notify_quiet_hours_start, notify_quiet_hours_end')
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
    notify_whatsapp_e164: (d.notify_whatsapp_e164 as string | null) ?? null,
    notify_warm_replies: (d.notify_warm_replies as boolean | null) ?? true,
    notify_quiet_hours_start: d.notify_quiet_hours_start == null ? null : Number(d.notify_quiet_hours_start),
    notify_quiet_hours_end: d.notify_quiet_hours_end == null ? null : Number(d.notify_quiet_hours_end),
  }
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    let settled = false

    // Subscribe-only pattern. Supabase fires INITIAL_SESSION on the first
    // subscriber with whatever's in storage (or null) once _initialize() has
    // read the persisted token. We do NOT race a manual getSession() against
    // a soft timeout — that produced cross-tab navigator-lock contention
    // (gotrue's "Lock not released within 5000ms" warning) and the UI could
    // settle in inconsistent states under React 19 StrictMode double-mount.
    // The hardCapTimer below is the only safety net.
    const hardCapTimer = setTimeout(() => {
      if (!mounted || settled) return
      console.error(
        '[useAuth] session restore hung past',
        SESSION_RESTORE_HARD_CAP_MS,
        'ms — clearing persisted session and redirecting to /login',
      )
      clearStaleSupabaseAuthStorage()
      setSession(null)
      setUser(null)
      setLoading(false)
      toast.error('Session expired, please log in')
      redirectToLogin()
    }, SESSION_RESTORE_HARD_CAP_MS)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!mounted) return
      settled = true
      clearTimeout(hardCapTimer)
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
      if (mounted) setLoading(false)
    })

    return () => {
      mounted = false
      clearTimeout(hardCapTimer)
      subscription.unsubscribe()
    }
  }, [])

  return { session, user, loading }
}
