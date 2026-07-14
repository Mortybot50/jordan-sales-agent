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

  // Validate the collected email BEFORE any DB mutation. Otherwise a malformed
  // (or empty) email records the visit + links the stop, then 422s — and the
  // retry hits the already-visited 409, so the contact is never created and
  // there's no recovery path.
  const rawEmail = body.collected_email == null ? '' : String(body.collected_email).trim().toLowerCase()
  if (outcome === 'collected_email') {
    if (!rawEmail) {
      return res.status(422).json({ error: 'collected_email is required when outcome is collected_email' })
    }
    if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 320) {
      return res.status(422).json({ error: 'collected_email is not a valid email address' })
    }
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

  // Loop-back: an email collected on a visit re-enters the normal pipeline via
  // a contact at verification_status='pending' (the column default) so the
  // verify-contacts cron picks it up → ZeroBounce → verify→draft. NEVER
  // auto-sends — the human approve/send gate is untouched.
  //
  // This runs BEFORE the field_visit insert + stop link on purpose. If it ran
  // after, a contact-insert failure would leave the visit recorded and the stop
  // linked (field_visit_id set), so the retry would hit the 409-already-visited
  // branch and the email would be silently lost with no recovery path. Doing it
  // first means a failure returns a recoverable 502 with nothing linked, and the
  // retry re-runs cleanly. The venue-scoped email lookup makes it idempotent:
  // if a prior attempt created the contact but then died before linking, the
  // retry finds the existing contact instead of duplicating it.
  // rawEmail is already validated above (before any mutation).
  let collectedContactId: string | null = null
  if (outcome === 'collected_email' && rawEmail && stop.venue_id) {
    // .limit(1) makes .maybeSingle() safe: a venue can hold multiple contacts
    // sharing an email (no venue/email unique constraint), and an unbounded
    // .maybeSingle() would ERROR on >1 row. Order deterministically so the same
    // existing contact is picked every retry instead of inserting a duplicate.
    const { data: existing, error: lookupErr } = await ctx.admin
      .from('contacts')
      .select('id, verification_status')
      .eq('org_id', stop.org_id)
      .eq('venue_id', stop.venue_id)
      .ilike('email', rawEmail)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (lookupErr) {
      // Recoverable: nothing linked yet. Surface so the client retries rather
      // than falling through to insert a duplicate contact.
      console.error('[route/mark-visited] collected_email contact lookup', lookupErr)
      return res.status(502).json({ error: 'Failed to save collected email — nothing recorded, please retry', detail: lookupErr.message })
    }

    if (existing?.id) {
      collectedContactId = existing.id
      // If a prior verdict left this email in a terminal non-deliverable state
      // (invalid / unknown / catch_all / disposable), the verify worker will
      // never re-claim it — leadflow_claim_pending_contacts only claims
      // verification_status='pending'. Jordan just physically re-collected the
      // address, which overrides the stale verdict, so reset it to the same
      // fresh state a brand-new contact starts in and let ZeroBounce re-judge.
      // 'valid' is already deliverable — leave it (don't burn a credit or risk a
      // downgrade); 'pending' is already queued — no-op.
      const vs = existing.verification_status
      if (vs !== 'pending' && vs !== 'valid') {
        const { error: requeueErr } = await ctx.admin
          .from('contacts')
          .update({
            verification_status: 'pending',
            verified_at: null,
            verification_claimed_at: null,
            catch_all_flag: false,
            role_based: null,
          })
          .eq('id', existing.id)
        if (requeueErr) {
          // Recoverable: nothing linked yet, so a retry re-runs and re-attempts
          // the requeue (idempotent — a now-pending contact skips this branch).
          console.error('[route/mark-visited] collected_email requeue', requeueErr)
          return res.status(502).json({ error: 'Failed to requeue collected email for verification — please retry', detail: requeueErr.message })
        }
      }
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
        // Recoverable: nothing is linked yet, so a retry with the same body
        // re-runs from scratch. Return 5xx so the client knows to retry.
        console.error('[route/mark-visited] collected_email contact insert', contactErr)
        return res.status(502).json({ error: 'Failed to save collected email — nothing recorded, please retry', detail: contactErr.message })
      }
      collectedContactId = contact.id
    }

    // Surface the venue back into the leads inbox so the collected email flows
    // through the SAME human chain every other lead uses: appear in the inbox →
    // Jordan clicks Approve → approve-lead runs verify → deal → enroll → tick →
    // step-1 draft lands in the review queue. We do NOT auto-approve or enrol
    // here — that would bypass the human send gate.
    //
    // The gate for "already in active outreach, leave it alone" is an OPEN deal
    // (closed_at IS NULL — the same idempotency signal approve-lead uses), NOT
    // review_status='approved'. approve-lead deliberately leaves a venue
    // 'approved' with no deal in its "needs contact" terminal case, so gating on
    // status alone would strand a later collected email on such a venue. A venue
    // already 'pending' is in the inbox — no-op.
    const { data: venueRow } = await ctx.admin
      .from('venues')
      .select('review_status')
      .eq('id', stop.venue_id)
      .maybeSingle()
    const reviewStatus = (venueRow?.review_status as string | null) ?? null
    if (reviewStatus !== 'pending') {
      const { data: openDeal } = await ctx.admin
        .from('deals')
        .select('id')
        .eq('venue_id', stop.venue_id)
        .is('closed_at', null)
        .limit(1)
        .maybeSingle()
      if (!openDeal) {
        const { error: reviewErr } = await ctx.admin
          .from('venues')
          .update({
            review_status: 'pending',
            review_decided_at: null,
            review_decided_by: null,
          })
          .eq('id', stop.venue_id)
          .eq('org_id', stop.org_id)
        if (reviewErr) {
          // Non-fatal: the contact is saved either way. Worst case the venue
          // isn't re-surfaced and Jordan re-approves it manually.
          console.error('[route/mark-visited] collected_email venue re-surface', reviewErr)
        }
      }
    }
  }

  // Insert the field_visit. The trigger threads the activity through the
  // venue's primary contact + bumps last_visited_at on venue/contact/deal.
  const { data: visit, error: visitErr } = await ctx.userClient
    .from('field_visits')
    .insert({
      org_id: stop.org_id,
      user_id: ctx.user.id,
      // Link to the collected contact so the trigger threads the activity onto
      // the right contact + bumps its last_visited_at. null for every other
      // outcome (collectedContactId is only ever set on the collected_email
      // path); the trigger then falls back to the venue's primary contact.
      contact_id: collectedContactId,
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

  return res.status(200).json({ field_visit_id: visit.id, collected_contact_id: collectedContactId })
}
