import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { differenceInDays, parseISO } from 'date-fns'
import type { ScoreBreakdownRule, ThreadExcerpt } from '@/lib/leadScoring'

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
  // Snooze (added 2026-04-26)
  snoozed_until: string | null
  // Next step (added 2026-04-26 — Quick Wins Batch 2)
  next_step_note: string | null
  next_step_due_at: string | null
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
  /**
   * Explainable rule-based win probability (0-100). Distinct from
   * `lead_score` above (joined from the lead_scores history table for
   * hot/warm/cold tiering). NULL when uncomputed — drawer shows
   * "Score pending" placeholder. See migration
   * 20260610102316_deal_drawer_rebuild.sql.
   */
  win_probability?: number | null
  /**
   * JSONB array of { rule, weight, applied, detail? } records describing
   * which scoring rules fired. Drives the tap-to-expand breakdown popover.
   * Matches the structure emitted by
   * scripts/backfill-deal-thread-excerpt.py.
   */
  win_probability_breakdown?: ScoreBreakdownRule[] | null
  /**
   * Last-message thread context lifted from the PST import — drives the
   * ConversationRecap panel at the top of DealDrawer. NULL when no thread
   * context exists (e.g. manually created deal).
   */
  thread_excerpt?: ThreadExcerpt | null
  days_in_stage?: number
  /**
   * True when the deal is currently snoozed (snoozed_until is in the future).
   * View-only — derived from snoozed_until at fetch time.
   */
  is_snoozed?: boolean
  /**
   * True when the deal woke from snooze in the last 7 days. Drives the amber
   * "RETURNED FROM SNOOZE" pill on DealCard. Pure view logic, no DB write.
   */
  recently_returned?: boolean
  /**
   * Days since the deal had any meaningful touch — max of `updated_at` and the
   * latest activity `occurred_at` for this deal. Pure view-derived; not a DB
   * column. Drives the aging pill on DealCard ("14d quiet", "30d+ quiet").
   */
  days_since_last_activity?: number
  /**
   * The actual ISO timestamp used for the aging calculation, exposed so the
   * tooltip can show "Last touched: <date>".
   */
  last_activity_at?: string | null
}

export interface UseDealsOptions {
  /**
   * When true, returns ALL deals including currently-snoozed ones. Default
   * false — snoozed deals are hidden from active views (Pipeline, Briefing).
   * Snoozed deals always reappear automatically once snoozed_until <= now().
   */
  includeSnoozed?: boolean
}

export function useDeals(options: UseDealsOptions = {}) {
  const { includeSnoozed = false } = options
  return useQuery({
    queryKey: ['deals', { includeSnoozed }],
    queryFn: async (): Promise<Deal[]> => {
      let query = supabase
        .from('deals')
        .select(`
          *,
          contact:contacts(id, full_name, email, signal_reopening),
          venue:venues(id, name, venue_type),
          stage:pipeline_stages(id, name, position, is_closed, color),
          product:products(id, sku, label, brand, weekly_price_aud)
        `)
        .order('updated_at', { ascending: false })

      // Snooze filter — hide deals currently snoozed (snoozed_until in future).
      // Past-dated snoozes auto-wake (deal reappears).
      if (!includeSnoozed) {
        const nowIso = new Date().toISOString()
        query = query.or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      }

      const { data, error } = await query

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

      // Pull the latest activity timestamp per deal so we can derive
      // days_since_last_activity client-side. We only care about the most
      // recent occurred_at — Supabase doesn't do GROUP BY directly so we
      // fold the rows ourselves. Cheap because activities are paged and we
      // only request (deal_id, occurred_at) columns.
      const lastActivityMap: Record<string, string> = {}
      if (dealIds.length > 0) {
        const { data: acts } = await supabase
          .from('activities')
          .select('deal_id, occurred_at')
          .in('deal_id', dealIds)
          .not('occurred_at', 'is', null)
          .order('occurred_at', { ascending: false })

        if (acts) {
          for (const a of acts) {
            if (a.deal_id && !lastActivityMap[a.deal_id] && a.occurred_at) {
              lastActivityMap[a.deal_id] = a.occurred_at
            }
          }
        }
      }

      const nowMs = Date.now()
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

      return deals.map((d) => {
        const snoozedAtMs = d.snoozed_until ? new Date(d.snoozed_until).getTime() : null
        const isSnoozed = snoozedAtMs != null && snoozedAtMs > nowMs
        const recentlyReturned =
          snoozedAtMs != null &&
          snoozedAtMs <= nowMs &&
          snoozedAtMs > nowMs - SEVEN_DAYS_MS

        // Aging — use latest of updated_at vs last activity occurred_at.
        const updatedAtMs = d.updated_at ? new Date(d.updated_at).getTime() : null
        const lastActMs = lastActivityMap[d.id]
          ? new Date(lastActivityMap[d.id]).getTime()
          : null
        const lastTouchMs =
          updatedAtMs != null && lastActMs != null
            ? Math.max(updatedAtMs, lastActMs)
            : (updatedAtMs ?? lastActMs)
        const daysSinceLastActivity =
          lastTouchMs != null
            ? Math.floor((nowMs - lastTouchMs) / (1000 * 60 * 60 * 24))
            : 0
        const lastActivityAt =
          lastTouchMs != null ? new Date(lastTouchMs).toISOString() : null

        return {
          ...d,
          outcome: (d.outcome as Deal['outcome']) ?? null,
          lead_score: scoreMap[d.id] ?? null,
          days_in_stage: d.updated_at ? differenceInDays(new Date(), parseISO(d.updated_at)) : 0,
          is_snoozed: isSnoozed,
          recently_returned: recentlyReturned,
          days_since_last_activity: daysSinceLastActivity,
          last_activity_at: lastActivityAt,
        }
      }) as Deal[]
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
        is_snoozed: _isSnoozed,
        recently_returned: _recentlyReturned,
        days_since_last_activity: _dsla,
        last_activity_at: _laa,
        // Drawer-rebuild fields — computed by the backfill script. Strip
        // from PATCH payloads so the form's handleSave can't overwrite
        // them, and so the typed Supabase client doesn't choke on the
        // richer TS types (ThreadExcerpt vs the generated Json shape).
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        win_probability: _wp,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        win_probability_breakdown: _wpb,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        thread_excerpt: _te,
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

/**
 * Count of deals currently snoozed (snoozed_until in future). Used to power
 * the "Show snoozed (N)" toggle on the Pipeline page.
 */
export function useSnoozedDealsCount() {
  return useQuery({
    queryKey: ['deals', 'snoozed-count'],
    queryFn: async (): Promise<number> => {
      const nowIso = new Date().toISOString()
      const { count, error } = await supabase
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .gt('snoozed_until', nowIso)
      if (error) throw error
      return count ?? 0
    },
    staleTime: 60_000,
  })
}

/**
 * Snooze (or unsnooze) a deal. Pass `until = null` to unsnooze immediately.
 * Snoozed deals are hidden from the active Pipeline + Morning Briefing until
 * `snoozed_until` is reached, after which they auto-wake with a 7-day amber
 * "RETURNED FROM SNOOZE" pill on DealCard (purely view-derived).
 */
export function useSnoozeDeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dealId, until }: { dealId: string; until: Date | null }) => {
      const { error } = await supabase
        .from('deals')
        .update({
          snoozed_until: until ? until.toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dealId)
      if (error) throw error
      return { dealId, until }
    },
    onSuccess: ({ until }) => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['briefing'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      if (until) {
        const label = until.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
        toast.success(`Snoozed until ${label}`)
      } else {
        toast.success('Unsnoozed')
      }
    },
    onError: (err: Error) => toast.error(`Failed to update snooze: ${err.message}`),
  })
}

/**
 * Set or clear the next-step note + optional reminder date on a deal.
 * Pass `note = null` and `dueAt = null` to clear both. Either can be set
 * independently — a note without a date is valid (and vice versa).
 */
export function useUpdateDealNextStep(dealId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ note, dueAt }: { note: string | null; dueAt: string | null }) => {
      const { error } = await supabase
        .from('deals')
        .update({
          next_step_note: note,
          next_step_due_at: dueAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dealId)
      if (error) throw error
      return { note, dueAt }
    },
    onSuccess: ({ note, dueAt }) => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      if (!note && !dueAt) {
        toast.success('Next step cleared')
      } else {
        toast.success('Next step saved')
      }
    },
    onError: (err: Error) => toast.error(`Failed to save next step: ${err.message}`),
  })
}
