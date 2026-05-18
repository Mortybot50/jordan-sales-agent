/**
 * send-via-smtp — sends a single email via the caller's encrypted SMTP creds.
 *
 * Used Week 1 for two flows:
 *   (a) Test connection: { mode: 'test', email_account_id }
 *       — sends a fixed test message FROM the inbox TO the inbox itself,
 *         so Jordan can verify the SMTP auth works without touching contacts.
 *   (b) Manual send:     { mode: 'manual', email_account_id, to, subject, html, text? }
 *       — sends arbitrary content. Used by the "Send Now via [inbox]" UI in
 *         Week 1; later this is the worker called by drain-send-queue.
 *
 * Both flows insert an `email_send_events` row of type='sent' on success
 * (with metadata.mode marking which flow it was) so the analytics surface
 * picks them up uniformly.
 *
 * Tracking pixel is injected ONLY when send_queue_id is provided AND
 * PUBLIC_APP_URL is set — the test flow has no queue row so no pixel.
 *
 * Required Supabase function secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY
 *   PUBLIC_APP_URL  optional — for tracking-pixel URL
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// denomailer — Deno-native SMTP client used here for STARTTLS + auth.
// Pinned to a known-good tag.
// @ts-expect-error Deno remote import
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { decryptToken } from '../_shared/token-crypto.ts'

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
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') ?? 'https://jordan-sales-agent.vercel.app'

interface SendRequest {
  mode: 'test' | 'manual'
  email_account_id: string
  send_queue_id?: string
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
  const url = `${PUBLIC_APP_URL.replace(/\/$/, '')}/functions/v1/pixel-track/${sendQueueId}`
  // 1×1 transparent gif served by pixel-track. Inline-styled to dodge image-block
  // heuristics; max-width set so it never visually intrudes.
  return `<img src="${url}" width="1" height="1" alt="" style="display:block;max-width:1px;max-height:1px;border:0;outline:none;" />`
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' })
  }

  // Authenticate the caller — we need an authenticated user for both flows.
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

  // Load the account ciphertext via the SECURITY DEFINER helper. service_role
  // bypasses RLS but we still scope by org_id + user_id below to defend
  // against a stolen token reaching another tenant's inbox.
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

  // Tenant + ownership check.
  if (account.user_id !== user.id) {
    return jsonResponse(403, { success: false, error: 'Forbidden' })
  }
  if (account.status === 'paused') {
    return jsonResponse(409, { success: false, error: 'Account is paused' })
  }
  if (!account.smtp_password_encrypted) {
    return jsonResponse(409, { success: false, error: 'SMTP password not set for this account' })
  }

  // If a send_queue_id was supplied, verify the queue row belongs to the same
  // org AND the same email_account_id as the caller's. Without this check a
  // user who owns inbox A could pass another tenant's queue_id and we'd mark
  // their row 'sent' on behalf of inbox A — a cross-tenant data-integrity bug.
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

  // Decrypt password using TOKEN_ENCRYPTION_KEY (Supabase secret).
  let smtpPassword: string
  try {
    smtpPassword = await decryptToken(account.smtp_password_encrypted)
  } catch (err) {
    console.error('Failed to decrypt SMTP password:', (err as Error).message)
    return jsonResponse(500, { success: false, error: 'Failed to decrypt SMTP credentials' })
  }

  // Decide what's actually being sent.
  const toAddress = body.mode === 'test' ? account.email_address : body.to!
  const subject =
    body.mode === 'test'
      ? `LeadFlow SMTP test — ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`
      : body.subject!
  const fromName = account.display_name ?? account.email_address
  const fromHeader = `${fromName} <${account.email_address}>`

  const baseHtml =
    body.mode === 'test'
      ? `
        <p>Hi Jordan,</p>
        <p>This is a LeadFlow SMTP test from <strong>${account.email_address}</strong>.</p>
        <p>If you're reading this, the SMTP credentials work.</p>
        <p style="color:#64748b;font-size:12px;">Sent ${new Date().toISOString()}</p>
      `
      : body.html!

  const baseText =
    body.mode === 'test'
      ? `LeadFlow SMTP test from ${account.email_address}. If you're reading this, SMTP works.`
      : (body.text ?? body.html!.replace(/<[^>]+>/g, ''))

  // Optionally inject the open-tracking pixel — only when there's a queue
  // row to attribute hits to. Test sends skip the pixel.
  const html = body.send_queue_id
    ? `${baseHtml}\n${buildTrackingPixel(body.send_queue_id)}`
    : baseHtml

  // Build the SMTP client. Gmail's recommended config: STARTTLS on 587.
  const client = new SMTPClient({
    connection: {
      hostname: account.smtp_host,
      port: account.smtp_port,
      tls: account.smtp_port === 465, // implicit TLS only on 465
      auth: {
        username: account.smtp_username,
        password: smtpPassword,
      },
    },
  })

  let smtpResponse: string | null = null
  let smtpMessageId: string | null = null

  try {
    const result = await client.send({
      from: fromHeader,
      to: toAddress,
      replyTo: undefined,
      subject,
      content: baseText,
      html,
    })
    // denomailer doesn't return a structured response object for all
    // transports; treat any non-throw as success and record what we have.
    smtpResponse = result ? JSON.stringify(result).slice(0, 500) : 'ok'
    smtpMessageId = `<${crypto.randomUUID()}@${account.domain ?? account.email_address.split('@')[1]}>`
  } catch (err) {
    const message = (err as Error).message ?? 'unknown SMTP error'
    console.error('SMTP send failed:', message)

    // Best-effort: log a failed event so the analytics page surfaces it.
    if (body.send_queue_id) {
      await supabase.from('email_send_events').insert({
        org_id: account.org_id,
        send_queue_id: body.send_queue_id,
        email_account_id: body.email_account_id,
        event_type: 'failed',
        metadata: { mode: body.mode, error: message.slice(0, 500) },
      })
    }
    try {
      await client.close()
    } catch {
      // swallow — best-effort cleanup
    }
    return jsonResponse(502, { success: false, error: message })
  }

  try {
    await client.close()
  } catch {
    // swallow — best-effort cleanup
  }

  // Update last_send_at on the account.
  await supabase
    .from('email_accounts')
    .update({ last_send_at: new Date().toISOString() })
    .eq('id', body.email_account_id)

  // Record the 'sent' event.
  await supabase.from('email_send_events').insert({
    org_id: account.org_id,
    send_queue_id: body.send_queue_id ?? null,
    email_account_id: body.email_account_id,
    event_type: 'sent',
    metadata: {
      mode: body.mode,
      to: toAddress,
      subject,
      smtp_response: smtpResponse,
      smtp_message_id: smtpMessageId,
    },
  })

  // If this was draining a queue row, mark it sent.
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
})
