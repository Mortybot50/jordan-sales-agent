/**
 * Instantly.ai webhook — receives cold-email events and writes them to the DB.
 *
 * Events handled:
 *   reply_received / email_replied → activities.reply_received
 *   email_bounced                  → suppression_list (bounce_hard) + bounce activity
 *   email_unsubscribed             → suppression_list (unsubscribe) + unsubscribe activity
 *   anything else                  → console.log + 200 (so Instantly stops retrying)
 *
 * Multi-tenancy:
 *   We look up matching contacts by email (lowercase) across all orgs and
 *   write per-contact, scoping every row to that contact's own org_id.
 *   No contact match → 200 + no-op (webhooks must be tolerant).
 *
 * Required env vars:
 *   INSTANTLY_WEBHOOK_SIGNING_KEY  — HMAC-SHA256 secret shared with Instantly
 *                                   (HARD-REQUIRED in prod)
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'

const INSTANTLY_SIGNING_KEY = process.env.INSTANTLY_WEBHOOK_SIGNING_KEY
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'

// TODO(day2): confirm exact header name when Instantly webhook is configured.
// Their docs reference `x-instantly-signature` for HMAC-SHA256(body) hex.
const SIGNATURE_HEADER = 'x-instantly-signature'

export function verifySignature(body: string, signature: string, key: string): boolean {
  const expected = createHmac('sha256', key).update(body).digest('hex')
  let provided = signature.trim()
  // Some providers prefix with `sha256=` — be tolerant.
  if (provided.startsWith('sha256=')) provided = provided.slice('sha256='.length)
  let a: Buffer
  try {
    a = Buffer.from(provided, 'hex')
  } catch {
    return false
  }
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

interface InstantlyPayload {
  event_type?: string
  event?: string
  // Common fields across Instantly event shapes — all optional because the
  // schema differs slightly per event type and we never trust the payload.
  email?: string
  lead_email?: string
  to_email?: string
  from_email?: string
  account_email?: string
  campaign_id?: string
  campaign_name?: string
  message_id?: string
  reply_subject?: string
  reply_text?: string
  reply_html?: string
  bounce_reason?: string
  timestamp?: string
  [key: string]: unknown
}

function pickEvent(payload: InstantlyPayload): string {
  return (payload.event_type ?? payload.event ?? '').toString().toLowerCase()
}

function pickLeadEmail(payload: InstantlyPayload): string | null {
  const raw = payload.lead_email ?? payload.email ?? payload.to_email ?? null
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function occurredAtFrom(payload: InstantlyPayload): string {
  const ts = payload.timestamp
  if (typeof ts === 'string') {
    const d = new Date(ts)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // S1: signature verification HARD-FAILS in prod when the signing key is unset.
  // Mirror the Calendly webhook — no silent fallthrough.
  if (!INSTANTLY_SIGNING_KEY) {
    if (IS_PRODUCTION) {
      console.error('INSTANTLY_WEBHOOK_SIGNING_KEY missing — webhook disabled')
      return res.status(503).json({ error: 'Webhook not configured' })
    }
    console.warn(
      'INSTANTLY_WEBHOOK_SIGNING_KEY not set — skipping signature verification (dev mode only)',
    )
  } else {
    const signature = req.headers[SIGNATURE_HEADER] as string | undefined
    const rawBody = JSON.stringify(req.body)
    if (!signature || !verifySignature(rawBody, signature, INSTANTLY_SIGNING_KEY)) {
      return res.status(401).json({ error: 'Invalid signature' })
    }
  }

  const payload = (req.body ?? {}) as InstantlyPayload
  const eventType = pickEvent(payload)
  const leadEmail = pickLeadEmail(payload)

  if (!eventType) {
    // No event type at all — accept and ignore so retries stop.
    console.warn('Instantly webhook: missing event_type', { keys: Object.keys(payload) })
    return res.status(200).json({ status: 'ignored', reason: 'no_event_type' })
  }

  if (!leadEmail) {
    console.warn('Instantly webhook: missing lead email for event', eventType)
    return res.status(200).json({ status: 'ignored', reason: 'no_lead_email', event: eventType })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Find every contact (across orgs) matching this email. Per-contact writes
  // are scoped to that contact's own org_id, so we never leak across tenants.
  const { data: contacts, error: contactErr } = await supabase
    .from('contacts')
    .select('id, org_id')
    .ilike('email', leadEmail)

  if (contactErr) {
    console.error('Instantly webhook: contact lookup failed', contactErr)
    // Still 200 — webhook retries won't fix a transient DB issue here.
    return res.status(200).json({ status: 'error', reason: 'contact_lookup_failed' })
  }

  if (!contacts || contacts.length === 0) {
    console.info('Instantly webhook: no contact match', { email: leadEmail, event: eventType })
    return res.status(200).json({ status: 'no_match', event: eventType })
  }

  const occurredAt = occurredAtFrom(payload)
  const metadataBase = {
    instantly_event_type: eventType,
    instantly_message_id: payload.message_id ?? null,
    campaign_id: payload.campaign_id ?? null,
    campaign_name: payload.campaign_name ?? null,
    from_email: payload.from_email ?? payload.account_email ?? null,
  }

  // Branch by event type. Anything we don't explicitly handle is logged and
  // accepted — Instantly should not keep retrying unknown events.
  switch (eventType) {
    case 'reply_received':
    case 'email_replied': {
      for (const c of contacts) {
        // Find latest open deal for this contact (best-effort link).
        const { data: deal } = await supabase
          .from('deals')
          .select('id')
          .eq('org_id', c.org_id)
          .eq('contact_id', c.id)
          .is('closed_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const subject = (payload.reply_subject as string | undefined) ?? null
        const body =
          (payload.reply_text as string | undefined) ??
          (payload.reply_html as string | undefined) ??
          null

        await supabase.from('activities').insert({
          org_id: c.org_id,
          contact_id: c.id,
          deal_id: deal?.id ?? null,
          activity_type: 'reply_received',
          subject: subject ? subject.slice(0, 255) : null,
          body: body ? body.slice(0, 4000) : null,
          metadata: metadataBase,
          occurred_at: occurredAt,
        })
      }
      break
    }

    case 'email_bounced': {
      for (const c of contacts) {
        // Idempotent suppression insert: skip if already present in this org.
        const { data: existing } = await supabase
          .from('suppression_list')
          .select('id')
          .eq('org_id', c.org_id)
          .eq('email', leadEmail)
          .maybeSingle()

        if (!existing) {
          const { error: supErr } = await supabase.from('suppression_list').insert({
            org_id: c.org_id,
            email: leadEmail,
            reason: 'bounce_hard',
            source: 'instantly_webhook',
            notes: payload.bounce_reason ?? null,
            domain_suppression: false,
          })
          if (supErr) {
            console.error('Instantly webhook: suppression insert (bounce) failed', supErr)
          }
        }

        await supabase.from('activities').insert({
          org_id: c.org_id,
          contact_id: c.id,
          activity_type: 'bounce',
          subject: 'Email bounced (Instantly)',
          body: (payload.bounce_reason as string | undefined) ?? null,
          metadata: metadataBase,
          occurred_at: occurredAt,
        })
      }
      // TODO(day2): when contacts.email_status column ships, mark contact
      // as 'bounced' here so it's filterable in the UI.
      break
    }

    case 'email_unsubscribed': {
      for (const c of contacts) {
        const { data: existing } = await supabase
          .from('suppression_list')
          .select('id')
          .eq('org_id', c.org_id)
          .eq('email', leadEmail)
          .maybeSingle()

        if (!existing) {
          const { error: supErr } = await supabase.from('suppression_list').insert({
            org_id: c.org_id,
            email: leadEmail,
            reason: 'unsubscribe',
            source: 'instantly_webhook',
            notes: 'Unsubscribed via Instantly link',
            domain_suppression: false,
          })
          if (supErr) {
            console.error('Instantly webhook: suppression insert (unsubscribe) failed', supErr)
          }
        }

        await supabase.from('activities').insert({
          org_id: c.org_id,
          contact_id: c.id,
          activity_type: 'unsubscribe',
          subject: 'Unsubscribed (Instantly)',
          metadata: metadataBase,
          occurred_at: occurredAt,
        })
      }
      break
    }

    case 'email_sent':
    case 'email_opened':
    case 'email_clicked':
    case 'lead_completed':
    default: {
      // Low-priority events — ignored for now. Keeping the switch open so
      // the next iteration can wire opens/clicks into the activity stream.
      // No webhook_events table exists yet; logging only.
      console.info('Instantly webhook: event ignored (not yet wired)', {
        event: eventType,
        email: leadEmail,
      })
      break
    }
  }

  return res.status(200).json({ status: 'processed', event: eventType, matches: contacts.length })
}
