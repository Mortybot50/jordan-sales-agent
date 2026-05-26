/**
 * poll-replies — Gmail IMAP scanner for inbound replies to LeadFlow outbound.
 *
 * Scans the last 30 min of each active email_account's INBOX for messages
 * whose `In-Reply-To` / `References` header matches an outbound
 * email_send_queue.smtp_message_id (status='sent') on the same account.
 *
 * On match per message:
 *   1. Insert email_send_events { event_type='replied', send_queue_id,
 *      email_account_id, metadata: { reply_message_id, reply_from,
 *      reply_subject, reply_snippet, in_reply_to } }.
 *   2. Insert an activities row (type='reply_received') for the matched
 *      contact (looked up via send_queue.draft_id -> email_drafts.contact_id),
 *      then POST { activity_id } to classify-reply-intent. The classifier
 *      writes intent + confidence back to activity.metadata and (when
 *      intent='unsubscribe' && confidence>=0.8) adds the contact to
 *      suppression_list automatically.
 *   3. Mark any active sequence_enrollments for the contact ->
 *      status='reply_received', completed_at=now(),
 *      last_status_message='replied via IMAP poll'.
 *   4. Mark the IMAP message with custom keyword $LFReplyProcessed for
 *      idempotency.
 *
 * Per scan we record a reply_scan_runs row with scanned / matched /
 * classified counters + any errors.
 *
 * Background. GATE-6 (25/05/2026): Jordan stays in Google OAuth Testing
 * mode permanently. Gmail Pub/Sub fallback dies with the gmail.readonly
 * verification requirement. IMAP polling becomes the primary reply
 * channel — 5 min latency is acceptable for cold outbound (replies live
 * for hours, not seconds). Same App Password already used for SMTP send
 * + process-bounces; one credential, both legs.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY
 *
 * IMAP transport: implicit TLS on 993 (imap.gmail.com). Minimal hand-rolled
 * client matching process-bounces. Refactor to shared module is a P2 follow-up.
 */

// @ts-expect-error Deno edge runtime import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptToken } from '../_shared/token-crypto.ts'
import { redactEmail } from '../_shared/pii.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const IMAP_HOST_GMAIL = 'imap.gmail.com'
const IMAP_PORT_TLS = 993
const SCAN_WINDOW_MIN = 30          // overlap with previous tick to absorb cron jitter
const MAX_MESSAGES_PER_ACCOUNT = 100
const PER_ACCOUNT_WALL_MS = 10_000  // hard cap so one slow IMAP doesn't hang the batch
const LF_KEYWORD = '$LFReplyProcessed'

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

// ---- Minimal IMAP client (inline copy of process-bounces primitives) -------
// TODO(P2): refactor to supabase/functions/_shared/imap-client.ts so both
// process-bounces and poll-replies import the same code path.

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

async function imapCmd(c: ImapConn, cmd: string): Promise<string> {
  c.tag++
  const tag = `A${c.tag.toString().padStart(4, '0')}`
  await imapWrite(c, `${tag} ${cmd}\r\n`)
  let full = ''
  const tagRe = new RegExp(`^${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`, 'm')
  while (true) {
    const chunk = await imapReadUntil(c, /\r\n/, 30000)
    full += chunk
    if (tagRe.test(full)) break
  }
  return full
}

async function imapLogin(c: ImapConn, user: string, pass: string): Promise<void> {
  const r = await imapCmd(c, `LOGIN "${user}" "${pass.replace(/"/g, '\\"')}"`)
  if (!/ OK /.test(r)) throw new Error(`IMAP LOGIN failed: ${r.slice(0, 200)}`)
}

async function imapLogout(c: ImapConn): Promise<void> {
  try { await imapCmd(c, 'LOGOUT') } catch { /* ignore */ }
  try { c.reader.releaseLock() } catch { /* ignore */ }
  // @ts-expect-error Deno types
  try { c.conn.close() } catch { /* ignore */ }
}

function parseSearchUids(resp: string): string[] {
  const m = resp.match(/\* SEARCH([^\r\n]*)\r\n/)
  if (!m) return []
  return m[1].trim().split(/\s+/).filter(Boolean)
}

// ---- Header + body extraction ---------------------------------------------

// Parse an IMAP FETCH response's literal body. IMAP framing returns:
//   * UID FETCH (... BODY[...] {N}\r\n<N bytes>...)\r\n
// We're lenient — first `{N}\r\n` literal, then take N bytes.
function extractLiteral(resp: string): string {
  const litMatch = resp.match(/\{(\d+)\}\r\n/)
  if (!litMatch || typeof litMatch.index !== 'number') return ''
  const size = parseInt(litMatch[1], 10)
  const start = litMatch.index + litMatch[0].length
  return resp.slice(start, start + size)
}

interface ParsedHeaders {
  messageId?: string
  inReplyTo?: string
  references: string[]
  from?: string
  subject?: string
  date?: string
  // X-LeadFlow-Warmup: '1' on inter-inbox warmup traffic. When present we
  // route the message into handleWarmupInbound() and short-circuit the
  // real-reply pipeline (no activity row, no classifier call, no
  // suppression touch). See send-warmup-tick for the producer side.
  xLeadflowWarmup?: string
}

// Headers are CRLF-separated, with continuation lines starting with whitespace.
// We unfold first, then parse name: value.
function parseHeaders(headerBlock: string): ParsedHeaders {
  const unfolded = headerBlock.replace(/\r\n[ \t]+/g, ' ')
  const out: ParsedHeaders = { references: [] }
  for (const line of unfolded.split(/\r\n/)) {
    const idx = line.indexOf(':')
    if (idx < 1) continue
    const name = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (name === 'message-id') out.messageId = extractMsgId(value)
    else if (name === 'in-reply-to') out.inReplyTo = extractMsgId(value)
    else if (name === 'references') out.references = extractAllMsgIds(value)
    else if (name === 'from') out.from = value
    else if (name === 'subject') out.subject = value
    else if (name === 'date') out.date = value
    else if (name === 'x-leadflow-warmup') out.xLeadflowWarmup = value
  }
  return out
}

// Extract the bare email address from a From header, which may look like
// '"Display Name" <addr@host>' or just 'addr@host'.
function extractFromAddress(raw: string | undefined): string | null {
  if (!raw) return null
  const bracket = raw.match(/<([^>]+)>/)
  if (bracket) return bracket[1].trim().toLowerCase()
  const bare = raw.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/)
  return bare ? bare[0].toLowerCase() : null
}

// Message-IDs are wrapped in `<...>`. Strip the brackets, lowercase for match.
function extractMsgId(raw: string): string | undefined {
  const m = raw.match(/<([^>]+)>/)
  return m?.[1]?.trim().toLowerCase()
}

function extractAllMsgIds(raw: string): string[] {
  const out: string[] = []
  const re = /<([^>]+)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) out.push(m[1].trim().toLowerCase())
  return out
}

// Strip a 4KB snippet from the body — text/plain part preferred, else raw.
function extractSnippet(rawBody: string, maxLen = 4096): string {
  // Cheap multipart text/plain peek: find the first text/plain section, then
  // grab the bytes after the next blank line until the next boundary.
  const tp = rawBody.match(/Content-Type:\s*text\/plain[^\r\n]*\r\n(?:[A-Z][^\r\n]*\r\n)*\r\n([\s\S]*?)(?:\r\n--|\Z)/i)
  if (tp?.[1]) return tp[1].slice(0, maxLen).trim()
  // Fallback: just slice the body, hoping non-multipart.
  return rawBody.slice(0, maxLen).trim()
}

// ---- Main handler ----------------------------------------------------------

interface AccountRow {
  id: string
  org_id: string
  user_id: string
  email_address: string
  smtp_username: string
  smtp_password_encrypted: string | null
  smtp_host: string | null
  status: string
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { success: false, error: 'Method not allowed' })
  }

  const unauthorizedResp = await requireServiceRoleAuth(req)
  if (unauthorizedResp) return unauthorizedResp

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: accounts, error: acctErr } = await supabase
    .from('email_accounts')
    .select('id, org_id, user_id, email_address, smtp_username, smtp_password_encrypted, smtp_host, status')
    .in('status', ['active', 'warming'])
  if (acctErr) {
    return json(500, { success: false, error: acctErr.message })
  }
  if (!accounts || accounts.length === 0) {
    return json(200, { success: true, accounts: 0, scanned: 0, matched: 0 })
  }

  let totalScanned = 0
  let totalMatched = 0
  let totalClassified = 0
  const topErrors: string[] = []

  for (const account of accounts as AccountRow[]) {
    const host = (account.smtp_host ?? '').toLowerCase()
    if (!host.endsWith('gmail.com')) continue
    if (!account.smtp_password_encrypted) continue

    // Insert reply_scan_runs row at the start so even a crashed scan leaves
    // a 'running' breadcrumb the dashboard can flag.
    const { data: runRow } = await supabase
      .from('reply_scan_runs')
      .insert({
        email_account_id: account.id,
        org_id: account.org_id,
        status: 'running',
      })
      .select('id')
      .single()
    const runId = runRow?.id as string | undefined

    let accScanned = 0
    let accMatched = 0
    let accClassified = 0
    const accErrors: string[] = []

    let password: string
    try {
      password = await decryptToken(account.smtp_password_encrypted)
    } catch (err) {
      accErrors.push(`decrypt: ${(err as Error).message}`)
      await finalizeRun(supabase, runId, 'failed', accScanned, accMatched, accClassified, accErrors)
      continue
    }

    const deadline = Date.now() + PER_ACCOUNT_WALL_MS
    let imap: ImapConn | null = null
    try {
      imap = await imapConnect(IMAP_HOST_GMAIL, IMAP_PORT_TLS)
      await imapLogin(imap, account.smtp_username, password)
      // Clear the password ref ASAP after login.
      password = ''
      const selResp = await imapCmd(imap, 'SELECT INBOX')
      if (!/ OK /.test(selResp)) {
        accErrors.push('SELECT INBOX failed')
        await imapLogout(imap)
        imap = null
        await finalizeRun(supabase, runId, 'failed', accScanned, accMatched, accClassified, accErrors)
        continue
      }

      const since = new Date(Date.now() - SCAN_WINDOW_MIN * 60 * 1000)
      const day = since.getUTCDate().toString().padStart(2, '0')
      const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][since.getUTCMonth()]
      const sinceStr = `${day}-${monthAbbr}-${since.getUTCFullYear()}`
      // Skip messages we've already processed (idempotency).
      const searchResp = await imapCmd(
        imap,
        `SEARCH SINCE ${sinceStr} NOT KEYWORD ${LF_KEYWORD} UNDELETED`,
      )
      const uids = parseSearchUids(searchResp).slice(0, MAX_MESSAGES_PER_ACCOUNT)

      for (const uid of uids) {
        if (Date.now() > deadline) {
          accErrors.push(`wall-clock cap hit after ${accScanned} msgs`)
          break
        }
        accScanned++
        try {
          // FETCH headers + first 4KB of body. We include X-LEADFLOW-WARMUP
          // so the parser can branch warmup traffic out of the real-reply
          // pipeline before it touches activities / classifier / suppression.
          const fetchResp = await imapCmd(
            imap,
            `FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES FROM SUBJECT DATE X-LEADFLOW-WARMUP)] BODY.PEEK[TEXT]<0.4096>)`,
          )
          // Two literals back — grab both.
          const literalMatches = [...fetchResp.matchAll(/\{(\d+)\}\r\n/g)]
          let headerBlock = ''
          let bodyBlock = ''
          if (literalMatches.length >= 1) {
            const first = literalMatches[0]
            const firstSize = parseInt(first[1], 10)
            const firstStart = (first.index ?? 0) + first[0].length
            headerBlock = fetchResp.slice(firstStart, firstStart + firstSize)
            if (literalMatches.length >= 2) {
              const second = literalMatches[1]
              const secondSize = parseInt(second[1], 10)
              const secondStart = (second.index ?? 0) + second[0].length
              bodyBlock = fetchResp.slice(secondStart, secondStart + secondSize)
            }
          } else {
            // Fallback — single-literal response.
            headerBlock = extractLiteral(fetchResp)
          }

          const headers = parseHeaders(headerBlock)

          // Warmup branch — if the inbound carries X-LeadFlow-Warmup: 1, this
          // is inter-inbox traffic from send-warmup-tick. Handle it here and
          // hard-skip the real-reply pipeline. Critically, no `activities`
          // row, no classify-reply-intent call, no suppression touch — those
          // would all corrupt the customer-facing view of the contact graph.
          if (headers.xLeadflowWarmup?.trim() === '1') {
            let warmupAction: 'reply' | 'star' | 'ignore' = 'ignore'
            try {
              warmupAction = await handleWarmupInbound(supabase, {
                accountId: account.id,
                orgId: account.org_id,
                fromAddress: extractFromAddress(headers.from),
                messageId: headers.messageId,
                references: headers.references,
                subject: headers.subject,
              })
            } catch (err) {
              accErrors.push(`warmup_inbound: ${(err as Error).message}`)
            }
            // Apply the IMAP flags. Star = \Flagged; always mark $LFReplyProcessed
            // so we don't re-process on next tick.
            const flags = warmupAction === 'star'
              ? `(\\Flagged ${LF_KEYWORD})`
              : `(${LF_KEYWORD})`
            try { await imapCmd(imap, `STORE ${uid} +FLAGS ${flags}`) } catch { /* ignore */ }
            continue
          }

          const candidateMsgIds = new Set<string>()
          if (headers.inReplyTo) candidateMsgIds.add(headers.inReplyTo)
          for (const r of headers.references) candidateMsgIds.add(r)
          if (candidateMsgIds.size === 0) {
            // Not a reply — mark processed so we never look again.
            await imapCmd(imap, `STORE ${uid} +FLAGS (${LF_KEYWORD})`)
            continue
          }

          // Build the IDs the way they're stored on our side: with angle brackets.
          const lookupIds = [...candidateMsgIds].map((id) => `<${id}>`)
          // CRITICAL: scope by email_account_id to prevent cross-org matches.
          const { data: queueRow } = await supabase
            .from('email_send_queue')
            .select('id, org_id, draft_id, email_account_id, to_email, subject')
            .eq('email_account_id', account.id)
            .eq('status', 'sent')
            .in('smtp_message_id', lookupIds)
            .order('sent_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (!queueRow) {
            await imapCmd(imap, `STORE ${uid} +FLAGS (${LF_KEYWORD})`)
            continue
          }

          // Belt-and-braces dedupe: skip if we've already recorded THIS exact
          // inbound message (by its Message-ID) as a reply. We must NOT
          // dedupe on send_queue_id alone — a prospect can send multiple
          // replies in the same thread (e.g. an initial "interested" then a
          // follow-up "unsubscribe"), and each needs its own event row +
          // classifier run. Only the IMAP message-id is uniquely tied to
          // one inbound message.
          if (headers.messageId) {
            const { data: existingEvent } = await supabase
              .from('email_send_events')
              .select('id')
              .eq('event_type', 'replied')
              .eq('metadata->>reply_message_id', headers.messageId)
              .limit(1)
              .maybeSingle()
            if (existingEvent) {
              await imapCmd(imap, `STORE ${uid} +FLAGS (${LF_KEYWORD})`)
              continue
            }
          }

          const snippet = extractSnippet(bodyBlock).slice(0, 2000)
          const replyFromHash = headers.from
            ? await redactEmail(headers.from.match(/<([^>]+)>/)?.[1] ?? headers.from)
            : null

          // 1. Insert the event.
          const { error: eventErr } = await supabase.from('email_send_events').insert({
            org_id: queueRow.org_id,
            send_queue_id: queueRow.id,
            email_account_id: account.id,
            draft_id: queueRow.draft_id ?? null,
            event_type: 'replied',
            metadata: {
              reply_message_id: headers.messageId,
              reply_from_hashed: replyFromHash,
              reply_subject: (headers.subject ?? '').slice(0, 300),
              reply_snippet: snippet.slice(0, 1000),
              in_reply_to: headers.inReplyTo,
              source: 'imap_poll',
            },
          })
          if (eventErr) {
            accErrors.push(`event insert: ${eventErr.message}`)
            // Don't mark the IMAP message — we want to retry next tick.
            continue
          }
          accMatched++

          // 2. Find contact via draft -> contact_id.
          let contactId: string | null = null
          if (queueRow.draft_id) {
            const { data: draft } = await supabase
              .from('email_drafts')
              .select('contact_id')
              .eq('id', queueRow.draft_id)
              .maybeSingle()
            contactId = (draft?.contact_id as string | null) ?? null
          }

          // 3. Insert activities row + fire classify-reply-intent.
          let activityId: string | null = null
          if (contactId) {
            const { data: act, error: actErr } = await supabase
              .from('activities')
              .insert({
                org_id: queueRow.org_id,
                contact_id: contactId,
                activity_type: 'reply_received',
                subject: (headers.subject ?? '').slice(0, 300),
                body: snippet,
                metadata: {
                  in_reply_to_message_id: headers.inReplyTo,
                  reply_message_id: headers.messageId,
                  source: 'imap_poll',
                },
                occurred_at: new Date().toISOString(),
              })
              .select('id')
              .single()
            if (actErr) {
              accErrors.push(`activity insert: ${actErr.message}`)
            } else {
              activityId = act?.id as string
            }
          }

          if (activityId) {
            try {
              const classifyRes = await fetch(
                `${SUPABASE_URL}/functions/v1/classify-reply-intent`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                  },
                  body: JSON.stringify({ activity_id: activityId }),
                },
              )
              if (classifyRes.ok) accClassified++
              else accErrors.push(`classify ${classifyRes.status}`)
            } catch (err) {
              accErrors.push(`classify fetch: ${(err as Error).message}`)
            }
          }

          // 4. Complete any active sequence_enrollments for the contact.
          if (contactId) {
            const { error: enrolErr } = await supabase
              .from('sequence_enrollments')
              .update({
                status: 'reply_received',
                completed_at: new Date().toISOString(),
                last_status_message: 'replied via IMAP poll',
              })
              .eq('contact_id', contactId)
              .eq('status', 'active')
            if (enrolErr) accErrors.push(`enrol update: ${enrolErr.message}`)
          }

          // 5. Mark IMAP message processed last — only after DB work succeeded.
          await imapCmd(imap, `STORE ${uid} +FLAGS (${LF_KEYWORD})`)
        } catch (err) {
          accErrors.push(`uid ${uid}: ${(err as Error).message}`)
        }
      }

      await imapLogout(imap)
      imap = null
      const finalStatus = accErrors.length === 0 ? 'success' : 'partial'
      await finalizeRun(supabase, runId, finalStatus, accScanned, accMatched, accClassified, accErrors)
    } catch (err) {
      accErrors.push(`account: ${(err as Error).message}`)
      if (imap) {
        try { await imapLogout(imap) } catch { /* ignore */ }
      }
      await finalizeRun(supabase, runId, 'failed', accScanned, accMatched, accClassified, accErrors)
    } finally {
      // Defensive: ensure no IMAP connection survives this loop iteration.
      if (imap) {
        try { await imapLogout(imap) } catch { /* ignore */ }
      }
    }

    totalScanned += accScanned
    totalMatched += accMatched
    totalClassified += accClassified
    if (accErrors.length > 0) topErrors.push(`acct ${account.id}: ${accErrors.slice(0, 3).join('; ')}`)
  }

  return json(200, {
    success: true,
    accounts: accounts.length,
    scanned: totalScanned,
    matched: totalMatched,
    classified: totalClassified,
    errors: topErrors.slice(0, 10),
  })
})

// ---- Warmup-inbound handler -----------------------------------------------
// Producer side: supabase/functions/send-warmup-tick — sets X-LeadFlow-Warmup: 1
// on every outbound. When the IMAP poller sees that header on a received
// message it short-circuits the real-reply pipeline and routes here.
//
// We roll a 3-way die:
//   40% — auto-reply via send-warmup-tick (mode: 'reply')
//   20% — IMAP STORE +FLAGS \Flagged (Gmail renders this as a yellow star)
//   40% — ignore (just the $LFReplyProcessed mark applied by the caller)
//
// In all cases we log an email_send_events row with metadata.kind =
// 'warmup_handled' so the dashboard can show conversation-graph health.

interface WarmupInboundArgs {
  accountId: string          // the inbox that received the warmup (becomes the sender if we reply)
  orgId: string
  fromAddress: string | null // bare email address of the warmup sender
  messageId?: string         // inbound Message-ID — used for In-Reply-To on auto-reply
  references: string[]
  subject?: string
}

async function handleWarmupInbound(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: WarmupInboundArgs,
): Promise<'reply' | 'star' | 'ignore'> {
  const dice = Math.random()
  let action: 'reply' | 'star' | 'ignore'
  if (dice < 0.4) action = 'reply'
  else if (dice < 0.6) action = 'star'
  else action = 'ignore'

  // For the auto-reply we need to resolve the from-address back to an
  // email_accounts.id (the original sender becomes the recipient of the
  // reply). Cross-org sends were already excluded at the producer; we
  // still verify here as defence-in-depth.
  let originalSenderAccountId: string | null = null
  if (action === 'reply' && args.fromAddress) {
    const { data: senderAcct } = await supabase
      .from('email_accounts')
      .select('id, org_id')
      .ilike('email_address', args.fromAddress)
      .eq('org_id', args.orgId)
      .maybeSingle()
    originalSenderAccountId = senderAcct?.id ?? null
    if (!originalSenderAccountId) {
      // Sender not in our roster — downgrade to ignore rather than reply
      // to a stranger.
      action = 'ignore'
    }
  }

  if (action === 'reply' && originalSenderAccountId) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-warmup-tick`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({
          mode: 'reply',
          sender_account_id: args.accountId,            // we received it → we reply
          recipient_account_id: originalSenderAccountId, // back to original sender
          in_reply_to_message_id: args.messageId,
          references: args.references,
          original_subject: args.subject,
        }),
      })
    } catch (err) {
      // If send-warmup-tick is unreachable, downgrade to ignore + log.
      console.warn('warmup auto-reply dispatch failed:', (err as Error).message)
      action = 'ignore'
    }
  }

  await supabase.from('email_send_events').insert({
    org_id: args.orgId,
    email_account_id: args.accountId,
    event_type: 'sent',
    metadata: {
      kind: 'warmup_handled',
      action,
      inbound_message_id: args.messageId,
      from_resolved_to_account_id: originalSenderAccountId,
    },
  })

  return action
}

// @ts-expect-error supabase client typed in caller
async function finalizeRun(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  runId: string | undefined,
  status: 'success' | 'partial' | 'failed',
  scanned: number,
  matched: number,
  classified: number,
  errors: string[],
): Promise<void> {
  if (!runId) return
  await supabase.from('reply_scan_runs').update({
    finished_at: new Date().toISOString(),
    status,
    scanned_messages: scanned,
    matched_replies: matched,
    classified_replies: classified,
    errors: errors.length > 0 ? errors.slice(0, 20) : null,
  }).eq('id', runId)
}
