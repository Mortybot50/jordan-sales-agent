/**
 * drain-send-queue — cron Edge Function (every 2 min via pg_cron).
 *
 * Claims pending rows from public.email_send_queue where scheduled_for <= now()
 * and dispatches them to send-via-smtp one at a time.
 *
 * Concurrency: we use a SECURITY DEFINER claim function (claim_send_queue_batch)
 * that runs `FOR UPDATE SKIP LOCKED` so two cron ticks colliding can't double-claim
 * the same row.
 *
 * Idempotency: send-via-smtp itself short-circuits rows already at status
 * sent/failed/cancelled — so worst-case a re-claim turns into a no-op.
 *
 * Auth: pg_cron posts with service-role JWT. verify_jwt=true.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-expect-error Deno edge runtime import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const BATCH_SIZE = 20  // max rows to send per tick; we run every 2 min

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

interface ClaimedRow {
  id: string
  org_id: string
  email_account_id: string
  draft_id: string | null
  to_email: string
  subject: string
  body: string
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { success: false, error: 'Method not allowed' })
  }

  // Service-role auth gate — see _shared/auth.ts for rationale.
  const unauthorizedResp = await requireServiceRoleAuth(req)
  if (unauthorizedResp) return unauthorizedResp

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Claim a batch atomically via the RPC.
  const { data: claimed, error: claimErr } = await supabase.rpc(
    'claim_send_queue_batch',
    { p_batch: BATCH_SIZE },
  )
  if (claimErr) {
    console.error('claim_send_queue_batch failed:', claimErr.message)
    return json(500, { success: false, error: claimErr.message })
  }
  const rows = (claimed ?? []) as ClaimedRow[]
  if (rows.length === 0) {
    return json(200, { success: true, drained: 0, message: 'nothing due' })
  }

  // Look up each draft's contact_id (for the unsub-token tuple).
  const draftIds = Array.from(new Set(rows.map((r) => r.draft_id).filter(Boolean) as string[]))
  const draftToContact = new Map<string, string>()
  if (draftIds.length > 0) {
    const { data: drafts } = await supabase
      .from('email_drafts')
      .select('id, contact_id')
      .in('id', draftIds)
    for (const d of (drafts ?? [])) {
      if (d.contact_id) draftToContact.set(d.id, d.contact_id)
    }
  }

  // The Edge Function calls itself function-to-function with the service role,
  // but send-via-smtp expects a USER JWT (Authorization header → supabase.auth.getUser).
  // We pass the service-role JWT, which getUser() rejects. Instead, we resolve
  // the queue row's owner user_id and mint a 60s impersonation JWT? No — too
  // heavy. Simpler: we invoke send-via-smtp's *internal* path by calling it
  // with the service-role JWT and a header that says "trust me, I'm the worker".
  //
  // Actually: send-via-smtp does `supabase.auth.getUser(token)` and rejects on
  // !user. Service-role JWT does NOT resolve to a user. So we have two paths:
  //   (a) duplicate the send logic here (DRY violation)
  //   (b) make send-via-smtp accept a SHARED_WORKER_TOKEN header for cron
  //
  // We choose (b). drain-send-queue sends both:
  //   Authorization: Bearer <service_role>     (so verify_jwt passes at the edge)
  //   X-Worker-Token: <SHARED_WORKER_TOKEN>    (so send-via-smtp skips auth.getUser)
  //
  // But that's a code change to send-via-smtp. To keep this PR self-contained
  // and avoid double-pinging Edge, drain-send-queue instead REIMPLEMENTS the
  // narrow send path here using the same shared modules (denomailer + crypto).
  // This keeps the worker single-RTT and avoids inventing a new trust header.
  //
  // We use the public RPC `get_email_account_smtp` (SECURITY DEFINER) the same
  // way send-via-smtp does.

  let drained = 0
  let failed = 0

  for (const row of rows) {
    try {
      const ok = await dispatchOne(supabase, row, draftToContact.get(row.draft_id ?? '') ?? null)
      if (ok) drained++
      else failed++
    } catch (err) {
      console.error('dispatchOne threw:', (err as Error).message, 'row=', row.id)
      await supabase.from('email_send_queue').update({
        status: 'failed',
        last_error: ((err as Error).message ?? 'unknown').slice(0, 500),
      }).eq('id', row.id)
      failed++
    }
  }

  return json(200, { success: true, drained, failed, claimed: rows.length })
})

// ---- inline send logic (mirrors send-via-smtp's manual-mode path) -----------

// @ts-expect-error Deno remote import
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { decryptToken } from '../_shared/token-crypto.ts'
import { signUnsubTuple } from '../_shared/unsub-token.ts'
import { redactEmail } from '../_shared/pii.ts'

// @ts-expect-error Deno globals
const PIXEL_BASE_URL = Deno.env.get('PIXEL_BASE_URL') ?? SUPABASE_URL
// @ts-expect-error Deno globals
const UNSUBSCRIBE_SIGNING_KEY = Deno.env.get('UNSUBSCRIBE_SIGNING_KEY') ?? ''

function buildTrackingPixel(sendQueueId: string): string {
  const url = `${PIXEL_BASE_URL.replace(/\/$/, '')}/functions/v1/pixel-track/${sendQueueId}`
  return `<img src="${url}" width="1" height="1" alt="" style="display:block;max-width:1px;max-height:1px;border:0;outline:none;" />`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Convert plain text body to a minimal HTML rendering (paragraphs per blank line).
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

// supabase-js client type is intentionally `unknown` here — strict typing isn't
// worth the import-map dance for an internal helper.
type SupabaseClient = ReturnType<typeof createClient>
async function dispatchOne(supabase: SupabaseClient, row: ClaimedRow, contactId: string | null): Promise<boolean> {
  const { data: accountRows, error: acctErr } = await supabase.rpc(
    'get_email_account_smtp',
    { p_account_id: row.email_account_id },
  )
  if (acctErr) {
    await supabase.from('email_send_queue').update({
      status: 'failed',
      last_error: `account lookup: ${acctErr.message}`.slice(0, 500),
    }).eq('id', row.id)
    return false
  }
  const account = Array.isArray(accountRows) ? accountRows[0] : accountRows
  if (!account || !account.smtp_password_encrypted) {
    await supabase.from('email_send_queue').update({
      status: 'failed',
      last_error: 'account missing or no SMTP password',
    }).eq('id', row.id)
    return false
  }

  // Spam Act gate — same as send-via-smtp.
  const { data: userRow } = await supabase
    .from('users')
    .select('spam_act_sender_block')
    .eq('id', account.user_id)
    .maybeSingle()
  const spamActBlock = (userRow?.spam_act_sender_block ?? '').trim()
  if (spamActBlock.length < 20) {
    await supabase.from('email_send_queue').update({
      status: 'failed',
      last_error: 'spam_act_sender_block missing or <20 chars',
    }).eq('id', row.id)
    await supabase.from('email_send_events').insert({
      org_id: row.org_id,
      send_queue_id: row.id,
      email_account_id: row.email_account_id,
      event_type: 'failed',
      metadata: { reason: 'spam_act_block_missing' },
    })
    return false
  }

  let smtpPassword: string
  try {
    smtpPassword = await decryptToken(account.smtp_password_encrypted)
  } catch (err) {
    await supabase.from('email_send_queue').update({
      status: 'failed',
      last_error: `decrypt: ${(err as Error).message}`.slice(0, 500),
    }).eq('id', row.id)
    return false
  }

  // Build the message
  const fromName = account.display_name ?? account.email_address
  const fromHeader = `${fromName} <${account.email_address}>`
  const bodyText = row.body ?? ''
  const bodyHtml = textToHtml(bodyText)

  const blockText = spamActBlock
  const finalText = `${bodyText}\n\n---\n${blockText}`
  const blockHtml = `<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />
<p style="color:#64748b;font-size:12px;line-height:1.5;margin:0;">${escapeHtml(blockText).replace(/\n/g, '<br/>')}</p>`
  const html = `${bodyHtml}\n${blockHtml}\n${buildTrackingPixel(row.id)}`

  const customHeaders: Record<string, string> = {}
  if (contactId && UNSUBSCRIBE_SIGNING_KEY.length >= 32) {
    try {
      const tok = await signUnsubTuple(contactId, row.id, UNSUBSCRIBE_SIGNING_KEY)
      const httpsUrl =
        `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/unsubscribe-post` +
        `?c=${encodeURIComponent(contactId)}&s=${encodeURIComponent(row.id)}&t=${tok}`
      const senderDomain = (account.email_address.split('@', 2)[1] ?? '').toLowerCase()
      const mailtoUrl = `mailto:unsub@${senderDomain}?subject=unsubscribe`
      customHeaders['List-Unsubscribe'] = `<${httpsUrl}>, <${mailtoUrl}>`
      customHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    } catch (err) {
      console.warn('unsub-token failed (no headers):', (err as Error).message)
    }
  }

  const isGmail = account.smtp_host?.toLowerCase().endsWith('gmail.com') ?? false
  const effectivePort = isGmail ? 465 : account.smtp_port
  const effectiveTls = isGmail ? true : (account.smtp_port === 465)

  const client = new SMTPClient({
    connection: {
      hostname: account.smtp_host,
      port: effectivePort,
      tls: effectiveTls,
      auth: { username: account.smtp_username, password: smtpPassword },
    },
  })

  try {
    await client.send({
      from: fromHeader,
      to: row.to_email,
      subject: row.subject ?? '(no subject)',
      content: finalText,
      html,
      headers: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    })
  } catch (err) {
    const msg = (err as Error).message ?? 'unknown SMTP error'
    const safeTo = await redactEmail(row.to_email)
    console.error('drain SMTP fail:', msg, 'to=', safeTo)
    await supabase.from('email_send_queue').update({
      status: 'failed',
      last_error: msg.slice(0, 500),
    }).eq('id', row.id)
    await supabase.from('email_send_events').insert({
      org_id: row.org_id,
      send_queue_id: row.id,
      email_account_id: row.email_account_id,
      event_type: 'failed',
      metadata: { reason: 'smtp_send', error: msg.slice(0, 500) },
    })
    try { await client.close() } catch { /* best-effort */ }
    return false
  }
  try { await client.close() } catch { /* best-effort */ }

  const smtpMessageId = `<${crypto.randomUUID()}@${account.domain ?? account.email_address.split('@')[1]}>`
  await supabase.from('email_send_queue').update({
    status: 'sent',
    sent_at: new Date().toISOString(),
    smtp_message_id: smtpMessageId,
  }).eq('id', row.id)

  const nowIso = new Date().toISOString()
  await supabase.from('email_accounts').update({
    last_send_at: nowIso,
  }).eq('id', row.email_account_id)

  // Mirror to sender_inboxes (legacy pool table still used by reputation +
  // weighted-rotation paths). Linked by (org_id, lower(email)) since there
  // is no direct FK between email_accounts and sender_inboxes.
  if (account.email_address) {
    const { error: siErr } = await supabase
      .from('sender_inboxes')
      .update({ last_send_at: nowIso })
      .eq('org_id', row.org_id)
      .ilike('email', account.email_address)
    if (siErr) {
      console.warn('sender_inboxes last_send_at update failed:', siErr.message)
    }
  }

  const safeTo = await redactEmail(row.to_email)
  await supabase.from('email_send_events').insert({
    org_id: row.org_id,
    send_queue_id: row.id,
    email_account_id: row.email_account_id,
    draft_id: row.draft_id,
    event_type: 'sent',
    metadata: {
      mode: 'manual',
      to_hashed: safeTo,
      subject: row.subject,
      smtp_message_id: smtpMessageId,
      had_list_unsubscribe: Object.keys(customHeaders).length > 0,
      source: 'drain-send-queue',
    },
  })

  // Bump the draft to 'sent' too (best-effort).
  if (row.draft_id) {
    await supabase.from('email_drafts').update({
      status: 'sent', sent_at: new Date().toISOString(),
    }).eq('id', row.draft_id)
  }

  return true
}
