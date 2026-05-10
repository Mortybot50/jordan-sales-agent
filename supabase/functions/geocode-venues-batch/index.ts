/**
 * geocode-venues-batch — Supabase Edge Function
 *
 * One-shot geocoder for the venues table. Per CCP Phase-1 dispatch
 * amendment A2 (10/05/2026): runs against ALL venues with lat IS NULL —
 * NO ICP filter — so prospect-only venues become routable.
 *
 * Uses the Google Places Text Search v1 API (the same key that backs
 * api/places/autocomplete + api/places/details). Idempotent: skips
 * venues that already have lat/lng. Caps each invocation at 200
 * venues — one-off cost ceiling ~2,000 venues × $0.017 = ~$34.
 *
 * Auth: user JWT, RLS scopes the read+write to caller's org.
 *
 * POST body: { limit?: number, dry_run?: boolean }
 * Response: {
 *   geocoded: number, failed: number, skipped: number,
 *   errors: string[] // first 20
 * }
 *
 * Required env vars:
 *   GOOGLE_PLACES_API_KEY
 *   VITE_SUPABASE_URL  (or SUPABASE_URL)
 *   SUPABASE_ANON_KEY  (so we honour the caller's RLS via Authorization header)
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// @ts-expect-error Deno globals
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const REQUEST_DELAY_MS = 60 // Google Places quota: 1000 req/min, stay well under

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface VenueRow {
  id: string
  name: string
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  google_place_id: string | null
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401)
  if (!GOOGLE_PLACES_API_KEY) return jsonResponse({ error: 'Places API not configured' }, 503)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  let body: { limit?: number; dry_run?: boolean } = {}
  try { body = await req.json() } catch { body = {} }

  const limit = Math.min(Math.max(1, body.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const dryRun = body.dry_run === true

  const { data: venues, error: vErr } = await supabase
    .from('venues')
    .select('id, name, address, suburb, state, postcode, google_place_id')
    .is('lat', null)
    .limit(limit)

  if (vErr) {
    return jsonResponse({ error: `venues query: ${vErr.message}` }, 500)
  }

  const errors: string[] = []
  let geocoded = 0
  let failed = 0
  let skipped = 0

  for (const v of (venues ?? []) as VenueRow[]) {
    const queryParts = [v.name, v.address, v.suburb, v.state, v.postcode, 'Australia']
      .map((x) => (x ?? '').trim())
      .filter(Boolean)
    const textQuery = queryParts.join(', ')
    if (!v.name || queryParts.length < 2) {
      skipped++
      errors.push(`venue ${v.id}: insufficient address parts`)
      continue
    }

    if (dryRun) {
      skipped++
      continue
    }

    try {
      const result = await placesTextSearch(textQuery)
      if (!result) {
        failed++
        errors.push(`venue ${v.id}: places no match for "${textQuery}"`)
        await sleep(REQUEST_DELAY_MS)
        continue
      }
      const { error: uErr } = await supabase
        .from('venues')
        .update({
          lat: result.lat,
          lng: result.lng,
          geocoded_at: new Date().toISOString(),
          // Backfill the place_id if we didn't have one — useful for future
          // details lookups without recharging billing.
          ...(v.google_place_id ? {} : { google_place_id: result.placeId }),
        })
        .eq('id', v.id)
      if (uErr) {
        failed++
        errors.push(`venue ${v.id} update: ${uErr.message}`)
      } else {
        geocoded++
      }
    } catch (e) {
      failed++
      errors.push(`venue ${v.id}: ${(e as Error).message}`)
    }

    await sleep(REQUEST_DELAY_MS)
  }

  return jsonResponse({ geocoded, failed, skipped, errors: errors.slice(0, 20) }, 200)
})

async function placesTextSearch(
  query: string,
): Promise<{ lat: number; lng: number; placeId: string } | null> {
  // Places API (New) — Text Search. Single field mask keeps the cost on the
  // "Text Search Pro" SKU only, ~$0.017 per call.
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY!,
      'X-Goog-FieldMask': 'places.id,places.location',
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 1,
      regionCode: 'au',
    }),
  })
  if (!r.ok) {
    throw new Error(`places non-2xx ${r.status}`)
  }
  const json = (await r.json()) as {
    places?: Array<{ id?: string; location?: { latitude?: number; longitude?: number } }>
  }
  const first = json.places?.[0]
  if (!first?.location || typeof first.location.latitude !== 'number' || typeof first.location.longitude !== 'number') {
    return null
  }
  return {
    lat: first.location.latitude,
    lng: first.location.longitude,
    placeId: first.id ?? '',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
