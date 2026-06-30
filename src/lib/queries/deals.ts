import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { differenceInDays, parseISO } from 'date-fns'
import { cleanDealTitle } from '@/lib/dealTitle'

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
  // Temperature (added 2026-06-12 — Jordan's at-a-glance board)
  temperature: 'hot' | 'warm' | 'cold' | null
  temperature_source: 'auto' | 'manual'
  // Canonical lead score 0–100, banded within temperature (added 2026-06-30 —
  // tier/score sync). Null until the deal has been scored.
  score: number | null
  // Proposal + held tracking (added 2026-06-30 — temperature-axis restructure)
  proposal_sent_at: string | null
  is_held: boolean
  held_until: string | null
  /** PST mailbox import: {subject, last_body} of the original thread. */
  thread_excerpt: { subject?: string | null; last_body?: string | null } | null
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
    score: number | null
    tier: 'hot' | 'warm' | 'cold'
  } | null
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
  /**
   * Last actual CONTACT with the lead (email/call/meeting either direction) —
   * max of last_touch_at and the latest contact-type activity. Distinct from
   * last_activity_at, which counts any touch incl. stage shuffles.
   */
  last_contact_at?: string | null
  /** Latest activity of any type — "last action" line on the card. */
  last_action?: { type: string; at: string } | null
  /** An inbound reply exists (live activity or PST import verdict). */
  has_replied?: boolean
  /** Active/most-recent sequence enrollment for the card chip. */
  enrollment?: {
    sequence_name: string
    current_step: number
    total_steps: number
    status: string
  } | null
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

      // Pull activity rows per deal and fold client-side (Supabase has no
      // GROUP BY): latest occurred_at (aging), latest of any type ("last
      // action" line), latest CONTACT-type activity (last-contact column) and
      // whether an inbound reply exists (Replied badge).
      const CONTACT_TYPES = new Set([
        'email_sent', 'email_outbound', 'email_manual', 'email_inbound',
        'reply_received', 'call_note', 'meeting_note', 'meeting_booked', 'voice_note',
      ])
      const INBOUND_TYPES = new Set(['reply_received', 'email_inbound'])
      const lastActivityMap: Record<string, string> = {}
      const lastActionMap: Record<string, { type: string; at: string }> = {}
      const lastContactActMap: Record<string, string> = {}
      const repliedSet = new Set<string>()
      if (dealIds.length > 0) {
        const { data: acts } = await supabase
          .from('activities')
          .select('deal_id, occurred_at, activity_type')
          .in('deal_id', dealIds)
          .not('occurred_at', 'is', null)
          .order('occurred_at', { ascending: false })

        if (acts) {
          for (const a of acts) {
            if (!a.deal_id || !a.occurred_at) continue
            if (!lastActivityMap[a.deal_id]) lastActivityMap[a.deal_id] = a.occurred_at
            if (!lastActionMap[a.deal_id] && a.activity_type) {
              lastActionMap[a.deal_id] = { type: a.activity_type, at: a.occurred_at }
            }
            if (!lastContactActMap[a.deal_id] && a.activity_type && CONTACT_TYPES.has(a.activity_type)) {
              lastContactActMap[a.deal_id] = a.occurred_at
            }
            if (a.activity_type && INBOUND_TYPES.has(a.activity_type)) {
              repliedSet.add(a.deal_id)
            }
          }
        }
      }

      // Sequence enrollment per deal — drives the "Hospitality 3-Touch ·
      // step 2/3" chip. Latest enrollment wins; total steps counted from
      // sequence_steps (a handful of rows org-wide).
      const enrollmentMap: Record<string, NonNullable<Deal['enrollment']>> = {}
      if (dealIds.length > 0) {
        const [{ data: enrolls }, { data: steps }] = await Promise.all([
          supabase
            .from('sequence_enrollments')
            .select('deal_id, status, current_step, enrolled_at, sequence:sequences(id, name)')
            .in('deal_id', dealIds)
            .order('enrolled_at', { ascending: false }),
          supabase.from('sequence_steps').select('sequence_id'),
        ])
        const stepCount: Record<string, number> = {}
        for (const s of steps ?? []) {
          if (s.sequence_id) stepCount[s.sequence_id] = (stepCount[s.sequence_id] ?? 0) + 1
        }
        for (const e of enrolls ?? []) {
          if (!e.deal_id || enrollmentMap[e.deal_id]) continue
          const seq = e.sequence as unknown as { id: string; name: string } | null
          if (!seq) continue
          enrollmentMap[e.deal_id] = {
            sequence_name: seq.name,
            current_step: e.current_step ?? 1,
            total_steps: stepCount[seq.id] ?? 0,
            status: e.status ?? 'active',
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

        // Last CONTACT — latest of the deal's own last_touch_at (set by the
        // PST re-triage from the mailbox metadata) and any contact-type
        // activity. Stage shuffles don't count as contact.
        const touchMs = d.last_touch_at ? new Date(d.last_touch_at).getTime() : null
        const contactActMs = lastContactActMap[d.id]
          ? new Date(lastContactActMap[d.id]).getTime()
          : null
        const lastContactMs =
          touchMs != null && contactActMs != null
            ? Math.max(touchMs, contactActMs)
            : (touchMs ?? contactActMs)

        // Replied = a live inbound activity OR the PST importer's WARM verdict
        // (those threads predate the activities table).
        const isPstWarm =
          typeof d.notes === 'string' &&
          d.notes.includes('[purezza-pst-promote]') &&
          /warm lead/i.test(d.notes)

        // Canonical lead score: tier = temperature, score = deals.score. Null
        // temperature (closed deals) → no score chip, never a Cold default.
        const leadScore = d.temperature
          ? { score: (d.score as number | null) ?? null, tier: d.temperature as 'hot' | 'warm' | 'cold' }
          : null

        return {
          ...d,
          outcome: (d.outcome as Deal['outcome']) ?? null,
          lead_score: leadScore,
          days_in_stage: d.updated_at ? differenceInDays(new Date(), parseISO(d.updated_at)) : 0,
          is_snoozed: isSnoozed,
          recently_returned: recentlyReturned,
          days_since_last_activity: daysSinceLastActivity,
          last_activity_at: lastActivityAt,
          last_contact_at: lastContactMs != null ? new Date(lastContactMs).toISOString() : null,
          last_action: lastActionMap[d.id] ?? null,
          has_replied: repliedSet.has(d.id) || isPstWarm,
          enrollment: enrollmentMap[d.id] ?? null,
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
      // Source-fix: strip status suffixes (" — Purezza intro", " — COLD from
      // PST", etc) ONCE so they never get baked into deals.title OR the
      // deal_created activity subject (both render in the UI).
      const cleanTitle = cleanDealTitle(input.title)
      const { data, error } = await supabase
        .from('deals')
        .insert({
          org_id: input.org_id,
          title: cleanTitle,
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
          subject: `Deal created: ${cleanTitle}`,
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
        last_contact_at: _lca,
        last_action: _lact,
        has_replied: _hr,
        enrollment: _enr,
        ...dbUpdates
      } = updates

      // Centralised: any move into Proposal Sent stamps proposal_sent_at the
      // first time (so the kanban card's "proposal sent / follow-up" line
      // appears) regardless of whether the move came from a drag or the
      // drawer's Stage select. Don't overwrite an existing timestamp.
      if (to_stage === 'Proposal Sent' && dbUpdates.proposal_sent_at === undefined) {
        const { data: cur } = await supabase
          .from('deals')
          .select('proposal_sent_at')
          .eq('id', id)
          .single()
        if (cur && !cur.proposal_sent_at) {
          ;(dbUpdates as Partial<Deal>).proposal_sent_at = new Date().toISOString()
        }
      }

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
      // A stage/close-field change can move achieved ACV in or out of the
      // monthly gate, so refresh the gate + dashboard caches too.
      qc.invalidateQueries({ queryKey: ['monthly-gate'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
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
 * Mark a deal as Won, Lost, or Installed.
 *
 * - won/lost: stamps outcome + final_value + closed_at; won also seeds
 *   close_won_at so the monthly gate trigger picks the right month.
 * - installed: a post-Closed fulfilment state. Persists outcome='won' (so it
 *   still counts as won in dashboards) plus install_completed_at = the chosen
 *   date — the moment commission is "earned".
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
      existingClosedAt = null,
      existingCloseWonAt = null,
    }: {
      dealId: string
      orgId: string
      outcome: 'won' | 'lost' | 'installed'
      finalValue: number | null
      closeDate: string                      // ISO date (yyyy-MM-dd)
      lostReason?: string | null
      stageId?: string                       // optional stage_id to set in same write
      existingClosedAt?: string | null       // preserved when marking Installed
      existingCloseWonAt?: string | null     // preserved when marking Installed
    }) => {
      const closeIso = new Date(`${closeDate}T12:00:00`).toISOString()
      const isInstalled = outcome === 'installed'
      // Installed deals are recorded as 'won' in the outcome column.
      const dbOutcome = isInstalled ? 'won' : outcome
      // Installed is a post-Closed fulfilment state — the dialog's date is the
      // INSTALL date, not the close date. Preserve the original close month so
      // gate history isn't rewritten; only seed close fields if the deal was
      // never closed (e.g. dragged straight to Installed).
      const closedAt = isInstalled ? (existingClosedAt ?? closeIso) : closeIso
      const closeWonAt = isInstalled
        ? (existingCloseWonAt ?? closeIso)
        : dbOutcome === 'won'
          ? closeIso
          : null
      const updates = {
        outcome: dbOutcome,
        final_value: finalValue,
        closed_at: closedAt,
        updated_at: new Date().toISOString(),
        close_won_at: closeWonAt,
        // Any confirmed outcome releases a "held for next month" flag — a
        // closed/lost/installed deal can't also be parked for next month.
        is_held: false,
        held_until: null,
        ...(outcome === 'lost' ? { lost_reason: lostReason ?? null } : {}),
        ...(isInstalled
          ? { install_completed_at: closeIso }
          : // Moving to Closed or Lost unwinds any install state, so a
            // previously-installed deal doesn't keep stale install timestamps
            // (and isn't double-counted as earned commission).
            {
              install_completed_at: null,
              install_confirmed_at: null,
              install_scheduled_for: null,
            }),
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
      const subject =
        outcome === 'installed' ? 'Marked Installed' : outcome === 'won' ? 'Marked Won' : 'Marked Lost'
      const body =
        outcome === 'lost'
          ? `Lost${lostReason ? ` — ${lostReason}` : ''}`
          : outcome === 'installed'
            ? `Installed — commission earned${finalValue != null ? ` ($${finalValue.toFixed(2)})` : ''}`
            : `Final value ${finalValue != null ? `$${finalValue.toFixed(2)}` : '—'}`
      await supabase.from('activities').insert({
        org_id: orgId,
        deal_id: dealId,
        activity_type: 'stage_change',
        subject,
        body,
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
 * Set or clear a deal's "held for next month" flag. When held, the deal stays
 * in its temperature column but shows a "Held for <month>" badge. `heldUntil`
 * is the date the hold lapses (typically the first of next month); pass null
 * to clear the hold.
 */
export function useSetDealHeld() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dealId, isHeld, heldUntil }: {
      dealId: string
      isHeld: boolean
      heldUntil?: string | null
    }) => {
      const { error } = await supabase
        .from('deals')
        .update({
          is_held: isHeld,
          held_until: isHeld ? (heldUntil ?? null) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dealId)
      if (error) throw error
      return { isHeld }
    },
    onSuccess: ({ isHeld }) => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['monthly-gate'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(isHeld ? 'Held for next month' : 'Hold cleared')
    },
    onError: (err: Error) => toast.error(`Failed to update hold: ${err.message}`),
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
    mutationFn: async ({
      dealId,
      stageId,
      existingCloseWonAt,
    }: {
      dealId: string
      stageId?: string
      existingCloseWonAt?: string | null
    }) => {
      const nowIso = new Date().toISOString()
      const { error } = await supabase
        .from('deals')
        .update({
          install_completed_at: nowIso,
          // Installed is a won fulfilment state. Stamp the won outcome + a
          // close_won_at so the deal is counted in won/earned + commission
          // totals even if it reached the Installed stage without an explicit
          // outcome tag. Preserve an existing close_won_at if there is one.
          outcome: 'won',
          close_won_at: existingCloseWonAt ?? nowIso,
          // An installed deal is no longer held — clear the hold so it leaves
          // its temperature column and counts toward gate/commission views.
          is_held: false,
          held_until: null,
          updated_at: nowIso,
          // Move into the Installed stage column so it leaves Closed (the
          // kanban renders the Installed column from stage_id).
          ...(stageId ? { stage_id: stageId } : {}),
        })
        .eq('id', dealId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['monthly-gate'] })
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
