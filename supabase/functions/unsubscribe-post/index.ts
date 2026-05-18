/**
 * unsubscribe-post — RFC 8058 one-click List-Unsubscribe endpoint.
 *
 * Endpoint:
 *   /functions/v1/unsubscribe-post?c=<contact_id>&s=<send_queue_id>&t=<hmac_hex>
 *
 * Only POST mutates state. Per RFC 8058 §3.1 the one-click flow MUST be
 * triggered by a POST; GET requests are used by mail-security scanners and
 * link-preview prefetchers and must NOT auto-unsubscribe (otherwise any
 * inbox-scanner that follows the URL silently kills the contact).
 *
 * GET   → renders a tiny HTML confirmation page with a POST form.
 * POST  → verifies HMAC tuple, inserts suppression row, returns 204.
 *
 * Idempotent — already-suppressed addresses still return 204.
 *
 * verify_jwt MUST be false (this endpoint is hit by mail clients with no auth).
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, UNSUBSCRIBE_SIGNING_KEY
 */

// @ts-expect-error Deno edge runtime import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyUnsubTuple } from '../_shared/unsub-token.ts'
import { redactEmail } from '../_shared/pii.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const UNSUBSCRIBE_SIGNING_KEY = Deno.env.get('UNSUBSCRIBE_SIGNING_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}

function confirmationPage(qs: string): Response {
  // GET fallback for humans (and for mail-security URL scanners). Never mutates.
  // Mail clients implementing RFC 8058 send POST and never see this page.
  const html = `<!doctype html><meta charset="utf-8"><title>Unsubscribe</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#0f172a}button{font:inherit;padding:10px 20px;background:#0f172a;color:#fff;border:0;border-radius:8px;cursor:pointer}p{color:#475569}</style>
<h1>Confirm unsubscribe</h1>
<p>Click the button below to remove yourself from future emails from this sender.</p>
<form method="POST" action="?${qs}"><button type="submit">Unsubscribe</button></form>`
  return new Response(html, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const url = new URL(req.url)

  // RFC 8058: only POST may unsubscribe. GET is for human confirmation only —
  // mail-security scanners pre-fetch URLs and would otherwise auto-suppress.
  if (req.method === 'GET') {
    return confirmationPage(url.searchParams.toString())
  }

  if (UNSUBSCRIBE_SIGNING_KEY.length < 32) {
    console.error('UNSUBSCRIBE_SIGNING_KEY missing/too short')
    // Don't reveal config state to the world — return 204 but log.
    return noContent()
  }

  const contactId = url.searchParams.get('c') ?? ''
  const sendQueueId = url.searchParams.get('s') ?? ''
  const token = url.searchParams.get('t') ?? ''

  // Basic UUID shape check — keeps non-UUID inputs from hitting Postgres.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(contactId) || !uuidRe.test(sendQueueId) || !/^[0-9a-f]{8,}$/i.test(token)) {
    // RFC 8058 just wants 204 — never tell scrapers whether their guess hit.
    return noContent()
  }

  const ok = await verifyUnsubTuple(contactId, sendQueueId, token, UNSUBSCRIBE_SIGNING_KEY)
  if (!ok) {
    return noContent()
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Resolve contact -> email + org_id
  const { data: contact, error: cErr } = await supabase
    .from('contacts')
    .select('id, email, org_id')
    .eq('id', contactId)
    .maybeSingle()
  if (cErr || !contact || !contact.email) {
    return noContent()
  }
  const email = String(contact.email).toLowerCase().trim()

  // Already suppressed? Still return 204 (idempotent).
  const { data: existing } = await supabase
    .from('suppression_list')
    .select('id')
    .eq('org_id', contact.org_id)
    .eq('email', email)
    .maybeSingle()

  if (!existing) {
    const { error: insErr } = await supabase.from('suppression_list').insert({
      org_id: contact.org_id,
      email,
      reason: 'unsubscribe',
      source: 'leadflow_unsubscribe_post',
      notes: 'RFC 8058 one-click unsubscribe',
      domain_suppression: false,
    })
    if (insErr) {
      console.error('suppression insert failed:', insErr.message)
      // Still 204 — never break the mail client's UX.
      return noContent()
    }
  }

  // Log an event for analytics (best-effort).
  await supabase.from('email_send_events').insert({
    org_id: contact.org_id,
    send_queue_id: sendQueueId,
    event_type: 'unsubscribed',
    metadata: {
      source: 'list_unsubscribe_post',
      to_hashed: await redactEmail(email),
    },
  })

  return noContent()
})
