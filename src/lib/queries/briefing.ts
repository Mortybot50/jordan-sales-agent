import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { subHours, subDays, startOfDay, endOfDay } from 'date-fns'

export interface BriefingReply {
  id: string
  contact_id: string | null
  contact_name: string
  venue_name: string | null
  subject: string | null
  body: string | null
  occurred_at: string
}

export function useOvernightReplies() {
  return useQuery({
    queryKey: ['briefing', 'overnight-replies'],
    queryFn: async (): Promise<BriefingReply[]> => {
      const since = subHours(new Date(), 18).toISOString()

      const { data, error } = await supabase
        .from('activities')
        .select(`
          id, contact_id, subject, body, occurred_at,
          contact:contacts(id, full_name, venue:venues(name))
        `)
        .in('activity_type', ['reply_received', 'email_inbound'])
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })

      if (error) throw error

      return (data ?? []).map((a) => {
        const c = a.contact as { full_name: string; venue: { name: string } | null } | null
        return {
          id: a.id,
          contact_id: a.contact_id,
          contact_name: c?.full_name ?? 'Unknown',
          venue_name: c?.venue?.name ?? null,
          subject: a.subject,
          body: a.body,
          occurred_at: a.occurred_at ?? new Date().toISOString(),
        }
      })
    },
  })
}

export interface BriefingTask {
  id: string
  title: string
  contact_name: string | null
  venue_name: string | null
  deal_title: string | null
  due_at: string | null
}

export function useTodayBriefingTasks() {
  return useQuery({
    queryKey: ['briefing', 'tasks-today'],
    queryFn: async (): Promise<BriefingTask[]> => {
      const today = new Date()
      const { data, error } = await supabase
        .from('tasks')
        .select(`
          id, title, due_at,
          contact:contacts(full_name, venue:venues(name)),
          deal:deals(title)
        `)
        .gte('due_at', startOfDay(today).toISOString())
        .lte('due_at', endOfDay(today).toISOString())
        .is('completed_at', null)
        .order('due_at')

      if (error) throw error

      return (data ?? []).map((t) => {
        const c = t.contact as { full_name: string; venue: { name: string } | null } | null
        const d = t.deal as { title: string } | null
        return {
          id: t.id,
          title: t.title,
          contact_name: c?.full_name ?? null,
          venue_name: c?.venue?.name ?? null,
          deal_title: d?.title ?? null,
          due_at: t.due_at,
        }
      })
    },
  })
}

export interface BriefingCandidate {
  id: string
  name: string | null
  address: string | null
  suburb: string | null
  venue_type_guess: string | null
  icp_score_guess: number | null
  created_at: string | null
}

export function useNewCandidates() {
  return useQuery({
    queryKey: ['briefing', 'candidates'],
    queryFn: async (): Promise<BriefingCandidate[]> => {
      const since = subDays(new Date(), 1).toISOString()
      const { data, error } = await supabase
        .from('auto_sourced_candidates')
        .select('id, name, address, suburb, venue_type_guess, icp_score_guess, created_at')
        .eq('status', 'pending')
        .gte('created_at', since)
        .order('icp_score_guess', { ascending: false })
        .limit(10)

      if (error) throw error
      return data ?? []
    },
  })
}

export interface ReengagementContact {
  id: string
  full_name: string
  venue_name: string | null
  last_activity_at: string | null
  days_silent: number
}

export function useReengagementOpportunities() {
  return useQuery({
    queryKey: ['briefing', 'reengagement'],
    queryFn: async (): Promise<ReengagementContact[]> => {
      const cutoff = subDays(new Date(), 42).toISOString()
      const signalCutoff = subDays(new Date(), 14).toISOString()

      // Contacts with signals in last 14 days
      const { data: signalContacts } = await supabase
        .from('signals')
        .select('contact_id, venue_id, detected_at')
        .gte('detected_at', signalCutoff)
        .eq('is_actioned', false)

      const contactIds = [...new Set((signalContacts ?? [])
        .filter((s) => s.contact_id)
        .map((s) => s.contact_id as string))]

      if (contactIds.length === 0) return []

      // Filter to contacts with no activities in 42+ days
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, full_name, venue:venues(name)')
        .in('id', contactIds)

      if (!contacts || contacts.length === 0) return []

      const { data: recentActivities } = await supabase
        .from('activities')
        .select('contact_id, occurred_at')
        .in('contact_id', contactIds)
        .gte('occurred_at', cutoff)

      const recentContactIds = new Set((recentActivities ?? []).map((a) => a.contact_id))

      const { data: lastActivities } = await supabase
        .from('activities')
        .select('contact_id, occurred_at')
        .in('contact_id', contactIds)
        .order('occurred_at', { ascending: false })

      const lastActivityMap: Record<string, string> = {}
      for (const a of lastActivities ?? []) {
        if (a.contact_id && !lastActivityMap[a.contact_id]) {
          if (a.occurred_at) lastActivityMap[a.contact_id] = a.occurred_at
        }
      }

      const now = new Date()
      return contacts
        .filter((c) => !recentContactIds.has(c.id))
        .map((c) => {
          const lastAt = lastActivityMap[c.id]
          const days = lastAt
            ? Math.floor((now.getTime() - new Date(lastAt).getTime()) / (1000 * 60 * 60 * 24))
            : 999
          return {
            id: c.id,
            full_name: c.full_name,
            venue_name: (c.venue as { name: string } | null)?.name ?? null,
            last_activity_at: lastAt ?? null,
            days_silent: days,
          }
        })
        .sort((a, b) => b.days_silent - a.days_silent)
        .slice(0, 10)
    },
  })
}
