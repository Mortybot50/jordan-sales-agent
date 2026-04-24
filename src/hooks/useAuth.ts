import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

export interface AppUser {
  id: string
  email: string
  org_id: string
  full_name: string | null
  role: string
  calendly_url: string | null
  email_signature: string | null
  voice_rules: string | null
  icp_config: Record<string, unknown>
  email_notifications: { morning_briefing: boolean; briefing_time_hour: number }
}

interface AuthState {
  session: Session | null
  user: AppUser | null
  loading: boolean
}

async function fetchUserProfile(userId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, org_id, full_name, email, role, calendly_url, email_signature, voice_rules, icp_config, email_notifications')
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
    calendly_url: d.calendly_url as string | null,
    email_signature: d.email_signature as string | null,
    voice_rules: d.voice_rules as string | null,
    icp_config: ((d.icp_config ?? {}) as Record<string, unknown>),
    email_notifications: ((d.email_notifications ?? { morning_briefing: true, briefing_time_hour: 7 }) as { morning_briefing: boolean; briefing_time_hour: number }),
  }
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!mounted) return
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
    }).catch((err) => {
      console.error('[useAuth] getSession failed:', err)
      if (mounted) setLoading(false)
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
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return { session, user, loading }
}
