import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { differenceInDays, parseISO } from 'date-fns'

export interface Deal {
  id: string
  org_id: string
  venue_id: string | null
  contact_id: string | null
  stage_id: string | null
  title: string | null
  contract_value: number | null
  contract_months: number | null
  follow_up_due: string | null
  last_touch_at: string | null
  closed_at: string | null
  lost_reason: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
  contact?: {
    id: string
    full_name: string
    email: string | null
  } | null
  venue?: {
    id: string
    name: string
    venue_type: string | null
  } | null
  stage?: {
    id: string
    name: string
    position: number
    is_closed: boolean | null
    color: string | null
  } | null
  lead_score?: {
    score: number
    tier: 'hot' | 'warm' | 'cold'
  } | null
  days_in_stage?: number
}

export function useDeals() {
  return useQuery({
    queryKey: ['deals'],
    queryFn: async (): Promise<Deal[]> => {
      const { data, error } = await supabase
        .from('deals')
        .select(`
          *,
          contact:contacts(id, full_name, email),
          venue:venues(id, name, venue_type),
          stage:pipeline_stages(id, name, position, is_closed, color)
        `)
        .order('updated_at', { ascending: false })

      if (error) throw error

      const deals = data ?? []
      const dealIds = deals.map((d) => d.id)

      let scoreMap: Record<string, { score: number; tier: 'hot' | 'warm' | 'cold' }> = {}
      if (dealIds.length > 0) {
        const { data: scores } = await supabase
          .from('lead_scores')
          .select('deal_id, score, tier, scored_at')
          .in('deal_id', dealIds)
          .order('scored_at', { ascending: false })

        if (scores) {
          for (const s of scores) {
            if (s.deal_id && !scoreMap[s.deal_id]) {
              scoreMap[s.deal_id] = { score: s.score, tier: s.tier as 'hot' | 'warm' | 'cold' }
            }
          }
        }
      }

      return deals.map((d) => ({
        ...d,
        lead_score: scoreMap[d.id] ?? null,
        days_in_stage: d.updated_at ? differenceInDays(new Date(), parseISO(d.updated_at)) : 0,
      }))
    },
  })
}

export function useContactDeals(contactId: string) {
  return useQuery({
    queryKey: ['deals', 'contact', contactId],
    queryFn: async (): Promise<Deal[]> => {
      const { data, error } = await supabase
        .from('deals')
        .select(`
          *,
          stage:pipeline_stages(id, name, position, is_closed, color)
        `)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data ?? []).map((d) => ({
        ...d,
        days_in_stage: d.updated_at ? differenceInDays(new Date(), parseISO(d.updated_at)) : 0,
      }))
    },
    enabled: !!contactId,
  })
}

export interface CreateDealInput {
  org_id: string
  title: string
  contact_id?: string
  venue_id?: string
  stage_id: string
  contract_value?: number
  follow_up_due?: string
  notes?: string
}

export function useCreateDeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateDealInput) => {
      const { data, error } = await supabase
        .from('deals')
        .insert({
          org_id: input.org_id,
          title: input.title,
          contact_id: input.contact_id ?? null,
          venue_id: input.venue_id ?? null,
          stage_id: input.stage_id,
          contract_value: input.contract_value ?? 800,
          follow_up_due: input.follow_up_due ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single()

      if (error) throw error

      // Log deal_created activity
      if (data) {
        await supabase.from('activities').insert({
          org_id: input.org_id,
          deal_id: data.id,
          contact_id: input.contact_id ?? null,
          activity_type: 'deal_created',
          subject: `Deal created: ${input.title}`,
        })
      }

      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      toast.success('Deal created')
    },
    onError: (err: Error) => {
      toast.error(`Failed to create deal: ${err.message}`)
    },
  })
}

export function useUpdateDeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, org_id, from_stage, to_stage, ...updates }: {
      id: string
      org_id: string
      from_stage?: string
      to_stage?: string
    } & Partial<Deal>) => {
      const { stage: _stage, contact: _contact, venue: _venue, lead_score: _ls, days_in_stage: _days, ...dbUpdates } = updates
      const { data, error } = await supabase
        .from('deals')
        .update({ ...dbUpdates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      // Log stage change
      if (from_stage && to_stage && from_stage !== to_stage) {
        await supabase.from('activities').insert({
          org_id,
          deal_id: id,
          activity_type: 'stage_change',
          subject: `Stage changed`,
          body: `Moved from ${from_stage} to ${to_stage}`,
        })
      }

      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      if (vars.contact_id) {
        qc.invalidateQueries({ queryKey: ['deals', 'contact', vars.contact_id] })
      }
    },
    onError: (err: Error) => {
      toast.error(`Failed to update deal: ${err.message}`)
    },
  })
}

export function useDeleteDeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('deals').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      toast.success('Deal deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
