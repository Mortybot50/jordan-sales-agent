/**
 * discover-leads — LeadFlow Sourcing Phase 2
 *
 * Wraps Outscraper Google Maps Scraper + Google Places API behind one entrypoint.
 * POST { search_id: uuid } — reads search config from lead_searches, runs the
 * configured engine, writes results to venues + contacts, logs run to lead_search_runs.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OUTSCRAPER_API_KEY      — for source_engine='outscraper'
 *   GOOGLE_PLACES_API_KEY   — for source_engine='google_places'
 */

// @ts-expect-error Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyEmailTier } from '../_shared/email-tier.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// @ts-expect-error Deno globals
const OUTSCRAPER_API_KEY = Deno.env.get('OUTSCRAPER_API_KEY') ?? ''
// @ts-expect-error Deno globals
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''

/**
 * Validate the caller's JWT using a user-scoped Supabase client.
 * Returns the user's org_id if authenticated, null otherwise.
 */
async function getCallerOrgId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null

  // Second arg must be the anon key (apikey header); user's JWT goes in Authorization
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  })

  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return null

  const { data: profile } = await userClient
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  return profile?.org_id ?? null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Outscraper adapter
// ---------------------------------------------------------------------------

interface OutscraperContact {
  email?: string
  phone?: string
  full_name?: string
  type?: string
}

interface OutscraperVenue {
  place_id?: string
  cid?: string
  kgmid?: string
  name?: string
  full_address?: string
  address?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  phone?: string
  website?: string
  latitude?: number
  longitude?: number
  rating?: number
  reviews?: number
  verified?: boolean
  business_status?: string
  working_hours?: Record<string, string>
  about?: Record<string, unknown>
  facebook?: string
  instagram?: string
  linkedin?: string
  twitter?: string
  emails_and_contacts?: OutscraperContact[]
  category?: string
  subtypes?: string
}

async function fetchOutscraper(
  query: string,
  limit: number,
): Promise<OutscraperVenue[]> {
  const body = {
    query: [query],
    language: 'en',
    region: 'AU',
    limit,
    enrichment: ['emails_and_contacts'],
    dropDuplicates: true,
    async: false,
  }

  const resp = await fetch('https://api.app.outscraper.com/maps/search-v3', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': OUTSCRAPER_API_KEY,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    throw new Error(`Outscraper API error ${resp.status}: ${await resp.text()}`)
  }

  const json = await resp.json() as { status: string; id?: string; data?: OutscraperVenue[][] }

  // Async job — poll until complete (max 90s)
  if (json.status === 'Pending' && json.id) {
    return await pollOutscraperJob(json.id)
  }

  // Sync response
  if (json.status === 'Success' && json.data) {
    return json.data.flat()
  }

  throw new Error(`Outscraper unexpected response: ${JSON.stringify(json).slice(0, 200)}`)
}

async function pollOutscraperJob(jobId: string): Promise<OutscraperVenue[]> {
  const maxAttempts = 45
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const resp = await fetch(`https://api.app.outscraper.com/requests/${jobId}`, {
      headers: { 'X-API-KEY': OUTSCRAPER_API_KEY },
    })
    if (!resp.ok) continue
    const json = await resp.json() as { status: string; data?: OutscraperVenue[][] }
    if (json.status === 'Success' && json.data) {
      return json.data.flat()
    }
    if (json.status === 'Failed') {
      throw new Error(`Outscraper job ${jobId} failed`)
    }
  }
  throw new Error(`Outscraper job ${jobId} timed out after 90s`)
}

// ---------------------------------------------------------------------------
// Google Places adapter
// ---------------------------------------------------------------------------

interface PlacesResult {
  place_id: string
  name: string
  formatted_address?: string
  geometry?: { location: { lat: number; lng: number } }
  rating?: number
  user_ratings_total?: number
  business_status?: string
  types?: string[]
  website?: string
  formatted_phone_number?: string
  opening_hours?: { periods?: unknown[] }
}

async function fetchGooglePlaces(
  query: string,
  suburb: string | null,
  categories: string[],
  limit: number,
): Promise<OutscraperVenue[]> {
  const results: OutscraperVenue[] = []
  const seen = new Set<string>()

  for (const category of categories) {
    const searchQuery = [category, suburb, 'Victoria', 'Australia'].filter(Boolean).join(' ')
    const params = new URLSearchParams({
      query: searchQuery,
      key: GOOGLE_PLACES_API_KEY,
      language: 'en',
      region: 'au',
    })

    let pageToken: string | undefined
    let fetched = 0

    do {
      if (pageToken) params.set('pagetoken', pageToken)
      const resp = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`,
      )
      if (!resp.ok) break

      const data = await resp.json() as {
        results?: PlacesResult[]
        next_page_token?: string
        status: string
      }

      for (const r of data.results ?? []) {
        if (seen.has(r.place_id)) continue
        seen.add(r.place_id)

        // Fetch details for phone + website
        const detail = await fetchPlaceDetail(r.place_id)
        const venue: OutscraperVenue = {
          place_id: r.place_id,
          name: r.name,
          full_address: r.formatted_address,
          latitude: r.geometry?.location.lat,
          longitude: r.geometry?.location.lng,
          rating: detail?.rating ?? r.rating,
          reviews: detail?.user_ratings_total ?? r.user_ratings_total,
          business_status: detail?.business_status ?? r.business_status,
          website: detail?.website ?? r.website,
          phone: detail?.formatted_phone_number,
          category: (r.types ?? [])[0],
          // Google Places doesn't return emails — contacts remain empty
          emails_and_contacts: [],
        }
        results.push(venue)
        fetched++
        if (results.length >= limit) break
      }

      pageToken = data.next_page_token
      if (pageToken) await new Promise((r) => setTimeout(r, 2000))
    } while (pageToken && results.length < limit)

    if (results.length >= limit) break
  }

  return results
}

async function fetchPlaceDetail(placeId: string): Promise<PlacesResult | null> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'name,formatted_phone_number,website,business_status,rating,user_ratings_total',
    key: GOOGLE_PLACES_API_KEY,
  })
  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`,
    )
    const data = await resp.json() as { result?: PlacesResult }
    return data.result ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Suburb extraction from address string
// ---------------------------------------------------------------------------

function extractSuburb(address: string | undefined): string | null {
  if (!address) return null
  // Australian addresses end like "Suburb, VIC XXXX, Australia" or "Suburb VIC XXXX"
  const match = address.match(/([A-Z][a-zA-Z\s]+),?\s*VIC\s+\d{4}/i)
  return match ? match[1].trim() : null
}

// ---------------------------------------------------------------------------
// Map business_status to our enum
// ---------------------------------------------------------------------------

type OurStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' | 'UNKNOWN'

function mapBusinessStatus(raw: string | undefined): OurStatus {
  if (!raw) return 'UNKNOWN'
  const upper = raw.toUpperCase()
  if (upper === 'OPERATIONAL' || upper === 'OPEN' || upper === 'ACTIVE') return 'OPERATIONAL'
  if (upper === 'CLOSED_TEMPORARILY' || upper === 'TEMPORARILY_CLOSED') return 'CLOSED_TEMPORARILY'
  if (upper === 'CLOSED_PERMANENTLY' || upper === 'PERMANENTLY_CLOSED') return 'CLOSED_PERMANENTLY'
  return 'UNKNOWN'
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let body: { search_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    return jsonResp({ error: 'invalid JSON' }, 400)
  }

  const { search_id } = body
  if (!search_id) return jsonResp({ error: 'search_id required' }, 400)

  // Validate caller's org before using service role key
  const callerOrgId = await getCallerOrgId(req)
  if (!callerOrgId) return jsonResp({ error: 'unauthorized' }, 401)

  // Load search config
  const { data: search, error: searchErr } = await supabase
    .from('lead_searches')
    .select('*')
    .eq('id', search_id)
    .single()

  if (searchErr || !search) {
    return jsonResp({ error: searchErr?.message ?? 'search not found' }, 404)
  }

  // Confirm caller's org owns this search (defence in depth against IDOR)
  if (search.org_id !== callerOrgId) {
    return jsonResp({ error: 'forbidden' }, 403)
  }

  // Create run record
  const { data: run, error: runErr } = await supabase
    .from('lead_search_runs')
    .insert({
      search_id,
      org_id: search.org_id,
      status: 'running',
    })
    .select('id')
    .single()

  if (runErr || !run) {
    return jsonResp({ error: runErr?.message ?? 'failed to create run' }, 500)
  }

  const runId = run.id
  let venuesAdded = 0
  let contactsAdded = 0
  let errorMsg: string | null = null

  try {
    // Build query string
    const queryParts = [
      ...search.categories,
      search.suburb ?? '',
      search.region,
      'Australia',
    ].filter(Boolean)
    const queryStr = queryParts.join(' ')

    // Fetch venues from the configured engine
    let rawVenues: OutscraperVenue[] = []

    if (search.source_engine === 'outscraper') {
      if (!OUTSCRAPER_API_KEY) throw new Error('OUTSCRAPER_API_KEY not set')
      rawVenues = await fetchOutscraper(queryStr, search.limit_per_run)
    } else if (search.source_engine === 'google_places') {
      if (!GOOGLE_PLACES_API_KEY) throw new Error('GOOGLE_PLACES_API_KEY not set')
      rawVenues = await fetchGooglePlaces(
        queryStr,
        search.suburb,
        search.categories,
        search.limit_per_run,
      )
    }

    // Process each venue
    for (const raw of rawVenues) {
      const status = mapBusinessStatus(raw.business_status)

      // Skip permanently closed — archive them but don't add fresh
      if (status === 'CLOSED_PERMANENTLY') continue

      const placeId = raw.place_id ?? null
      const suburb = raw.city ?? extractSuburb(raw.full_address ?? raw.address)

      // Dedup check
      let venueId: string | null = null

      if (placeId) {
        // Scope dedup by org_id — place_id unique index is (org_id, place_id)
        const { data: existing } = await supabase
          .from('venues')
          .select('id')
          .eq('org_id', search.org_id)
          .eq('place_id', placeId)
          .maybeSingle()

        if (existing) {
          // Update live fields only (don't overwrite name or manual edits)
          await supabase
            .from('venues')
            .update({
              business_status: status,
              rating: raw.rating ?? null,
              review_count: raw.reviews ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
          venueId = existing.id
        }
      }

      if (!venueId) {
        // New venue — insert
        const { data: inserted, error: insErr } = await supabase
          .from('venues')
          .insert({
            org_id: search.org_id,
            name: raw.name ?? 'Unknown',
            place_id: placeId,
            cid: raw.cid ?? null,
            kgmid: raw.kgmid ?? null,
            address: raw.full_address ?? raw.address ?? null,
            suburb,
            postcode: null,
            website: raw.website ?? null,
            phone: raw.phone ?? null,
            lat: raw.latitude ?? null,
            lng: raw.longitude ?? null,
            rating: raw.rating ?? null,
            review_count: raw.reviews ?? null,
            verified: raw.verified ?? null,
            business_status: status,
            working_hours: raw.working_hours ?? null,
            about_blob: raw.about ?? null,
            social_facebook: raw.facebook ?? null,
            social_instagram: raw.instagram ?? null,
            social_linkedin: raw.linkedin ?? null,
            social_twitter: raw.twitter ?? null,
            source: search.source_engine,
          })
          .select('id')
          .single()

        if (insErr || !inserted) continue
        venueId = inserted.id
        venuesAdded++
      }

      // Insert contacts from Outscraper enrichment
      if (!search.email_extraction) continue

      const contacts = raw.emails_and_contacts ?? []
      for (const c of contacts) {
        if (!c.email) continue

        const normalizedEmail = c.email.toLowerCase().trim()
        const tier = classifyEmailTier(normalizedEmail)

        // Skip if this email already exists on this venue (dedup on repeated runs)
        const { data: dupContact } = await supabase
          .from('contacts')
          .select('id')
          .eq('org_id', search.org_id)
          .eq('venue_id', venueId)
          .eq('email', normalizedEmail)
          .maybeSingle()

        if (dupContact) continue

        const { error: contactErr } = await supabase
          .from('contacts')
          .insert({
            org_id: search.org_id,
            venue_id: venueId,
            full_name: c.full_name ?? normalizedEmail.split('@')[0],
            email: normalizedEmail,
            phone: c.phone ?? null,
            email_tier: tier,
            source: search.source_engine,
            verification_status: 'pending',
          })

        if (!contactErr) contactsAdded++
      }
    }

    // Update run: success
    await supabase
      .from('lead_search_runs')
      .update({
        status: 'success',
        finished_at: new Date().toISOString(),
        result_count: rawVenues.length,
        new_venue_count: venuesAdded,
      })
      .eq('id', runId)

    // Update search last_run snapshot
    await supabase
      .from('lead_searches')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_result_count: rawVenues.length,
        total_runs: (search.total_runs ?? 0) + 1,
      })
      .eq('id', search_id)
  } catch (e) {
    errorMsg = String(e)
    await supabase
      .from('lead_search_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: errorMsg,
      })
      .eq('id', runId)

    return jsonResp({ error: errorMsg, run_id: runId }, 500)
  }

  return jsonResp({
    venues_added: venuesAdded,
    contacts_added: contactsAdded,
    run_id: runId,
  }, 200)
})

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
