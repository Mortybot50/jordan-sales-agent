/**
 * POST /api/route/upsert-day
 *
 * Create-or-update the caller's route_day for a given weekday (1..6, Mon–Sat).
 *
 * Body (JSON):
 *   {
 *     day_of_week: 1..6,
 *     anchor_venue_id?: uuid | null,
 *     suburb_focus?: string | null,
 *     anchor_lat?: number | null,
 *     anchor_lng?: number | null,
 *     radius_km?: number,         // 0.5..25
 *     target_stops?: number,      // 1..12
 *     prospect_share?: number,    // 0..1
 *     notes?: string | null
 *   }
 *
 * Response: { route_day_id: string }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  authenticate,
  isValidDayOfWeek,
  makeRateLimiter,
  rateLimitOk,
} from './_helpers.js'

const limiter = makeRateLimiter(60_000, 30)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ctx = await authenticate(req, res)
  if (!ctx) return

  if (!rateLimitOk(limiter, ctx.user.id)) {
    return res.status(429).json({ error: 'Rate limit exceeded' })
  }

  const body = (req.body ?? {}) as {
    day_of_week?: unknown
    anchor_venue_id?: unknown
    suburb_focus?: unknown
    anchor_lat?: unknown
    anchor_lng?: unknown
    radius_km?: unknown
    target_stops?: unknown
    prospect_share?: unknown
    notes?: unknown
  }

  if (!isValidDayOfWeek(body.day_of_week)) {
    return res.status(422).json({ error: 'day_of_week must be 1..6 (Mon–Sat)' })
  }

  const radiusKm = body.radius_km == null ? 5.0 : Number(body.radius_km)
  if (!Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 25) {
    return res.status(422).json({ error: 'radius_km must be 0.5..25' })
  }

  const targetStops = body.target_stops == null ? 5 : Number(body.target_stops)
  if (!Number.isInteger(targetStops) || targetStops < 1 || targetStops > 12) {
    return res.status(422).json({ error: 'target_stops must be integer 1..12' })
  }

  const prospectShare = body.prospect_share == null ? 0.7 : Number(body.prospect_share)
  if (!Number.isFinite(prospectShare) || prospectShare < 0 || prospectShare > 1) {
    return res.status(422).json({ error: 'prospect_share must be 0..1' })
  }

  const anchorVenueId = body.anchor_venue_id == null ? null : String(body.anchor_venue_id)
  const anchorLat = body.anchor_lat == null ? null : Number(body.anchor_lat)
  const anchorLng = body.anchor_lng == null ? null : Number(body.anchor_lng)
  if ((anchorLat !== null && !Number.isFinite(anchorLat)) ||
      (anchorLng !== null && !Number.isFinite(anchorLng))) {
    return res.status(422).json({ error: 'anchor_lat/anchor_lng must be numeric' })
  }

  const suburbFocus = body.suburb_focus == null ? null : String(body.suburb_focus).slice(0, 200)
  const notes = body.notes == null ? null : String(body.notes).slice(0, 2000)

  // Validation: at least one anchor signal so generate-day has somewhere to start.
  if (!anchorVenueId && !suburbFocus && (anchorLat == null || anchorLng == null)) {
    return res.status(422).json({
      error: 'Provide an anchor_venue_id, suburb_focus, or anchor_lat+anchor_lng',
    })
  }

  const payload = {
    org_id: ctx.user.org_id,
    user_id: ctx.user.id,
    day_of_week: body.day_of_week as number,
    anchor_venue_id: anchorVenueId,
    suburb_focus: suburbFocus,
    anchor_lat: anchorLat,
    anchor_lng: anchorLng,
    radius_km: radiusKm,
    target_stops: targetStops,
    prospect_share: prospectShare,
    notes,
  }

  // RLS-scoped upsert. The unique index (org_id, user_id, day_of_week) makes
  // this idempotent per-weekday for the caller.
  const { data, error } = await ctx.userClient
    .from('route_days')
    .upsert(payload, { onConflict: 'org_id,user_id,day_of_week' })
    .select('id')
    .single()

  if (error) {
    if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    console.error('[route/upsert-day]', error)
    return res.status(500).json({ error: 'DB error', detail: error.message })
  }

  return res.status(200).json({ route_day_id: data.id })
}
