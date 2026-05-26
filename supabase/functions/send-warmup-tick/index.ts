/**
 * send-warmup-tick — inter-inbox warmup sender (cron-driven).
 *
 * Closes the GATE-WARM gap from the 2026-05-26 audit: PR #64 shipped the
 * warmup schema + 200 templates but no worker. Without warmup traffic our 4
 * brand-new mailboxes look brand-new to Gmail, and cold-send week 1 torches
 * the domain reputation. This function fires the inter-inbox conversations
 * that make the mailboxes look established.
 *
 * Two modes:
 *   (a) tick   (default, from pg_cron)
 *       Body: {} or {"mode":"tick"}
 *       For each eligible inbox: bump warmup_day (once per AEST day), check
 *       today's warmup-send count vs daily quota, pick the
 *       oldest-untouched warmup_thread, render a random warmup_message,
 *       send.
 *
 *   (b) reply  (from poll-replies, when a warmup arrives and we roll a
 *               40% auto-reply)
 *       Body: {
 *         mode: 'reply',
 *         sender_account_id, recipient_account_id,
 *         in_reply_to_message_id, references, original_subject
 *       }
 *       Single targeted send, threaded with In-Reply-To / References so
 *       Gmail renders it as part of the same conversation.
 *
 * Quiet hours. The cron schedule runs every 30 min UTC; this function
 * gates against Australia/Melbourne local time and only sends 09:00-17:00,
 * Mon-Fri. Outside that window we early-return `{ skipped: true }` so the
 * cron tick is cheap.
 *
 * Quota. Daily quota per inbox = min(1 + warmup_day, 10). Day 1 = 2 sends,
 * Day 2 = 3, +1/day to Day 9 = 10, capped at 10 thereafter.
 *
 * Spam-trap defence:
 *   - Every warmup send carries `X-LeadFlow-Warmup: 1` so the IMAP poller
 *     can short-circuit warmup traffic out of the real-reply pipeline.
 *   - No tracking pixel, no unsubscribe footer, no Spam-Act block — these
 *     are inbox-to-inbox messages between accounts the operator owns; the
 *     Spam Act applies to commercial messages, which these are not.
 *   - Subject + body come straight from warmup_messages (conversational
 *     templates seeded in PR #64). No marketing language.
 *
 * Auth: service-role JWT (cron posts with vault-sourced bearer). Function
 * is verify_jwt=true at the gateway; we additionally enforce role='service_role'
 * via _shared/auth.ts.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-expect-error Deno remote import
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { decryptToken } from '../_shared/token-crypto.ts'
import { redactEmail } from '../_shared/pii.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const WARMUP_HEADER = 'X-LeadFlow-Warmup'
const QUIET_HOURS_START_LOCAL = 9   // 09:00 Australia/Melbourne
const QUIET_HOURS_END_LOCAL = 17    // up to (not including) 17:00 — last tick at 16:30
const PER_ACCOUNT_WALL_MS = 15_000  // cap one tick at ~15s/inbox; cron runs again in 30 min

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---- Australia/Melbourne time helpers --------------------------------------

interface MelbourneNow {
  hour: number          // 0-23
  weekday: number       // 0=Sun..6=Sat
  isoDate: string       // YYYY-MM-DD in Australia/Melbourne
  startOfDayUtcIso: string  // midnight Australia/Melbourne expressed in UTC
}

/**
 * Get the current wall-clock in Australia/Melbourne. We use Intl.DateTimeFormat
 * because Deno Edge supports the full ICU tables. Avoids manually tracking
 * AEST/AEDT DST transitions.
 */
function melbourneNow(now: Date = new Date()): MelbourneNow {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekdayShort = get('weekday')  // e.g. "Mon"
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const weekday = weekdayMap[weekdayShort] ?? -1
  const isoDate = `${get('year')}-${get('month')}-${get('day')}`
  const hour = parseInt(get('hour'), 10)

  // Compute midnight-local-Australia/Melbourne as an absolute UTC timestamp.
  // We do this by formatting the offset for the *current* instant and applying
  // it to the local date. This is robust across DST transitions because we
  // only need it for "today's start" — well clear of any 02:00→03:00 jump.
  const offsetFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Melbourne',
    timeZoneName: 'shortOffset',
  })
  const offsetStr = offsetFmt.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+10'
  // offsetStr looks like "GMT+10" or "GMT+11". Parse to a +HH:00 ISO suffix.
  const offsetMatch = offsetStr.match(/GMT([+\-]?\d+)/)
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : 10
  const sign = offsetHours >= 0 ? '+' : '-'
  const isoOffset = `${sign}${Math.abs(offsetHours).toString().padStart(2, '0')}:00`
  const startOfDayUtcIso = new Date(`${isoDate}T00:00:00${isoOffset}`).toISOString()

  return { hour, weekday, isoDate, startOfDayUtcIso }
}

function isWithinQuietHours(mel: MelbourneNow): boolean {
  // Weekday: Mon=1..Fri=5
  if (mel.weekday < 1 || mel.weekday > 5) return false
  if (mel.hour < QUIET_HOURS_START_LOCAL || mel.hour >= QUIET_HOURS_END_LOCAL) return false
  return true
}

// ---- Body / subject helpers ------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

// ---- Types ----------------------------------------------------------------

interface AccountRow {
  id: string
  org_id: string
  user_id: string
  email_address: string
  smtp_host: string | null
  smtp_username: string
  smtp_password_encrypted: string | null
  status: string
  warmup_day: number
  warmup_day_bumped_on: string | null
  last_warmup_send_at: string | null
}

interface ThreadRow {
  id: string
  org_id: string
  sender_account_id: string
  recipient_account_id: string
  last_send_at: string | null
}

interface WarmupMessageRow {
  id: string
  kind: string
  subject: string | null
  body: string
}

interface ReplyModeBody {
  mode: 'reply'
  sender_account_id: string
  recipient_account_id: string
  in_reply_to_message_id?: string
  references?: string[]
  original_subject?: string
}

interface TickModeBody {
  mode?: 'tick'
}

// ---- Main handler ----------------------------------------------------------

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed' })
  }

  const unauthorized = await requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let body: ReplyModeBody | TickModeBody = {}
  try {
    body = await req.json() as ReplyModeBody | TickModeBody
  } catch {
    body = {}
  }

  // Quiet-hours gate applies to BOTH modes — we never want to send warmup
  // (or warmup replies) at 3am, even if poll-replies happens to fire then.
  const mel = melbourneNow()
  if (!isWithinQuietHours(mel)) {
    return json(200, {
      success: true,
      skipped: true,
      reason: 'outside_quiet_hours',
      melbourne: { hour: mel.hour, weekday: mel.weekday, date: mel.isoDate },
    })
  }

  if ('mode' in body && body.mode === 'reply') {
    return await handleReply(supabase, body, mel)
  }
  return await handleTick(supabase, mel)
})

// ---- Tick mode -------------------------------------------------------------

async function handleTick(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  mel: MelbourneNow,
): Promise<Response> {
  const { data: accounts, error: acctErr } = await supabase
    .from('email_accounts')
    .select('id, org_id, user_id, email_address, smtp_host, smtp_username, smtp_password_encrypted, status, warmup_day, warmup_day_bumped_on, last_warmup_send_at')
    .in('status', ['active', 'warming'])
    .not('smtp_password_encrypted', 'is', null)

  if (acctErr) {
    return json(500, { success: false, error: acctErr.message })
  }
  if (!accounts || accounts.length === 0) {
    return json(200, { success: true, accounts: 0, sent: 0 })
  }

  let totalSent = 0
  let totalSkipped = 0
  const perAccount: { email: string; result: string }[] = []

  for (const account of accounts as AccountRow[]) {
    const accountDeadline = Date.now() + PER_ACCOUNT_WALL_MS
    try {
      // 1. Bump warmup_day if not yet bumped today (Melbourne local date).
      const bumpedToday = account.warmup_day_bumped_on === mel.isoDate
      const targetDay = bumpedToday
        ? account.warmup_day
        : Math.min(account.warmup_day + 1, 14)

      if (!bumpedToday) {
        await supabase
          .from('email_accounts')
          .update({ warmup_day: targetDay, warmup_day_bumped_on: mel.isoDate })
          .eq('id', account.id)
      }

      // 2. Compute today's quota and today's actual count.
      const dailyQuota = Math.min(1 + targetDay, 10)
      const { count: todaysCount, error: countErr } = await supabase
        .from('email_send_events')
        .select('id', { count: 'exact', head: true })
        .eq('email_account_id', account.id)
        .eq('event_type', 'sent')
        .gte('event_at', mel.startOfDayUtcIso)
        .contains('metadata', { kind: 'warmup' })

      if (countErr) {
        perAccount.push({ email: account.email_address, result: `count_err: ${countErr.message}` })
        continue
      }
      if ((todaysCount ?? 0) >= dailyQuota) {
        totalSkipped++
        perAccount.push({ email: account.email_address, result: `quota_met (${todaysCount}/${dailyQuota})` })
        continue
      }

      // 3. Pick the oldest-untouched active warmup_thread for this sender.
      //    NULLS FIRST puts never-sent pairs at the front of the queue.
      const { data: threads, error: threadErr } = await supabase
        .from('warmup_threads')
        .select('id, org_id, sender_account_id, recipient_account_id, last_send_at')
        .eq('sender_account_id', account.id)
        .eq('status', 'active')
        .order('last_send_at', { ascending: true, nullsFirst: true })
        .limit(1)

      if (threadErr) {
        perAccount.push({ email: account.email_address, result: `thread_err: ${threadErr.message}` })
        continue
      }
      const thread = (threads ?? [])[0] as ThreadRow | undefined
      if (!thread) {
        perAccount.push({ email: account.email_address, result: 'no_active_thread' })
        continue
      }

      if (Date.now() > accountDeadline) {
        perAccount.push({ email: account.email_address, result: 'deadline_hit_pre_send' })
        continue
      }

      // 4. Look up recipient address.
      const { data: recipient } = await supabase
        .from('email_accounts')
        .select('email_address')
        .eq('id', thread.recipient_account_id)
        .maybeSingle()
      if (!recipient?.email_address) {
        perAccount.push({ email: account.email_address, result: 'recipient_missing' })
        continue
      }

      // 5. Pick a random warmup_message (intro / casual / followup — exclude
      //    'reply' kind, which is only used in reply mode).
      const tpl = await pickWarmupTemplate(supabase, ['intro', 'casual', 'followup'])
      if (!tpl) {
        perAccount.push({ email: account.email_address, result: 'no_template' })
        continue
      }

      // 6. Send.
      const sendResult = await sendWarmupEmail(supabase, {
        senderAccount: account,
        recipientEmail: recipient.email_address,
        subject: tpl.subject ?? '(no subject)',
        textBody: tpl.body,
        templateId: tpl.id,
        threadId: thread.id,
        inReplyToMessageId: null,
        references: [],
      })

      if (sendResult.ok) {
        totalSent++
        perAccount.push({ email: account.email_address, result: `sent (day ${targetDay}, ${(todaysCount ?? 0) + 1}/${dailyQuota})` })
      } else {
        perAccount.push({ email: account.email_address, result: `send_err: ${sendResult.error}` })
      }
    } catch (err) {
      perAccount.push({ email: account.email_address, result: `threw: ${(err as Error).message.slice(0, 200)}` })
    }
  }

  return json(200, {
    success: true,
    mode: 'tick',
    accounts: accounts.length,
    sent: totalSent,
    skipped: totalSkipped,
    per_account: perAccount,
    melbourne: { hour: mel.hour, weekday: mel.weekday, date: mel.isoDate },
  })
}

// ---- Reply mode ------------------------------------------------------------

async function handleReply(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  body: ReplyModeBody,
  _mel: MelbourneNow,
): Promise<Response> {
  if (!body.sender_account_id || !body.recipient_account_id) {
    return json(400, { success: false, error: 'sender_account_id + recipient_account_id required' })
  }

  const { data: account } = await supabase
    .from('email_accounts')
    .select('id, org_id, user_id, email_address, smtp_host, smtp_username, smtp_password_encrypted, status, warmup_day, warmup_day_bumped_on, last_warmup_send_at')
    .eq('id', body.sender_account_id)
    .maybeSingle()
  if (!account || !account.smtp_password_encrypted) {
    return json(404, { success: false, error: 'sender account missing or no SMTP' })
  }
  if (account.status !== 'active' && account.status !== 'warming') {
    return json(409, { success: false, error: `sender account status=${account.status}` })
  }

  const { data: recipient } = await supabase
    .from('email_accounts')
    .select('email_address, org_id')
    .eq('id', body.recipient_account_id)
    .maybeSingle()
  if (!recipient?.email_address) {
    return json(404, { success: false, error: 'recipient missing' })
  }
  if (recipient.org_id !== account.org_id) {
    return json(403, { success: false, error: 'cross-org reply rejected' })
  }

  // Locate the reverse direction thread (sender→recipient). This is the
  // thread whose last_send_at we should bump for the auto-reply.
  const { data: thread } = await supabase
    .from('warmup_threads')
    .select('id')
    .eq('sender_account_id', body.sender_account_id)
    .eq('recipient_account_id', body.recipient_account_id)
    .maybeSingle()

  // Pick a 'reply' template (Re: <subject>, conversational body).
  const tpl = await pickWarmupTemplate(supabase, ['reply'])
  if (!tpl) {
    return json(500, { success: false, error: 'no reply template' })
  }
  // Prefer threading off the original subject so Gmail collapses the conversation.
  const replySubject = body.original_subject
    ? (body.original_subject.toLowerCase().startsWith('re:')
        ? body.original_subject
        : `Re: ${body.original_subject}`)
    : (tpl.subject ?? 'Re: (no subject)')

  const sendResult = await sendWarmupEmail(supabase, {
    senderAccount: account as AccountRow,
    recipientEmail: recipient.email_address,
    subject: replySubject,
    textBody: tpl.body,
    templateId: tpl.id,
    threadId: thread?.id ?? null,
    inReplyToMessageId: body.in_reply_to_message_id ?? null,
    references: body.references ?? (body.in_reply_to_message_id ? [body.in_reply_to_message_id] : []),
  })

  return json(sendResult.ok ? 200 : 502, {
    success: sendResult.ok,
    mode: 'reply',
    error: sendResult.ok ? undefined : sendResult.error,
    smtp_message_id: sendResult.ok ? sendResult.messageId : undefined,
  })
}

// ---- Send primitive --------------------------------------------------------

interface SendArgs {
  senderAccount: AccountRow
  recipientEmail: string
  subject: string
  textBody: string
  templateId: string
  threadId: string | null
  inReplyToMessageId: string | null
  references: string[]
}

interface SendResult {
  ok: boolean
  error?: string
  messageId?: string
}

async function sendWarmupEmail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: SendArgs,
): Promise<SendResult> {
  const acct = args.senderAccount
  if (!acct.smtp_password_encrypted) {
    return { ok: false, error: 'no smtp password' }
  }

  let smtpPassword: string
  try {
    smtpPassword = await decryptToken(acct.smtp_password_encrypted)
  } catch (err) {
    return { ok: false, error: `decrypt: ${(err as Error).message}` }
  }

  const fromHeader = `${acct.email_address} <${acct.email_address}>`
  const htmlBody = textToHtml(args.textBody)

  const domain = acct.email_address.split('@', 2)[1] ?? 'localhost'
  const smtpMessageId = `<${crypto.randomUUID()}@${domain}>`

  const customHeaders: Record<string, string> = {
    [WARMUP_HEADER]: '1',
    'Message-ID': smtpMessageId,
  }
  if (args.inReplyToMessageId) {
    const wrapped = args.inReplyToMessageId.startsWith('<')
      ? args.inReplyToMessageId
      : `<${args.inReplyToMessageId}>`
    customHeaders['In-Reply-To'] = wrapped
  }
  if (args.references.length > 0) {
    customHeaders['References'] = args.references
      .map((r) => (r.startsWith('<') ? r : `<${r}>`))
      .join(' ')
  }

  // Gmail SMTP: port 465 implicit TLS only (Week 1 PR #63 finding).
  const host = (acct.smtp_host ?? 'smtp.gmail.com').toLowerCase()
  const isGmail = host.endsWith('gmail.com')
  const port = isGmail ? 465 : 587
  const tls = isGmail ? true : false

  const client = new SMTPClient({
    connection: {
      hostname: acct.smtp_host ?? 'smtp.gmail.com',
      port,
      tls,
      auth: { username: acct.smtp_username, password: smtpPassword },
    },
  })

  try {
    await client.send({
      from: fromHeader,
      to: args.recipientEmail,
      subject: args.subject,
      content: args.textBody,
      html: htmlBody,
      headers: customHeaders,
    })
  } catch (err) {
    const msg = (err as Error).message ?? 'unknown SMTP error'
    const safeTo = await redactEmail(args.recipientEmail)
    console.error('warmup SMTP fail:', msg, 'to=', safeTo)
    try { await client.close() } catch { /* ignore */ }
    // Log a failed event so the dashboard can surface warmup health.
    await supabase.from('email_send_events').insert({
      org_id: acct.org_id,
      email_account_id: acct.id,
      event_type: 'failed',
      metadata: {
        kind: 'warmup',
        reason: 'smtp_send',
        error: msg.slice(0, 500),
        warmup_thread_id: args.threadId,
        warmup_template_id: args.templateId,
        to_hashed: safeTo,
      },
    })
    return { ok: false, error: msg.slice(0, 300) }
  }
  try { await client.close() } catch { /* ignore */ }

  // Post-send bookkeeping. All three writes are best-effort — if any one
  // fails we still want the event log to record the SEND that actually
  // happened, so we run them sequentially and don't abort on partial
  // failure.
  const safeTo = await redactEmail(args.recipientEmail)
  const nowIso = new Date().toISOString()

  await supabase
    .from('email_accounts')
    .update({ last_warmup_send_at: nowIso })
    .eq('id', acct.id)

  if (args.threadId) {
    // Increment send_count atomically via PostgREST's RPC fallback would
    // require a custom function; for the warmup tick we accept a read-
    // modify-write race (two cron ticks in the same 30-min slot is
    // exceedingly unlikely, and the value is cosmetic, not load-bearing).
    const { data: cur } = await supabase
      .from('warmup_threads')
      .select('send_count')
      .eq('id', args.threadId)
      .maybeSingle()
    await supabase
      .from('warmup_threads')
      .update({
        last_send_at: nowIso,
        send_count: (cur?.send_count ?? 0) + 1,
      })
      .eq('id', args.threadId)
  }

  await supabase.from('email_send_events').insert({
    org_id: acct.org_id,
    email_account_id: acct.id,
    event_type: 'sent',
    metadata: {
      kind: 'warmup',
      mode: args.inReplyToMessageId ? 'reply' : 'tick',
      to_hashed: safeTo,
      subject: args.subject.slice(0, 200),
      smtp_message_id: smtpMessageId,
      warmup_thread_id: args.threadId,
      warmup_template_id: args.templateId,
      in_reply_to: args.inReplyToMessageId,
    },
  })

  return { ok: true, messageId: smtpMessageId }
}

// ---- Template picker -------------------------------------------------------

async function pickWarmupTemplate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  kinds: string[],
): Promise<WarmupMessageRow | null> {
  // Pick a random active template of one of the requested kinds. We do this
  // with a small over-fetch + JS-side random pick to avoid pg's ORDER BY
  // RANDOM() cost on every tick. With 200 templates and ~50 per kind, an
  // over-fetch of 50 keeps us out of any hot-row pattern.
  const { data: candidates, error } = await supabase
    .from('warmup_messages')
    .select('id, kind, subject, body')
    .eq('active', true)
    .in('kind', kinds)
    .limit(50)
  if (error || !candidates || candidates.length === 0) return null
  const idx = Math.floor(Math.random() * candidates.length)
  return candidates[idx] as WarmupMessageRow
}
