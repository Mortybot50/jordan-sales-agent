/**
 * reopening-radar-poll — Supabase Edge Function
 *
 * Cron-triggered watcher that turns hospitality churn into fresh leads.
 *
 * For each org, pulls the latest snapshot from each source (vcglr,
 * google_places), compares against the most recent prior observation,
 * and flags transitions as reopening_events:
 *
 *   - status flip CLOSED → ACTIVE        → 'reopened'
 *   - licensee changed at same address   → 'licensee_changed'
 *   - venue renamed at same address      → 'renamed'
 *   - any other ACTIVE→ACTIVE fingerprint change → 'status_flip'
 *
 * STUB MODE: when REOPENING_RADAR_LIVE !== 'true', both scrapers return
 * an empty array. GATE-5 (VCGLR validation) must clear before live mode
 * is enabled. Google Places is stubbed even if the API key is present —
 * flip the env var explicitly.
 *
 * Invocation:
 *   POST {}                         — run all sources for every org
 *   POST { source: 'vcglr' }        — single source
 *
 * Required env vars:
 *   VITE_SUPABASE_URL / SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   REOPENING_RADAR_LIVE            — 'true' to hit real APIs (default: off)
 *   GOOGLE_PLACES_API_KEY           — optional, only needed when live
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const LIVE = Deno.env.get('REOPENING_RADAR_LIVE') === 'true'

type Source = 'vcglr' | 'google_places'
type BusinessStatus = 'ACTIVE' | 'CLOSED_PERMANENTLY' | 'CLOSED_TEMPORARILY' | 'SUSPENDED'

interface FetchedVenue {
  external_id: string | null
  venue_name: string
  address: string | null
  suburb: string | null
  licence_type: string | null
  licence_number: string | null
  licensee: string | null
  business_status: BusinessStatus
  evidence_url: string | null
  raw: Record<string, unknown>
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const startedAt = new Date().toISOString()
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let requestedSource: Source | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.source === 'vcglr' || body?.source === 'google_places') {
      requestedSource = body.source
    }
  } catch {
    // ignore — run all sources
  }

  const sources: Source[] = requestedSource ? [requestedSource] : ['vcglr', 'google_places']

  const { data: orgs, error: orgsErr } = await supabase.from('orgs').select('id')
  if (orgsErr) {
    return jsonResponse({ error: orgsErr.message }, 500)
  }

  const summary: Array<{ org_id: string; source: Source; observed: number; events: number }> = []
  const errors: string[] = []

  for (const org of orgs ?? []) {
    for (const source of sources) {
      try {
        const venues = await fetchSource(source)
        let events = 0

        for (const v of venues) {
          // Most recent prior observation for same org + source + external_id
          let prior = null
          if (v.external_id) {
            const { data } = await supabase
              .from('venue_observations')
              .select('id, business_status, licensee, venue_name, address')
              .eq('org_id', org.id)
              .eq('source', source)
              .eq('external_id', v.external_id)
              .order('observed_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            prior = data
          }

          const { data: inserted, error: insertErr } = await supabase
            .from('venue_observations')
            .insert({
              org_id: org.id,
              source,
              external_id: v.external_id,
              venue_name: v.venue_name,
              address: v.address,
              suburb: v.suburb,
              licence_type: v.licence_type,
              licence_number: v.licence_number,
              licensee: v.licensee,
              business_status: v.business_status,
              evidence_url: v.evidence_url,
              raw: v.raw,
            })
            .select('id')
            .single()

          if (insertErr || !inserted) {
            errors.push(`${source}:${v.external_id ?? v.venue_name}: ${insertErr?.message}`)
            continue
          }

          if (!prior) continue

          const transition = classifyTransition(prior, v)
          if (!transition) continue

          const { error: evErr } = await supabase.from('reopening_events').insert({
            org_id: org.id,
            venue_observation_prior: prior.id,
            venue_observation_new: inserted.id,
            event_type: transition,
          })
          if (evErr) {
            errors.push(`event ${transition}: ${evErr.message}`)
          } else {
            events++
          }
        }

        summary.push({ org_id: org.id, source, observed: venues.length, events })
      } catch (e) {
        errors.push(`${source}: ${String(e)}`)
      }
    }
  }

  await supabase.from('worker_runs' as never).insert({
    worker_name: 'reopening_radar_poll',
    status: errors.length === 0 ? 'ok' : 'partial',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    rows_processed: summary.reduce((s, r) => s + r.observed, 0),
    error: errors.length > 0 ? errors.slice(0, 20).join('; ') : null,
    metadata: { summary, live: LIVE } as unknown,
  })

  return jsonResponse({ live: LIVE, summary, errors: errors.slice(0, 20) }, 200)
})

function classifyTransition(
  prior: { business_status: string; licensee: string | null; venue_name: string | null; address: string | null },
  next: FetchedVenue,
): 'reopened' | 'licensee_changed' | 'renamed' | 'status_flip' | null {
  const wasClosed = prior.business_status !== 'ACTIVE'
  const nowActive = next.business_status === 'ACTIVE'
  if (wasClosed && nowActive) return 'reopened'

  if (prior.business_status === 'ACTIVE' && nowActive) {
    const sameAddr = (prior.address ?? '').trim() === (next.address ?? '').trim()
    if (sameAddr && prior.licensee && next.licensee && prior.licensee !== next.licensee) {
      return 'licensee_changed'
    }
    if (sameAddr && prior.venue_name && next.venue_name && prior.venue_name !== next.venue_name) {
      return 'renamed'
    }
  }

  if (prior.business_status !== next.business_status) return 'status_flip'
  return null
}

async function fetchSource(source: Source): Promise<FetchedVenue[]> {
  if (!LIVE) return []
  if (source === 'vcglr') return await fetchVcglr()
  if (source === 'google_places') return await fetchGooglePlaces()
  return []
}

// VCGLR scrape — STUB until GATE-5 clears.
async function fetchVcglr(): Promise<FetchedVenue[]> {
  console.warn('[reopening-radar] VCGLR live fetch not implemented — GATE-5 pending')
  return []
}

// Google Places business_status delta — STUB.
// Implementation shape (for later):
//   - Pull tracked place_ids from venues.google_place_id
//   - For each, call Places Details API (fields=place_id,business_status,name,formatted_address)
//   - Map business_status → our enum
async function fetchGooglePlaces(): Promise<FetchedVenue[]> {
  console.warn('[reopening-radar] Google Places live fetch not implemented')
  return []
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
