import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

// Generated Database types don't yet know about the new users columns or
// notification_log — added in migration 20260526092804. Cast to an untyped
// client until the next `supabase gen types typescript` regen. Same pattern as
// queries/claude-chat.ts uses pre-regen.
const sb = supabase as unknown as SupabaseClient

export interface NotificationPrefs {
  notify_whatsapp_e164: string | null
  notify_warm_replies: boolean
  notify_quiet_hours_start: number | null
  notify_quiet_hours_end: number | null
}

export function useNotificationPrefs(userId: string | undefined) {
  return useQuery({
    queryKey: ['notification-prefs', userId ?? null],
    queryFn: async (): Promise<NotificationPrefs | null> => {
      if (!userId) return null
      const { data, error } = await sb
        .from('users')
        .select('notify_whatsapp_e164, notify_warm_replies, notify_quiet_hours_start, notify_quiet_hours_end')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return (data as NotificationPrefs | null) ?? null
    },
    enabled: !!userId,
  })
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<NotificationPrefs>) => {
      const { data, error } = await sb
        .from('users')
        .update(patch)
        .eq('id', id)
        .select('notify_whatsapp_e164, notify_warm_replies, notify_quiet_hours_start, notify_quiet_hours_end')
        .single()
      if (error) throw error
      return data as NotificationPrefs
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-prefs'] })
      qc.invalidateQueries({ queryKey: ['user'] })
      toast.success('Notification preferences saved')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export interface TestPingResult {
  id: string
  status: 'queued' | 'skipped' | 'sent' | 'failed'
  reason: string | null
  quiet_hour: boolean
}

export function useSendTestPing() {
  return useMutation({
    mutationFn: async (userId: string): Promise<TestPingResult> => {
      const { data, error } = await supabase.functions.invoke('notify-warm-reply', {
        body: { test: true, user_id: userId },
      })
      if (error) throw error
      return data as TestPingResult
    },
    onSuccess: (res) => {
      if (res.status === 'queued') {
        toast.success('Test ping queued — WhatsApp delivery within ~60s')
      } else if (res.status === 'skipped' && res.reason === 'quiet_hours') {
        toast.message('Test ping skipped: quiet hours', {
          description: 'Your current AEST hour is inside the quiet-hours window.',
        })
      } else {
        toast.message(`Test ping: ${res.status}`, {
          description: res.reason ?? undefined,
        })
      }
    },
    onError: (err: Error) => toast.error(`Test ping failed: ${err.message}`),
  })
}
