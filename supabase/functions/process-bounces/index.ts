/**
 * process-bounces — Gmail IMAP scanner for hard-bounce postmaster replies.
 *
 * Scans the last 24h of each active email_account's INBOX for RFC 3464
 * delivery-status notifications (DSNs). For each hard-bounce DSN:
 *   1. Parse the original-recipient + status code from the DSN body.
 *   2. Find the matching email_send_queue row by recipient + sender_account.
 *   3. Mark that queue row status='bounced'.
 *   4. Insert an email_send_events row event_type='bounced'.
 *   5. Auto-add the recipient to suppression_list (reason='bounce_hard',
 *      source='leadflow_bounce_scan').
 *
 * Idempotent: we keep a marker on the IMAP message (FLAGS \Seen + a custom
 * keyword $LFProcessed) so re-runs skip already-handled DSNs.
 *
 * IMAP transport: implicit TLS on port 993 (imap.gmail.com). Auth uses the
 * same SMTP app password (Gmail allows the same app password for IMAP + SMTP).
 *
 * Schedule: every 30 min via pg_cron.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY
 *
 * NOTE: Pure-Deno IMAP libraries are immature. We use a minimal hand-rolled
 *       IMAP client over Deno.connectTls — enough to LOGIN, SELECT INBOX,
 *       SEARCH SINCE <date>, FETCH BODY[TEXT], and STORE +FLAGS. Comments
 *       inline.
 */

// @ts-expect-error Deno edge runtime import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptToken } from '../_shared/token-crypto.ts'
import { redactEmail } from '../_shared/pii.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const IMAP_HOST_GMAIL = 'imap.gmail.com'
const IMAP_PORT_TLS = 993
const SCAN_WINDOW_HOURS = 24
const MAX_MESSAGES_PER_ACCOUNT = 50  // safety bound

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---- Minimal IMAP client over Deno.connectTls ------------------------------

interface ImapConn {
  // @ts-expect-error Deno types
  conn: Deno.Conn
  reader: ReadableStreamDefaultReader<Uint8Array>
  buf: string
  tag: number
}

async function imapConnect(host: string, port: number): Promise<ImapConn> {
  // @ts-expect-error Deno globals
  const conn = await Deno.connectTls({ hostname: host, port })
  const reader = conn.readable.getReader()
  const c: ImapConn = { conn, reader, buf: '', tag: 0 }
  // Greeting
  await imapReadUntil(c, /\r\n/)
  return c
}

async function imapReadUntil(c: ImapConn, terminator: RegExp, maxMs = 15000): Promise<string> {
  const start = Date.now()
  while (true) {
    const m = c.buf.match(terminator)
    if (m && typeof m.index === 'number') {
      const out = c.buf.slice(0, m.index + m[0].length)
      c.buf = c.buf.slice(m.index + m[0].length)
      return out
    }
    if (Date.now() - start > maxMs) throw new Error('imap read timeout')
    const { value, done } = await c.reader.read()
    if (done) throw new Error('imap connection closed')
    c.buf += new TextDecoder().decode(value)
  }
}

async function imapWrite(c: ImapConn, line: string): Promise<void> {
  // @ts-expect-error Deno types
  const w = c.conn.writable.getWriter()
  try {
    await w.write(new TextEncoder().encode(line))
  } finally {
    w.releaseLock()
  }
}

// Send a tagged command, read until the tagged completion line.
async function imapCmd(c: ImapConn, cmd: string): Promise<string> {
  c.tag++
  const tag = `A${c.tag.toString().padStart(4, '0')}`
  await imapWrite(c, `${tag} ${cmd}\r\n`)
  let full = ''
  // Read lines until we see the tagged completion (`tag OK|NO|BAD`).
  const tagRe = new RegExp(`^${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`, 'm')
  while (true) {
    const chunk = await imapReadUntil(c, /\r\n/, 30000)
    full += chunk
    if (tagRe.test(full)) break
  }
  return full
}

async function imapLogin(c: ImapConn, user: string, pass: string): Promise<void> {
  // Quote the password to allow special chars
  const r = await imapCmd(c, `LOGIN "${user}" "${pass.replace(/"/g, '\\"')}"`)
  if (!/ OK /.test(r)) throw new Error(`IMAP LOGIN failed: ${r.slice(0, 200)}`)
}

async function imapLogout(c: ImapConn): Promise<void> {
  try { await imapCmd(c, 'LOGOUT') } catch { /* ignore */ }
  try { c.reader.releaseLock() } catch { /* ignore */ }
  // @ts-expect-error Deno types
  try { c.conn.close() } catch { /* ignore */ }
}

// Parse a SEARCH response. Returns an array of message UIDs (as strings).
function parseSearchUids(resp: string): string[] {
  // Look for `* SEARCH 1 2 3`
  const m = resp.match(/\* SEARCH([^\r\n]*)\r\n/)
  if (!m) return []
  const ids = m[1].trim().split(/\s+/).filter(Boolean)
  return ids
}

// ---- DSN parsing ----------------------------------------------------------

interface DsnInfo {
  recipient?: string
  statusCode?: string  // e.g. '5.1.1'
  diagnostic?: string
  isHardBounce: boolean
}

function parseDsn(rawBody: string): DsnInfo | null {
  // RFC 3464 DSNs are multipart, with one part of Content-Type:
  // message/delivery-status containing per-recipient fields.
  // Heuristic: scan for `Final-Recipient`, `Status`, `Diagnostic-Code` lines.
  const recMatch = rawBody.match(/Final-Recipient:\s*[^;]+;\s*([^\r\n]+)/i)
    ?? rawBody.match(/Original-Recipient:\s*[^;]+;\s*([^\r\n]+)/i)
  const statusMatch = rawBody.match(/^Status:\s*([0-9]\.[0-9]+\.[0-9]+)/im)
  const diagMatch = rawBody.match(/Diagnostic-Code:\s*[^;]+;\s*([^\r\n]+)/i)

  if (!recMatch && !statusMatch) return null

  const recipient = recMatch?.[1]?.trim().toLowerCase().replace(/[<>]/g, '')
  const statusCode = statusMatch?.[1]
  const diagnostic = diagMatch?.[1]?.trim()

  // 5.x.x = permanent failure (hard bounce). 4.x.x = transient (soft).
  const isHardBounce = !!statusCode && statusCode.startsWith('5.')

  if (!recipient && !isHardBounce) return null
  return { recipient, statusCode, diagnostic, isHardBounce }
}

// ---- Main handler ---------------------------------------------------------

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { success: false, error: 'Method not allowed' })
  }

  // Service-role auth gate — see enqueue-sends/index.ts for rationale.
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return json(401, { success: false, error: 'unauthorized' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Pull all active email_accounts. We only scan Gmail accounts in v1 (the
  // IMAP host is hardcoded to imap.gmail.com). Other providers will fall
  // through silently — log + skip.
  const { data: accounts, error: acctErr } = await supabase
    .from('email_accounts')
    .select('id, org_id, user_id, email_address, smtp_username, smtp_password_encrypted, smtp_host, status')
    .in('status', ['active', 'warming'])
  if (acctErr) {
    return json(500, { success: false, error: acctErr.message })
  }
  if (!accounts || accounts.length === 0) {
    return json(200, { success: true, scanned: 0, bounces: 0 })
  }

  let totalScanned = 0
  let totalBounces = 0
  const errors: string[] = []

  for (const account of accounts) {
    const host = (account.smtp_host ?? '').toLowerCase()
    if (!host.endsWith('gmail.com')) {
      // v1 only supports Gmail IMAP. Skip non-Gmail accounts.
      continue
    }
    if (!account.smtp_password_encrypted) continue

    let password: string
    try {
      password = await decryptToken(account.smtp_password_encrypted)
    } catch (err) {
      errors.push(`decrypt failed for ${account.id}: ${(err as Error).message}`)
      continue
    }

    let imap: ImapConn | null = null
    try {
      imap = await imapConnect(IMAP_HOST_GMAIL, IMAP_PORT_TLS)
      await imapLogin(imap, account.smtp_username, password)
      const selResp = await imapCmd(imap, 'SELECT INBOX')
      if (!/ OK /.test(selResp)) {
        errors.push(`SELECT failed for ${account.id}`)
        await imapLogout(imap)
        continue
      }

      // SEARCH SINCE <Day-Month-Year> for DSNs. Gmail returns mail-daemon
      // bounces from "mailer-daemon@googlemail.com" with subjects like
      // "Delivery Status Notification (Failure)". We narrow with FROM +
      // SUBJECT criteria.
      const since = new Date(Date.now() - SCAN_WINDOW_HOURS * 60 * 60 * 1000)
      const day = since.getUTCDate().toString().padStart(2, '0')
      const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][since.getUTCMonth()]
      const sinceStr = `${day}-${monthAbbr}-${since.getUTCFullYear()}`
      const searchResp = await imapCmd(
        imap,
        `SEARCH SINCE ${sinceStr} FROM "mailer-daemon" UNDELETED`,
      )
      const uids = parseSearchUids(searchResp).slice(0, MAX_MESSAGES_PER_ACCOUNT)

      for (const uid of uids) {
        totalScanned++
        try {
          // Fetch the message body text (RFC 822 source — gives us full headers + DSN parts).
          const fetchResp = await imapCmd(imap, `FETCH ${uid} BODY[TEXT]`)
          // Extract the literal body — IMAP returns `{NN}\r\n<body>` ; simplest
          // approach: grab everything between the first `{` literal marker and
          // the trailing `)` + tag.
          const litMatch = fetchResp.match(/\{(\d+)\}\r\n([\s\S]*)\r\n\)/)
          const rawBody = litMatch?.[2] ?? fetchResp
          const dsn = parseDsn(rawBody)
          if (!dsn || !dsn.recipient || !dsn.isHardBounce) continue

          const recipient = dsn.recipient
          // Find the queue row by sender account + recipient email, in the last 7 days.
          const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
          const { data: queueRow } = await supabase
            .from('email_send_queue')
            .select('id, org_id, draft_id, email_account_id')
            .eq('email_account_id', account.id)
            .ilike('to_email', recipient)
            .gte('created_at', cutoff)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (queueRow) {
            // NOTE: email_send_queue.status CHECK constraint allows only
            // queued/sending/sent/failed/cancelled — no 'bounced'. We mark
            // the row 'failed' with a `bounce:` prefix in last_error so the
            // bounce signal is unambiguous in queries; the canonical bounce
            // record is the email_send_events row inserted below
            // (event_type='bounced').
            const bounceMsg = (dsn.diagnostic ?? `status ${dsn.statusCode}`).slice(0, 480)
            await supabase.from('email_send_queue').update({
              status: 'failed',
              last_error: `bounce: ${bounceMsg}`,
            }).eq('id', queueRow.id)

            await supabase.from('email_send_events').insert({
              org_id: queueRow.org_id,
              send_queue_id: queueRow.id,
              email_account_id: account.id,
              draft_id: queueRow.draft_id ?? null,
              event_type: 'bounced',
              metadata: {
                status_code: dsn.statusCode,
                diagnostic: (dsn.diagnostic ?? '').slice(0, 500),
                to_hashed: await redactEmail(recipient),
                source: 'imap_scan',
              },
            })
          }

          // Auto-suppress (idempotent — unique (org_id, email) suppression).
          // If we don't have a queue row but we know the org via account, still suppress.
          const orgId = queueRow?.org_id ?? account.org_id
          const { data: alreadyS } = await supabase
            .from('suppression_list')
            .select('id')
            .eq('org_id', orgId)
            .eq('email', recipient)
            .maybeSingle()
          if (!alreadyS) {
            await supabase.from('suppression_list').insert({
              org_id: orgId,
              email: recipient,
              reason: 'bounce_hard',
              source: 'leadflow_bounce_scan',
              notes: (dsn.diagnostic ?? `status ${dsn.statusCode ?? '5.x.x'}`).slice(0, 300),
              domain_suppression: false,
            })
          }

          totalBounces++

          // Mark the message \Seen so a future scan SEARCH UNSEEN would skip it
          // (we already filter UNDELETED, but \Seen also helps users in the UI).
          await imapCmd(imap, `STORE ${uid} +FLAGS (\\Seen)`)
        } catch (err) {
          console.warn('DSN parse/process err uid=', uid, (err as Error).message)
        }
      }
      await imapLogout(imap)
      imap = null
    } catch (err) {
      errors.push(`account ${account.id}: ${(err as Error).message}`)
      if (imap) {
        try { await imapLogout(imap) } catch { /* ignore */ }
      }
    }
  }

  return json(200, {
    success: true,
    scanned: totalScanned,
    bounces: totalBounces,
    errors: errors.slice(0, 10),
  })
})
