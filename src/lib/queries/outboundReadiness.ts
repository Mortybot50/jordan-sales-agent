import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

// Untyped client for the two tables not yet in the generated Database type
// (email_signature_templates landed 26/05, email_accounts 19/05). Mirrors the
// pattern queries/signatures.ts and queries/notifications.ts already use.
const sb = supabase as unknown as SupabaseClient

export interface OutboundReadiness {
  profileNameSet: boolean
  hasSignature: boolean
  hasInbox: boolean
  isReady: boolean
  /** Human-readable gaps in setup order, for the checklist banner copy. */
  gaps: { label: string; cta: string; to: string }[]
}

/**
 * Outbound-send readiness — single source of truth for both the dashboard
 * setup-checklist banner and the Draft Review pre-flight guard. Returns
 * which of the three prerequisites for sending email are met:
 *
 *   1. Profile name set (users.full_name)
 *   2. At least one signature template exists for this user
 *   3. At least one email_accounts row with status='active'
 *
 * isReady = all three. gaps lists what's still missing in the order Jordan
 * should fix them.
 */
export function useOutboundReadiness() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['outbound-readiness', user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<OutboundReadiness> => {
      const userId = user!.id
      const profileNameSet = !!(user!.full_name && user!.full_name.trim().length > 0)

      const [{ count: sigCount }, { count: inboxCount }] = await Promise.all([
        sb
          .from('email_signature_templates')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
        sb
          .from('email_accounts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'active'),
      ])

      const hasSignature = (sigCount ?? 0) > 0
      const hasInbox = (inboxCount ?? 0) > 0
      const isReady = profileNameSet && hasSignature && hasInbox

      const gaps: OutboundReadiness['gaps'] = []
      if (!profileNameSet) {
        gaps.push({
          label: 'Set your full name',
          cta: 'Open profile',
          to: '/settings',
        })
      }
      if (!hasSignature) {
        gaps.push({
          label: 'Add at least one brand signature',
          cta: 'Set signatures',
          to: '/settings',
        })
      }
      if (!hasInbox) {
        gaps.push({
          label: 'Connect a sending inbox',
          cta: 'Connect inbox',
          to: '/settings/email-accounts',
        })
      }

      return { profileNameSet, hasSignature, hasInbox, isReady, gaps }
    },
  })
}
