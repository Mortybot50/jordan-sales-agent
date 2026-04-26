/**
 * Google Places Details proxy — returns the address_components for a place_id
 * so the client can populate suburb / state / postcode at once.
 *
 * GET /api/places/details?place_id=<id>&sessionToken=<uuid>
 *
 * Auth + rate limit identical to /api/places/autocomplete.
 *
 * Required env vars:
 *   GOOGLE_PLACES_API_KEY
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30
type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

function rateLimitOk(userId: string): boolean {
  const now = Date.now()
  const b = buckets.get(userId)
  if (!b || now > b.resetAt) {
    buckets.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (b.count >= RATE_LIMIT_MAX) return false
  b.count += 1
  return true
}

interface AddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!rateLimitOk(user.id)) {
    return res.status(429).json({ error: 'Rate limit exceeded — try again in a minute' })
  }

  if (!GOOGLE_PLACES_API_KEY) {
    return res.status(503).json({ error: 'Places API not configured' })
  }

  const placeId = (req.query.place_id ?? '').toString().trim()
  const sessionToken = (req.query.sessionToken ?? '').toString().trim()
  if (!placeId) {
    return res.status(400).json({ error: 'place_id required' })
  }

  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'address_components,formatted_address',
    key: GOOGLE_PLACES_API_KEY,
  })
  if (sessionToken) params.set('sessiontoken', sessionToken)

  try {
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`,
    )
    if (!r.ok) {
      console.error('[places/details] Google API non-2xx:', r.status)
      return res.status(502).json({ error: 'Places upstream error' })
    }
    const json = (await r.json()) as {
      status: string
      result?: { address_components?: AddressComponent[]; formatted_address?: string }
    }
    if (json.status !== 'OK') {
      console.error('[places/details] Google status:', json.status)
      return res.status(502).json({ error: `Places upstream: ${json.status}` })
    }

    const components = json.result?.address_components ?? []
    const find = (type: string) => components.find((c) => c.types.includes(type))
    const locality = find('locality') ?? find('postal_town') ?? find('sublocality')
    const state = find('administrative_area_level_1')
    const postcode = find('postal_code')

    return res.status(200).json({
      suburb: locality?.long_name ?? '',
      state: state?.short_name ?? '',
      postcode: postcode?.long_name ?? '',
      formatted_address: json.result?.formatted_address ?? '',
    })
  } catch (e) {
    console.error('[places/details] fetch failed:', e)
    return res.status(502).json({ error: 'Places upstream fetch failed' })
  }
}
