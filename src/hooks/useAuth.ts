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
  icp_config: Record<string, unknown>
}

interface AuthState {
  session: Session | null
  user: AppUser | null
  loading: boolean
}

async function fetchUserProfile(userId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, org_id, full_name, email, role, calendly_url, email_signature, icp_config')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id,
    email: data.email ?? '',
    org_id: data.org_id,
    full_name: data.full_name,
    role: data.role ?? 'member',
    calendly_url: data.calendly_url,
    email_signature: data.email_signature,
    icp_config: (data.icp_config ?? {}) as Record<string, unknown>,
  }
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s)
      if (s?.user) {
        const profile = await fetchUserProfile(s.user.id)
        setUser(profile)
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s)
      if (s?.user) {
        const profile = await fetchUserProfile(s.user.id)
        setUser(profile)
      } else {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return { session, user, loading }
}
