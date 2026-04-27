/**
 * Calendly webhook — receives booking events and creates activities + advances deal stages.
 *
 * Events handled:
 *   invitee.created  → insert meeting_booked activity, advance deal stage if in New/Contacted/Replied
 *   invitee.canceled → insert note activity
 *
 * Required env vars:
 *   CALENDLY_WEBHOOK_SIGNING_KEY  from Calendly developer portal (HARD-REQUIRED in prod)
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'

const CALENDLY_SIGNING_KEY = process.env.CALENDLY_WEBHOOK_SIGNING_KEY
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'

// Stages that should auto-advance to "Meeting Booked" on a calendly booking
const ADVANCE_FROM_STAGE_NAMES = ['new', 'new lead', 'contacted', 'replied']

function verifySignature(body: string, signature: string, key: string): boolean {
  const expected = createHmac('sha256', key).update(body).digest('hex')
  const a = Buffer.from(signature, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // S1: signature verification HARD-FAILS in prod when the signing key is unset.
  // No silent fallthrough — that's how the webhook shipped to prod unauthenticated.
  if (!CALENDLY_SIGNING_KEY) {
    if (IS_PRODUCTION) {
      console.error('CALENDLY_WEBHOOK_SIGNING_KEY missing — webhook disabled')
      return res.status(503).json({ error: 'Webhook not configured' })
    }
    console.warn('CALENDLY_WEBHOOK_SIGNING_KEY not set — skipping signature verification (dev mode only)')
  } else {
    const signature = req.headers['calendly-webhook-signature'] as string | undefined
    const rawBody = JSON.stringify(req.body)
    if (!signature || !verifySignature(rawBody, signature, CALENDLY_SIGNING_KEY)) {
      return res.status(401).json({ error: 'Invalid signature' })
    }
  }

  const payload = req.body as {
    event: string
    payload: {
      event: { uri: string; name: string; start_time: string }
      invitee: { email: string; name: string; uri: string }
      // Calendly delivers the host's calendar account in scheduled_event.event_memberships[].user_email
      scheduled_event?: {
        event_memberships?: Array<{ user_email?: string; user?: string }>
      }
      questions_and_answers?: Array<{ question: string; answer: string }>
    }
  }

  const eventType = payload.event
  const invitee = payload.payload?.invitee
  const event = payload.payload?.event

  if (!invitee?.email || !event) {
    return res.status(400).json({ error: 'Missing invitee or event data' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // S1: scope the contact lookup to a single org by mapping the Calendly host
  // account email → user.calendly_account_email → user.org_id.
  const hostEmails = (payload.payload?.scheduled_event?.event_memberships ?? [])
    .map((m) => (m.user_email ?? '').toLowerCase().trim())
    .filter((e) => e.length > 0)

  let scopedUser: { id: string; org_id: string } | null = null
  if (hostEmails.length > 0) {
    const { data: matchedUser } = await supabase
      .from('users')
      .select('id, org_id')
      .in('calendly_account_email', hostEmails)
      .limit(1)
      .maybeSingle()
    scopedUser = (matchedUser ?? null) as { id: string; org_id: string } | null
  }

  if (!scopedUser) {
    // No org mapping — return 200 (don't leak existence) but write nothing.
    console.info(
      'Calendly webhook: no users.calendly_account_email match for host emails',
      hostEmails,
    )
    return res.status(200).json({ status: 'no_match' })
  }

  // Find matching contact within the scoped org only.
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, org_id, venue_id')
    .eq('org_id', scopedUser.org_id)
    .ilike('email', invitee.email.toLowerCase())

  if (!contacts || contacts.length === 0) {
    console.info('No contact found in org for Calendly invitee:', invitee.email)
    return res.status(200).json({ status: 'no_match' })
  }

  for (const contact of contacts) {
    // Find open deal for this contact
    const { data: deal } = await supabase
      .from('deals')
      .select('id, stage_id, stage:pipeline_stages(id, name, position)')
      .eq('contact_id', contact.id)
      .is('closed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const startTime = event.start_time ? new Date(event.start_time).toISOString() : new Date().toISOString()

    if (eventType === 'invitee.created') {
      // Insert calendly_event record
      await supabase
        .from('calendly_events')
        .upsert({
          org_id: contact.org_id,
          deal_id: deal?.id ?? null,
          contact_id: contact.id,
          event_type: 'invitee.created',
          invitee_email: invitee.email,
          invitee_name: invitee.name,
          event_name: event.name,
          event_start: startTime,
          raw_payload: payload.payload,
          received_at: new Date().toISOString(),
        }, { onConflict: 'invitee_email,event_start', ignoreDuplicates: true })

      // Insert meeting_booked activity
      await supabase
        .from('activities')
        .insert({
          org_id: contact.org_id,
          contact_id: contact.id,
          deal_id: deal?.id ?? null,
          activity_type: 'meeting_booked',
          subject: `${event.name} confirmed`,
          body: `Calendly booking: ${invitee.name} (${invitee.email}) — ${new Date(startTime).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })} AEST`,
          occurred_at: new Date().toISOString(),
        })

      // Advance deal stage to "Meeting Booked" if currently in New/Contacted/Replied
      if (deal?.id) {
        // Supabase typegen returns FK relations as arrays; runtime is a single object for to-one relations
        const stageRel = (Array.isArray(deal.stage) ? deal.stage[0] : deal.stage) as { name: string } | null | undefined
        const stageName = (stageRel?.name ?? '').toLowerCase()
        const shouldAdvance = ADVANCE_FROM_STAGE_NAMES.some((s) => stageName.includes(s))

        if (shouldAdvance) {
          // Find Meeting Booked stage for this org
          const { data: meetingStage } = await supabase
            .from('pipeline_stages')
            .select('id')
            .eq('org_id', contact.org_id)
            .ilike('name', 'meeting booked')
            .single()

          if (meetingStage) {
            await supabase
              .from('deals')
              .update({ stage_id: meetingStage.id, updated_at: new Date().toISOString() })
              .eq('id', deal.id)

            await supabase
              .from('activities')
              .insert({
                org_id: contact.org_id,
                contact_id: contact.id,
                deal_id: deal.id,
                activity_type: 'stage_change',
                subject: `Stage advanced to Meeting Booked (auto — Calendly booking)`,
                occurred_at: new Date().toISOString(),
              })
          }
        }
      }
    } else if (eventType === 'invitee.canceled') {
      await supabase
        .from('activities')
        .insert({
          org_id: contact.org_id,
          contact_id: contact.id,
          deal_id: deal?.id ?? null,
          activity_type: 'note',
          subject: `Calendly meeting cancelled — ${event.name}`,
          body: `${invitee.name} cancelled their booking for ${new Date(startTime).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne' })}.`,
          occurred_at: new Date().toISOString(),
        })
    }
  }

  return res.status(200).json({ status: 'processed' })
}
