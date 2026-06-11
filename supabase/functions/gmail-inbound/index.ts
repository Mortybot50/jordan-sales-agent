/**
 * gmail-inbound — Gmail Pub/Sub push webhook
 *
 * Receives inbound email notifications from Gmail Pub/Sub, parses the message,
 * stores it as an `email_inbound` activity, then fires classify-reply-intent
 * asynchronously (non-blocking).
 *
 * Setup required (Morty-side, gated on Google verification):
 *   1. Cloud Pub/Sub topic + subscription pointing at this function's URL
 *   2. Gmail Watch set up via users.watch() with label filter INBOX
 *   3. GMAIL_PUBSUB_AUDIENCE env var (base64-encoded JSON service account key)
 *      OR leave open and rely on Supabase secret verification header.
 *
 * The function does NOT touch Gmail OAuth — that's Morty-side gated.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Optional: shared secret Jordan sets in Pub/Sub push subscription attributes
const PUBSUB_TOKEN = Deno.env.get('GMAIL_PUBSUB_TOKEN')

interface PubSubMessage {
  message: {
    data: string // base64-encoded JSON
    messageId: string
    publishTime: string
    attributes?: Record<string, string>
  }
  subscription: string
}

interface GmailNotification {
  emailAddress: string
  historyId: string
}

/** Decode a base64 string safely (Deno-compatible). */
function decodeBase64(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Shared-token check — prevents random POST abuse. The token is MANDATORY:
  // when Pub/Sub goes live this function flips to verify_jwt=false, and an
  // unset env var must fail closed (503), never fall through to unauthenticated.
  if (!PUBSUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GMAIL_PUBSUB_TOKEN not configured' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const token = req.headers.get('x-pubsub-token') ?? new URL(req.url).searchParams.get('token')
  if (token !== PUBSUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let pubsub: PubSubMessage
  try {
    pubsub = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Decode Pub/Sub envelope
  let notification: GmailNotification
  try {
    notification = JSON.parse(decodeBase64(pubsub.message.data))
  } catch {
    // Pub/Sub requires 2xx to ack even malformed messages (otherwise it retries forever)
    console.warn('gmail-inbound: could not parse Pub/Sub data, acking anyway')
    return new Response('ok', { status: 200 })
  }

  const { emailAddress, historyId } = notification
  console.log(`gmail-inbound: notification for ${emailAddress}, historyId=${historyId}`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Look up the Jordan user by email address to get org_id
  const { data: jordanUser } = await supabase
    .from('users')
    .select('id, org_id')
    .eq('email', emailAddress)
    .maybeSingle()

  if (!jordanUser) {
    console.warn(`gmail-inbound: no user found for ${emailAddress}`)
    // Still ack — we don't want Pub/Sub to hammer us
    return new Response('ok', { status: 200 })
  }

  /**
   * NOTE: Full Gmail message fetch (history.list + messages.get) requires
   * an OAuth2 access token refreshed via the stored refresh token. That
   * Gmail OAuth setup is Morty-side gated. When wired, replace the stub
   * body below with real message fetch + parse logic.
   *
   * For now: record the notification event so the historyId is traceable,
   * and we can backfill when OAuth is live.
   */
  const { data: stubActivity, error: insertErr } = await supabase
    .from('activities')
    .insert({
      org_id: jordanUser.org_id,
      activity_type: 'email_inbound',
      subject: `[Pub/Sub notification] historyId=${historyId}`,
      body: null,
      occurred_at: pubsub.message.publishTime ?? new Date().toISOString(),
      metadata: {
        gmail_history_id: historyId,
        gmail_email_address: emailAddress,
        pubsub_message_id: pubsub.message.messageId,
        stub: true, // Remove when full OAuth fetch is wired
      },
    })
    .select('id')
    .single()

  if (insertErr) {
    console.error('gmail-inbound: failed to insert activity:', insertErr)
    // Still ack Pub/Sub
    return new Response('ok', { status: 200 })
  }

  // Kick off classifier async — don't await, must respond quickly to Pub/Sub
  if (stubActivity?.id) {
    const classifyUrl = `${SUPABASE_URL}/functions/v1/classify-reply-intent`
    fetch(classifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ activity_id: stubActivity.id }),
    }).catch((err) => {
      console.error('gmail-inbound: classify-reply-intent fire-and-forget failed:', err)
    })
  }

  // Pub/Sub requires 2xx within 10s to ack the message
  return new Response(JSON.stringify({ ok: true, activity_id: stubActivity?.id }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
