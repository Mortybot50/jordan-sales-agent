/**
 * _shared/places.ts — the SINGLE Google Places client.
 *
 * Both discover-leads (bulk sourcing) and enrich-venue-contacts (name→website
 * resolution for media-listing venues) call through here so there is exactly
 * one Places adapter, one set of field masks, and one place to reason about
 * cost. GOOGLE_PLACES_API_KEY is already provisioned as a Supabase secret.
 *
 * Uses Places API (New) v1 (places.googleapis.com). The legacy endpoints
 * (maps.googleapis.com/maps/api/place/*) return REQUEST_DENIED for this key —
 * it is provisioned for Places API (New) only. Confirmed 2026-07-14 via a live
 * diag probe: every legacy Text Search came back REQUEST_DENIED / 0 results.
 * The New-API responses are mapped back onto the same PlaceTextSearchResult /
 * PlaceDetail shapes the callers already consume, so no caller changed.
 *
 * Two primitives + one high-level helper:
 *   placeTextSearch(query)          — Places Text Search (one page)
 *   placeDetails(placeId, fields)   — Places Details (phone/website/etc)
 *   resolveVenueWebsite(name, sub)  — name-only → { website, phone, place_id }
 *
 * All calls degrade to null / empty on any failure (missing key, non-200,
 * network, malformed JSON) so callers never throw on a Places hiccup.
 */

// The GOOGLE_PLACES_API_KEY secret was stored wrapped in literal double-quotes
// ("AIza…"), which Google rejects as API_KEY_INVALID. Strip a single layer of
// surrounding quotes + whitespace defensively so a quote-wrapped secret still
// works; a clean key is unaffected. Confirmed via diag probe 2026-07-14.
// @ts-expect-error Deno globals
const GOOGLE_PLACES_API_KEY = (Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '')
  .trim()
  .replace(/^["']|["']$/g, '')

export function placesConfigured(): boolean {
  return GOOGLE_PLACES_API_KEY.length > 0
}

export interface PlaceTextSearchResult {
  place_id: string
  name: string
  formatted_address?: string
  geometry?: { location: { lat: number; lng: number } }
  rating?: number
  user_ratings_total?: number
  business_status?: string
  types?: string[]
}

export interface PlaceDetail {
  place_id?: string
  name?: string
  formatted_address?: string
  formatted_phone_number?: string
  website?: string
  business_status?: string
  rating?: number
  user_ratings_total?: number
  types?: string[]
  geometry?: { location: { lat: number; lng: number } }
}

// Places API (New) endpoints + field masks. The New API bills per-field via
// the X-Goog-FieldMask header, so we request exactly what the shapes below map.
const PLACES_NEW_BASE = 'https://places.googleapis.com/v1'
const TEXT_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.types',
  'nextPageToken',
].join(',')
const DETAIL_FIELDS_DEFAULT = [
  'id',
  'displayName',
  'formattedAddress',
  'nationalPhoneNumber',
  'websiteUri',
  'businessStatus',
  'rating',
  'userRatingCount',
  'types',
].join(',')

// Raw Places API (New) response shapes (only the fields we map).
interface NewPlace {
  id?: string
  displayName?: { text?: string; languageCode?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  rating?: number
  userRatingCount?: number
  businessStatus?: string
  types?: string[]
  nationalPhoneNumber?: string
  websiteUri?: string
}

function mapPlaceSummary(p: NewPlace): PlaceTextSearchResult {
  return {
    place_id: p.id ?? '',
    name: p.displayName?.text ?? '',
    formatted_address: p.formattedAddress,
    geometry: p.location
      ? { location: { lat: p.location.latitude ?? 0, lng: p.location.longitude ?? 0 } }
      : undefined,
    rating: p.rating,
    user_ratings_total: p.userRatingCount,
    business_status: p.businessStatus,
    types: p.types,
  }
}

/**
 * One page of Places Text Search (New API). Returns [] on any failure.
 * `status` mirrors the legacy vocabulary callers expect: 'OK', 'ZERO_RESULTS',
 * 'REQUEST_DENIED', 'HTTP_<n>', 'NO_KEY', 'FETCH_ERROR'.
 */
export async function placeTextSearch(
  query: string,
  opts?: { pageToken?: string },
): Promise<{ results: PlaceTextSearchResult[]; nextPageToken?: string; status: string }> {
  if (!GOOGLE_PLACES_API_KEY) return { results: [], status: 'NO_KEY' }

  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: 'en',
    regionCode: 'AU',
  }
  if (opts?.pageToken) body.pageToken = opts.pageToken

  try {
    const resp = await fetch(`${PLACES_NEW_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': TEXT_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      // Surface a permission failure with the legacy-style token so upstream
      // diagnostics stay readable; any other non-200 maps to HTTP_<code>.
      const status = resp.status === 403 ? 'REQUEST_DENIED' : `HTTP_${resp.status}`
      return { results: [], status }
    }
    const data = await resp.json() as { places?: NewPlace[]; nextPageToken?: string }
    const results = (data.places ?? []).map(mapPlaceSummary)
    return {
      results,
      nextPageToken: data.nextPageToken,
      status: results.length > 0 ? 'OK' : 'ZERO_RESULTS',
    }
  } catch {
    return { results: [], status: 'FETCH_ERROR' }
  }
}

/**
 * Places Details lookup (New API) for a place_id. Returns null on any failure.
 * `fields` is a New-API X-Goog-FieldMask (comma-joined bare field names).
 */
export async function placeDetails(
  placeId: string,
  fields: string = DETAIL_FIELDS_DEFAULT,
): Promise<PlaceDetail | null> {
  if (!GOOGLE_PLACES_API_KEY || !placeId) return null
  try {
    const resp = await fetch(`${PLACES_NEW_BASE}/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': fields,
      },
    })
    if (!resp.ok) return null
    const d = await resp.json() as NewPlace
    return {
      place_id: d.id,
      name: d.displayName?.text,
      formatted_address: d.formattedAddress,
      formatted_phone_number: d.nationalPhoneNumber,
      website: d.websiteUri,
      business_status: d.businessStatus,
      rating: d.rating,
      user_ratings_total: d.userRatingCount,
      types: d.types,
    }
  } catch {
    return null
  }
}

export interface ResolvedVenue {
  place_id: string
  name?: string
  website?: string
  phone?: string
  business_status?: string
}

// Tokenise a venue name for a cheap similarity check. Drops generic hospitality
// words that would otherwise let "The Wine Room" match "The Coffee Room".
const NAME_STOPWORDS = new Set([
  'the', 'and', 'cafe', 'café', 'bar', 'restaurant', 'kitchen', 'co', 'company',
  'bistro', 'eatery', 'venue', 'pty', 'ltd', 'group', 'melbourne', 'vic',
  'victoria', 'australia', 'hotel', 'pub', 'wine', 'room', 'house',
])

function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !NAME_STOPWORDS.has(t)),
  )
}

/**
 * Does the Places result plausibly refer to the same venue we searched for?
 * Requires at least one shared distinctive token. Prevents resolving a
 * name-only listing to a wrong-but-nearby business's website. When the query
 * name is ALL stopwords (e.g. "The Wine Room") we can't discriminate, so we
 * accept the top result (Places relevance ranking already did the work).
 */
function nameMatches(queryName: string, resultName: string): boolean {
  const q = nameTokens(queryName)
  if (q.size === 0) return true
  const r = nameTokens(resultName)
  for (const t of q) if (r.has(t)) return true
  return false
}

/**
 * Resolve a name-only venue to its official website + phone via a single
 * Text Search + Details lookup. Returns null when Places has no plausible
 * match (true name-only dead-end) or when no key is configured.
 *
 * Cost: 1 Text Search + at most 1 Details call per venue.
 */
export async function resolveVenueWebsite(
  name: string,
  suburb: string | null,
): Promise<ResolvedVenue | null> {
  if (!GOOGLE_PLACES_API_KEY || !name?.trim()) return null

  const query = [name, suburb, 'Victoria', 'Australia'].filter(Boolean).join(' ')
  const { results } = await placeTextSearch(query)
  if (results.length === 0) return null

  // Take the highest-ranked plausible match.
  const top = results.find((r) => nameMatches(name, r.name)) ?? null
  if (!top) return null

  const detail = await placeDetails(top.place_id)
  return {
    place_id: top.place_id,
    name: top.name,
    website: detail?.website ?? undefined,
    phone: detail?.formatted_phone_number ?? undefined,
    business_status: detail?.business_status ?? top.business_status,
  }
}
