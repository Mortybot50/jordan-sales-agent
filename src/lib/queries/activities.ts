import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Json } from '@/types/database'

export type ActivityType =
  | 'email_sent' | 'email_opened' | 'email_clicked' | 'reply_received'
  | 'call_note' | 'meeting_note' | 'task_completed' | 'stage_change'
  | 'bounce' | 'unsubscribe' | 'email_inbound' | 'email_outbound'
  | 'deal_created' | 'note' | 'meeting_booked'

export interface Activity {
  id: string
  org_id: string
  deal_id: string | null
  contact_id: string | null
  activity_type: ActivityType
  subject: string | null
  body: string | null
  metadata: Json | null
  occurred_at: string | null
  created_at: string | null
  contact?: {
    id: string
    full_name: string
  } | null
  deal?: {
    id: string
    title: string | null
  } | null
}

export function useContactActivities(contactId: string) {
  return useQuery({
    queryKey: ['activities', 'contact', contactId],
    queryFn: async (): Promise<Activity[]> => {
      // Get activities directly linked to contact
      const { data: directActivities, error: e1 } = await supabase
        .from('activities')
        .select(`*, deal:deals(id, title)`)
        .eq('contact_id', contactId)
        .order('occurred_at', { ascending: false })

      if (e1) throw e1

      return (directActivities ?? []).map((a) => ({
        ...a,
        activity_type: a.activity_type as ActivityType,
      }))
    },
    enabled: !!contactId,
  })
}

export function useRecentActivities(limit = 10) {
  return useQuery({
    queryKey: ['activities', 'recent', limit],
    queryFn: async (): Promise<Activity[]> => {
      const { data, error } = await supabase
        .from('activities')
        .select(`
          *,
          contact:contacts(id, full_name),
          deal:deals(id, title)
        `)
        .order('occurred_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return (data ?? []).map((a) => ({
        ...a,
        activity_type: a.activity_type as ActivityType,
      }))
    },
  })
}

export function useCreateActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      org_id: string
      deal_id?: string
      contact_id?: string
      activity_type: ActivityType
      subject: string
      body?: string
      occurred_at?: string
    }) => {
      const { data, error } = await supabase
        .from('activities')
        .insert({
          org_id: input.org_id,
          deal_id: input.deal_id ?? null,
          contact_id: input.contact_id ?? null,
          activity_type: input.activity_type,
          subject: input.subject,
          body: input.body ?? null,
          occurred_at: input.occurred_at ?? new Date().toISOString(),
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      if (vars.contact_id) {
        qc.invalidateQueries({ queryKey: ['activities', 'contact', vars.contact_id] })
      }
      toast.success('Activity logged')
    },
    onError: (err: Error) => {
      toast.error(`Failed to log activity: ${err.message}`)
    },
  })
}
