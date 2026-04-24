/**
 * generate-learning-digest — Supabase Edge Function
 *
 * Weekly "Option B" Learning Loop worker. Pulls the last 7 days of edited
 * drafts per user, asks Claude to identify recurring patterns, stores a
 * learning_digests row with the proposed voice rules, and emails the user.
 *
 * Invocation:
 *   POST { user_id: uuid }        — run for a single user
 *   POST { all: true }            — iterate every user (used by pg_cron)
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY              — required; fail loud if absent
 *   RESEND_API_KEY                 — optional; if absent, digest is saved
 *                                    but email step is skipped with a log
 *   VITE_SUPABASE_URL / SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   LEARNING_MIN_DRAFTS            — optional; default 3
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
// @ts-expect-error Deno globals
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const MIN_DRAFTS = parseInt(Deno.env.get('LEARNING_MIN_DRAFTS') ?? '3', 10)

const MODEL = 'claude-sonnet-4-6'
const FROM_ADDRESS = 'Jordan Briefing <briefing@jordan.purezza.com.au>'
const APP_URL = 'https://jordan-sales-agent.vercel.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DraftRow {
  id: string
  original_subject: string | null
  original_body: string | null
  edited_subject: string | null
  edited_body: string | null
  subject: string | null
  body: string | null
  edit_logged_at: string | null
}

interface ProposedRule {
  id: string
  text: string
  evidence_drafts: string[]
  status: 'pending' | 'approved' | 'rejected'
  decided_at: string | null
}

// @ts-expect-error Deno serve
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let payload: { user_id?: string; all?: boolean } = {}
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }

  // Resolve the target user(s)
  let userIds: string[] = []
  if (payload.all) {
    const { data: users, error } = await supabase
      .from('users')
      .select('id')
      .not('email', 'is', null)
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    userIds = (users ?? []).map((u: { id: string }) => u.id)
  } else if (payload.user_id) {
    userIds = [payload.user_id]
  } else {
    return new Response(
      JSON.stringify({ error: 'Expected { user_id } or { all: true }' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const results: Array<{ user_id: string; status: string; [k: string]: unknown }> = []

  for (const userId of userIds) {
    try {
      const result = await runForUser(supabase, userId)
      results.push({ user_id: userId, ...result })
    } catch (e) {
      console.error(`[learning-digest] user=${userId} error:`, e)
      results.push({ user_id: userId, status: 'error', error: String(e) })
    }
  }

  return new Response(JSON.stringify({ results, min_drafts: MIN_DRAFTS }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

async function runForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<{ status: string; [k: string]: unknown }> {
  // Resolve user + org + email
  const { data: userRow } = await supabase
    .from('users')
    .select('id, org_id, email, full_name')
    .eq('id', userId)
    .single()

  if (!userRow) return { status: 'skipped', reason: 'user not found' }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Pull drafts edited in the last 7 days
  const { data: drafts } = await supabase
    .from('email_drafts')
    .select('id, original_subject, original_body, edited_subject, edited_body, subject, body, edit_logged_at')
    .eq('org_id', userRow.org_id)
    .gte('edit_logged_at', sevenDaysAgo)
    .or('edited_subject.not.is.null,edited_body.not.is.null')
    .order('edit_logged_at', { ascending: false })

  const editedDrafts: DraftRow[] = (drafts ?? []) as DraftRow[]

  if (editedDrafts.length < MIN_DRAFTS) {
    return {
      status: 'skipped',
      reason: `fewer than ${MIN_DRAFTS} edited drafts (found ${editedDrafts.length})`,
    }
  }

  // Build Claude prompt
  const draftBlocks = editedDrafts.map((d, i) => {
    const origSubj = d.original_subject ?? ''
    const origBody = d.original_body ?? ''
    const sentSubj = d.edited_subject ?? d.subject ?? origSubj
    const sentBody = d.edited_body ?? d.body ?? origBody
    return `DRAFT ${i + 1} (id: ${d.id}):
--- Claude wrote ---
Subject: ${origSubj}
${origBody}
--- Rep sent ---
Subject: ${sentSubj}
${sentBody}`
  }).join('\n\n')

  const prompt = `You are analysing a sales rep's editing patterns over the last 7 days.
For each draft you generated, here is what you wrote vs what the rep actually sent:

${draftBlocks}

Task: Identify 1–5 consistent patterns in the rep's edits.
For each pattern, write a single short voice-rule sentence the rep could add to prevent the edit in future drafts.
Rules should be specific, actionable, plain English, under 20 words each.
Do NOT propose rules based on a single draft — only propose a rule if you see the pattern in at least 2 drafts.
For each rule, list the draft IDs that evidence it.

Output JSON only, no prose:
{ "rules": [ { "text": "...", "evidence_drafts": ["uuid","uuid"] }, ... ] }`

  // Call Anthropic
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text()
    throw new Error(`Anthropic ${anthropicRes.status}: ${errText}`)
  }

  const anthropicData = await anthropicRes.json()
  const raw = anthropicData.content?.[0]?.text ?? ''
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned) as { rules: Array<{ text: string; evidence_drafts: string[] }> }
  const rawRules = Array.isArray(parsed.rules) ? parsed.rules : []

  const proposedRules: ProposedRule[] = rawRules.map((r) => ({
    id: crypto.randomUUID(),
    text: String(r.text ?? '').trim(),
    evidence_drafts: Array.isArray(r.evidence_drafts) ? r.evidence_drafts.map(String) : [],
    status: 'pending',
    decided_at: null,
  })).filter((r) => r.text.length > 0)

  // Week bounds (Monday-to-Sunday, ISO week ending yesterday)
  const today = new Date()
  const weekEnd = new Date(today)
  weekEnd.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7) - 1) // Sunday just past
  const weekStart = new Date(weekEnd)
  weekStart.setUTCDate(weekEnd.getUTCDate() - 6)

  // Insert digest
  const { data: digest, error: insertErr } = await supabase
    .from('learning_digests')
    .insert({
      org_id: userRow.org_id,
      user_id: userRow.id,
      week_start: weekStart.toISOString().slice(0, 10),
      week_end: weekEnd.toISOString().slice(0, 10),
      drafts_analysed: editedDrafts.length,
      proposed_rules: proposedRules,
      status: proposedRules.length === 0 ? 'dismissed' : 'pending',
    })
    .select()
    .single()

  if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`)

  // Email (optional — skip if Resend not configured or no rules to propose)
  let emailStatus = 'skipped'
  if (!RESEND_API_KEY) {
    console.log('Resend key missing, email skipped')
    emailStatus = 'resend_missing'
  } else if (proposedRules.length === 0) {
    emailStatus = 'no_rules_no_email'
  } else if (!userRow.email) {
    emailStatus = 'no_email_on_user'
  } else {
    try {
      const html = buildEmailHtml({
        firstName: (userRow.full_name ?? 'there').split(' ')[0],
        editedCount: editedDrafts.length,
        rules: proposedRules,
        digestId: digest.id,
      })
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [userRow.email],
          subject: 'LeadFlow — your weekly rule proposals',
          html,
        }),
      })
      if (!res.ok) {
        emailStatus = `resend_error_${res.status}`
        console.error('Resend error', await res.text())
      } else {
        emailStatus = 'sent'
        await supabase
          .from('learning_digests')
          .update({ email_sent_at: new Date().toISOString() })
          .eq('id', digest.id)
      }
    } catch (e) {
      emailStatus = `resend_throw_${String(e).slice(0, 80)}`
    }
  }

  return {
    status: 'created',
    digest_id: digest.id,
    drafts_analysed: editedDrafts.length,
    rules_proposed: proposedRules.length,
    email: emailStatus,
  }
}

function buildEmailHtml(args: {
  firstName: string
  editedCount: number
  rules: ProposedRule[]
  digestId: string
}): string {
  const rulesList = args.rules
    .map((r, i) => `<li style="margin-bottom:8px;">${escapeHtml(`${i + 1}. ${r.text}`)}</li>`)
    .join('')

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;background:#fafbfc;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center" style="max-width:600px;background:#ffffff;border:1px solid #e4e7eb;border-radius:6px;">
    <tr><td style="padding:24px;">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">LeadFlow · Weekly Learning</div>
      <div style="font-size:20px;font-weight:600;margin-top:6px;">Your weekly rule proposals</div>
      <p style="font-size:14px;line-height:22px;color:#334155;margin-top:14px;">
        Hi ${escapeHtml(args.firstName)},
      </p>
      <p style="font-size:14px;line-height:22px;color:#334155;">
        You edited <strong>${args.editedCount}</strong> of my drafts before sending last week. Here are <strong>${args.rules.length}</strong> consistent patterns I noticed — adding these to your voice rules would stop the repeat edits:
      </p>
      <ol style="font-size:14px;line-height:22px;color:#0f172a;padding-left:20px;">
        ${rulesList}
      </ol>
      <div style="margin-top:20px;">
        <a href="${APP_URL}/drafts?learning=${encodeURIComponent(args.digestId)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:6px;">
          Review &amp; approve →
        </a>
      </div>
      <p style="font-size:12px;color:#64748b;margin-top:24px;">
        Approve any rule to add it to your Voice &amp; Style Rules automatically. Reject to dismiss.
      </p>
    </td></tr>
  </table>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
