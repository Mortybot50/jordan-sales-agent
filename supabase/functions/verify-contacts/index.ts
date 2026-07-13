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
    case 'do_not_mail':
      return 'invalid'
    case 'unknown':
    default:
      return 'unknown'
  }
}

async function zeroBounceBatch(emails: string[]): Promise<Map<string, ZbResult>> {
  const resp = await fetch('https://bulkapi.zerobounce.net/v2/validatebatch', {
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

  const json = await resp.json() as { email_batch?: ZbResult[]; errors?: unknown[] }
  const out = new Map<string, ZbResult>()
  for (const r of json.email_batch ?? []) {
    const key = (r.address ?? r.email_address ?? '').toLowerCase().trim()
    if (key) out.set(key, r)
  }
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

  // Pull the pending backlog, best emails first. Exclude contacts on rejected
  // venues — no point spending a verification credit on a lead we've binned.
  const { data: pending, error: readErr } = await supabase
    .from('contacts')
    .select('id, email, venue_id, venues!inner(review_status)')
    .eq('verification_status', 'pending')
    .not('email', 'is', null)
    .neq('venues.review_status', 'rejected')
    .order('email_tier', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (readErr) return json(500, { error: `pending read failed: ${readErr.message}` })

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
    const { error: upErr } = await supabase
      .from('contacts')
      .update({
        verification_status: status,
        verified_at: now,
        catch_all_flag: status === 'catch_all',
      })
      .eq('id', row.id)

    if (upErr) {
      console.error(`verify-contacts: update failed for ${row.id}: ${upErr.message}`)
      continue
    }
    counts[status] = (counts[status] ?? 0) + 1
    updated++
  }

  return json(200, { checked: rows.length, updated, by_status: counts })
})
