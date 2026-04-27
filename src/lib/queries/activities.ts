import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { startOfWeek, endOfWeek } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Json } from '@/types/database'

export type ActivityType =
  | 'email_sent' | 'email_opened' | 'email_clicked' | 'reply_received'
  | 'call_note' | 'meeting_note' | 'task_completed' | 'stage_change'
  | 'bounce' | 'unsubscribe' | 'email_inbound' | 'email_outbound'
  | 'deal_created' | 'note' | 'meeting_booked' | 'email_manual' | 'import'

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

/**
 * Deep-link target for the Dashboard "Qualified meetings · this week"
 * KPI. Returns the set of deal-ids (and a fallback contact-id set) that
 * have a meeting_note / meeting_booked activity in the current Mon-Sun
 * week. Used by PipelinePage to filter the kanban when the
 * `?filter=meetings&period=this_week` param is present.
 */
export function useMeetingsThisWeekDealIds(enabled = true) {
  return useQuery({
    queryKey: ['activities', 'meetings-this-week'],
    queryFn: async (): Promise<{
      dealIds: Set<string>
      contactIds: Set<string>
    }> => {
      const now = new Date()
      const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString()
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString()
      const { data, error } = await supabase
        .from('activities')
        .select('deal_id, contact_id')
        .in('activity_type', ['meeting_note', 'meeting_booked'])
        .gte('occurred_at', weekStart)
        .lte('occurred_at', weekEnd)
      if (error) throw error
      const dealIds = new Set<string>()
      const contactIds = new Set<string>()
      for (const a of data ?? []) {
        if (a.deal_id) dealIds.add(a.deal_id)
        if (a.contact_id) contactIds.add(a.contact_id)
      }
      return { dealIds, contactIds }
    },
    enabled,
    staleTime: 60_000,
  })
}

/** Map of contact_id -> intent string for the most recent classified inbound activity. */
export function useInboundActivityIntents(contactIds: string[]) {
  return useQuery({
    queryKey: ['activities', 'inbound-intents', contactIds.slice().sort().join(',')],
    queryFn: async (): Promise<Record<string, string>> => {
      if (contactIds.length === 0) return {}

      const { data, error } = await supabase
        .from('activities')
        .select('contact_id, metadata, occurred_at')
        .in('contact_id', contactIds)
        .in('activity_type', ['reply_received', 'email_inbound'])
        .not('metadata->intent', 'is', null)
        .order('occurred_at', { ascending: false })

      if (error) throw error

      // Build map: one entry per contact_id (most recent classified reply)
      const map: Record<string, string> = {}
      for (const row of data ?? []) {
        if (!row.contact_id) continue
        if (map[row.contact_id]) continue
        const intent = (row.metadata as Record<string, unknown> | null)?.intent
        if (typeof intent === 'string') {
          map[row.contact_id] = intent
        }
      }
      return map
    },
    enabled: contactIds.length > 0,
    staleTime: 60_000,
  })
}


export function useArchiveActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('activities')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['briefing'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
    },
    onError: (err: Error) => {
      toast.error(`Failed to archive: ${err.message}`)
    },
  })
}
