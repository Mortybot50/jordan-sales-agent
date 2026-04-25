/**
 * geocode-batch — Supabase Edge Function
 *
 * Forward-geocodes contacts and venue_observations that lack lat/lng.
 * Uses OpenStreetMap Nominatim (free, no key) — rate-limited at 1 req/sec
 * per Nominatim usage policy.
 *
 * Auth: user JWT, RLS enforces org_id.
 *
 * POST body: { contact_ids?: string[], venue_observation_ids?: string[] }
 *   - if both arrays empty/absent: geocode up to 25 of each that are
 *     missing lat/lng for the caller's org.
 *
 * Response: { geocoded: number, failed: number, errors: string[] }
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const NOMINATIM_USER_AGENT = 'LeadFlow/1.0 (jordan-sales-agent)'
const NOMINATIM_DELAY_MS = 1_100
const BATCH_LIMIT = 25

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  let body: { contact_ids?: string[]; venue_observation_ids?: string[] } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const errors: string[] = []
  let geocoded = 0
  let failed = 0

  // Pull contacts to geocode
  let contactsQ = supabase
    .from('contacts')
    .select('id, full_name, venue:venues(address, suburb)')
    .is('lat', null)
    .limit(BATCH_LIMIT)
  if (body.contact_ids && body.contact_ids.length > 0) {
    contactsQ = supabase
      .from('contacts')
      .select('id, full_name, venue:venues(address, suburb)')
      .in('id', body.contact_ids)
      .is('lat', null)
      .limit(BATCH_LIMIT)
  }
  const { data: contacts, error: cErr } = await contactsQ
  if (cErr) errors.push(`contacts query: ${cErr.message}`)

  for (const c of contacts ?? []) {
    const venue = Array.isArray(c.venue) ? c.venue[0] : c.venue
    const address = [venue?.address, venue?.suburb, 'Victoria, Australia']
      .filter(Boolean)
      .join(', ')
    if (!address || address === 'Victoria, Australia') {
      failed++
      errors.push(`contact ${c.id}: no address to geocode`)
      continue
    }
    const result = await geocode(address)
    if (!result) {
      failed++
      errors.push(`contact ${c.id}: nominatim no match for "${address}"`)
      continue
    }
    const { error: uErr } = await supabase
      .from('contacts')
      .update({ lat: result.lat, lng: result.lng, geocoded_at: new Date().toISOString() })
      .eq('id', c.id)
    if (uErr) {
      failed++
      errors.push(`contact ${c.id} update: ${uErr.message}`)
    } else {
      geocoded++
    }
    await sleep(NOMINATIM_DELAY_MS)
  }

  // Pull venue_observations to geocode
  let voQ = supabase
    .from('venue_observations')
    .select('id, address, suburb, venue_name')
    .is('lat', null)
    .limit(BATCH_LIMIT)
  if (body.venue_observation_ids && body.venue_observation_ids.length > 0) {
    voQ = supabase
      .from('venue_observations')
      .select('id, address, suburb, venue_name')
      .in('id', body.venue_observation_ids)
      .is('lat', null)
      .limit(BATCH_LIMIT)
  }
  const { data: vos, error: vErr } = await voQ
  if (vErr) errors.push(`venue_observations query: ${vErr.message}`)

  for (const v of vos ?? []) {
    const address = [v.address, v.suburb, 'Victoria, Australia']
      .filter(Boolean)
      .join(', ')
    if (!address || address === 'Victoria, Australia') {
      failed++
      errors.push(`venue_observation ${v.id}: no address`)
      continue
    }
    const result = await geocode(address)
    if (!result) {
      failed++
      errors.push(`venue_observation ${v.id}: nominatim no match`)
      continue
    }
    const { error: uErr } = await supabase
      .from('venue_observations')
      .update({ lat: result.lat, lng: result.lng, geocoded_at: new Date().toISOString() })
      .eq('id', v.id)
    if (uErr) {
      failed++
      errors.push(`venue_observation ${v.id} update: ${uErr.message}`)
    } else {
      geocoded++
    }
    await sleep(NOMINATIM_DELAY_MS)
  }

  return jsonResponse({ geocoded, failed, errors: errors.slice(0, 20) }, 200)
})

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } })
    if (!r.ok) return null
    const data = await r.json() as Array<{ lat: string; lon: string }>
    if (!data || data.length === 0) return null
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch {
    return null
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
