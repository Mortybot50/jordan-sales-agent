import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import {
  buildReauthUrl,
  isReauthAttempt,
  stripReauthFlag,
} from '@/lib/auth-recovery'
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
  /**
   * True when there IS a Supabase session but the app profile could not be
   * loaded — either the users-row fetch errored (DB/RLS/network) or no row
   * exists. Either way the app shell must not render against `user=null`;
   * RequireAuth surfaces a recoverable error screen instead.
   */
  profileError: boolean
}

// Hard cap for the case where Supabase's internal session restore truly hangs
// (no INITIAL_SESSION ever delivered). Common cause: an orphaned navigator.locks
// lock on `sb-<ref>-auth-token` held by a previous mount or stale tab — gotrue's
// _initialize() awaits the lock and never returns. 8s is the floor below which
// a slow first-paint + slow network can spuriously trip; above 25s users give
// up and force-quit the tab.
const SESSION_RESTORE_HARD_CAP_MS = 8_000

// Module-scoped (per-tab) state for the hard-cap timer. Survives React 19
// StrictMode's effect-cleanup-then-remount so a remount can't re-arm a timer
// that already fired once in this tab's lifetime.
type HardCapStatus = 'idle' | 'fired' | 'settled'

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
      if (key && key.startsWith('sb-')) {
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

// Distinguish the three outcomes so the caller can react correctly:
//   AppUser  — profile loaded
//   'error'  — the fetch failed (DB/RLS/network); recoverable via retry
//   null     — no users row for this auth id (misconfiguration)
type ProfileResult = AppUser | 'error' | null

async function fetchUserProfile(userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from('users')
    .select('id, org_id, full_name, email, role, email_signature, voice_rules, icp_config, email_notifications, default_commission_pct, notify_whatsapp_e164, notify_warm_replies, notify_quiet_hours_start, notify_quiet_hours_end')
    .eq('id', userId)
    .maybeSingle()

  if (error) return 'error'
  if (!data) return null

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
  const [profileError, setProfileError] = useState(false)

  // Tracks whether THIS tab's hard cap has already fired or settled. Uses
  // useRef so the value survives React 19 StrictMode's mount→cleanup→remount
  // dance without being reset to 'idle'. Once 'fired' or 'settled', a remount
  // does NOT re-arm the timer.
  const hardCapStatusRef = useRef<HardCapStatus>('idle')

  useEffect(() => {
    let mounted = true

    // Subscribe-only pattern. Supabase fires INITIAL_SESSION on the first
    // subscriber with whatever's in storage (or null) once _initialize() has
    // read the persisted token. We do NOT race a manual getSession() against
    // a soft timeout — that produced cross-tab navigator-lock contention
    // (gotrue's "Lock not released within 5000ms" warning) and the UI could
    // settle in inconsistent states under React 19 StrictMode double-mount.
    // The hardCapTimer below is the only safety net.
    let hardCapTimer: ReturnType<typeof setTimeout> | null = null
    if (hardCapStatusRef.current === 'idle') {
      hardCapTimer = setTimeout(() => {
        if (!mounted) return
        if (hardCapStatusRef.current !== 'idle') return
        hardCapStatusRef.current = 'fired'
        console.error(
          '[useAuth] session restore hung past',
          SESSION_RESTORE_HARD_CAP_MS,
          'ms — initiating recovery',
        )
        clearStaleSupabaseAuthStorage()
        setSession(null)
        setUser(null)
        setProfileError(false)
        setLoading(false)

        if (isReauthAttempt()) {
          // Second consecutive hang — the hard reload didn't fix it, so this
          // is a real auth problem (or a system-wide lock we can't break).
          // Bail out to /login so the user can re-authenticate by hand.
          console.error(
            '[useAuth] hard-cap fired again after ?reauth=1 — escalating to /login',
          )
          toast.error('Session could not be restored, please log in')
          redirectToLogin()
          return
        }

        // First hang — try a hard reload to drop any Web Lock held by this
        // browsing context. navigator.locks does not expose an API to release
        // a lock from outside the context that owns it; a context reload is
        // the only standards-compliant way to recover in place.
        toast.message('Refreshing session…')
        if (typeof window !== 'undefined') {
          window.location.replace(buildReauthUrl())
        }
      }, SESSION_RESTORE_HARD_CAP_MS)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!mounted) return
      if (hardCapStatusRef.current === 'fired') return
      hardCapStatusRef.current = 'settled'
      if (hardCapTimer !== null) {
        clearTimeout(hardCapTimer)
        hardCapTimer = null
      }
      setSession(s)
      if (s?.user) {
        try {
          const profile = await fetchUserProfile(s.user.id)
          if (!mounted) return
          if (profile === 'error' || profile === null) {
            // Fetch failed or no profile row — never render the app shell with
            // a null user. RequireAuth shows a recoverable error screen.
            setUser(null)
            setProfileError(true)
          } else {
            setUser(profile)
            setProfileError(false)
          }
        } catch (err) {
          console.error('[useAuth] Failed to load profile on auth change:', err)
          if (mounted) {
            setUser(null)
            setProfileError(true)
          }
        }
      } else {
        setUser(null)
        setProfileError(false)
      }
      if (mounted) {
        setLoading(false)
        // The ?reauth=1 flag survived a successful recovery — strip it so a
        // user-initiated refresh doesn't re-trigger the recovery path.
        if (isReauthAttempt()) stripReauthFlag()
      }
    })

    return () => {
      mounted = false
      if (hardCapTimer !== null) clearTimeout(hardCapTimer)
      subscription.unsubscribe()
    }
  }, [])

  return { session, user, loading, profileError }
}
