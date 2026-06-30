import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { isOpenPipeline, dealHeadlineValue, type DealFinancialRow } from '@/lib/queries/pipelineFinancials'
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  subWeeks,
} from 'date-fns'
import {
  computeJordanScore,
  JORDAN_MEETINGS_WEEKLY_TARGET_MAX,
  qualifiedMeetingsTone,
  type JordanScoreResult,
} from '@/lib/metrics/jordanScore'
import { pickPrimaryDeal, type PrimaryDealCandidate } from '@/lib/leadTier'

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
          .eq('activity_type', 'email_outbound')
          .gte('occurred_at', weekStart).lte('occurred_at', weekEnd),
        supabase.from('activities').select('id', { count: 'exact', head: true })
          .in('activity_type', ['reply_received', 'email_inbound'])
          .gte('occurred_at', weekStart).lte('occurred_at', weekEnd),
        supabase.from('activities').select('id', { count: 'exact', head: true })
          .eq('activity_type', 'email_outbound')
          .gte('occurred_at', monthStart).lte('occurred_at', monthEnd),
        supabase.from('activities').select('id', { count: 'exact', head: true })
          .in('activity_type', ['meeting_note', 'meeting_booked'])
          .gte('occurred_at', monthStart).lte('occurred_at', monthEnd),
        supabase.from('deals').select('contract_value, acv, outcome, closed_at, stage:pipeline_stages(is_closed, name)')
          .is('closed_at', null),
        supabase.from('tasks').select('id', { count: 'exact', head: true })
          .gte('due_at', todayStart).lte('due_at', todayEnd)
          .is('completed_at', null),
        // Won stage = closed and not Lost ("Closed" post-consolidation; the
        // old "Closed Won" name also satisfies this for replay safety).
        supabase.from('pipeline_stages').select('id')
          .eq('is_closed', true).not('name', 'ilike', '%lost%'),
      ])

      const closedWonIds = (closedWonStages ?? []).map((s) => s.id)

      const { count: closesThisMonth } = closedWonIds.length > 0
        ? await supabase.from('deals').select('id', { count: 'exact', head: true })
            .in('stage_id', closedWonIds)
            .gte('updated_at', monthStart).lte('updated_at', monthEnd)
        : { count: 0 }

      // Pipeline value = open deals only, via the shared single source of truth
      // (pipelineFinancials.ts) so this KPI card reconciles with the monthly ACV
      // bar and the pipeline hero. Open = stage not closed AND not closed_at AND
      // not lost; value = acv with contract_value fallback.
      const pipelineValue = (openDeals ?? [])
        .filter((d) => isOpenPipeline(d as unknown as DealFinancialRow))
        .reduce((sum, d) => sum + dealHeadlineValue(d as unknown as DealFinancialRow), 0)

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
  score: number | null
  last_touch_at: string | null
}

export function useWarmLeads() {
  return useQuery({
    queryKey: ['dashboard', 'warm-leads'],
    queryFn: async (): Promise<WarmLead[]> => {
      const sevenDaysAgo = subDays(new Date(), 7).toISOString()

      // Canonical warm leads, per CONTACT (not per deal). We group every deal by
      // contact, pick the primary deal with the SAME rule the contacts list uses
      // (pickPrimaryDeal), and keep contacts whose primary deal is warm and
      // hasn't been touched in 7+ days. Deriving from the primary deal — rather
      // than any warm deal — guarantees the widget never lists a contact the
      // list/detail page call Hot or Cold. Score (banded 50–79 for warm) comes
      // straight off deals.score.
      const { data: deals, error } = await supabase
        .from('deals')
        .select(`
          contact_id, temperature, score, last_touch_at, closed_at, created_at,
          stage:pipeline_stages(is_closed),
          contact:contacts(id, full_name),
          venue:venues(name)
        `)
        .not('contact_id', 'is', null)

      if (error) throw error

      interface WarmRow extends PrimaryDealCandidate {
        contact_id: string
        last_touch_at: string | null
        full_name: string
        venue_name: string | null
      }

      const byContact = new Map<string, WarmRow[]>()
      for (const d of deals ?? []) {
        if (!d.contact_id) continue
        const row: WarmRow = {
          contact_id: d.contact_id,
          temperature: (d.temperature as PrimaryDealCandidate['temperature']) ?? null,
          score: (d.score as number | null) ?? null,
          closed_at: d.closed_at,
          created_at: d.created_at,
          stage: (d.stage as unknown as { is_closed: boolean | null } | null) ?? null,
          last_touch_at: d.last_touch_at,
          full_name: (d.contact as { full_name: string } | null)?.full_name ?? 'Unknown',
          venue_name: (d.venue as { name: string } | null)?.name ?? null,
        }
        const arr = byContact.get(d.contact_id) ?? []
        arr.push(row)
        byContact.set(d.contact_id, arr)
      }

      const out: WarmLead[] = []
      for (const [contactId, rows] of byContact) {
        const primary = pickPrimaryDeal(rows)
        if (!primary || primary.temperature !== 'warm') continue
        // Untouched 7+ days (older than the cutoff) or never touched.
        if (primary.last_touch_at && primary.last_touch_at >= sevenDaysAgo) continue
        out.push({
          id: contactId,
          full_name: primary.full_name,
          venue_name: primary.venue_name,
          score: primary.score ?? null,
          last_touch_at: primary.last_touch_at,
        })
      }

      // Highest score first; unscored warm leads (score null) sort last.
      return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 5)
    },
  })
}

export interface PipelineStageCount {
  stage_id: string
  stage_name: string
  count: number
  value: number
  color: string | null
}

/**
 * Phase F — Pipeline hero metrics (Dark Anchor cards above Kanban).
 */
export interface PipelineHeroMetrics {
  pipelineValue: number
  closeRatePct: number | null
  avgDealSize: number
  dealsOpen: number
  dealsWon: number
  dealsLost: number
}

export function usePipelineHeroMetrics() {
  return useQuery({
    queryKey: ['pipeline', 'hero-metrics'],
    queryFn: async (): Promise<PipelineHeroMetrics> => {
      const [{ data: openDeals }, { data: stages }, { data: closedDeals }] = await Promise.all([
        supabase.from('deals').select('contract_value, acv, outcome, closed_at, stage:pipeline_stages(is_closed, name)').is('closed_at', null),
        supabase.from('pipeline_stages').select('id, name, is_closed'),
        supabase
          .from('deals')
          .select('contract_value, stage_id, closed_at')
          .not('closed_at', 'is', null),
      ])

      const wonStageIds = new Set(
        (stages ?? [])
          // Won = closed and not Lost ("Closed" post-consolidation).
          .filter((s) => s.is_closed && !/lost/i.test(s.name ?? ''))
          .map((s) => s.id),
      )
      const lostStageIds = new Set(
        (stages ?? [])
          .filter((s) => s.is_closed && /lost/i.test(s.name ?? ''))
          .map((s) => s.id),
      )

      // Shared single source of truth (pipelineFinancials.ts) — same open
      // definition + monetary basis as the dashboard KPI card and the monthly
      // ACV bar, so the pipeline hero can't show a contradicting figure.
      const pipelineValue = (openDeals ?? [])
        .filter((d) => isOpenPipeline(d as unknown as DealFinancialRow))
        .reduce((s, d) => s + dealHeadlineValue(d as unknown as DealFinancialRow), 0)

      const dealsWon = (closedDeals ?? []).filter(
        (d) => d.stage_id && wonStageIds.has(d.stage_id),
      ).length
      const dealsLost = (closedDeals ?? []).filter(
        (d) => d.stage_id && lostStageIds.has(d.stage_id),
      ).length

      const decidedTotal = dealsWon + dealsLost
      const closeRatePct =
        decidedTotal > 0 ? Math.round((dealsWon / decidedTotal) * 100) : null

      const openCount = (openDeals ?? []).length
      // KPI integrity: deals without a value (e.g. the PST import, value
      // intentionally NULL) are excluded from the average's denominator —
      // otherwise 300 unvalued leads crush the figure to ~$0.
      const valuedOpenCount = (openDeals ?? []).filter(
        (d) =>
          isOpenPipeline(d as unknown as DealFinancialRow) &&
          dealHeadlineValue(d as unknown as DealFinancialRow) > 0,
      ).length
      const avgDealSize = valuedOpenCount > 0 ? Math.round(pipelineValue / valuedOpenCount) : 0

      return {
        pipelineValue,
        closeRatePct,
        avgDealSize,
        dealsOpen: openCount,
        dealsWon,
        dealsLost,
      }
    },
    staleTime: 60_000,
  })
}

/**
 * Phase F — Jordan Score & dark-anchor hero data.
 *
 * Bundles response rate, qualified meetings, pipeline velocity, plus
 * WoW deltas, meter positions, and the 7-day streak pattern used by
 * the Dashboard's DarkMetricCards. Reply-benchmark is anchored to the
 * hospitality 8–14% band (mid-point 12%), not generic-B2B 15%.
 */
export interface JordanAnchorMetrics {
  pipelineValue: number
  pipelineDeltaPct: number
  pipelineStageMeter: { segments: number; filled: number }
  /** Qualified meetings booked THIS WEEK (Mon–Sun, local). */
  qualifiedMeetingsCount: number
  /** WoW delta (count-this-week minus count-last-week). */
  qualifiedMeetingsDelta: number
  /** Meter tone driven by target band: ≥8 mint, 4–7 warning, <4 danger. */
  qualifiedMeetingsTone: 'mint' | 'warning' | 'danger'
  qualifiedMeter: { segments: number; filled: number }
  responseRatePct: number | null
  responseRateDelta: number
  responseRateMeter: { segments: number; filled: number }
  jordanScore: JordanScoreResult
  /** 7-day streak — true where score >= 50 on that day (best-effort fallback). */
  scoreStreak: boolean[]
  lastSyncedAt: string
}

/**
 * Hospitality cold-reply benchmark (not generic-SaaS 15%).
 * 8–14% reply is healthy for cold hospitality; below 5% means
 * deliverability, offer or targeting is broken.
 */
const REPLY_BENCHMARK_PCT = 12 // hospitality mid-band

export function useJordanAnchorMetrics() {
  return useQuery({
    queryKey: ['dashboard', 'jordan-anchor'],
    queryFn: async (): Promise<JordanAnchorMetrics> => {
      const now = new Date()
      const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString()
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString()
      const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }).toISOString()
      const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }).toISOString()
      const monthStart = startOfMonth(now).toISOString()
      const monthEnd = endOfMonth(now).toISOString()
      const last30dStart = subDays(now, 30).toISOString()
      const last60dStart = subDays(now, 60).toISOString()

      const [
        { data: openDeals },
        { count: sentThisWeek },
        { count: repliesThisWeek },
        { count: sentLastWeek },
        { count: repliesLastWeek },
        { count: sent30d },
        { count: replies30d },
        { count: sentPrev30d },
        { count: repliesPrev30d },
        { count: meetingsThisMonth },
        { count: meetingsThisWeek },
        { count: meetingsLastWeek },
        { data: stages },
      ] = await Promise.all([
        supabase
          .from('deals')
          // closed_at IS NULL is the same direction as isOpenPipeline (which
          // also excludes closed_at-set rows), so prefiltering here yields an
          // identical financial set to running the helper over all deals — it
          // just keeps the fetch small for the velocity/stage-meter reuse below.
          .select('contract_value, acv, outcome, stage_id, created_at, closed_at, stage:pipeline_stages(is_closed, name)')
          .is('closed_at', null),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('activity_type', 'email_outbound')
          .gte('occurred_at', weekStart)
          .lte('occurred_at', weekEnd),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .in('activity_type', ['reply_received', 'email_inbound'])
          .gte('occurred_at', weekStart)
          .lte('occurred_at', weekEnd),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('activity_type', 'email_outbound')
          .gte('occurred_at', lastWeekStart)
          .lte('occurred_at', lastWeekEnd),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .in('activity_type', ['reply_received', 'email_inbound'])
          .gte('occurred_at', lastWeekStart)
          .lte('occurred_at', lastWeekEnd),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('activity_type', 'email_outbound')
          .gte('occurred_at', last30dStart),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .in('activity_type', ['reply_received', 'email_inbound'])
          .gte('occurred_at', last30dStart),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('activity_type', 'email_outbound')
          .gte('occurred_at', last60dStart)
          .lt('occurred_at', last30dStart),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .in('activity_type', ['reply_received', 'email_inbound'])
          .gte('occurred_at', last60dStart)
          .lt('occurred_at', last30dStart),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .in('activity_type', ['meeting_note', 'meeting_booked'])
          .gte('occurred_at', monthStart)
          .lte('occurred_at', monthEnd),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .in('activity_type', ['meeting_note', 'meeting_booked'])
          .gte('occurred_at', weekStart)
          .lte('occurred_at', weekEnd),
        supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .in('activity_type', ['meeting_note', 'meeting_booked'])
          .gte('occurred_at', lastWeekStart)
          .lte('occurred_at', lastWeekEnd),
        supabase.from('pipeline_stages').select('id').eq('is_closed', false),
      ])

      // Pipeline value & rough WoW velocity via created_at buckets.
      // One source of truth (see pipelineFinancials.ts): sum the headline value
      // (ACV with contract_value fallback) over genuinely-open deals only —
      // stage not closed and not lost. This matches the ACV/TCV bar's set + basis
      // so the two tiles can no longer contradict each other, and excludes
      // won-stage deals that never had closed_at stamped.
      const pipelineValue = (openDeals ?? [])
        .filter((d) => isOpenPipeline(d as unknown as DealFinancialRow))
        .reduce((s, d) => s + dealHeadlineValue(d as unknown as DealFinancialRow), 0)
      const createdThisWeek = (openDeals ?? []).filter(
        (d) => d.created_at && d.created_at >= weekStart && d.created_at <= weekEnd,
      ).length
      const createdLastWeek = (openDeals ?? []).filter(
        (d) =>
          d.created_at && d.created_at >= lastWeekStart && d.created_at <= lastWeekEnd,
      ).length
      const pipelineDeltaPct =
        createdLastWeek > 0
          ? Math.round(((createdThisWeek - createdLastWeek) / createdLastWeek) * 100)
          : createdThisWeek > 0
            ? 100
            : 0

      const stageIds = new Set(
        (openDeals ?? []).map((d) => d.stage_id).filter((v): v is string => !!v),
      )
      const totalStages = Math.max(5, (stages ?? []).length || 5)
      const pipelineStageMeter = {
        segments: Math.min(8, totalStages),
        filled: Math.min(Math.min(8, totalStages), stageIds.size),
      }

      // Jordan Score still tracks the monthly cadence (existing weighting).
      const qMeetingsMonth = meetingsThisMonth ?? 0

      // KPI tile switched to weekly (hospitality reality): count this week +
      // WoW delta, meter anchored to the 8–12 target band.
      const qMeetingsWeek = meetingsThisWeek ?? 0
      const qMeetingsWeekLast = meetingsLastWeek ?? 0
      const qualifiedMeetingsDelta = qMeetingsWeek - qMeetingsWeekLast

      const qMeetingsTone = qualifiedMeetingsTone(qMeetingsWeek)
      const qualifiedMeter = {
        segments: JORDAN_MEETINGS_WEEKLY_TARGET_MAX,
        filled: Math.min(JORDAN_MEETINGS_WEEKLY_TARGET_MAX, qMeetingsWeek),
      }

      const sent = sentThisWeek ?? 0
      const replies = repliesThisWeek ?? 0
      const responseRatePct = sent > 0 ? Math.round((replies / sent) * 100) : null

      const sentLast = sentLastWeek ?? 0
      const repliesLast = repliesLastWeek ?? 0
      const lastRate = sentLast > 0 ? Math.round((repliesLast / sentLast) * 100) : 0
      const responseRateDelta = (responseRatePct ?? 0) - lastRate

      const responseRateMeter = {
        segments: 6,
        filled: Math.round(
          Math.min(6, ((responseRatePct ?? 0) / (REPLY_BENCHMARK_PCT * 2)) * 6),
        ),
      }

      const sent30 = sent30d ?? 0
      const replies30 = replies30d ?? 0
      const sentPrev30 = sentPrev30d ?? 0
      const repliesPrev30 = repliesPrev30d ?? 0
      const rate30 = sent30 > 0 ? (replies30 / sent30) * 100 : 0
      const ratePrev30 = sentPrev30 > 0 ? (repliesPrev30 / sentPrev30) * 100 : 0
      const velocityPct = Math.round(rate30 - ratePrev30)

      const jordanScore = computeJordanScore({
        responseRatePct,
        qualifiedMeetingsCount: qMeetingsMonth,
        pipelineVelocityPct: velocityPct,
      })

      const meetingsPerDay = Math.max(1, qMeetingsWeek)
      const scoreStreak = Array.from({ length: 7 }).map(
        (_, i) => i < Math.min(7, meetingsPerDay + Math.floor(jordanScore.score / 25)),
      )

      return {
        pipelineValue,
        pipelineDeltaPct,
        pipelineStageMeter,
        qualifiedMeetingsCount: qMeetingsWeek,
        qualifiedMeetingsDelta,
        qualifiedMeetingsTone: qMeetingsTone,
        qualifiedMeter,
        responseRatePct,
        responseRateDelta,
        responseRateMeter,
        jordanScore,
        scoreStreak,
        lastSyncedAt: new Date().toISOString(),
      }
    },
    staleTime: 60_000,
  })
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
          stage_id: s.id,
          stage_name: s.name,
          count: stageDeals.length,
          value: stageDeals.reduce((sum, d) => sum + (Number(d.contract_value) || 0), 0),
          color: s.color,
        }
      })
    },
  })
}

/* ────────────────────────────────────────────────────────────────────
 * Lost-reason analytics — "Why deals die" card
 *
 * Aggregates closed-lost deals over a recent window (default 90d) and
 * groups by lost_reason. Drives the LostReasonCard on the Dashboard so
 * Jordan can spot "12 deals lost to price" / "5 to timing" and adjust.
 * ──────────────────────────────────────────────────────────────────── */

export interface LostReasonStat {
  reason: string
  count: number
  totalValue: number
}

export function useLostReasonStats(days: number = 90) {
  return useQuery({
    queryKey: ['dashboard', 'lost-reasons', days],
    queryFn: async (): Promise<LostReasonStat[]> => {
      const since = subDays(new Date(), days).toISOString()
      const { data, error } = await supabase
        .from('deals')
        .select('lost_reason, final_value, contract_value')
        .eq('outcome', 'lost')
        .gte('closed_at', since)

      if (error) throw error

      // Aggregate client-side — Supabase JS doesn't support GROUP BY directly.
      // Volumes here are tens of rows for a solo seller, so this is fine.
      const buckets = new Map<string, { count: number; totalValue: number }>()
      for (const row of data ?? []) {
        const reason = (row.lost_reason ?? '').trim() || 'Not specified'
        const value =
          (row.final_value != null ? Number(row.final_value) : null) ??
          (row.contract_value != null ? Number(row.contract_value) : 0) ??
          0
        const bucket = buckets.get(reason) ?? { count: 0, totalValue: 0 }
        bucket.count += 1
        bucket.totalValue += Number.isFinite(value) ? value : 0
        buckets.set(reason, bucket)
      }

      return Array.from(buckets.entries())
        .map(([reason, b]) => ({ reason, count: b.count, totalValue: b.totalValue }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    },
    staleTime: 5 * 60_000, // 5 min
  })
}
