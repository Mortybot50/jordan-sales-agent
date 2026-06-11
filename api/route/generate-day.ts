/**
 * POST /api/route/generate-day
 *
 * Calls the Postgres `generate_route_stops()` function for the given route_day,
 * then runs the existing `field-route-optimize` Edge Function to TSP-order the
 * resulting stops and write back stop_order + est_arrival_min.
 *
 * Body: { route_day_id: string, lookback_days?: number }
 * Response: {
 *   route_day_id: string,
 *   stop_count: number,
 *   total_distance_km: number,
 *   estimated_minutes: number
 * }
 *
 * Heavy bucket: 5 calls/min/user. Regen is a deliberate action.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  SUPABASE_URL,
  authenticate,
  makeRateLimiter,
  rateLimitOk,
} from './_helpers.js'

const limiter = makeRateLimiter(60_000, 5)
const URBAN_AVG_KMH = 30
const STOP_DWELL_MIN = 15

interface OptimizeResult {
  ordered_ids: string[]
  total_distance_km: number
  estimated_minutes: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ctx = await authenticate(req, res)
  if (!ctx) return

  if (!rateLimitOk(limiter, ctx.user.id)) {
    return res.status(429).json({ error: 'Rate limit exceeded — regen is heavy, try again in a minute' })
  }

  const body = (req.body ?? {}) as { route_day_id?: unknown; lookback_days?: unknown }
  const routeDayId = typeof body.route_day_id === 'string' ? body.route_day_id : ''
  if (!routeDayId) return res.status(422).json({ error: 'route_day_id required' })

  const lookbackDays = body.lookback_days == null ? 30 : Number(body.lookback_days)
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
    return res.status(422).json({ error: 'lookback_days must be integer 1..365' })
  }

  // RLS check: confirm the caller owns this route_day before invoking the SECURITY DEFINER fn.
  const { data: routeDay, error: rdErr } = await ctx.userClient
    .from('route_days')
    .select('id, anchor_venue_id, anchor_lat, anchor_lng, suburb_focus')
    .eq('id', routeDayId)
    .maybeSingle()
  if (rdErr) {
    console.error('[route/generate-day] route_days lookup', rdErr)
    return res.status(500).json({ error: 'DB error' })
  }
  if (!routeDay) return res.status(404).json({ error: 'route_day not found' })

  if (!routeDay.anchor_venue_id && (routeDay.anchor_lat == null || routeDay.anchor_lng == null)) {
    return res.status(422).json({
      error: 'Pick an anchor venue or set anchor_lat/anchor_lng before generating',
    })
  }

  // Run the generation fn — admin client because the SQL function is SECURITY DEFINER
  // and we've already proven ownership above.
  const { error: rpcErr } = await ctx.admin.rpc('generate_route_stops', {
    p_route_day_id: routeDayId,
    p_visited_lookback_days: lookbackDays,
  })
  if (rpcErr) {
    console.error('[route/generate-day] generate_route_stops', rpcErr)
    return res.status(500).json({ error: 'Generation failed', detail: rpcErr.message })
  }

  // Pull the stops with venue lat/lng for the TSP step. Skip stops already
  // visited (their order is now immutable) — the optimiser only re-orders the
  // unvisited tail of the route.
  const { data: stops, error: stopsErr } = await ctx.userClient
    .from('route_stops')
    .select(`
      id, stop_order, stop_kind, field_visit_id,
      venue:venues!inner(id, lat, lng)
    `)
    .eq('route_day_id', routeDayId)
    .order('stop_order', { ascending: true })

  if (stopsErr) {
    console.error('[route/generate-day] stops fetch', stopsErr)
    return res.status(500).json({ error: 'DB error' })
  }

  const allStops = (stops ?? []) as unknown as Array<{
    id: string
    stop_order: number
    stop_kind: string
    field_visit_id: string | null
    venue: { id: string; lat: number | null; lng: number | null }
  }>

  const visited = allStops.filter((s) => s.field_visit_id != null)
  const unvisited = allStops.filter(
    (s) => s.field_visit_id == null && s.venue?.lat != null && s.venue?.lng != null,
  )

  let optimized: OptimizeResult = {
    ordered_ids: unvisited.map((s) => s.id),
    total_distance_km: 0,
    estimated_minutes: 0,
  }

  if (unvisited.length >= 2) {
    // Origin = anchor (the first stop is conventionally the anchor). Fall back
    // to the first unvisited stop if no anchor lat/lng is known yet.
    const anchorStop = allStops.find((s) => s.stop_kind === 'anchor') ?? unvisited[0]
    const origin = anchorStop?.venue.lat != null && anchorStop?.venue.lng != null
      ? { lat: anchorStop.venue.lat, lng: anchorStop.venue.lng }
      : undefined

    // Hand the anchor as origin, route everything else.
    const tspStops = unvisited
      .filter((s) => s.id !== anchorStop?.id)
      .map((s) => ({ id: s.id, lat: s.venue.lat as number, lng: s.venue.lng as number }))

    if (tspStops.length >= 1 && origin) {
      const url = `${SUPABASE_URL}/functions/v1/field-route-optimize`
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.authorization!,
        },
        body: JSON.stringify({ stops: tspStops, origin }),
      })
      if (r.ok) {
        const tsp = (await r.json()) as OptimizeResult
        const orderedIds = [anchorStop.id, ...tsp.ordered_ids]
        optimized = {
          ordered_ids: orderedIds,
          total_distance_km: tsp.total_distance_km,
          estimated_minutes: tsp.estimated_minutes,
        }
      } else {
        console.warn('[route/generate-day] field-route-optimize non-2xx', r.status)
      }
    }
  }

  // Renumber stop_order: visited stops keep their orders (lowest), unvisited go after.
  // Visited can have any order from a prior run — preserve sort by their existing stop_order.
  visited.sort((a, b) => a.stop_order - b.stop_order)
  let cursor = 0
  const updates: Array<{ id: string; stop_order: number; est_arrival_min: number | null }> = []
  for (const s of visited) {
    updates.push({ id: s.id, stop_order: cursor, est_arrival_min: null })
    cursor += 1
  }
  for (let i = 0; i < optimized.ordered_ids.length; i++) {
    const stopId = optimized.ordered_ids[i]
    // Cumulative drive minutes from the anchor + dwell × (i).
    const cumulativeKm = optimized.total_distance_km * (i / Math.max(optimized.ordered_ids.length - 1, 1))
    const driveMin = (cumulativeKm / URBAN_AVG_KMH) * 60
    const dwellMin = i * STOP_DWELL_MIN
    updates.push({
      id: stopId,
      stop_order: cursor,
      est_arrival_min: Math.round(driveMin + dwellMin),
    })
    cursor += 1
  }

  // Atomic re-numbering — push updates one row at a time. The unique index
  // (route_day_id, stop_order) means we have to write to a temporary order
  // first, then settle. Use negative orders during the swap.
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i]
    await ctx.userClient
      .from('route_stops')
      .update({ stop_order: -1 - i })
      .eq('id', u.id)
  }
  for (const u of updates) {
    const { error: uErr } = await ctx.userClient
      .from('route_stops')
      .update({ stop_order: u.stop_order, est_arrival_min: u.est_arrival_min })
      .eq('id', u.id)
    if (uErr) {
      console.error('[route/generate-day] reorder write', uErr)
      return res.status(500).json({ error: 'Reorder failed', detail: uErr.message })
    }
  }

  return res.status(200).json({
    route_day_id: routeDayId,
    stop_count: visited.length + optimized.ordered_ids.length,
    total_distance_km: optimized.total_distance_km,
    estimated_minutes: optimized.estimated_minutes,
  })
}
