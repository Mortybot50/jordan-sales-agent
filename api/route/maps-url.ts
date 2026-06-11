/**
 * GET /api/route/maps-url?route_day_id=<uuid>&include_visited=0
 *
 * Builds a Google Maps multi-stop directions URL for the day's UNVISITED
 * stops (in order). Server-side so we don't leak the full lat/lng list into
 * the page source. iOS UA → Apple Maps URL (single waypoint maps URL — Apple
 * doesn't natively support multi-stop deep links, so we hand off to Google
 * Maps via the `comgooglemaps://` scheme when available).
 *
 * Query:
 *   route_day_id          required
 *   include_visited=1     optional (default 0 = skip visited stops)
 *
 * Response: { url: string, stop_count: number, scheme: 'google' | 'apple' }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authenticate, makeRateLimiter, rateLimitOk } from './_helpers.js'
import { buildGoogleMapsUrl, type MapsStop } from './_maps.js'

const limiter = makeRateLimiter(60_000, 60)

// Re-export the pure builder + type so existing import paths continue to work.
export { buildGoogleMapsUrl }
export type { MapsStop }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ctx = await authenticate(req, res)
  if (!ctx) return
  if (!rateLimitOk(limiter, ctx.user.id)) {
    return res.status(429).json({ error: 'Rate limit exceeded' })
  }

  const routeDayId = (req.query.route_day_id ?? '').toString()
  if (!routeDayId) return res.status(422).json({ error: 'route_day_id required' })

  const includeVisited = (req.query.include_visited ?? '0').toString() === '1'

  const { data: stops, error: sErr } = await ctx.userClient
    .from('route_stops')
    .select(`
      id, stop_order, field_visit_id,
      venue:venues!route_stops_venue_id_fkey(lat, lng)
    `)
    .eq('route_day_id', routeDayId)
    .order('stop_order', { ascending: true })

  if (sErr) {
    console.error('[route/maps-url] stops', sErr)
    return res.status(500).json({ error: 'DB error' })
  }

  const rows = (stops ?? []) as unknown as Array<{
    id: string
    stop_order: number
    field_visit_id: string | null
    venue: { lat: number | null; lng: number | null } | null
  }>

  if (rows.length === 0) {
    return res.status(404).json({ error: 'route_day has no stops (or not found)' })
  }

  const points: MapsStop[] = rows
    .filter((r) => r.venue?.lat != null && r.venue?.lng != null)
    .map((r) => ({
      lat: r.venue!.lat as number,
      lng: r.venue!.lng as number,
      visited: r.field_visit_id != null,
    }))

  if (points.length === 0) {
    return res.status(422).json({ error: 'Stops have no geocoded venues yet' })
  }

  const { url, count } = buildGoogleMapsUrl(points, includeVisited)
  if (!url) {
    return res.status(422).json({ error: 'No unvisited stops remaining (use include_visited=1)' })
  }

  return res.status(200).json({ url, stop_count: count, scheme: 'google' })
}
