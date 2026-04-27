import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL = 'claude-sonnet-4-6'

const INTENT_VALUES = ['positive', 'objection', 'unsubscribe', 'ooo', 'spam', 'referral', 'other'] as const
type Intent = typeof INTENT_VALUES[number]

function isValidIntent(s: string): s is Intent {
  return (INTENT_VALUES as readonly string[]).includes(s)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Anthropic API key not configured.' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let activity_id: string | undefined
  try {
    const body = await req.json()
    activity_id = body.activity_id
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!activity_id) {
    return new Response(JSON.stringify({ error: 'activity_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Fetch the inbound activity
  const { data: activity, error: actErr } = await supabase
    .from('activities')
    .select('id, org_id, contact_id, body, metadata, activity_type, occurred_at')
    .eq('id', activity_id)
    .single()

  if (actErr || !activity) {
    return new Response(JSON.stringify({ error: 'Activity not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Only classify inbound reply types
  if (!['reply_received', 'email_inbound'].includes(activity.activity_type)) {
    return new Response(
      JSON.stringify({ error: 'Activity is not an inbound reply type', activity_type: activity.activity_type }),
      { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const replyBody: string = (activity.body ?? '').trim()
  const metadata = (activity.metadata ?? {}) as Record<string, unknown>

  // Fetch the original outbound message via in_reply_to_message_id
  let outboundBody = ''
  const inReplyToId = metadata.in_reply_to_message_id as string | undefined
  if (inReplyToId && activity.contact_id) {
    const { data: outbound } = await supabase
      .from('activities')
      .select('body')
      .eq('contact_id', activity.contact_id)
      .contains('metadata', { gmail_message_id: inReplyToId })
      .maybeSingle()
    if (outbound?.body) {
      outboundBody = outbound.body.trim()
    }
  }

  // Fallback: get the most recent outbound email for this contact
  if (!outboundBody && activity.contact_id) {
    const { data: fallback } = await supabase
      .from('activities')
      .select('body')
      .eq('contact_id', activity.contact_id)
      .in('activity_type', ['email_sent', 'email_outbound', 'email_manual'])
      .lt('occurred_at', activity.occurred_at ?? new Date().toISOString())
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (fallback?.body) {
      outboundBody = fallback.body.trim()
    }
  }

  const classifyPrompt = `Classify this email reply into ONE of these intents:
- positive — interested, wants to talk, asking a follow-up question, scheduling
- objection — pushback, "not interested right now", price concern, timing concern
- unsubscribe — explicit opt-out request ("remove me", "stop", "unsubscribe")
- ooo — auto-reply, out of office, on leave
- spam — clearly auto-generated, not a real human reply
- referral — passing to someone else ("you should talk to X", forwarding)
- other — none of the above

Respond with JSON only: { "intent": "<one of above>", "confidence": <0.0-1.0>, "reason": "<one sentence>" }

Original outbound: ${outboundBody || '(not available)'}
Reply: ${replyBody || '(empty)'}`

  let intent: Intent = 'other'
  let confidence = 0.5
  let reason = ''

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: 'user', content: classifyPrompt }],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      console.error('Anthropic error:', errText)
      throw new Error(`Anthropic returned ${anthropicRes.status}`)
    }

    const data = await anthropicRes.json()
    const raw = (data.content?.[0]?.text ?? '').replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(raw)

    const rawIntent = String(parsed.intent ?? '').toLowerCase().trim()
    intent = isValidIntent(rawIntent) ? rawIntent : 'other'
    confidence = typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5
    reason = String(parsed.reason ?? '').slice(0, 500)
  } catch (err) {
    console.error('Classification failed:', err)
    return new Response(
      JSON.stringify({ error: 'Classification failed', detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Write classification back to the activity's metadata
  const updatedMetadata = {
    ...metadata,
    intent,
    intent_confidence: confidence,
    intent_reason: reason,
    classified_at: new Date().toISOString(),
  }

  const { error: updateErr } = await supabase
    .from('activities')
    .update({ metadata: updatedMetadata })
    .eq('id', activity_id)

  if (updateErr) {
    console.error('Metadata update failed:', updateErr)
    return new Response(
      JSON.stringify({ error: 'Failed to write classification to activity' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Auto-suppression: unsubscribe with confidence >= 0.8
  if (intent === 'unsubscribe' && confidence >= 0.8 && activity.contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('email, org_id')
      .eq('id', activity.contact_id)
      .maybeSingle()

    if (contact?.email && contact.org_id) {
      const normalised = contact.email.trim().toLowerCase()
      // Upsert — don't error if already suppressed
      await supabase
        .from('suppression_list')
        .upsert(
          {
            org_id: contact.org_id,
            email: normalised,
            reason: 'unsubscribe',
            source: 'manual',
            domain_suppression: false,
          },
          { onConflict: 'org_id,email', ignoreDuplicates: true },
        )
      console.log(`Auto-suppressed ${normalised} (intent=unsubscribe, confidence=${confidence})`)
    }
  }

  return new Response(
    JSON.stringify({ activity_id, intent, confidence, reason }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
