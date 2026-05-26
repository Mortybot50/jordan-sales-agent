// =============================================================================
// notify-warm-reply
// -----------------------------------------------------------------------------
// Called fire-and-forget by classify-reply-intent when a positive reply
// (confidence >= 0.8) lands. Builds a short WhatsApp message and enqueues it
// in notification_log (status='queued'). A separate poller on the Mac mini
// reads queued rows and sends them via the openclaw agent CLI.
//
// Modes:
//   POST { activity_id }            → real warm-reply enqueue
//   POST { test: true, user_id }    → test ping (no contact lookup)
//
// Idempotency:
//   For real warm-reply, skip if another warm_reply row exists for the same
//   activity_id within the last hour (status in queued|sent).
//
// Quiet hours:
//   If user has notify_quiet_hours_start/end set and the current AEST hour
//   falls in [start, end), log status='skipped' reason='quiet_hours' and
//   return (no send).
// =============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') ?? 'https://jordan-sales-agent.vercel.app'
const DEDUPE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Returns 0-23 hour in Australia/Melbourne (AEST/AEDT). */
function aestHourNow(): number {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    hour: 'numeric',
    hour12: false,
  })
  const raw = fmt.format(new Date())
  // "24" can appear on some locales for midnight — normalise.
  return parseInt(raw, 10) % 24
}

function inQuietHours(start: number | null, end: number | null, hour: number): boolean {
  if (start == null || end == null) return false
  // Same-day window (e.g. 22 → 23 means 22:00–23:00).
  if (start < end) return hour >= start && hour < end
  // Overnight window (e.g. 22 → 7 means 22:00–07:00).
  if (start > end) return hour >= start || hour < end
  // start == end: zero-width — never matches.
  return false
}

interface UserPrefs {
  id: string
  org_id: string
  notify_whatsapp_e164: string | null
  notify_warm_replies: boolean
  notify_quiet_hours_start: number | null
  notify_quiet_hours_end: number | null
}

async function loadUserPrefs(sb: SupabaseClient, userId: string): Promise<UserPrefs | null> {
  const { data, error } = await sb
    .from('users')
    .select('id, org_id, notify_whatsapp_e164, notify_warm_replies, notify_quiet_hours_start, notify_quiet_hours_end')
    .eq('id', userId)
    .maybeSingle()
  if (error || !data) return null
  return data as UserPrefs
}

async function findOrgOwnerUserId(sb: SupabaseClient, orgId: string): Promise<string | null> {
  // Warm-reply pings go to whichever user in the org has notify_warm_replies=true
  // and a configured E.164. Today this is always Jordan (single-user-per-org).
  // We pick the first match by created_at to keep behaviour deterministic.
  const { data } = await sb
    .from('users')
    .select('id, created_at')
    .eq('org_id', orgId)
    .eq('notify_warm_replies', true)
    .not('notify_whatsapp_e164', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
  const row = (data ?? [])[0] as { id: string } | undefined
  return row?.id ?? null
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1).trimEnd() + '…'
}

async function buildWarmReplyBody(
  sb: SupabaseClient,
  activityId: string,
): Promise<{ body: string; contact_id: string | null; error?: string }> {
  const { data: activity, error } = await sb
    .from('activities')
    .select('id, org_id, contact_id, body, metadata')
    .eq('id', activityId)
    .maybeSingle()
  if (error || !activity) return { body: '', contact_id: null, error: 'activity_not_found' }

  const metadata = (activity.metadata ?? {}) as Record<string, unknown>
  const confidence = typeof metadata.intent_confidence === 'number'
    ? (metadata.intent_confidence as number)
    : 0
  const replySnippet = truncate(String(activity.body ?? ''), 200)

  let contactLine = 'Unknown contact'
  if (activity.contact_id) {
    const { data: contact } = await sb
      .from('contacts')
      .select('full_name, venue_id')
      .eq('id', activity.contact_id)
      .maybeSingle()
    if (contact) {
      const name = (contact.full_name ?? '').trim() || 'Unknown contact'
      let venueBit = ''
      if (contact.venue_id) {
        const { data: venue } = await sb
          .from('venues')
          .select('name, suburb')
          .eq('id', contact.venue_id)
          .maybeSingle()
        if (venue) {
          const suburb = venue.suburb ? ` (${venue.suburb})` : ''
          venueBit = ` — ${venue.name ?? 'venue'}${suburb}`
        }
      }
      contactLine = `${name}${venueBit}`
    }
  }

  const link = `${PUBLIC_APP_URL}/contacts/${activity.contact_id ?? ''}`
  const body = [
    '🔥 Warm reply',
    contactLine,
    replySnippet ? `"${replySnippet}"` : '(empty reply body)',
    `Intent: positive · confidence: ${confidence.toFixed(2)}`,
    link,
  ].join('\n')

  return { body, contact_id: activity.contact_id ?? null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // -----------------------------------------------------------------------
  // Authorisation gate. Two trusted caller shapes:
  //   1. Service-role JWT (server-to-server: classify-reply-intent fanout
  //      and any future cron/poller). May enqueue any activity, any user.
  //   2. End-user JWT (browser via supabase.functions.invoke). May ONLY
  //      enqueue test pings, and only for their OWN user_id.
  // Anything else (anon key, missing/invalid JWT) is rejected.
  // -----------------------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!bearer) {
    return jsonResponse({ error: 'authorization_required' }, 401)
  }
  const isServiceRole = bearer === SUPABASE_SERVICE_ROLE_KEY

  let authedUserId: string | null = null
  if (!isServiceRole) {
    // Decode the user JWT via the auth admin API. We don't pass the bearer
    // to createClient because we use service-role below for actual writes —
    // we only need the JWT here to confirm WHO is calling.
    const sbAuthCheck = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: userData, error: authErr } = await sbAuthCheck.auth.getUser(bearer)
    if (authErr || !userData?.user) {
      return jsonResponse({ error: 'invalid_jwt' }, 401)
    }
    authedUserId = userData.user.id
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const isTest = payload.test === true
  const activityId = payload.activity_id as string | undefined
  const explicitUserId = payload.user_id as string | undefined

  if (!isTest && !activityId) {
    return jsonResponse({ error: 'activity_id is required' }, 400)
  }

  // End-user callers can only hit the test path — warm-reply enqueue must
  // come from another Edge Function authenticated with the service role.
  if (!isServiceRole && !isTest) {
    return jsonResponse({ error: 'forbidden — warm_reply enqueue is internal-only' }, 403)
  }

  // -----------------------------------------------------------------------
  // TEST PING — synchronous, returns the log row id so the UI can show it.
  // -----------------------------------------------------------------------
  if (isTest) {
    if (!explicitUserId) return jsonResponse({ error: 'user_id required for test ping' }, 400)
    // End-user callers can only test-ping themselves. The request payload's
    // user_id is ignored when it doesn't match the JWT subject.
    if (!isServiceRole && authedUserId !== explicitUserId) {
      return jsonResponse({ error: 'forbidden — test ping must target your own user_id' }, 403)
    }
    const prefs = await loadUserPrefs(sb, explicitUserId)
    if (!prefs) return jsonResponse({ error: 'user not found' }, 404)
    if (!prefs.notify_whatsapp_e164) {
      return jsonResponse({ error: 'notify_whatsapp_e164 not set on user' }, 422)
    }

    const hourNow = aestHourNow()
    const quiet = inQuietHours(prefs.notify_quiet_hours_start, prefs.notify_quiet_hours_end, hourNow)
    const body = `✅ LeadFlow test ping — routing to ${prefs.notify_whatsapp_e164} works. Sent at ${new Date().toISOString()}.`

    const { data: row, error: insErr } = await sb
      .from('notification_log')
      .insert({
        org_id: prefs.org_id,
        user_id: prefs.id,
        channel: 'whatsapp',
        target: prefs.notify_whatsapp_e164,
        kind: 'test_ping',
        activity_id: null,
        status: quiet ? 'skipped' : 'queued',
        reason: quiet ? 'quiet_hours' : null,
        body,
      })
      .select('id, status, reason')
      .single()
    if (insErr) return jsonResponse({ error: 'enqueue_failed', detail: insErr.message }, 500)

    return jsonResponse({ id: row?.id, status: row?.status, reason: row?.reason, quiet_hour: quiet })
  }

  // -----------------------------------------------------------------------
  // WARM-REPLY PING — fire-and-forget caller. Always 200; failures surface
  // in notification_log status='failed' for debugging.
  // -----------------------------------------------------------------------
  const { body: builtBody, error: buildErr } = await buildWarmReplyBody(sb, activityId!)
  if (buildErr) {
    return jsonResponse({ error: buildErr }, 404)
  }

  // Resolve org via activity (already fetched above; refetch for clarity)
  const { data: activity } = await sb
    .from('activities')
    .select('org_id')
    .eq('id', activityId!)
    .maybeSingle()
  if (!activity) return jsonResponse({ error: 'activity_not_found' }, 404)

  const orgId = (activity as { org_id: string }).org_id
  const userId = await findOrgOwnerUserId(sb, orgId)
  if (!userId) {
    // No-op: org has no opted-in user with a configured E.164. We can't write
    // a notification_log row because user_id REFERENCES auth.users — there's
    // no valid recipient to attribute the skip to. Log to console so it shows
    // up in the Edge Function logs for debugging.
    console.log(`notify-warm-reply: skipped — no recipient configured for org ${orgId}, activity ${activityId}`)
    return jsonResponse({ status: 'skipped', reason: 'no_recipient_configured' })
  }

  const prefs = await loadUserPrefs(sb, userId)
  if (!prefs) return jsonResponse({ error: 'user_prefs_not_found' }, 404)

  // Defensive: re-check the opt-in flag and E.164 (findOrgOwnerUserId already
  // filtered, but a row could change between calls).
  if (!prefs.notify_warm_replies || !prefs.notify_whatsapp_e164) {
    await sb.from('notification_log').insert({
      org_id: prefs.org_id,
      user_id: prefs.id,
      channel: 'whatsapp',
      target: prefs.notify_whatsapp_e164 ?? '',
      kind: 'warm_reply',
      activity_id: activityId,
      status: 'skipped',
      reason: 'opt_out_or_no_target',
      body: builtBody,
    })
    return jsonResponse({ status: 'skipped', reason: 'opt_out_or_no_target' })
  }

  // Idempotency check — same activity_id within last hour
  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
  const { data: existing } = await sb
    .from('notification_log')
    .select('id')
    .eq('kind', 'warm_reply')
    .eq('activity_id', activityId!)
    .in('status', ['queued', 'sent'])
    .gte('created_at', cutoff)
    .limit(1)
  if (existing && existing.length > 0) {
    await sb.from('notification_log').insert({
      org_id: prefs.org_id,
      user_id: prefs.id,
      channel: 'whatsapp',
      target: prefs.notify_whatsapp_e164,
      kind: 'warm_reply',
      activity_id: activityId,
      status: 'skipped',
      reason: 'duplicate_within_window',
      body: builtBody,
    })
    return jsonResponse({ status: 'skipped', reason: 'duplicate_within_window' })
  }

  // Quiet-hours check
  const hourNow = aestHourNow()
  const quiet = inQuietHours(prefs.notify_quiet_hours_start, prefs.notify_quiet_hours_end, hourNow)
  if (quiet) {
    await sb.from('notification_log').insert({
      org_id: prefs.org_id,
      user_id: prefs.id,
      channel: 'whatsapp',
      target: prefs.notify_whatsapp_e164,
      kind: 'warm_reply',
      activity_id: activityId,
      status: 'skipped',
      reason: 'quiet_hours',
      body: builtBody,
    })
    return jsonResponse({ status: 'skipped', reason: 'quiet_hours' })
  }

  // Enqueue
  const { data: queued, error: insErr } = await sb
    .from('notification_log')
    .insert({
      org_id: prefs.org_id,
      user_id: prefs.id,
      channel: 'whatsapp',
      target: prefs.notify_whatsapp_e164,
      kind: 'warm_reply',
      activity_id: activityId,
      status: 'queued',
      reason: null,
      body: builtBody,
    })
    .select('id')
    .single()
  if (insErr) return jsonResponse({ error: 'enqueue_failed', detail: insErr.message }, 500)

  return jsonResponse({ id: queued?.id, status: 'queued' })
})
