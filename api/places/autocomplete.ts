/**
 * Google Places Autocomplete proxy — hides the API key + scopes results to AU regions.
 *
 * GET /api/places/autocomplete?q=<query>&sessionToken=<uuid>
 *
 * Auth: requires Authorization: Bearer <supabase JWT>. Anonymous calls are 401d
 * because Google Places billing is metered.
 *
 * Rate limit: 30 requests / minute / user (in-memory token bucket per Vercel
 * lambda instance; good enough for our scale, not a hard guarantee).
 *
 * Required env vars:
 *   GOOGLE_PLACES_API_KEY     server-side only — set in Vercel
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

interface GooglePrediction {
  description: string
  place_id: string
  structured_formatting?: {
    main_text?: string
    secondary_text?: string
  }
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
    // Graceful degrade — client falls back to plain input on empty/non-2xx.
    return res.status(503).json({ error: 'Places API not configured', predictions: [] })
  }

  const q = (req.query.q ?? '').toString().trim()
  const sessionToken = (req.query.sessionToken ?? '').toString().trim()
  if (q.length < 2) {
    return res.status(200).json({ predictions: [] })
  }

  const params = new URLSearchParams({
    input: q,
    components: 'country:au',
    types: '(regions)',
    key: GOOGLE_PLACES_API_KEY,
  })
  if (sessionToken) params.set('sessiontoken', sessionToken)

  try {
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`,
    )
    if (!r.ok) {
      console.error('[places/autocomplete] Google API non-2xx:', r.status)
      return res.status(502).json({ error: 'Places upstream error', predictions: [] })
    }
    const json = (await r.json()) as { status: string; predictions?: GooglePrediction[] }
    if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      console.error('[places/autocomplete] Google status:', json.status)
      return res.status(502).json({ error: `Places upstream: ${json.status}`, predictions: [] })
    }
    const predictions = (json.predictions ?? []).map((p) => ({
      description: p.description,
      place_id: p.place_id,
      structured_formatting: p.structured_formatting
        ? {
            main_text: p.structured_formatting.main_text ?? '',
            secondary_text: p.structured_formatting.secondary_text ?? '',
          }
        : undefined,
    }))
    return res.status(200).json({ predictions })
  } catch (e) {
    console.error('[places/autocomplete] fetch failed:', e)
    return res.status(502).json({ error: 'Places upstream fetch failed', predictions: [] })
  }
}
