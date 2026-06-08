/**
 * sourcing-cron-tick — every-5-minute dispatcher for saved sourcing searches.
 *
 * pg_cron posts here on `*` /5 cadence (UTC). The handler:
 *   1. Loads every lead_searches row with schedule_cron IS NOT NULL.
 *   2. For each row, parses the cron and checks whether it would fire in
 *      the half-open window [now - WINDOW_MIN, now). The window matches
 *      the cron cadence (5 min) so each scheduled time fires exactly once.
 *   3. For matching rows, invokes discover-leads with the service-role JWT
 *      and a body of `{ search_id, triggered_by: 'cron' }`. discover-leads
 *      logs its own lead_search_runs row with triggered_by='cron'.
 *
 * Auth: verify_jwt=true. Caller must be the service role
 * (requireServiceRoleAuth). The pg_cron job uses the vault-sourced
 * service-role key — same pattern as enqueue-sends et al.
 *
 * Idempotency: the 5-min window matches the cron cadence so a given
 * (search_id, minute) fires at most once. If a tick is delayed and the
 * next tick's window overlaps, the cron expression will still only
 * yield one matching minute inside that window, so the search runs
 * once per scheduled time. Concurrent cron-tick invocations are not
 * expected (pg_cron sequences ticks); if they ever overlap, the worst
 * case is one search firing twice in the same minute, which
 * discover-leads handles cleanly (dedup on (org_id, place_id)).
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-expect-error Deno edge runtime import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import {
  firesInWindow,
  parseCron,
  CronParseError,
} from '../_shared/cron-match.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const WINDOW_MIN = 5 // must match the pg_cron schedule cadence

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface LeadSearchRow {
  id: string
  org_id: string
  name: string
  schedule_cron: string | null
}

interface TickResult {
  search_id: string
  name: string
  cron: string
  fired: boolean
  reason?: string
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method not allowed' })
  }

  const unauthorized = await requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  // The pg_cron caller's Authorization header carries the vault-sourced
  // service-role JWT that has just passed this function's verify_jwt gate.
  // Forward THAT exact token to discover-leads (also verify_jwt=true) rather
  // than the injected SUPABASE_SERVICE_ROLE_KEY env var: on projects using the
  // new API-key format the env var is not a verifiable JWT, so discover-leads'
  // gateway rejected it with 401 and every scheduled search silently failed.
  // (Fixed 2026-06-02.)
  const callerAuth = req.headers.get('Authorization') ?? `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`

  // Optional body: { now?: ISO8601 } for deterministic tests. Production
  // pg_cron sends '{}'.
  let bodyNow: Date | null = null
  try {
    const body = await req.json() as { now?: string } | null
    if (body?.now) {
      const candidate = new Date(body.now)
      if (!isNaN(candidate.getTime())) bodyNow = candidate
    }
  } catch {
    // pg_cron sends an empty body sometimes — that's fine.
  }

  const now = bodyNow ?? new Date()

  // Anchor the window to the closest minute boundary so consecutive ticks
  // don't overlap. Each minute is checked in exactly one tick:
  //   windowEnd   = floor(now) + 1 minute  (exclusive)
  //   windowStart = windowEnd - WINDOW_MIN minutes (inclusive minute boundary)
  // Example with WINDOW_MIN=5:
  //   tick at 06:00:03 → covers minutes 05:56, 05:57, 05:58, 05:59, 06:00
  //   tick at 06:05:03 → covers minutes 06:01, 06:02, 06:03, 06:04, 06:05
  // pg_cron is allowed to be a few seconds late without missing or
  // duplicating any scheduled minute.
  const nowMs = now.getTime()
  const nowMinute = Math.floor(nowMs / 60_000) * 60_000
  const windowEnd = new Date(nowMinute + 60_000)
  const windowStart = new Date(nowMinute - (WINDOW_MIN - 1) * 60_000)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: rows, error } = await supabase
    .from('lead_searches')
    .select('id, org_id, name, schedule_cron')
    .not('schedule_cron', 'is', null)

  if (error) {
    return json(500, { error: `lead_searches read failed: ${error.message}` })
  }

  const results: TickResult[] = []
  const toDispatch: string[] = []

  for (const row of (rows ?? []) as LeadSearchRow[]) {
    if (!row.schedule_cron) continue
    let shouldFire = false
    let reason: string | undefined

    try {
      const parsed = parseCron(row.schedule_cron)
      shouldFire = firesInWindow(parsed, windowStart, windowEnd)
      if (!shouldFire) reason = 'no match in window'
    } catch (e) {
      reason =
        e instanceof CronParseError
          ? `invalid cron: ${e.message}`
          : `parse failed: ${String(e)}`
    }

    if (!shouldFire) {
      results.push({
        search_id: row.id,
        name: row.name,
        cron: row.schedule_cron,
        fired: false,
        reason,
      })
      continue
    }

    toDispatch.push(row.id)
    results.push({
      search_id: row.id,
      name: row.name,
      cron: row.schedule_cron,
      fired: true,
    })
  }

  // discover-leads can take 30-90s per search (Outscraper polling, Google
  // Places paging). We must NOT await them inside the cron-tick request or
  // the response times out and pg_cron logs a fail. Hand the dispatches to
  // EdgeRuntime.waitUntil so the runtime keeps them alive after we return.
  if (toDispatch.length > 0) {
    const work = Promise.allSettled(
      toDispatch.map((id) => dispatchDiscoverLeads(id, callerAuth)),
    )
    // @ts-expect-error EdgeRuntime is a Supabase-specific global
    const er = typeof EdgeRuntime !== 'undefined' ? EdgeRuntime : null
    if (er && typeof er.waitUntil === 'function') {
      er.waitUntil(work)
    } else {
      // Fallback for local dev / non-Supabase runtimes — we still need to
      // give the fetches a chance to flush before returning. Best-effort
      // 1-second hold.
      await Promise.race([work, new Promise((r) => setTimeout(r, 1_000))])
    }
  }

  return json(200, {
    now: now.toISOString(),
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    total_scheduled: rows?.length ?? 0,
    fired: toDispatch.length,
    results,
  })
})

async function dispatchDiscoverLeads(searchId: string, authHeader: string): Promise<void> {
  const url = `${SUPABASE_URL}/functions/v1/discover-leads`
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({ search_id: searchId, triggered_by: 'cron' }),
    })
  } catch (e) {
    console.error(`dispatch ${searchId} failed:`, e)
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
