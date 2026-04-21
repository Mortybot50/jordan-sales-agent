import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MODEL = 'claude-sonnet-4-6'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Anthropic API key not configured — ask admin.' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Verify JWT and get caller's user_id
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing auth header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Get caller's org_id
  const { data: userProfile } = await supabase
    .from('users')
    .select('org_id, full_name, email_signature, calendly_url')
    .eq('id', user.id)
    .single()

  if (!userProfile) {
    return new Response(JSON.stringify({ error: 'User profile not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { contact_id, draft_type, context_hint } = await req.json()

  if (!contact_id || !draft_type) {
    return new Response(JSON.stringify({ error: 'contact_id and draft_type are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Load contact + venue, verify org_id matches caller
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select(`
      id, full_name, role, email, org_id,
      venue:venues(id, name, venue_type, cover_count, suburb, address, kitchen_type, service_style, competitor_water_usage, licensing_status)
    `)
    .eq('id', contact_id)
    .single()

  if (contactError || !contact) {
    return new Response(JSON.stringify({ error: 'Contact not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (contact.org_id !== userProfile.org_id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Load last 3 activities for this contact
  const { data: activities } = await supabase
    .from('activities')
    .select('activity_type, subject, body, occurred_at')
    .eq('contact_id', contact_id)
    .order('occurred_at', { ascending: false })
    .limit(3)

  // Load any open deal for this contact
  const { data: deal } = await supabase
    .from('deals')
    .select('id, title, contract_value, stage:pipeline_stages(name)')
    .eq('contact_id', contact_id)
    .is('closed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const venue = contact.venue as {
    name: string; venue_type: string | null; cover_count: number | null
    suburb: string | null; address: string | null; kitchen_type: string | null
    service_style: string | null; competitor_water_usage: string | null; licensing_status: string | null
  } | null

  const activitySummary = (activities ?? [])
    .map((a) => `[${a.activity_type}] ${a.occurred_at?.slice(0, 10)} — ${a.subject ?? 'no subject'}: ${(a.body ?? '').slice(0, 200)}`)
    .join('\n')

  const draftTypeLabel = draft_type === 'cold_outreach'
    ? 'cold outreach email (first contact)'
    : draft_type === 'follow_up'
    ? 'follow-up email (they haven\'t replied yet)'
    : 'reply email (responding to their most recent inbound)'

  const systemPrompt = `You are Jordan Smith, a sales manager at Purezza — a premium filtered water company that installs under-bench or bar-top water filtration units for hospitality venues across Melbourne.

Jordan's voice: direct, warm, brief, hospitality-native. Never pushy. Respects operators' time. Focuses on ROI and sustainability. Uses first names. Ends with a single soft CTA — never multiple asks.

Product: Purezza filtered still/sparkling water on tap. Replaces single-use plastic bottles. Monthly subscription. Typical contract 36-48 months. $410–$490/month depending on term. Full payback vs bottled water in 11-14 months for a 60-100 cover venue. Installation and filter maintenance included.

Key selling points for hospitality:
- Eliminates plastic bottle purchasing and logistics
- Premium still/sparkling on tap at any outlet (bar, kitchen, function rooms)
- One monthly invoice, zero maintenance hassle
- 12-month flexible exit clause
- Strong case studies in Melbourne restaurant/bar market

Jordan's email rules:
- Under 150 words for cold outreach, under 200 for follow-ups
- No exclamation marks
- No marketing jargon ("exciting", "amazing", "cutting-edge")
- One clear ask at the end — a call, a meeting, or a yes/no
- Personalise with venue-specific detail (covers, venue type, suburb)
- End with "Cheers, Jordan"`

  const userPrompt = `Write a ${draftTypeLabel} to ${contact.full_name}${venue ? ` at ${venue.name} (${venue.venue_type ?? 'venue'}, ${venue.cover_count ? venue.cover_count + ' covers, ' : ''}${venue.suburb ?? ''})` : ''}.

${venue?.competitor_water_usage && venue.competitor_water_usage !== 'purezza'
  ? `Current water setup: ${venue.competitor_water_usage} — this is an opportunity.`
  : ''}

Recent activity with this contact:
${activitySummary || 'No prior activity recorded — this is truly cold.'}

${deal ? `Open deal: ${deal.title ?? 'Unnamed deal'} — Stage: ${(deal.stage as { name: string } | null)?.name ?? 'Unknown'}` : ''}

${context_hint ? `Additional context from Jordan: ${context_hint}` : ''}

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{"subject": "email subject line here", "body": "email body here with \\n for line breaks"}`

  // Call Anthropic API
  let subject = ''
  let body = ''

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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      console.error('Anthropic API error:', errText)
      throw new Error(`Anthropic API returned ${anthropicRes.status}`)
    }

    const anthropicData = await anthropicRes.json()
    const raw = anthropicData.content?.[0]?.text ?? ''

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    subject = parsed.subject ?? ''
    body = parsed.body ?? ''
  } catch (err) {
    console.error('Draft generation failed:', err)
    return new Response(
      JSON.stringify({ error: 'Failed to generate draft. Check logs.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const contextJson = {
    contact: {
      name: contact.full_name,
      role: contact.role,
      venue: venue?.name,
      venue_type: venue?.venue_type,
      cover_count: venue?.cover_count,
      suburb: venue?.suburb,
      competitor_water_usage: venue?.competitor_water_usage,
    },
    draft_type,
    activities_count: activities?.length ?? 0,
    context_hint: context_hint ?? null,
  }

  // Store draft
  const { data: draft, error: insertError } = await supabase
    .from('email_drafts')
    .insert({
      org_id: userProfile.org_id,
      contact_id,
      deal_id: deal?.id ?? null,
      draft_type,
      subject,
      body,
      context_json: contextJson,
      model: MODEL,
      status: 'pending',
      generated_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select()
    .single()

  if (insertError) {
    console.error('Insert error:', insertError)
    return new Response(JSON.stringify({ error: 'Failed to save draft' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ draft }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
