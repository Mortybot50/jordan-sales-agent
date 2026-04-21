import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns'

export interface DashboardKPIs {
  replyRate: number | null
  meetingRate: number | null
  pipelineValue: number
  followupsDueToday: number
  closesThisMonth: number
}

export function useDashboardKPIs() {
  return useQuery({
    queryKey: ['dashboard', 'kpis'],
    queryFn: async (): Promise<DashboardKPIs> => {
      const now = new Date()
      const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString()
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString()
      const monthStart = startOfMonth(now).toISOString()
      const monthEnd = endOfMonth(now).toISOString()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()

      const [
        { count: emailsSentThisWeek },
        { count: repliesThisWeek },
        { count: emailsSentThisMonth },
        { count: meetingsThisMonth },
        { data: openDeals },
        { count: followupsDue },
        { data: closedWonStages },
      ] = await Promise.all([
        supabase.from('activities').select('id', { count: 'exact', head: true })
          .eq('activity_type', 'email_sent')
          .gte('occurred_at', weekStart).lte('occurred_at', weekEnd),
        supabase.from('activities').select('id', { count: 'exact', head: true })
          .in('activity_type', ['reply_received', 'email_inbound'])
          .gte('occurred_at', weekStart).lte('occurred_at', weekEnd),
        supabase.from('activities').select('id', { count: 'exact', head: true })
          .eq('activity_type', 'email_sent')
          .gte('occurred_at', monthStart).lte('occurred_at', monthEnd),
        supabase.from('activities').select('id', { count: 'exact', head: true })
          .in('activity_type', ['meeting_note', 'meeting_booked'])
          .gte('occurred_at', monthStart).lte('occurred_at', monthEnd),
        supabase.from('deals').select('contract_value, stage:pipeline_stages(is_closed)')
          .is('closed_at', null),
        supabase.from('tasks').select('id', { count: 'exact', head: true })
          .gte('due_at', todayStart).lte('due_at', todayEnd)
          .is('completed_at', null),
        supabase.from('pipeline_stages').select('id')
          .eq('is_closed', true).ilike('name', '%won%'),
      ])

      const closedWonIds = (closedWonStages ?? []).map((s) => s.id)

      const { count: closesThisMonth } = closedWonIds.length > 0
        ? await supabase.from('deals').select('id', { count: 'exact', head: true })
            .in('stage_id', closedWonIds)
            .gte('updated_at', monthStart).lte('updated_at', monthEnd)
        : { count: 0 }

      // Pipeline value = sum of open (non-closed) deals
      const pipelineValue = (openDeals ?? []).reduce((sum, d) => {
        const stage = d.stage as { is_closed: boolean } | null
        if (!stage || !stage.is_closed) return sum + (Number(d.contract_value) || 0)
        return sum
      }, 0)

      const emailsSent = emailsSentThisWeek ?? 0
      const replies = repliesThisWeek ?? 0
      const emailsSentMonth = emailsSentThisMonth ?? 0
      const meetings = meetingsThisMonth ?? 0

      return {
        replyRate: emailsSent > 0 ? Math.round((replies / emailsSent) * 100) : null,
        meetingRate: emailsSentMonth > 0 ? Math.round((meetings / emailsSentMonth) * 100) : null,
        pipelineValue,
        followupsDueToday: followupsDue ?? 0,
        closesThisMonth: closesThisMonth ?? 0,
      }
    },
    staleTime: 60_000,
  })
}

export interface WarmLead {
  id: string
  full_name: string
  venue_name: string | null
  score: number
  last_touch_at: string | null
}

export function useWarmLeads() {
  return useQuery({
    queryKey: ['dashboard', 'warm-leads'],
    queryFn: async (): Promise<WarmLead[]> => {
      const sevenDaysAgo = subDays(new Date(), 7).toISOString()

      const { data: deals, error } = await supabase
        .from('deals')
        .select(`
          id, contact_id, last_touch_at,
          contact:contacts(id, full_name),
          venue:venues(name)
        `)
        .or(`last_touch_at.lt.${sevenDaysAgo},last_touch_at.is.null`)
        .is('closed_at', null)
        .limit(20)

      if (error) throw error

      const dealIds = (deals ?? []).map((d) => d.id)
      if (dealIds.length === 0) return []

      const { data: scores } = await supabase
        .from('lead_scores')
        .select('deal_id, score, tier, scored_at')
        .in('deal_id', dealIds)
        .gte('score', 50)
        .lte('score', 79)
        .order('scored_at', { ascending: false })

      const scoreMap: Record<string, number> = {}
      for (const s of scores ?? []) {
        if (s.deal_id && !scoreMap[s.deal_id]) {
          scoreMap[s.deal_id] = s.score
        }
      }

      return (deals ?? [])
        .filter((d) => d.id in scoreMap)
        .map((d) => ({
          id: d.contact_id ?? d.id,
          full_name: (d.contact as { full_name: string } | null)?.full_name ?? 'Unknown',
          venue_name: (d.venue as { name: string } | null)?.name ?? null,
          score: scoreMap[d.id],
          last_touch_at: d.last_touch_at,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
    },
  })
}

export interface PipelineStageCount {
  stage_name: string
  count: number
  value: number
  color: string | null
}

export function usePipelineHealth() {
  return useQuery({
    queryKey: ['dashboard', 'pipeline-health'],
    queryFn: async (): Promise<PipelineStageCount[]> => {
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name, color, position')
        .order('position')

      const { data: deals } = await supabase
        .from('deals')
        .select('stage_id, contract_value')
        .is('closed_at', null)

      if (!stages) return []

      return stages.map((s) => {
        const stageDeals = (deals ?? []).filter((d) => d.stage_id === s.id)
        return {
          stage_name: s.name,
          count: stageDeals.length,
          value: stageDeals.reduce((sum, d) => sum + (Number(d.contract_value) || 0), 0),
          color: s.color,
        }
      })
    },
  })
}
