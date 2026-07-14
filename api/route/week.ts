/**
 * GET /api/route/week
 *
 * Returns the caller's Mon–Sat route_days with their ordered stops.
 *
 * Single hydration call for the /route diary view. RLS scopes everything
 * to the caller's user_id + org_id.
 *
 * Response: {
 *   days: Array<{
 *     id, day_of_week, anchor_venue_id, anchor_lat, anchor_lng, suburb_focus,
 *     prospect_share, radius_km, target_stops, generated_at, notes,
 *     stops: Array<{
 *       id, stop_order, stop_kind, est_arrival_min, est_drive_km,
 *       venue_id, venue_name_cached, suburb_cached, lead_score_cached,
 *       field_visit_id, visited_at, lat, lng
 *     }>
 *   }>
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authenticate, makeRateLimiter, rateLimitOk } from './_helpers.js'

const limiter = makeRateLimiter(60_000, 60)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ctx = await authenticate(req, res)
  if (!ctx) return
  if (!rateLimitOk(limiter, ctx.user.id)) {
    return res.status(429).json({ error: 'Rate limit exceeded' })
  }

  const { data: days, error: dErr } = await ctx.userClient
    .from('route_days')
    .select(`
      id, day_of_week, anchor_venue_id, anchor_lat, anchor_lng, suburb_focus,
      prospect_share, radius_km, target_stops, generated_at, notes,
      anchor_venue:venues!route_days_anchor_venue_id_fkey(id, name, suburb, lat, lng)
    `)
    .eq('user_id', ctx.user.id)
    .order('day_of_week', { ascending: true })

  if (dErr) {
    console.error('[route/week] days', dErr)
    return res.status(500).json({ error: 'DB error', detail: dErr.message })
  }

  const dayIds = (days ?? []).map((d) => d.id)
  let stopsByDay: Record<string, unknown[]> = {}
  if (dayIds.length > 0) {
    const { data: stops, error: sErr } = await ctx.userClient
      .from('route_stops')
      .select(`
        id, route_day_id, stop_order, stop_kind, est_arrival_min, est_drive_km,
        venue_id, venue_name_cached, suburb_cached, lead_score_cached,
        field_visit_id, outreach_channel, phone_cached,
        venue:venues!route_stops_venue_id_fkey(lat, lng),
        field_visit:field_visits!route_stops_field_visit_id_fkey(visited_at, outcome)
      `)
      .in('route_day_id', dayIds)
      .order('stop_order', { ascending: true })
    if (sErr) {
      console.error('[route/week] stops', sErr)
      return res.status(500).json({ error: 'DB error', detail: sErr.message })
    }
    stopsByDay = {}
    for (const s of stops ?? []) {
      const key = (s as { route_day_id: string }).route_day_id
      ;(stopsByDay[key] ||= []).push(s)
    }
  }

  const result = (days ?? []).map((d) => ({
    ...d,
    stops: stopsByDay[d.id] ?? [],
  }))

  return res.status(200).json({ days: result })
}
