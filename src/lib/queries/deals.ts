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
  // Pricing model fields (added 2026-04-25)
  product_id: string | null
  owner_user_id: string | null
  weekly_price_override: number | null
  term_months: number | null
  acv: number | null
  tcv: number | null
  commission_pct: number | null
  commission_amount: number | null
  close_won_at: string | null
  install_scheduled_for: string | null
  install_confirmed_at: string | null
  install_completed_at: string | null
  // Close Won outcome (added 2026-04-26)
  outcome: 'won' | 'lost' | null
  final_value: number | null
  contact?: {
    id: string
    full_name: string
    email: string | null
    signal_reopening?: unknown | null
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
  product?: {
    id: string
    sku: string
    label: string
    brand: string
    weekly_price_aud: number
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
          contact:contacts(id, full_name, email, signal_reopening),
          venue:venues(id, name, venue_type),
          stage:pipeline_stages(id, name, position, is_closed, color),
          product:products(id, sku, label, brand, weekly_price_aud)
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
        outcome: (d.outcome as Deal['outcome']) ?? null,
        lead_score: scoreMap[d.id] ?? null,
        days_in_stage: d.updated_at ? differenceInDays(new Date(), parseISO(d.updated_at)) : 0,
      })) as Deal[]
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
          stage:pipeline_stages(id, name, position, is_closed, color),
          product:products(id, sku, label, brand, weekly_price_aud)
        `)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data ?? []).map((d) => ({
        ...d,
        outcome: (d.outcome as Deal['outcome']) ?? null,
        days_in_stage: d.updated_at ? differenceInDays(new Date(), parseISO(d.updated_at)) : 0,
      })) as Deal[]
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
  // Pricing model
  product_id?: string
  owner_user_id?: string
  weekly_price_override?: number
  term_months?: number
  commission_pct?: number
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
          contract_value: input.contract_value ?? null,
          follow_up_due: input.follow_up_due ?? null,
          notes: input.notes ?? null,
          product_id: input.product_id ?? null,
          owner_user_id: input.owner_user_id ?? null,
          weekly_price_override: input.weekly_price_override ?? null,
          term_months: input.term_months ?? null,
          commission_pct: input.commission_pct ?? null,
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
      const {
        stage: _stage,
        contact: _contact,
        venue: _venue,
        lead_score: _ls,
        days_in_stage: _days,
        product: _product,
        ...dbUpdates
      } = updates
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

export function useUpdateDealStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dealId, stageId }: { dealId: string; stageId: string }) => {
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: stageId, updated_at: new Date().toISOString() })
        .eq("id", dealId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] })
      qc.invalidateQueries({ queryKey: ["briefing"] })
      qc.invalidateQueries({ queryKey: ['monthly-gate'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success("Deal stage updated")
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

/**
 * Mark a deal as Won or Lost. Stamps outcome + final_value + closed_at, and
 * for won deals also seeds close_won_at to the chosen close date so the monthly
 * gate trigger picks the right month.
 */
export function useMarkDealOutcome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      dealId,
      orgId,
      outcome,
      finalValue,
      closeDate,
      lostReason,
      stageId,
    }: {
      dealId: string
      orgId: string
      outcome: 'won' | 'lost'
      finalValue: number | null
      closeDate: string                      // ISO date (yyyy-MM-dd)
      lostReason?: string | null
      stageId?: string                       // optional stage_id to set in same write
    }) => {
      const closeIso = new Date(`${closeDate}T12:00:00`).toISOString()
      const updates = {
        outcome,
        final_value: finalValue,
        closed_at: closeIso,
        updated_at: new Date().toISOString(),
        close_won_at: outcome === 'won' ? closeIso : null,
        ...(outcome === 'lost' ? { lost_reason: lostReason ?? null } : {}),
        ...(stageId ? { stage_id: stageId } : {}),
      }

      const { data, error } = await supabase
        .from('deals')
        .update(updates)
        .eq('id', dealId)
        .select()
        .single()

      if (error) throw error

      // Activity row for the timeline
      await supabase.from('activities').insert({
        org_id: orgId,
        deal_id: dealId,
        activity_type: 'stage_change',
        subject: outcome === 'won' ? 'Marked Won' : 'Marked Lost',
        body:
          outcome === 'won'
            ? `Final value ${finalValue != null ? `$${finalValue.toFixed(2)}` : '—'}`
            : `Lost${lostReason ? ` — ${lostReason}` : ''}`,
      })

      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      qc.invalidateQueries({ queryKey: ['monthly-gate'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err: Error) => {
      toast.error(`Failed to update outcome: ${err.message}`)
    },
  })
}

/**
 * Mark install confirmed: stamps install_confirmed_at + optional scheduled date.
 */
export function useMarkInstallConfirmed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dealId, scheduledFor }: { dealId: string; scheduledFor?: string }) => {
      const { error } = await supabase
        .from('deals')
        .update({
          install_confirmed_at: new Date().toISOString(),
          install_scheduled_for: scheduledFor ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dealId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Install confirmed')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

/**
 * Mark installed: stamps install_completed_at = now() — this is the moment commission is "earned".
 */
export function useMarkInstalled() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dealId: string) => {
      const { error } = await supabase
        .from('deals')
        .update({
          install_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', dealId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Marked as installed — commission earned')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
