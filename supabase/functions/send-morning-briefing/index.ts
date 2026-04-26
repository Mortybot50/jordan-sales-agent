/**
 * send-morning-briefing — Supabase Edge Function
 *
 * Cron-triggered hourly. For each user we check (in Melbourne local time):
 *   - email_notifications.morning_briefing       (must be true / unset)
 *   - email_notifications.briefing_time_hour     (must equal current Melb hour)
 *   - email_notifications.morning_briefing_paused_until (must be in the past)
 * Already-sent-today is enforced by a UNIQUE index on briefing_sends
 * (user_id, sent_local_date) so retries are no-ops.
 *
 * Phase G additions (2026-04-26):
 *   - dedup via briefing_sends
 *   - plain-text fallback alongside HTML
 *   - dynamic subject ("N items need you" / "Quiet morning")
 *   - DST-safe scheduling: cron fires hourly, function gates on Melb hour
 *   - manual-trigger mode (POST { mode: 'manual', user_id }) for "send me one now"
 *
 * Required env vars:
 *   RESEND_API_KEY         — if absent, logs 'skipped' run and returns 200
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
// Functions runtime auto-injects SUPABASE_URL; VITE_SUPABASE_URL is the Vercel name
// — accept either so the function works locally and in prod without manual setup.
const SUPABASE_URL =
  // @ts-expect-error Deno globals
  Deno.env.get('VITE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const FROM_ADDRESS = 'Jordan Briefing <briefing@jordan.purezza.com.au>'
const APP_URL = 'https://jordan-sales-agent.vercel.app'

// ── Jordan design tokens (inline — email-safe subset) ──────────────
const INK = '#0f172a'
const INK_DARK = '#0f1113'
const INK_DARK_FAINT = 'rgba(255,255,255,0.55)'
const INK_MUTED = '#334155'
const INK_FAINT = '#64748b'
const HAIRLINE = '#e4e7eb'
const DARK_SEG = 'rgba(255,255,255,0.12)'
const SURFACE_1 = '#ffffff'
const SURFACE_2 = '#fafbfc'
const ACCENT = '#2563eb'
const ACCENT_SOFT = '#eff6ff'
const MINT = '#2dd47c'
const WARM_SOFT = '#fffbeb'
const WARM_TEXT = '#b45309'
const SUCCESS_SOFT = '#ecfdf5'
const SUCCESS_TEXT = '#047857'
const FONT = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
const FONT_MONO = `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace`

interface UserRow {
  id: string
  org_id: string
  email: string | null
  full_name: string | null
  email_notifications: {
    morning_briefing?: boolean
    briefing_time_hour?: number
    morning_briefing_paused_until?: string | null
  } | null
}

// Returns the Melbourne local hour (0–23) at the given instant.
function melbourneHour(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(at)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '0'
  // en-AU returns "24" for midnight in some runtimes — normalise.
  const n = parseInt(h, 10)
  return n === 24 ? 0 : n
}

function melbourneDateIso(at: Date): string {
  // YYYY-MM-DD in Melbourne local calendar.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
  return parts // en-CA gives YYYY-MM-DD
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  const startedAt = new Date().toISOString()
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date()

  // Optional manual-trigger mode for "send me one now" Settings button.
  // Body: { mode: 'manual', user_id?: string, force?: boolean }
  let manualUserId: string | null = null
  let manualForce = false
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      if (body && body.mode === 'manual') {
        manualUserId = typeof body.user_id === 'string' ? body.user_id : null
        manualForce = body.force === true
      }
    } catch {
      // empty/invalid body is fine — treat as scheduled run
    }
  }

  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping send (dev mode)')
    await supabase.from('worker_runs' as never).insert({
      worker_name: 'morning_briefing',
      status: 'skipped',
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      rows_processed: 0,
      error: 'RESEND_API_KEY not configured',
    })
    return new Response(
      JSON.stringify({
        status: 'skipped',
        reason: 'RESEND_API_KEY not configured — set it in Supabase project env vars',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Fetch all candidate users.
  let query = supabase
    .from('users')
    .select('id, org_id, email, full_name, email_notifications')
    .not('email', 'is', null)
  if (manualUserId) {
    query = query.eq('id', manualUserId)
  }
  const { data: users, error: usersError } = await query

  if (usersError) {
    await supabase.from('worker_runs' as never).insert({
      worker_name: 'morning_briefing',
      status: 'error',
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      rows_processed: 0,
      error: usersError.message,
    })
    return new Response(JSON.stringify({ error: usersError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const melbHour = melbourneHour(now)
  const melbDate = melbourneDateIso(now)

  // Eligibility filter for scheduled runs:
  //   - opted in (default true)
  //   - not paused
  //   - briefing_time_hour matches current Melbourne hour
  // Manual trigger bypasses the hour gate but still respects opt-in/pause
  // unless `force=true`.
  const eligibleUsers = (users ?? []).filter((u: UserRow) => {
    if (!u.email) return false
    const notif = u.email_notifications ?? {}
    if (manualForce) return true
    if (notif.morning_briefing === false) return false
    const pausedUntil = notif.morning_briefing_paused_until
    if (pausedUntil && new Date(pausedUntil) > now) return false
    if (manualUserId) return true // manual: skip hour gate
    const hour = typeof notif.briefing_time_hour === 'number' ? notif.briefing_time_hour : 7
    return hour === melbHour
  })

  let sent = 0
  let skippedDup = 0
  const errors: string[] = []

  for (const user of eligibleUsers as UserRow[]) {
    if (!user.email) continue
    try {
      // Idempotency: try to insert a stub row first. Unique index on
      // (user_id, sent_local_date) means a duplicate insert errors out
      // with code 23505 → that user already received today's briefing.
      const { error: stubErr } = await supabase
        .from('briefing_sends' as never)
        .insert({
          user_id: user.id,
          sent_local_date: melbDate,
          item_count: 0,
        } as never)

      if (stubErr) {
        // 23505 = unique_violation
        if ((stubErr as { code?: string }).code === '23505') {
          skippedDup++
          console.log(`Already sent today: ${user.email}`)
          continue
        }
        errors.push(`${user.email}: stub insert failed: ${stubErr.message}`)
        continue
      }

      const { html, text, itemCount } = await buildBriefing(supabase, user.org_id, user.full_name ?? 'Jordan')
      const subject = itemCount > 0
        ? `Your morning briefing — ${itemCount} ${itemCount === 1 ? 'item needs' : 'items need'} you`
        : `Quiet morning — nothing urgent`

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [user.email],
          subject,
          html,
          text,
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        errors.push(`${user.email}: ${res.status} ${body}`)
        await supabase
          .from('briefing_sends' as never)
          .update({ error: `${res.status} ${body.slice(0, 500)}` } as never)
          .eq('user_id', user.id)
          .eq('sent_local_date', melbDate)
      } else {
        const json = (await res.json().catch(() => null)) as { id?: string } | null
        await supabase
          .from('briefing_sends' as never)
          .update({
            item_count: itemCount,
            resend_message_id: json?.id ?? null,
          } as never)
          .eq('user_id', user.id)
          .eq('sent_local_date', melbDate)
        sent++
      }
    } catch (e) {
      errors.push(`${user.email}: ${String(e)}`)
    }
  }

  await supabase.from('worker_runs' as never).insert({
    worker_name: 'morning_briefing',
    status: errors.length === 0 ? 'ok' : sent > 0 ? 'ok' : 'error',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    rows_processed: sent,
    error: errors.length > 0 ? errors.join('; ') : null,
  })

  return new Response(
    JSON.stringify({
      sent,
      skipped_already_sent_today: skippedDup,
      melbourne_hour: melbHour,
      candidate_users: eligibleUsers.length,
      errors,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface BriefingReplyRow {
  id: string
  subject: string | null
  body: string | null
  occurred_at: string
  contact: { full_name: string; venue: { name: string } | null } | null
}

interface BriefingTaskRow {
  id: string
  title: string
  due_at: string | null
  contact: { full_name: string } | null
}

interface BriefingCandidateRow {
  id: string
  name: string | null
  suburb: string | null
  venue_type_guess: string | null
  icp_score_guess: number | null
}

interface BriefingReopeningRow {
  id: string
  detected_at: string
  event_type: string
  evidence_url: string | null
  venue_name: string
  suburb: string | null
  address: string | null
  prior_name: string | null
  prior_licensee: string | null
  new_licensee: string | null
}

async function buildBriefing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  fullName: string,
): Promise<{ html: string; text: string; itemCount: number }> {
  const since18h = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString()
  const since1d = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const now = new Date()
  const todayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
  ).toISOString()

  // 1. Overnight replies
  const { data: repliesData } = await supabase
    .from('activities')
    .select('id, subject, body, occurred_at, contact:contacts(full_name, venue:venues(name))')
    .eq('org_id', orgId)
    .in('activity_type', ['reply_received', 'email_inbound'])
    .is('archived_at', null)
    .gte('occurred_at', since18h)
    .order('occurred_at', { ascending: false })
    .limit(5)
  const replies: BriefingReplyRow[] = repliesData ?? []

  // 2. Tasks due today
  const { data: tasksData } = await supabase
    .from('tasks')
    .select('id, title, due_at, contact:contacts(full_name)')
    .eq('org_id', orgId)
    .lte('due_at', todayEnd)
    .is('completed_at', null)
    .order('due_at')
    .limit(5)
  const tasks: BriefingTaskRow[] = tasksData ?? []

  // 3. New candidates
  const { data: candidatesData } = await supabase
    .from('auto_sourced_candidates')
    .select('id, name, suburb, venue_type_guess, icp_score_guess')
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .gte('created_at', since1d)
    .order('icp_score_guess', { ascending: false })
    .limit(5)
  const candidates: BriefingCandidateRow[] = candidatesData ?? []

  // 3b. Reopened this week — undismissed, unconverted reopening_events
  const since7dReopen = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: reopeningsData } = await supabase
    .from('reopening_events')
    .select(`
      id, detected_at, event_type,
      venue_observation_new:venue_observations!reopening_events_venue_observation_new_fkey(
        venue_name, address, suburb, licensee, evidence_url
      ),
      venue_observation_prior:venue_observations!reopening_events_venue_observation_prior_fkey(
        venue_name, licensee
      )
    `)
    .eq('org_id', orgId)
    .is('dismissed_at', null)
    .is('contact_id', null)
    .gte('detected_at', since7dReopen)
    .order('detected_at', { ascending: false })
    .limit(5)

  type ReopeningRawRow = {
    id: string
    detected_at: string
    event_type: string
    venue_observation_new: {
      venue_name: string
      address: string | null
      suburb: string | null
      licensee: string | null
      evidence_url: string | null
    } | null
    venue_observation_prior: {
      venue_name: string | null
      licensee: string | null
    } | null
  }
  const reopenings: BriefingReopeningRow[] = ((reopeningsData ?? []) as ReopeningRawRow[]).map((r) => ({
    id: r.id,
    detected_at: r.detected_at,
    event_type: r.event_type,
    evidence_url: r.venue_observation_new?.evidence_url ?? null,
    venue_name: r.venue_observation_new?.venue_name ?? 'Unknown venue',
    suburb: r.venue_observation_new?.suburb ?? null,
    address: r.venue_observation_new?.address ?? null,
    prior_name: r.venue_observation_prior?.venue_name ?? null,
    prior_licensee: r.venue_observation_prior?.licensee ?? null,
    new_licensee: r.venue_observation_new?.licensee ?? null,
  }))

  // 4. Jordan Score — mirrors src/lib/metrics/jordanScore.ts (keep in sync).
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const monthStartIso = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  ).toISOString()

  const [
    { count: sentWeek },
    { count: repliesWeek },
    { count: sent30 },
    { count: replies30 },
    { count: meetingsMonth },
  ] = await Promise.all([
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('activity_type', 'email_outbound')
      .gte('occurred_at', since7d),
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .in('activity_type', ['reply_received', 'email_inbound'])
      .gte('occurred_at', since7d),
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('activity_type', 'email_outbound')
      .gte('occurred_at', since30d),
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .in('activity_type', ['reply_received', 'email_inbound'])
      .gte('occurred_at', since30d),
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .in('activity_type', ['meeting_note', 'meeting_booked'])
      .gte('occurred_at', monthStartIso),
  ])

  const weekResponseRate = (sentWeek ?? 0) > 0
    ? Math.round(((repliesWeek ?? 0) / (sentWeek ?? 1)) * 100)
    : 0
  const monthResponseRate = (sent30 ?? 0) > 0
    ? Math.round(((replies30 ?? 0) / (sent30 ?? 1)) * 100)
    : 0
  const meetingsTarget = 15
  const meetingsCount = meetingsMonth ?? 0

  const respComp = Math.max(0, Math.min(100, weekResponseRate))
  const meetComp = Math.max(0, Math.min(100, (meetingsCount / meetingsTarget) * 100))
  const velComp = Math.max(0, Math.min(100, 50 + (weekResponseRate - monthResponseRate) / 2))
  const jordanScore = Math.max(
    0,
    Math.min(100, Math.round(respComp * 0.3 + meetComp * 0.5 + velComp * 0.2)),
  )
  const tier = Math.max(1, Math.min(10, Math.ceil(jordanScore / 10) || 1))
  const tierLabel = jordanScore >= 85
    ? 'Elite'
    : jordanScore >= 70
      ? 'Strong'
      : jordanScore >= 55
        ? 'Solid'
        : jordanScore >= 40
          ? 'Fair'
          : jordanScore >= 20
            ? 'Building'
            : 'Dormant'
  const yesterdayDelta = weekResponseRate - monthResponseRate // proxy — no persisted daily score yet
  const deltaArrow = yesterdayDelta > 0 ? '↗' : yesterdayDelta < 0 ? '↘' : '→'
  const deltaSign = yesterdayDelta > 0 ? '+' : ''
  const deltaColor = yesterdayDelta > 0 ? MINT : yesterdayDelta < 0 ? '#ff7a7a' : INK_DARK_FAINT

  // Meter rail: 8 cells, fill proportional to tier (on 10 scale -> 8 scale).
  const meterFilled = Math.round((tier / 10) * 8)
  const meterCells: string[] = []
  for (let i = 0; i < 8; i++) {
    const on = i < meterFilled
    meterCells.push(
      `<td width="11%" style="padding:0 1px;"><div style="height:6px;background:${on ? MINT : DARK_SEG};border-radius:1px;font-size:0;line-height:0;">&nbsp;</div></td>`,
    )
  }

  const dateStr = new Date().toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Melbourne',
  })
  const firstName = fullName?.split(' ')[0] ?? 'Jordan'

  // Items-needing-attention counter — drives the dynamic subject line.
  const itemCount = replies.length + tasks.length + candidates.length + reopenings.length

  // ── Section rendering ────────────────────────────────────────────
  const emptyRow = (msg: string) => `
    <tr><td style="padding:12px 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${INK_FAINT};">${escapeHtml(msg)}</td></tr>
  `

  const repliesRows = replies.length === 0
    ? emptyRow('No new replies overnight.')
    : replies.map((r) => {
        const name = r.contact?.full_name ?? 'Unknown'
        const venue = r.contact?.venue?.name ?? ''
        const preview = ((r.body ?? '').slice(0, 180).trim()) + ((r.body ?? '').length > 180 ? '…' : '')
        const subj = r.subject ? `<div style="font-family:${FONT};font-size:13px;line-height:20px;color:${INK};font-weight:600;margin-top:2px;">${escapeHtml(r.subject)}</div>` : ''
        return `
          <tr><td style="padding:12px 16px;border-bottom:1px solid ${HAIRLINE};">
            <div style="font-family:${FONT};font-size:13px;line-height:20px;color:${INK};font-weight:600;">${escapeHtml(name)}${
              venue
                ? `<span style="color:${INK_FAINT};font-weight:400;"> &middot; ${escapeHtml(venue)}</span>`
                : ''
            }</div>
            ${subj}
            <div style="font-family:${FONT};font-size:13px;line-height:20px;color:${INK_MUTED};margin-top:4px;word-wrap:break-word;">${escapeHtml(preview)}</div>
          </td></tr>
        `
      }).join('')

  const tasksRows = tasks.length === 0
    ? emptyRow('Nothing due today. ✅')
    : tasks.map((t) => {
        const who = t.contact?.full_name
        return `
          <tr><td style="padding:10px 16px;border-bottom:1px solid ${HAIRLINE};">
            <div style="font-family:${FONT};font-size:13px;line-height:20px;color:${INK};font-weight:500;word-wrap:break-word;">${escapeHtml(t.title)}</div>
            ${
              who
                ? `<div style="font-family:${FONT};font-size:12px;line-height:16px;color:${INK_FAINT};margin-top:2px;">${escapeHtml(who)}</div>`
                : ''
            }
          </td></tr>
        `
      }).join('')

  const reopeningsRows = reopenings.length === 0
    ? emptyRow('No reopenings detected this week.')
    : reopenings.map((r) => {
        const meta: string[] = []
        if (r.suburb) meta.push(escapeHtml(r.suburb))
        if (r.event_type) meta.push(escapeHtml(r.event_type.replace(/_/g, ' ')))
        const metaHtml = meta.length
          ? `<div style="font-family:${FONT};font-size:12px;line-height:16px;color:${INK_FAINT};margin-top:2px;">${meta.join(' &middot; ')}</div>`
          : ''
        const licenseeDelta = (r.prior_licensee && r.new_licensee && r.prior_licensee !== r.new_licensee)
          ? `<div style="font-family:${FONT};font-size:12px;line-height:16px;color:${INK_MUTED};margin-top:2px;"><span style="color:${INK_FAINT};">Licensee:</span> ${escapeHtml(r.prior_licensee)} → ${escapeHtml(r.new_licensee)}</div>`
          : ''
        const nameDelta = (r.prior_name && r.prior_name !== r.venue_name)
          ? `<div style="font-family:${FONT};font-size:12px;line-height:16px;color:${INK_MUTED};margin-top:2px;"><span style="color:${INK_FAINT};">Was:</span> ${escapeHtml(r.prior_name)}</div>`
          : ''
        const evidence = r.evidence_url
          ? `<a href="${escapeHtml(r.evidence_url)}" style="color:${ACCENT};text-decoration:underline;font-size:11px;margin-left:6px;">source</a>`
          : ''
        return `
          <tr><td style="padding:10px 16px;border-bottom:1px solid ${HAIRLINE};">
            <div style="font-family:${FONT};font-size:13px;line-height:20px;color:${INK};font-weight:500;word-wrap:break-word;">${escapeHtml(r.venue_name)}${evidence}</div>
            ${metaHtml}
            ${licenseeDelta}
            ${nameDelta}
          </td></tr>
        `
      }).join('')

  const candidatesRows = candidates.length === 0
    ? emptyRow('No new candidates today.')
    : candidates.map((c) => {
        const name = c.name ?? 'Unnamed venue'
        const meta: string[] = []
        if (c.venue_type_guess) meta.push(escapeHtml(c.venue_type_guess))
        if (c.suburb) meta.push(escapeHtml(c.suburb))
        const metaHtml = meta.length
          ? `<div style="font-family:${FONT};font-size:12px;line-height:16px;color:${INK_FAINT};margin-top:2px;">${meta.join(' &middot; ')}</div>`
          : ''
        const score = c.icp_score_guess != null
          ? `<span style="display:inline-block;background:${WARM_SOFT};color:${WARM_TEXT};font-family:${FONT_MONO};font-variant-numeric:tabular-nums;font-size:11px;font-weight:600;padding:2px 6px;border-radius:3px;border:1px solid ${HAIRLINE};margin-left:6px;vertical-align:middle;">ICP ${c.icp_score_guess}</span>`
          : ''
        return `
          <tr><td style="padding:10px 16px;border-bottom:1px solid ${HAIRLINE};">
            <div style="font-family:${FONT};font-size:13px;line-height:20px;color:${INK};font-weight:500;word-wrap:break-word;">${escapeHtml(name)}${score}</div>
            ${metaHtml}
          </td></tr>
        `
      }).join('')

  const sectionHeader = (iconBg: string, iconText: string, emoji: string, title: string, count: number) => `
    <tr><td style="padding:14px 16px 10px 16px;border-top:1px solid ${HAIRLINE};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="width:28px;">
            <div style="width:24px;height:24px;border-radius:4px;background:${iconBg};color:${iconText};text-align:center;font-size:13px;line-height:24px;">${emoji}</div>
          </td>
          <td style="font-family:${FONT};font-size:11px;line-height:16px;color:${INK_FAINT};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">
            ${escapeHtml(title)}
          </td>
          <td align="right" style="font-family:${FONT_MONO};font-variant-numeric:tabular-nums;font-size:11px;color:${INK_FAINT};">
            ${count}
          </td>
        </tr>
      </table>
    </td></tr>
  `

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Morning Briefing</title>
  <!--[if mso]>
  <style>body, table, td { font-family: Arial, Helvetica, sans-serif !important; }</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${SURFACE_2};font-family:${FONT};color:${INK};">
  <!-- Preheader (hidden, shows in inbox preview) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${SURFACE_2};">
    ${itemCount > 0 ? `${itemCount} ${itemCount === 1 ? 'item needs' : 'items need'} you this morning.` : 'Quiet morning — nothing urgent on the radar.'}
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${SURFACE_2};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${SURFACE_1};border:1px solid ${HAIRLINE};border-radius:6px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:20px 20px 16px 20px;border-bottom:1px solid ${HAIRLINE};">
              <div style="font-family:${FONT};font-size:11px;line-height:16px;color:${INK_FAINT};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">
                ${escapeHtml(dateStr)}
              </div>
              <div style="font-family:${FONT};font-size:20px;line-height:28px;color:${INK};font-weight:600;margin-top:4px;">
                Morning Briefing
              </div>
              <div style="font-family:${FONT};font-size:13px;line-height:20px;color:${INK_MUTED};margin-top:2px;">
                Good morning, ${escapeHtml(firstName)}. Here's what's waiting.
              </div>
            </td>
          </tr>

          <!-- Phase F — Jordan Score dark hero card -->
          <tr>
            <td style="padding:16px 16px 0 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${INK_DARK};border-radius:12px;padding:0;">
                <tr>
                  <td style="padding:20px 22px 18px 22px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-family:${FONT};font-size:10px;line-height:14px;color:${INK_DARK_FAINT};text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">
                          Jordan Score · Today
                        </td>
                        <td align="right" style="font-family:${FONT};font-size:11px;line-height:16px;color:${deltaColor};font-weight:600;">
                          ${deltaArrow} ${deltaSign}${yesterdayDelta}%
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:10px;font-family:${FONT};font-size:13px;line-height:18px;color:${INK_DARK_FAINT};">
                          ${escapeHtml(tierLabel)} · composite performance
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:6px;">
                          <span style="font-family:${FONT_MONO};font-variant-numeric:tabular-nums;font-size:44px;line-height:1;color:#ffffff;font-weight:700;letter-spacing:-0.01em;">${jordanScore}</span><span style="font-family:${FONT_MONO};font-variant-numeric:tabular-nums;font-size:18px;color:${INK_DARK_FAINT};font-weight:600;padding-left:4px;">/100</span>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:14px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                            <tr>${meterCells.join('')}</tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:8px;font-family:${FONT};font-size:11px;line-height:16px;color:${INK_DARK_FAINT};text-transform:uppercase;letter-spacing:0.08em;">
                          Tier ${tier} · ${meetingsCount}/${meetingsTarget} meetings · ${weekResponseRate}% reply rate
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Overnight replies -->
          ${sectionHeader(SUCCESS_SOFT, SUCCESS_TEXT, '💬', 'Overnight Replies', replies.length)}
          ${repliesRows}

          <!-- Follow-ups -->
          ${sectionHeader(ACCENT_SOFT, ACCENT, '📋', 'Follow-ups Due Today', tasks.length)}
          ${tasksRows}

          <!-- Reopened this week -->
          ${sectionHeader('#e8fbf0', '#047857', '📡', 'Reopened This Week', reopenings.length)}
          ${reopeningsRows}

          <!-- Candidates -->
          ${sectionHeader(WARM_SOFT, WARM_TEXT, '🔍', 'New Candidates', candidates.length)}
          ${candidatesRows}

          <!-- CTA -->
          <tr>
            <td style="padding:20px 16px;border-top:1px solid ${HAIRLINE};background:${SURFACE_2};text-align:center;">
              <a href="${APP_URL}/briefing" style="display:inline-block;background:${ACCENT};color:#ffffff;font-family:${FONT};font-size:13px;line-height:20px;font-weight:600;text-decoration:none;padding:8px 16px;border-radius:6px;">
                Open briefing →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 16px 16px 16px;border-top:1px solid ${HAIRLINE};background:${SURFACE_2};">
              <div style="font-family:${FONT};font-size:11px;line-height:16px;color:${INK_FAINT};text-align:center;">
                You're receiving this because morning briefings are on.
                <a href="${APP_URL}/settings?tab=profile&action=pause-briefing" style="color:${INK_FAINT};text-decoration:underline;">Pause for a week</a>
                &middot;
                <a href="${APP_URL}/settings?tab=profile&action=disable-briefing" style="color:${INK_FAINT};text-decoration:underline;">Disable</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  // ── Plain-text fallback ─────────────────────────────────────────
  // Most clients (Gmail mobile, Apple Mail) prefer multipart/alternative
  // and will pick HTML — but a real text part is required for accessibility,
  // spam filters, and a clean "view source" experience.
  const textLines: string[] = []
  textLines.push(`Morning Briefing — ${dateStr}`)
  textLines.push(`Good morning, ${firstName}.`)
  textLines.push('')
  textLines.push(`Jordan Score: ${jordanScore}/100 (${tierLabel}, tier ${tier})`)
  textLines.push(`Meetings: ${meetingsCount}/${meetingsTarget} · Reply rate: ${weekResponseRate}%`)
  textLines.push('')
  textLines.push(`OVERNIGHT REPLIES (${replies.length})`)
  if (replies.length === 0) {
    textLines.push('  - No new replies overnight.')
  } else {
    for (const r of replies) {
      const name = r.contact?.full_name ?? 'Unknown'
      const venue = r.contact?.venue?.name ? ` · ${r.contact.venue.name}` : ''
      const preview = ((r.body ?? '').replace(/\s+/g, ' ').slice(0, 140) || '').trim()
      textLines.push(`  - ${name}${venue}${r.subject ? `: ${r.subject}` : ''}`)
      if (preview) textLines.push(`      "${preview}${(r.body ?? '').length > 140 ? '…' : ''}"`)
    }
  }
  textLines.push('')
  textLines.push(`FOLLOW-UPS DUE TODAY (${tasks.length})`)
  if (tasks.length === 0) {
    textLines.push('  - Nothing due today.')
  } else {
    for (const t of tasks) {
      const who = t.contact?.full_name ? ` (${t.contact.full_name})` : ''
      textLines.push(`  - ${t.title}${who}`)
    }
  }
  textLines.push('')
  textLines.push(`REOPENED THIS WEEK (${reopenings.length})`)
  if (reopenings.length === 0) {
    textLines.push('  - No reopenings detected.')
  } else {
    for (const r of reopenings) {
      const meta = [r.suburb, r.event_type?.replace(/_/g, ' ')].filter(Boolean).join(' · ')
      textLines.push(`  - ${r.venue_name}${meta ? ` (${meta})` : ''}`)
    }
  }
  textLines.push('')
  textLines.push(`NEW CANDIDATES (${candidates.length})`)
  if (candidates.length === 0) {
    textLines.push('  - No new candidates today.')
  } else {
    for (const c of candidates) {
      const meta = [c.venue_type_guess, c.suburb].filter(Boolean).join(' · ')
      const score = c.icp_score_guess != null ? ` [ICP ${c.icp_score_guess}]` : ''
      textLines.push(`  - ${c.name ?? 'Unnamed venue'}${score}${meta ? ` (${meta})` : ''}`)
    }
  }
  textLines.push('')
  textLines.push(`Open briefing: ${APP_URL}/briefing`)
  textLines.push('')
  textLines.push(`Manage preferences: ${APP_URL}/settings?tab=profile`)
  textLines.push(`Pause for a week: ${APP_URL}/settings?tab=profile&action=pause-briefing`)

  return { html, text: textLines.join('\n'), itemCount }
}
