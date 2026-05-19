/**
 * leadflow-analytics — TanStack Query hooks for the Week 3 sending dashboard,
 * seed placement tests, and Postmaster Tools grade tracking.
 *
 * Everything here is plain Supabase + RLS (auth_org_id() / auth.uid()).
 * Aggregations are computed client-side off raw rows — at Jordan's volume
 * (4 inboxes, ~800 sends/day at full ramp) the row counts are small and a
 * single-pass JS reduce beats round-tripping to an Edge Function.
 */

import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmailSendEventType =
  | 'sent'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'replied'
  | 'unsubscribed'
  | 'spam_complaint'
  | 'failed'

export interface RawSendEvent {
  id: string
  email_account_id: string | null
  event_type: EmailSendEventType
  event_at: string
}

export interface RawPixelHit {
  send_queue_id: string | null
  hit_at: string
  is_apple_mpp: boolean
}

export interface InboxDailyStats {
  email_account_id: string
  sent_today: number
  bounced_today: number
  replied_today: number
  /** Real opens only — Apple MPP prefetches excluded. */
  opened_today: number
  bounce_rate_24h: number
  spam_complaints_24h: number
  reputation_score: number | null
  reputation_score_prev_day: number | null
}

export interface DomainRollup {
  domain: string
  inbox_count: number
  sent_7d: number
  replied_7d: number
  bounced_7d: number
  spam_complaints_7d: number
  reply_rate_7d_pct: number
  bounce_rate_7d_pct: number
  spam_rate_7d_pct: number
}

export interface InboxPlacementSeed {
  id: string
  org_id: string
  user_id: string
  domain: string
  seed_address: string
  seed_provider: 'hotmail' | 'outlook' | 'gmail_personal' | 'protonmail' | 'yahoo'
  sent_at: string
  placement: 'inbox' | 'promotions' | 'spam' | 'unknown' | null
  placement_recorded_at: string | null
  created_at: string
}

export interface PostmasterGrade {
  id: string
  org_id: string
  user_id: string
  domain: string
  grade: 'High' | 'Medium' | 'Low' | 'Bad' | 'Unknown'
  recorded_at: string
  notes: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Raw event fetches (14d window — enough for reputation + 7d rollups + today)
// ---------------------------------------------------------------------------

function fourteenDaysAgoIso(): string {
  return new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
}

function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function twentyFourHoursAgoIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
}

function sevenDaysAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
}

export function useLeadflowSendEvents() {
  return useQuery({
    queryKey: ['leadflow-analytics', 'send-events-14d'],
    queryFn: async (): Promise<RawSendEvent[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('email_send_events')
        .select('id, email_account_id, event_type, event_at')
        .gte('event_at', fourteenDaysAgoIso())
        .order('event_at', { ascending: false })
        .limit(50000)
      if (error) throw error
      return (data ?? []) as RawSendEvent[]
    },
    staleTime: 60_000,
  })
}

export function useLeadflowPixelHits() {
  return useQuery({
    queryKey: ['leadflow-analytics', 'pixel-hits-24h'],
    queryFn: async (): Promise<RawPixelHit[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('email_pixel_hits')
        .select('send_queue_id, hit_at, is_apple_mpp')
        .gte('hit_at', twentyFourHoursAgoIso())
        .eq('is_apple_mpp', false)
        .limit(10000)
      if (error) throw error
      return (data ?? []) as RawPixelHit[]
    },
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Derived aggregations (pure functions for testability)
// ---------------------------------------------------------------------------

export function computeInboxDailyStats(
  events: RawSendEvent[],
  accounts: { id: string; reputation_score: number | null }[],
): InboxDailyStats[] {
  const today = startOfTodayIso()
  const dayAgo = twentyFourHoursAgoIso()

  return accounts.map((acct) => {
    const acctEvents = events.filter((e) => e.email_account_id === acct.id)
    const todayEvents = acctEvents.filter((e) => e.event_at >= today)
    const last24h = acctEvents.filter((e) => e.event_at >= dayAgo)

    const sent_today = todayEvents.filter((e) => e.event_type === 'sent').length
    const bounced_today = todayEvents.filter((e) => e.event_type === 'bounced').length
    const replied_today = todayEvents.filter((e) => e.event_type === 'replied').length
    const opened_today = todayEvents.filter((e) => e.event_type === 'opened').length

    const sent_24h = last24h.filter((e) => e.event_type === 'sent').length
    const bounced_24h = last24h.filter((e) => e.event_type === 'bounced').length
    const spam_24h = last24h.filter((e) => e.event_type === 'spam_complaint').length

    const bounce_rate_24h = sent_24h > 0 ? (bounced_24h / sent_24h) * 100 : 0

    return {
      email_account_id: acct.id,
      sent_today,
      bounced_today,
      replied_today,
      opened_today,
      bounce_rate_24h: Math.round(bounce_rate_24h * 10) / 10,
      spam_complaints_24h: spam_24h,
      reputation_score: acct.reputation_score,
      reputation_score_prev_day: null, // populated when we wire a history table later
    }
  })
}

export function computeDomainRollups(
  events: RawSendEvent[],
  accounts: { id: string; domain: string | null }[],
): DomainRollup[] {
  const sevenAgo = sevenDaysAgoIso()
  const accountToDomain = new Map<string, string>()
  for (const a of accounts) {
    if (a.domain) accountToDomain.set(a.id, a.domain)
  }

  const byDomain = new Map<string, {
    sent: number
    bounced: number
    replied: number
    complained: number
    inboxes: Set<string>
  }>()

  for (const acct of accounts) {
    if (!acct.domain) continue
    if (!byDomain.has(acct.domain)) {
      byDomain.set(acct.domain, {
        sent: 0,
        bounced: 0,
        replied: 0,
        complained: 0,
        inboxes: new Set(),
      })
    }
    byDomain.get(acct.domain)!.inboxes.add(acct.id)
  }

  for (const ev of events) {
    if (ev.event_at < sevenAgo) continue
    if (!ev.email_account_id) continue
    const domain = accountToDomain.get(ev.email_account_id)
    if (!domain) continue
    const bucket = byDomain.get(domain)
    if (!bucket) continue
    if (ev.event_type === 'sent') bucket.sent++
    else if (ev.event_type === 'bounced') bucket.bounced++
    else if (ev.event_type === 'replied') bucket.replied++
    else if (ev.event_type === 'spam_complaint') bucket.complained++
  }

  const rollups: DomainRollup[] = []
  for (const [domain, b] of byDomain) {
    const denom = b.sent > 0 ? b.sent : 1
    rollups.push({
      domain,
      inbox_count: b.inboxes.size,
      sent_7d: b.sent,
      replied_7d: b.replied,
      bounced_7d: b.bounced,
      spam_complaints_7d: b.complained,
      reply_rate_7d_pct: b.sent > 0 ? Math.round((b.replied / denom) * 1000) / 10 : 0,
      bounce_rate_7d_pct: b.sent > 0 ? Math.round((b.bounced / denom) * 1000) / 10 : 0,
      spam_rate_7d_pct: b.sent > 0 ? Math.round((b.complained / denom) * 1000) / 10 : 0,
    })
  }
  rollups.sort((a, b) => a.domain.localeCompare(b.domain))
  return rollups
}

export interface SendsOverTimePoint {
  date: string   // YYYY-MM-DD
  sent: number
  bounced: number
  replied: number
}

export function computeSendsOverTime(events: RawSendEvent[], days = 14): SendsOverTimePoint[] {
  const buckets = new Map<string, { sent: number; bounced: number; replied: number }>()
  // Seed every day so the chart has continuous x-axis
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    d.setHours(0, 0, 0, 0)
    const key = d.toISOString().slice(0, 10)
    buckets.set(key, { sent: 0, bounced: 0, replied: 0 })
  }
  for (const ev of events) {
    const key = ev.event_at.slice(0, 10)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (ev.event_type === 'sent') bucket.sent++
    else if (ev.event_type === 'bounced') bucket.bounced++
    else if (ev.event_type === 'replied') bucket.replied++
  }
  return Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }))
}

// ---------------------------------------------------------------------------
// "At risk" alert evaluation
// ---------------------------------------------------------------------------

export type AtRiskReason =
  | { code: 'bounce_rate_high'; bounce_rate_24h: number }
  | { code: 'spam_complaints'; complaints_24h: number }
  | { code: 'reputation_drop'; drop: number }

export interface InboxAtRisk {
  email_account_id: string
  reasons: AtRiskReason[]
}

export function detectInboxesAtRisk(stats: InboxDailyStats[]): InboxAtRisk[] {
  const risky: InboxAtRisk[] = []
  for (const s of stats) {
    const reasons: AtRiskReason[] = []
    if (s.bounce_rate_24h > 2) {
      reasons.push({ code: 'bounce_rate_high', bounce_rate_24h: s.bounce_rate_24h })
    }
    if (s.spam_complaints_24h >= 1) {
      reasons.push({ code: 'spam_complaints', complaints_24h: s.spam_complaints_24h })
    }
    if (
      s.reputation_score != null &&
      s.reputation_score_prev_day != null &&
      s.reputation_score_prev_day - s.reputation_score >= 10
    ) {
      reasons.push({
        code: 'reputation_drop',
        drop: s.reputation_score_prev_day - s.reputation_score,
      })
    }
    if (reasons.length > 0) risky.push({ email_account_id: s.email_account_id, reasons })
  }
  return risky
}

// ---------------------------------------------------------------------------
// Pause inbox mutation (used by the at-risk banner)
// ---------------------------------------------------------------------------

export function usePauseInbox() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('email_accounts')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-accounts'] })
      toast.success('Inbox paused — re-enable from Settings → Email Accounts')
    },
    onError: (err: Error) => toast.error(`Failed to pause: ${err.message}`),
  })
}

// ---------------------------------------------------------------------------
// Seed placement tests
// ---------------------------------------------------------------------------

export function useInboxPlacementSeeds() {
  return useQuery({
    queryKey: ['leadflow-analytics', 'placement-seeds'],
    queryFn: async (): Promise<InboxPlacementSeed[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('inbox_placement_seeds')
        .select(
          'id, org_id, user_id, domain, seed_address, seed_provider, sent_at, placement, placement_recorded_at, created_at',
        )
        .order('sent_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as InboxPlacementSeed[]
    },
  })
}

export interface RecordSeedSendInput {
  org_id: string
  user_id: string
  domain: string
  seed_address: string
  seed_provider: InboxPlacementSeed['seed_provider']
}

export function useRecordSeedSend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RecordSeedSendInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('inbox_placement_seeds')
        .insert(input)
        .select()
        .single()
      if (error) throw error
      return data as InboxPlacementSeed
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leadflow-analytics', 'placement-seeds'] })
      toast.success('Seed test recorded — record placement in 5-10 min')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateSeedPlacement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; placement: NonNullable<InboxPlacementSeed['placement']> }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('inbox_placement_seeds')
        .update({
          placement: input.placement,
          placement_recorded_at: new Date().toISOString(),
        })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leadflow-analytics', 'placement-seeds'] })
      toast.success('Placement recorded')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ---------------------------------------------------------------------------
// Postmaster grades
// ---------------------------------------------------------------------------

export function usePostmasterGrades() {
  return useQuery({
    queryKey: ['leadflow-analytics', 'postmaster-grades'],
    queryFn: async (): Promise<PostmasterGrade[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('postmaster_grades')
        .select('id, org_id, user_id, domain, grade, recorded_at, notes, created_at')
        .order('recorded_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as PostmasterGrade[]
    },
  })
}

export interface RecordGradeInput {
  org_id: string
  user_id: string
  domain: string
  grade: PostmasterGrade['grade']
  notes?: string | null
}

export function useRecordPostmasterGrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RecordGradeInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('postmaster_grades')
        .insert(input)
        .select()
        .single()
      if (error) throw error
      return data as PostmasterGrade
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leadflow-analytics', 'postmaster-grades'] })
      toast.success('Postmaster grade recorded')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ---------------------------------------------------------------------------
// Latest-grade-per-domain helper
// ---------------------------------------------------------------------------

export function useLatestPostmasterGradeByDomain() {
  const { data } = usePostmasterGrades()
  return useMemo(() => {
    const map = new Map<string, PostmasterGrade>()
    if (!data) return map
    // grades are ordered desc by recorded_at; first hit per domain wins.
    for (const g of data) {
      if (!map.has(g.domain)) map.set(g.domain, g)
    }
    return map
  }, [data])
}

// ---------------------------------------------------------------------------
// Cron health (display the cron_job_run_status view from PR #65)
// ---------------------------------------------------------------------------

/**
 * cron_job_run_status (from PR #65) — one row per cron run.
 * We aggregate to one row per jobname in JS: latest run + failure count over 24h.
 */
export interface CronRunRow {
  runid: number
  jobid: number
  jobname: string
  start_time: string | null
  end_time: string | null
  pg_cron_status: string | null
  http_status: number | null
  http_error: string | null
}

export interface CronJobHealth {
  jobname: string
  last_run_at: string | null
  last_http_status: number | null
  last_error: string | null
  failures_24h: number
}

export function useCronHealth() {
  return useQuery({
    queryKey: ['leadflow-analytics', 'cron-health'],
    queryFn: async (): Promise<CronJobHealth[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('cron_job_run_status')
        .select('runid, jobid, jobname, start_time, end_time, pg_cron_status, http_status, http_error')
        .order('start_time', { ascending: false })
        .limit(2000)
      if (error) {
        // View might not exist in some envs — fail soft so the dashboard still renders.
        // eslint-disable-next-line no-console
        console.warn('[useCronHealth] view fetch failed:', error.message)
        return []
      }
      const rows = (data ?? []) as CronRunRow[]
      const dayAgo = twentyFourHoursAgoIso()
      const byJob = new Map<string, CronJobHealth>()
      for (const row of rows) {
        if (!row.jobname) continue
        const isFailure =
          (row.http_status != null && (row.http_status < 200 || row.http_status >= 300)) ||
          !!row.http_error
        const existing = byJob.get(row.jobname)
        if (!existing) {
          byJob.set(row.jobname, {
            jobname: row.jobname,
            last_run_at: row.start_time,
            last_http_status: row.http_status,
            last_error: row.http_error,
            failures_24h:
              isFailure && row.start_time && row.start_time >= dayAgo ? 1 : 0,
          })
        } else {
          // rows are sorted desc — existing.last_run_at is already the most recent
          if (isFailure && row.start_time && row.start_time >= dayAgo) {
            existing.failures_24h++
          }
        }
      }
      return Array.from(byJob.values()).sort((a, b) =>
        a.jobname.localeCompare(b.jobname),
      )
    },
    staleTime: 60_000,
  })
}
