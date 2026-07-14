/**
 * approve-lead — the leads-inbox Approve chain (Jordan-facing, verify_jwt=true).
 *
 * POST { venue_id: uuid }
 *
 * Runs the FULL settled chain server-side and reports per-step results:
 *   1. crawl    — if the venue has no contacts, invoke crawl-venue-contacts
 *   2. verify   — internal verification (syntax/MX/role/tier) on every
 *                 unverified contact via _shared/verify-email (adapter —
 *                 no paid provider, by decision)
 *   3. deal     — create a deal in New (business-name title, no value,
 *                 temperature cold/auto)
 *   4. enroll   — best contact (tier asc, valid first) into the canonical
 *                 sequence (is_canonical = true)
 *   5. tick     — fire sequence-tick so the step-1 draft lands in Jordan's
 *                 review queue immediately, not at the next hourly cron
 *
 * Crawl finding nothing is NOT a failure of the chain: the venue is still
 * approved and flagged "needs contact" (review_notes) — the UI shows it.
 *
 * Response: { ok, steps: [{ step, status: 'ok'|'skipped'|'failed', detail }] }
 */
// @ts-expect-error Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getVerifyProvider } from '../_shared/verify-email.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface Step {
  step: 'crawl' | 'verify' | 'deal' | 'enroll' | 'tick'
  status: 'ok' | 'skipped' | 'failed'
  detail: string
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  // Caller must be a signed-in operator (gateway verified the JWT signature).
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!jwt) return json(401, { error: 'Authentication required' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: userRes, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !userRes?.user) return json(401, { error: 'Invalid token' })
  const userId = userRes.user.id

  const { data: profile } = await supabase
    .from('users').select('id, org_id').eq('id', userId).maybeSingle()
  if (!profile?.org_id) return json(403, { error: 'No org membership' })
  const orgId = profile.org_id as string

  let venueId: string | null = null
  try {
    const body = await req.json()
    venueId = typeof body?.venue_id === 'string' ? body.venue_id : null
  } catch { /* fallthrough */ }
  if (!venueId) return json(400, { error: 'venue_id is required' })

  const { data: venue } = await supabase
    .from('venues')
    .select('id, org_id, name, website, review_status')
    .eq('id', venueId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!venue) return json(404, { error: 'Venue not found' })

  const steps: Step[] = []

  // Approve up front — the venue is approved even if later steps stumble.
  await supabase
    .from('venues')
    .update({
      review_status: 'approved',
      review_decided_at: new Date().toISOString(),
      review_decided_by: userId,
    })
    .eq('id', venue.id)

  // ── 1. Crawl (only when no contacts exist) ────────────────────────────
  const { data: existingContacts } = await supabase
    .from('contacts')
    .select('id, email, email_tier, verification_status, full_name, catch_all_flag, role_based')
    .eq('venue_id', venue.id)

  let contacts = existingContacts ?? []
  if (contacts.length > 0) {
    steps.push({ step: 'crawl', status: 'skipped', detail: `${contacts.length} contact(s) already on file` })
  } else if (!venue.website) {
    steps.push({ step: 'crawl', status: 'failed', detail: 'No website on record — add a contact manually' })
  } else {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/crawl-venue-contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ venue_id: venue.id }),
      })
      const crawlBody = await r.json().catch(() => ({}))
      const { data: after } = await supabase
        .from('contacts')
        .select('id, email, email_tier, verification_status, full_name, catch_all_flag, role_based')
        .eq('venue_id', venue.id)
      contacts = after ?? []
      steps.push({
        step: 'crawl',
        status: r.ok ? 'ok' : 'failed',
        detail: r.ok
          ? `${contacts.length} contact(s) found`
          : `Crawler error: ${JSON.stringify(crawlBody).slice(0, 120)}`,
      })
    } catch (e) {
      steps.push({ step: 'crawl', status: 'failed', detail: `Crawler unreachable: ${String(e).slice(0, 120)}` })
    }
  }

  // ── 2. Internal verification on unverified contacts ──────────────────
  const provider = getVerifyProvider()
  let verified = 0
  for (const c of contacts) {
    if (!c.email) continue
    if (c.verification_status && c.verification_status !== 'pending') continue
    try {
      const v = await provider.verify(c.email)
      // The internal provider is only a cheap PRE-filter (syntax/MX/role/tier);
      // ZeroBounce (the leadflow-verify-contacts cron) is the AUTHORITATIVE
      // deliverability verdict and it only claims rows still at 'pending'. So:
      //   - a confident 'invalid' (malformed / no MX) is written now — no point
      //     spending a ZeroBounce credit on a domain that can't receive mail;
      //   - 'valid' (MX exists) and 'risky' (role address / MX lookup failed)
      //     are LEFT 'pending' so ZeroBounce still supplies the real verdict.
      // Internal 'valid' is MX-existence only, NOT deliverability — promoting it
      // to verification_status='valid' would both strand the contact out of the
      // ZeroBounce backlog AND make the send gates treat an unverified mailbox
      // as sendable. We always stamp the tier, which is useful regardless.
      if (v.result === 'invalid') {
        await supabase
          .from('contacts')
          .update({
            verification_status: 'invalid',
            email_tier: v.tier,
            verified_at: new Date().toISOString(),
          })
          .eq('id', c.id)
        c.verification_status = 'invalid'
        c.email_tier = v.tier
        verified++
      } else {
        await supabase
          .from('contacts')
          .update({ email_tier: v.tier })
          .eq('id', c.id)
        c.email_tier = v.tier
      }
    } catch (e) {
      console.error('verify failed for contact', c.id, e)
    }
  }
  steps.push({
    step: 'verify',
    status: contacts.length === 0 ? 'skipped' : 'ok',
    detail: contacts.length === 0 ? 'No contacts to verify' : `internal pre-filter ran on ${contacts.length} contact(s), ${verified} rejected as invalid — deliverability is confirmed by ZeroBounce`,
  })

  // Send gate (Jordan's rule): a contact is only enrollable — i.e. eligible to
  // enter the outbound sequence — when it is GENUINELY DELIVERABLE:
  //   verification_status = 'valid' AND NOT catch_all_flag AND NOT role_based.
  // 'pending' / 'unknown' / 'catch_all' / role inboxes (info@, bookings@ …) are
  // NEVER auto-enrolled — they need a human to make the call. This is the
  // machine half of the human-review gate; the draft still lands in the review
  // queue for sign-off before anything is sent.
  const usable = contacts
    .filter((c) =>
      !!c.email &&
      c.verification_status === 'valid' &&
      c.catch_all_flag !== true &&
      c.role_based !== true,
    )
    .sort((a, b) => (a.email_tier ?? 3) - (b.email_tier ?? 3))
  if (usable.length === 0) {
    // Distinguish "still waiting on ZeroBounce" from "genuinely no usable
    // email". A contact that is still 'pending' (email present, not role-based,
    // ZeroBounce hasn't returned its verdict yet) may still become 'valid'.
    // We must NOT leave such a venue stranded at review_status='approved': the
    // leads inbox only lists pending venues and the verification cron creates
    // no deal / enrolment, so an approved-but-unenrolled venue would vanish
    // with no way to retry. Instead we revert it to 'pending' so it stays in
    // the inbox and is re-approvable the moment a deliverable email is
    // confirmed. Terminal cases (only role/catch-all/unknown/invalid emails,
    // or no email at all) get the honest "needs contact" flag and stay
    // approved — retrying them would never change the outcome.
    const awaitingVerification = contacts.some((c) =>
      !!c.email &&
      (c.verification_status == null || c.verification_status === 'pending') &&
      c.role_based !== true &&
      c.catch_all_flag !== true,
    )
    if (awaitingVerification) {
      await supabase
        .from('venues')
        .update({
          review_status: 'pending',
          review_decided_at: null,
          review_decided_by: null,
          review_notes: 'awaiting email verification (ZeroBounce) — approve again once a deliverable email is confirmed',
        })
        .eq('id', venue.id)
      steps.push({ step: 'deal', status: 'skipped', detail: 'Email(s) still awaiting ZeroBounce verification — kept in the inbox to retry once confirmed deliverable' })
      return json(200, { ok: true, awaiting_verification: true, steps })
    }
    await supabase
      .from('venues')
      .update({ review_notes: 'needs contact — no verified-deliverable email (need valid, not catch-all, not role-based)' })
      .eq('id', venue.id)
    steps.push({ step: 'deal', status: 'skipped', detail: 'No verified-deliverable contact (valid, not catch-all, not role-based) — venue flagged "needs contact"' })
    return json(200, { ok: true, needs_contact: true, steps })
  }
  const best = usable[0]

  // ── 3. Deal in New ────────────────────────────────────────────────────
  const { data: newStage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('org_id', orgId)
    .eq('name', 'New')
    .maybeSingle()
  if (!newStage) {
    steps.push({ step: 'deal', status: 'failed', detail: "Pipeline has no 'New' stage" })
    return json(200, { ok: false, steps })
  }

  // Idempotency: an open deal for this venue means Approve already ran.
  const { data: existingDeal } = await supabase
    .from('deals')
    .select('id')
    .eq('venue_id', venue.id)
    .is('closed_at', null)
    .maybeSingle()

  let dealId: string
  if (existingDeal) {
    dealId = existingDeal.id
    steps.push({ step: 'deal', status: 'skipped', detail: 'Open deal already exists for this venue' })
  } else {
    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .insert({
        org_id: orgId,
        venue_id: venue.id,
        contact_id: best.id,
        stage_id: newStage.id,
        title: venue.name,
        temperature: 'cold',
        temperature_source: 'auto',
        owner_user_id: userId,
        notes: `[leads-inbox] approved from sourcing inbox ${new Date().toISOString().slice(0, 10)}`,
      })
      .select('id')
      .single()
    if (dealErr || !deal) {
      steps.push({ step: 'deal', status: 'failed', detail: dealErr?.message ?? 'insert failed' })
      return json(200, { ok: false, steps })
    }
    dealId = deal.id
    steps.push({ step: 'deal', status: 'ok', detail: `Deal created in New — "${venue.name}"` })
  }

  // ── 4. Enroll best contact in the canonical sequence ─────────────────
  const { data: canonical } = await supabase
    .from('sequences')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('is_canonical', true)
    .eq('is_active', true)
    .maybeSingle()
  if (!canonical) {
    steps.push({ step: 'enroll', status: 'failed', detail: 'No active canonical sequence configured' })
    return json(200, { ok: false, steps })
  }

  const { data: existingEnrol } = await supabase
    .from('sequence_enrollments')
    .select('id')
    .eq('contact_id', best.id)
    .eq('sequence_id', canonical.id)
    .in('status', ['active', 'paused'])
    .maybeSingle()

  if (existingEnrol) {
    steps.push({ step: 'enroll', status: 'skipped', detail: 'Contact already enrolled in the canonical sequence' })
  } else {
    // Suppression gate — same firewall as every other outbound surface.
    const { data: suppressed } = await supabase.rpc('is_suppressed', {
      p_org_id: orgId,
      p_email: best.email,
    })
    if (suppressed === true) {
      steps.push({ step: 'enroll', status: 'failed', detail: `${best.email} is on the suppression list` })
      return json(200, { ok: false, steps })
    }
    const { error: enrolErr } = await supabase.from('sequence_enrollments').insert({
      org_id: orgId,
      sequence_id: canonical.id,
      deal_id: dealId,
      contact_id: best.id,
      enrolled_by_user_id: userId,
      status: 'active',
    })
    if (enrolErr) {
      steps.push({ step: 'enroll', status: 'failed', detail: enrolErr.message })
      return json(200, { ok: false, steps })
    }
    steps.push({
      step: 'enroll',
      status: 'ok',
      detail: `${best.full_name ?? best.email} → ${canonical.name} (tier ${best.email_tier ?? '?'} ${best.verification_status})`,
    })
  }

  // ── 5. Fire sequence-tick so the step-1 draft lands NOW ──────────────
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/sequence-tick`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({}),
    })
    steps.push({
      step: 'tick',
      status: r.ok ? 'ok' : 'failed',
      detail: r.ok ? 'Sequence tick fired — step-1 draft heading to your review queue' : `tick HTTP ${r.status}`,
    })
  } catch (e) {
    steps.push({ step: 'tick', status: 'failed', detail: `tick unreachable (hourly cron will catch up): ${String(e).slice(0, 80)}` })
  }

  return json(200, { ok: steps.every((s) => s.status !== 'failed'), steps })
})
