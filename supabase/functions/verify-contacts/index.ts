/**
 * verify-contacts — ZeroBounce email verification drainer.
 *
 * Closes the gap where every discovered contact sat at
 * verification_status='pending' forever: the key was set as a Supabase
 * secret but nothing ever called ZeroBounce. This function drains the
 * pending backlog in batches, driven by the leadflow-verify-contacts cron.
 *
 * It ONLY writes verification_status / verified_at / catch_all_flag. It does
 * NOT enrol, create deals, or send anything — outreach stays behind the human
 * approve-lead gate. Verifying a contact never makes it auto-sendable.
 *
 * POST body (all optional): { limit?: number }
 * Caller: service-role only (cron drainer). verify_jwt=true + role-claim check.
 *
 * verification_status is constrained to: pending|valid|invalid|catch_all|
 * disposable|unknown (contacts_verification_status_check). ZeroBounce statuses
 * are mapped onto that set — see mapZeroBounce().
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ZEROBOUNCE_API_KEY.
 */

// @ts-expect-error Deno edge runtime import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const ZEROBOUNCE_API_KEY = Deno.env.get('ZEROBOUNCE_API_KEY') ?? ''

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200 // ZeroBounce validatebatch ceiling

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type VerificationStatus =
  | 'valid' | 'invalid' | 'catch_all' | 'disposable' | 'unknown'

interface ZbResult {
  email_address?: string
  address?: string
  status?: string
  sub_status?: string
}

/**
 * Map a ZeroBounce verdict onto our CHECK-constrained vocabulary.
 * Conservative on deliverability: spamtrap / abuse / do_not_mail are treated
 * as 'invalid' so they can never reach the outbound funnel. Disposable is
 * flagged before the do_not_mail collapse so it keeps its own bucket.
 */
function mapZeroBounce(status: string | undefined, subStatus: string | undefined): VerificationStatus {
  const s = (status ?? '').toLowerCase()
  const sub = (subStatus ?? '').toLowerCase()

  if (sub.includes('disposable')) return 'disposable'

  switch (s) {
    case 'valid':
      return 'valid'
    case 'invalid':
      return 'invalid'
    case 'catch-all':
    case 'catch_all':
      return 'catch_all'
    case 'spamtrap':
    case 'abuse':
      return 'invalid'
    case 'do_not_mail':
      // ZeroBounce tags role-based inboxes (hello@ / info@ / bookings@) as
      // do_not_mail sub_status=role_based — but venue inboxes ARE the target
      // audience for hospitality outreach. Hard-killing them as 'invalid'
      // (which approve-lead permanently excludes) emptied the funnel on the
      // first drain: 10/10 real venues flagged. Route role-based to 'unknown'
      // so the human approve gate makes the call; the genuinely toxic
      // sub-statuses (toxic / possible_trap / global_suppression) stay fatal.
      if (sub.includes('role_based')) return 'unknown'
      return 'invalid'
    case 'unknown':
    default:
      return 'unknown'
  }
}

async function zeroBounceBatch(emails: string[]): Promise<Map<string, ZbResult>> {
  // bulkapi.zerobounce.net is DEPRECATED — it now serves a Cloudflare-WAF 403
  // ("Access Restricted") for every request. The batch endpoint lives on the
  // main API host. Confirmed 13/07/2026 when the verify cron 403'd on launch.
  const resp = await fetch('https://api.zerobounce.net/v2/validatebatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: ZEROBOUNCE_API_KEY,
      email_batch: emails.map((e) => ({ email_address: e, ip_address: '' })),
    }),
  })

  if (!resp.ok) {
    throw new Error(`ZeroBounce HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  }

  const json = await resp.json() as {
    email_batch?: ZbResult[]
    errors?: { error?: string; email_address?: string }[]
  }

  // The migrated endpoint reports key/credit problems as HTTP 200 with an
  // `errors` array and an empty batch — fail loud instead of silently marking
  // nothing, so a dead key surfaces in the cron log rather than a stalled queue.
  if ((json.email_batch ?? []).length === 0 && (json.errors ?? []).length > 0) {
    throw new Error(`ZeroBounce rejected batch: ${JSON.stringify(json.errors).slice(0, 200)}`)
  }

  const out = new Map<string, ZbResult>()
  const rawCounts: Record<string, number> = {}
  for (const r of json.email_batch ?? []) {
    const key = (r.address ?? r.email_address ?? '').toLowerCase().trim()
    if (key) out.set(key, r)
    const combo = `${r.status ?? '?'}:${r.sub_status || '-'}`
    rawCounts[combo] = (rawCounts[combo] ?? 0) + 1
  }
  // Raw verdict distribution (status:sub_status) — sub_status isn't persisted
  // on contacts, so this log line is the only audit trail of WHY each batch
  // landed in its buckets (e.g. do_not_mail:role_based vs do_not_mail:toxic).
  console.log(`verify-contacts: zerobounce verdicts ${JSON.stringify(rawCounts)}`)
  return out
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const unauthorized = await requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  if (!ZEROBOUNCE_API_KEY) return json(500, { error: 'ZEROBOUNCE_API_KEY not set' })

  let limit = DEFAULT_LIMIT
  try {
    const body = await req.json() as { limit?: number } | null
    if (body?.limit && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(body.limit)))
    }
  } catch {
    // empty body from cron — fine
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Atomically CLAIM a batch of the pending backlog (best emails first, rejected
  // venues excluded) via leadflow_claim_pending_contacts, which uses FOR UPDATE
  // SKIP LOCKED + a 15-min lease. This guarantees two overlapping drainer ticks
  // never claim — and never spend a ZeroBounce credit on — the same contact.
  const { data: pending, error: readErr } = await supabase
    .rpc('leadflow_claim_pending_contacts', { p_limit: limit })

  if (readErr) return json(500, { error: `claim failed: ${readErr.message}` })

  const rows = (pending ?? []).filter((r) => r.email)
  if (rows.length === 0) {
    return json(200, { checked: 0, updated: 0, message: 'no pending contacts' })
  }

  // De-dupe emails for the ZeroBounce call (multiple contacts can share one).
  const emails = Array.from(new Set(rows.map((r) => r.email!.toLowerCase().trim())))

  let verdicts: Map<string, ZbResult>
  try {
    verdicts = await zeroBounceBatch(emails)
  } catch (e) {
    return json(502, { error: `ZeroBounce call failed: ${String(e)}`, checked: rows.length, updated: 0 })
  }

  const now = new Date().toISOString()
  const counts: Record<string, number> = {}
  let updated = 0

  for (const row of rows) {
    const key = row.email!.toLowerCase().trim()
    const verdict = verdicts.get(key)
    if (!verdict) continue // ZeroBounce didn't return this one — leave pending

    const status = mapZeroBounce(verdict.status, verdict.sub_status)
    // Compare-and-swap on verification_status='pending': if a concurrent tick
    // (or the human approve-lead verify) already moved this contact off
    // pending, this update matches zero rows and we skip it — so overlapping
    // drainer runs can't clobber a newer verdict with a staler one.
    const { data: swapped, error: upErr } = await supabase
      .from('contacts')
      .update({
        verification_status: status,
        verified_at: now,
        catch_all_flag: status === 'catch_all',
      })
      .eq('id', row.id)
      .eq('verification_status', 'pending')
      .select('id')

    if (upErr) {
      console.error(`verify-contacts: update failed for ${row.id}: ${upErr.message}`)
      continue
    }
    if (!swapped || swapped.length === 0) continue // already claimed by another run
    counts[status] = (counts[status] ?? 0) + 1
    updated++
  }

  return json(200, { checked: rows.length, updated, by_status: counts })
})
