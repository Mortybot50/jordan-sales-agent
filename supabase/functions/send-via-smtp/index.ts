/**
 * send-via-smtp — sends a single email via the caller's encrypted SMTP creds.
 *
 * Modes:
 *   (a) test    — { mode: 'test', email_account_id }
 *                 sends a fixed test message FROM the inbox TO the inbox itself.
 *   (b) manual  — { mode: 'manual', email_account_id, to, subject, html, text?,
 *                  send_queue_id?, contact_id? }
 *                 sends arbitrary content. With `send_queue_id` this is also the
 *                 worker drain-send-queue calls.
 *
 * Week 2 additions:
 *   - Mandatory Spam Act 2003 sender-identification block appended to body
 *     (text + html). Hard 503 if users.spam_act_sender_block is NULL or <20 chars.
 *   - RFC 8058 List-Unsubscribe-Post (one-click) headers, when contact_id +
 *     send_queue_id are both present.
 *   - PII-redacted logs (`<sha256(local)[0..8]>@<domain>`).
 *   - Idempotency: send-queue rows already at status='sent' short-circuit OK.
 *
 * Required Supabase function secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY,
 *   UNSUBSCRIBE_SIGNING_KEY, PUBLIC_APP_URL (optional, defaults)
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// denomailer 1.6.0 — Gmail must use port 465 (implicit TLS), NOT 587/STARTTLS.
// @ts-expect-error Deno remote import
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { decryptToken } from '../_shared/token-crypto.ts'
import { signUnsubTuple } from '../_shared/unsub-token.ts'
import { redactEmail } from '../_shared/pii.ts'
import { initSentry, captureException } from '../_shared/sentry.ts'

initSentry('send-via-smtp')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const PIXEL_BASE_URL = Deno.env.get('PIXEL_BASE_URL') ?? SUPABASE_URL
// @ts-expect-error Deno globals
const UNSUBSCRIBE_SIGNING_KEY = Deno.env.get('UNSUBSCRIBE_SIGNING_KEY') ?? ''

interface SendRequest {
  mode: 'test' | 'manual'
  email_account_id: string
  send_queue_id?: string
  contact_id?: string
  to?: string
  subject?: string
  html?: string
  text?: string
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function buildTrackingPixel(sendQueueId: string): string {
  const url = `${PIXEL_BASE_URL.replace(/\/$/, '')}/functions/v1/pixel-track/${sendQueueId}`
  return `<img src="${url}" width="1" height="1" alt="" style="display:block;max-width:1px;max-height:1px;border:0;outline:none;" />`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' })
  }

  try {
    return await handle(req)
  } catch (err) {
    await captureException(err, { service: 'send-via-smtp', url: req.url })
    return jsonResponse(500, { success: false, error: (err as Error).message })
  }
})

// @ts-expect-error Deno serve — original body extracted so the outer try/catch
// can forward unhandled errors to Sentry without restructuring the existing
// flow. AUDIT-2026-05-28 P1-OBS-02.
async function handle(req: Request): Promise<Response> {

  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return jsonResponse(401, { success: false, error: 'Missing Authorization header' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const userToken = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(userToken)
  if (authError || !user) {
    return jsonResponse(401, { success: false, error: 'Unauthorized' })
  }

  let body: SendRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON body' })
  }

  if (!body.email_account_id) {
    return jsonResponse(400, { success: false, error: 'email_account_id required' })
  }
  if (body.mode !== 'test' && body.mode !== 'manual') {
    return jsonResponse(400, { success: false, error: 'mode must be "test" or "manual"' })
  }
  if (body.mode === 'manual') {
    if (!body.to || !body.subject || !body.html) {
      return jsonResponse(400, { success: false, error: 'manual mode requires to, subject, html' })
    }
  }

  // Idempotency short-circuit: if drain-send-queue calls us twice on the same
  // queue row, the second call must be a no-op (not a duplicate send).
  if (body.send_queue_id) {
    const { data: existing } = await supabase
      .from('email_send_queue')
      .select('id, status')
      .eq('id', body.send_queue_id)
      .maybeSingle()
    if (existing && (existing.status === 'sent' || existing.status === 'failed' || existing.status === 'cancelled')) {
      return jsonResponse(200, {
        success: true,
        idempotent: true,
        status: existing.status,
      })
    }
  }

  const { data: accountRows, error: acctErr } = await supabase.rpc(
    'get_email_account_smtp',
    { p_account_id: body.email_account_id },
  )
  if (acctErr) {
    console.error('get_email_account_smtp failed:', acctErr)
    return jsonResponse(500, { success: false, error: acctErr.message })
  }
  const account = Array.isArray(accountRows) ? accountRows[0] : accountRows
  if (!account) {
    return jsonResponse(404, { success: false, error: 'email_account not found' })
  }

  if (account.user_id !== user.id) {
    return jsonResponse(403, { success: false, error: 'Forbidden' })
  }
  if (account.status === 'paused') {
    return jsonResponse(409, { success: false, error: 'Account is paused' })
  }
  if (!account.smtp_password_encrypted) {
    return jsonResponse(409, { success: false, error: 'SMTP password not set for this account' })
  }

  // ---------- Spam Act 2003 sender-identification gate ---------------------
  // Fetch the user's spam_act_sender_block. Hard-fail if missing/short.
  // Test sends ALSO require the block — the test message goes to the user
  // themselves but the principle (functional unsub, sender ID) stands.
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('spam_act_sender_block, send_timezone')
    .eq('id', account.user_id)
    .maybeSingle()
  if (userErr) {
    console.error('users lookup failed:', userErr.message)
    return jsonResponse(500, { success: false, error: 'user lookup failed' })
  }
  const spamActBlock: string = userRow?.spam_act_sender_block ?? ''
  if (!spamActBlock || spamActBlock.trim().length < 20) {
    return jsonResponse(503, {
      success: false,
      error:
        'Spam Act sender-identification block missing or too short (>=20 chars). ' +
        'Set it in Settings → Email Accounts before sending.',
    })
  }

  if (body.send_queue_id) {
    const { data: queueRow, error: queueErr } = await supabase
      .from('email_send_queue')
      .select('id, org_id, email_account_id')
      .eq('id', body.send_queue_id)
      .maybeSingle()
    if (queueErr) {
      console.error('queue lookup failed:', queueErr)
      return jsonResponse(500, { success: false, error: queueErr.message })
    }
    if (!queueRow) {
      return jsonResponse(404, { success: false, error: 'send_queue row not found' })
    }
    if (queueRow.org_id !== account.org_id || queueRow.email_account_id !== body.email_account_id) {
      return jsonResponse(403, { success: false, error: 'send_queue does not belong to this account' })
    }
  }

  let smtpPassword: string
  try {
    smtpPassword = await decryptToken(account.smtp_password_encrypted)
  } catch (err) {
    console.error('Failed to decrypt SMTP password:', (err as Error).message)
    return jsonResponse(500, { success: false, error: 'Failed to decrypt SMTP credentials' })
  }

  const toAddress = body.mode === 'test' ? account.email_address : body.to!
  const subject =
    body.mode === 'test'
      ? `LeadFlow SMTP test — ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`
      : body.subject!
  const fromName = account.display_name ?? account.email_address
  const fromHeader = `${fromName} <${account.email_address}>`

  const rawHtml =
    body.mode === 'test'
      ? `
        <p>Hi Jordan,</p>
        <p>This is a LeadFlow SMTP test from <strong>${account.email_address}</strong>.</p>
        <p>If you're reading this, the SMTP credentials work.</p>
        <p style="color:#64748b;font-size:12px;">Sent ${new Date().toISOString()}</p>
      `
      : body.html!

  const rawText =
    body.mode === 'test'
      ? `LeadFlow SMTP test from ${account.email_address}. If you're reading this, SMTP works.`
      : (body.text ?? body.html!.replace(/<[^>]+>/g, ''))

  // ---------- Append Spam-Act sender block to both body parts --------------
  const blockText = spamActBlock.trim()
  const finalText = `${rawText}\n\n---\n${blockText}`
  const blockHtml = `<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />
<p style="color:#64748b;font-size:12px;line-height:1.5;margin:0;">${escapeHtml(blockText).replace(/\n/g, '<br/>')}</p>`
  const htmlWithBlock = `${rawHtml}\n${blockHtml}`

  const html = body.send_queue_id
    ? `${htmlWithBlock}\n${buildTrackingPixel(body.send_queue_id)}`
    : htmlWithBlock

  // ---------- RFC 8058 one-click unsubscribe headers -----------------------
  // Generated ONLY when we can verify the (contact, send) tuple later — that
  // requires both ids AND the signing key. For test mode (no contact) we omit.
  const customHeaders: { name: string; value: string }[] = []
  if (
    body.mode === 'manual' &&
    body.contact_id &&
    body.send_queue_id &&
    UNSUBSCRIBE_SIGNING_KEY.length >= 32
  ) {
    try {
      const tok = await signUnsubTuple(body.contact_id, body.send_queue_id, UNSUBSCRIBE_SIGNING_KEY)
      const httpsUrl =
        `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/unsubscribe-post` +
        `?c=${encodeURIComponent(body.contact_id)}&s=${encodeURIComponent(body.send_queue_id)}&t=${tok}`
      const senderDomain = (account.email_address.split('@', 2)[1] ?? '').toLowerCase()
      const mailtoUrl = `mailto:unsub@${senderDomain}?subject=unsubscribe`
      customHeaders.push({ name: 'List-Unsubscribe', value: `<${httpsUrl}>, <${mailtoUrl}>` })
      customHeaders.push({ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' })
    } catch (err) {
      console.warn('unsub-token sign failed (continuing without headers):', (err as Error).message)
    }
  }

  // EDGE-RUNTIME WORKAROUND: force 465 implicit TLS for Gmail (Week 1 PR #63).
  const isGmail = account.smtp_host?.toLowerCase().endsWith('gmail.com') ?? false
  const effectivePort = isGmail ? 465 : account.smtp_port
  const effectiveTls = isGmail ? true : (account.smtp_port === 465)
  const client = new SMTPClient({
    connection: {
      hostname: account.smtp_host,
      port: effectivePort,
      tls: effectiveTls,
      auth: {
        username: account.smtp_username,
        password: smtpPassword,
      },
    },
  })

  let smtpResponse: string | null = null
  // Generate the Message-ID before the send and quote it on the wire as a
  // custom header. Reply clients echo this back in In-Reply-To / References,
  // which is what poll-replies matches on. If we let the SMTP server pick
  // its own Message-ID we can't correlate inbound replies back to the send.
  const smtpMessageId = `<${crypto.randomUUID()}@${account.domain ?? account.email_address.split('@')[1]}>`
  customHeaders.push({ name: 'Message-ID', value: smtpMessageId })

  try {
    const result = await client.send({
      from: fromHeader,
      to: toAddress,
      replyTo: undefined,
      subject,
      content: finalText,
      html,
      headers: customHeaders.length > 0
        ? Object.fromEntries(customHeaders.map((h) => [h.name, h.value]))
        : undefined,
    })
    smtpResponse = result ? JSON.stringify(result).slice(0, 500) : 'ok'
  } catch (err) {
    const message = (err as Error).message ?? 'unknown SMTP error'
    const safeTo = await redactEmail(toAddress)
    console.error('SMTP send failed:', message, 'to=', safeTo)

    if (body.send_queue_id) {
      await supabase.from('email_send_events').insert({
        org_id: account.org_id,
        send_queue_id: body.send_queue_id,
        email_account_id: body.email_account_id,
        event_type: 'failed',
        metadata: { mode: body.mode, error: message.slice(0, 500) },
      })
      await supabase
        .from('email_send_queue')
        .update({ status: 'failed', last_error: message.slice(0, 500) })
        .eq('id', body.send_queue_id)
    }
    try { await client.close() } catch { /* best-effort */ }
    return jsonResponse(502, { success: false, error: message })
  }

  try { await client.close() } catch { /* best-effort */ }

  await supabase
    .from('email_accounts')
    .update({ last_send_at: new Date().toISOString() })
    .eq('id', body.email_account_id)

  const safeToLog = await redactEmail(toAddress)
  await supabase.from('email_send_events').insert({
    org_id: account.org_id,
    send_queue_id: body.send_queue_id ?? null,
    email_account_id: body.email_account_id,
    event_type: 'sent',
    metadata: {
      mode: body.mode,
      to_hashed: safeToLog,
      subject,
      smtp_response: smtpResponse,
      smtp_message_id: smtpMessageId,
      had_list_unsubscribe: customHeaders.length > 0,
    },
  })

  if (body.send_queue_id) {
    await supabase
      .from('email_send_queue')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        smtp_response: smtpResponse,
        smtp_message_id: smtpMessageId,
      })
      .eq('id', body.send_queue_id)
  }

  return jsonResponse(200, {
    success: true,
    smtp_message_id: smtpMessageId,
    smtp_response: smtpResponse,
  })
}
