/**
 * POST /api/route/mark-visited
 *
 * Insert a field_visit row tied to the route_stop's venue, then link the
 * stop's `field_visit_id`. The existing field_visits trigger handles the
 * activity-feed write + last_visited_at + last_touch_at cascade.
 *
 * Body:
 *   {
 *     route_stop_id: string,
 *     outcome: 'interested' | 'not_now' | 'closed' | 'not_in' | 'dm_absent' | 'other',
 *     notes?: string | null,
 *     voice_transcript?: string | null,
 *     voice_audio_path?: string | null,
 *     lat?: number | null,
 *     lng?: number | null
 *   }
 *
 * Response: { field_visit_id: string }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authenticate, makeRateLimiter, rateLimitOk } from './_helpers.js'

const limiter = makeRateLimiter(60_000, 30)

const VALID_OUTCOMES = new Set([
  'interested', 'not_now', 'closed', 'not_in', 'dm_absent', 'collected_email', 'other',
])

// Deliberately loose — the real verdict comes from ZeroBounce via the
// verify-contacts cron once the contact is created. We only reject obvious junk.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ctx = await authenticate(req, res)
  if (!ctx) return
  if (!rateLimitOk(limiter, ctx.user.id)) {
    return res.status(429).json({ error: 'Rate limit exceeded' })
  }

  const body = (req.body ?? {}) as {
    route_stop_id?: unknown
    outcome?: unknown
    notes?: unknown
    voice_transcript?: unknown
    voice_audio_path?: unknown
    lat?: unknown
    lng?: unknown
    collected_email?: unknown
  }

  const stopId = typeof body.route_stop_id === 'string' ? body.route_stop_id : ''
  if (!stopId) return res.status(422).json({ error: 'route_stop_id required' })

  const outcome = typeof body.outcome === 'string' ? body.outcome : ''
  if (!VALID_OUTCOMES.has(outcome)) {
    return res.status(422).json({ error: 'Invalid outcome' })
  }

  const lat = body.lat == null ? null : Number(body.lat)
  const lng = body.lng == null ? null : Number(body.lng)
  if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) {
    return res.status(422).json({ error: 'lat/lng must be numeric' })
  }

  // Confirm the stop belongs to the caller (RLS handles this implicitly via
  // the join to route_days.user_id, but we want a 404 vs a silent zero-row).
  const { data: stop, error: stopErr } = await ctx.userClient
    .from('route_stops')
    .select('id, venue_id, org_id, field_visit_id, venue_name_cached')
    .eq('id', stopId)
    .maybeSingle()
  if (stopErr) {
    console.error('[route/mark-visited] stop fetch', stopErr)
    return res.status(500).json({ error: 'DB error' })
  }
  if (!stop) return res.status(404).json({ error: 'route_stop not found' })

  if (stop.field_visit_id) {
    return res.status(409).json({ error: 'Stop already marked visited', field_visit_id: stop.field_visit_id })
  }

  const notes = body.notes == null ? null : String(body.notes).slice(0, 4000)
  const voiceTranscript = body.voice_transcript == null ? null : String(body.voice_transcript).slice(0, 8000)
  const voiceAudioPath = body.voice_audio_path == null ? null : String(body.voice_audio_path).slice(0, 500)

  // Insert the field_visit. The trigger threads the activity through the
  // venue's primary contact + bumps last_visited_at on venue/contact/deal.
  const { data: visit, error: visitErr } = await ctx.userClient
    .from('field_visits')
    .insert({
      org_id: stop.org_id,
      user_id: ctx.user.id,
      contact_id: null,
      venue_id: stop.venue_id,
      outcome,
      notes,
      voice_transcript: voiceTranscript,
      voice_audio_path: voiceAudioPath,
      lat,
      lng,
    })
    .select('id')
    .single()
  if (visitErr) {
    console.error('[route/mark-visited] field_visits insert', visitErr)
    return res.status(500).json({ error: 'DB error', detail: visitErr.message })
  }

  // Link the stop. Failure here is non-fatal — the visit is the source of truth.
  const { error: linkErr } = await ctx.userClient
    .from('route_stops')
    .update({ field_visit_id: visit.id })
    .eq('id', stopId)
  if (linkErr) {
    console.error('[route/mark-visited] route_stops link', linkErr)
  }

  // Loop-back: an email collected on a visit re-enters the normal pipeline.
  // Create a contact at verification_status='pending' (the column default) so
  // the verify-contacts cron picks it up → ZeroBounce → verify→draft. This
  // NEVER auto-sends — the human approve/send gate is untouched.
  let collectedContactId: string | null = null
  const rawEmail = body.collected_email == null ? '' : String(body.collected_email).trim().toLowerCase()
  if (outcome === 'collected_email' && rawEmail && stop.venue_id) {
    if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 320) {
      return res.status(422).json({ error: 'collected_email is not a valid email address', field_visit_id: visit.id })
    }
    // Skip if this venue already has the same email (don't create duplicates).
    const { data: existing } = await ctx.admin
      .from('contacts')
      .select('id')
      .eq('org_id', stop.org_id)
      .eq('venue_id', stop.venue_id)
      .ilike('email', rawEmail)
      .maybeSingle()

    if (existing?.id) {
      collectedContactId = existing.id
    } else {
      const fullName = (stop.venue_name_cached as string | null)?.trim() || 'Collected on visit'
      const { data: contact, error: contactErr } = await ctx.admin
        .from('contacts')
        .insert({
          org_id: stop.org_id,
          venue_id: stop.venue_id,
          full_name: fullName,
          email: rawEmail,
          source: 'manual',
        })
        .select('id')
        .single()
      if (contactErr) {
        // Non-fatal: the visit + outcome are already recorded. Surface for logs.
        console.error('[route/mark-visited] collected_email contact insert', contactErr)
      } else {
        collectedContactId = contact.id
      }
    }
  }

  return res.status(200).json({ field_visit_id: visit.id, collected_contact_id: collectedContactId })
}
