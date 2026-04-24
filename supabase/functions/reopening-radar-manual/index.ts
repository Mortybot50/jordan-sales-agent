/**
 * reopening-radar-manual — Supabase Edge Function
 *
 * Lets Jordan manually paste a reopening tip. Inserts a venue_observations
 * row (source='manual', business_status='ACTIVE') and a reopening_events
 * row (event_type='manual').
 *
 * Auth: user JWT required. We use the user's JWT (not service-role) so
 * RLS enforces org_id on the insert — no cross-tenant writes.
 *
 * Request body:
 *   {
 *     venue_name:     string  (required)
 *     address:        string?
 *     suburb:         string?
 *     licensee:       string?
 *     licence_type:   string?
 *     prior_name:     string?  (optional — if the venue was previously known as X)
 *     prior_licensee: string?
 *     evidence_url:   string?
 *   }
 *
 * Required env vars:
 *   VITE_SUPABASE_URL / SUPABASE_URL
 *   SUPABASE_ANON_KEY
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'missing Authorization bearer token' }, 401)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: auth, error: authErr } = await supabase.auth.getUser()
  if (authErr || !auth?.user) {
    return json({ error: 'invalid token' }, 401)
  }

  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (profileErr || !profile) {
    return json({ error: 'user profile not found' }, 403)
  }
  const orgId = profile.org_id as string

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const venue_name = typeof body.venue_name === 'string' ? body.venue_name.trim() : ''
  if (!venue_name) return json({ error: 'venue_name is required' }, 400)

  const address = typeof body.address === 'string' ? body.address.trim() : null
  const suburb = typeof body.suburb === 'string' ? body.suburb.trim() : null
  const licensee = typeof body.licensee === 'string' ? body.licensee.trim() : null
  const licence_type = typeof body.licence_type === 'string' ? body.licence_type.trim() : null
  const prior_name = typeof body.prior_name === 'string' ? body.prior_name.trim() : null
  const prior_licensee = typeof body.prior_licensee === 'string' ? body.prior_licensee.trim() : null
  const evidence_url = typeof body.evidence_url === 'string' ? body.evidence_url.trim() : null

  // Optional: if user supplied a prior_name or prior_licensee, record a
  // prior observation with business_status='CLOSED_PERMANENTLY' so the
  // UI can display the delta.
  let priorId: string | null = null
  if (prior_name || prior_licensee) {
    const { data: priorInsert, error: priorErr } = await supabase
      .from('venue_observations')
      .insert({
        org_id: orgId,
        source: 'manual',
        external_id: null,
        venue_name: prior_name ?? venue_name,
        address,
        suburb,
        licence_type,
        licensee: prior_licensee,
        business_status: 'CLOSED_PERMANENTLY',
        evidence_url,
        raw: { note: 'manual — prior snapshot supplied by user' },
      })
      .select('id')
      .single()
    if (priorErr) return json({ error: `prior insert failed: ${priorErr.message}` }, 500)
    priorId = priorInsert?.id ?? null
  }

  const { data: newObs, error: newErr } = await supabase
    .from('venue_observations')
    .insert({
      org_id: orgId,
      source: 'manual',
      external_id: null,
      venue_name,
      address,
      suburb,
      licence_type,
      licensee,
      business_status: 'ACTIVE',
      evidence_url,
      raw: { note: 'manual — user-supplied reopening tip' },
    })
    .select('id')
    .single()
  if (newErr || !newObs) return json({ error: `observation insert failed: ${newErr?.message}` }, 500)

  const event_type = priorId
    ? (prior_licensee && prior_licensee !== licensee ? 'licensee_changed'
        : prior_name && prior_name !== venue_name ? 'renamed'
        : 'reopened')
    : 'manual'

  const { data: event, error: eventErr } = await supabase
    .from('reopening_events')
    .insert({
      org_id: orgId,
      venue_observation_prior: priorId,
      venue_observation_new: newObs.id,
      event_type,
    })
    .select('id, event_type, detected_at')
    .single()
  if (eventErr) return json({ error: `event insert failed: ${eventErr.message}` }, 500)

  return json({ ok: true, event }, 200)
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
