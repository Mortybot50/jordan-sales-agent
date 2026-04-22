/**
 * send-morning-briefing — Supabase Edge Function
 *
 * Sends a morning briefing email digest to every user with
 * email_notifications.morning_briefing !== false.
 *
 * Phase C restyle (2026-04-22): HTML template now matches the in-app
 * Jordan visual language — Inter (with Helvetica fallback for email
 * clients that lack variable-font support), hairline borders, electric
 * blue `#2563eb` accents, tabular numerals in data blocks, 600px max
 * width, inline styles only, single-column responsive.
 *
 * Designed to be triggered via Supabase cron at 7am AEST (21:00 UTC prev day):
 *   SELECT cron.schedule('morning-briefing', '0 21 * * *', $$
 *     SELECT net.http_post(
 *       url := current_setting('app.supabase_url') || '/functions/v1/send-morning-briefing',
 *       headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
 *       body := '{}'::jsonb
 *     );
 *   $$);
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
// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const FROM_ADDRESS = 'Jordan Briefing <briefing@jordan.purezza.com.au>'

// ── Jordan design tokens (inline — email-safe subset) ──────────────
// Phase F "Dark Anchor" adds INK_DARK + MINT for the hero card at top.
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

// @ts-expect-error Deno serve
Deno.serve(async () => {
  const startedAt = new Date().toISOString()
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

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

  // Fetch all users who want morning briefings
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, org_id, email, full_name, email_notifications')
    .not('email', 'is', null)

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

  const eligibleUsers = (users ?? []).filter((u: { email_notifications: unknown }) => {
    const notif = (u.email_notifications as { morning_briefing?: boolean } | null) ?? {}
    return notif.morning_briefing !== false
  })

  let sent = 0
  const errors: string[] = []

  for (const user of eligibleUsers) {
    try {
      const html = await buildBriefingHtml(supabase, user.org_id, user.full_name)
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [user.email],
          subject: `Morning Briefing — ${new Date().toLocaleDateString('en-AU', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            timeZone: 'Australia/Melbourne',
          })}`,
          html,
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        errors.push(`${user.email}: ${res.status} ${body}`)
      } else {
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

  return new Response(JSON.stringify({ sent, errors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
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

async function buildBriefingHtml(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  fullName: string,
): Promise<string> {
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

  return `<!DOCTYPE html>
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

          <!-- Candidates -->
          ${sectionHeader(WARM_SOFT, WARM_TEXT, '🔍', 'New Candidates', candidates.length)}
          ${candidatesRows}

          <!-- CTA -->
          <tr>
            <td style="padding:20px 16px;border-top:1px solid ${HAIRLINE};background:${SURFACE_2};text-align:center;">
              <a href="https://jordan-sales-agent.vercel.app/briefing" style="display:inline-block;background:${ACCENT};color:#ffffff;font-family:${FONT};font-size:13px;line-height:20px;font-weight:600;text-decoration:none;padding:8px 16px;border-radius:6px;">
                Open briefing →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 16px 16px 16px;border-top:1px solid ${HAIRLINE};background:${SURFACE_2};">
              <div style="font-family:${FONT};font-size:11px;line-height:16px;color:${INK_FAINT};text-align:center;">
                Jordan Sales Agent &middot; Sent at 7am AEST.
                <a href="https://jordan-sales-agent.vercel.app/settings" style="color:${INK_FAINT};text-decoration:underline;">Manage preferences</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
