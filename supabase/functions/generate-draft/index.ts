import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkUnsubKey } from './_unsub-key.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UNSUBSCRIBE_SIGNING_KEY = Deno.env.get('UNSUBSCRIBE_SIGNING_KEY')
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') ?? 'https://jordan-sales-agent.vercel.app'

// Spam Act 2003 (Cth) s.18 — commercial electronic messages MUST carry a
// functional unsubscribe. We sign per-recipient unsub tokens with this key,
// and refuse to draft at all when it is absent or malformed. Don't relax
// this without legal review — see _unsub-key.ts for the check semantics.
const UNSUB_KEY_CHECK = checkUnsubKey(UNSUBSCRIBE_SIGNING_KEY)

const MODEL = 'claude-sonnet-4-6'

// HMAC-SHA256 of the lowercased+trimmed email, hex-encoded — matches the
// Node-side `signUnsubscribeToken` in api/unsubscribe.ts so a token signed
// here verifies there. The footer is the Spam Act 2003 mandatory unsubscribe
// mechanism — appended verbatim so Claude can never paraphrase the legal copy.
async function signEmailHmac(email: string, key: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    enc.encode(email.trim().toLowerCase()),
  )
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Resolve the brand_key for a deal based on its product's brand. Maps
// products.brand → email_signature_templates.brand_key:
//   'purezza'           → 'purezza'
//   'culligan' / 'zip'  → 'culligan_zip'
//   anything else / no deal / no product → 'purezza' (default per Jordan)
async function resolveBrandKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  productId: string | null | undefined,
): Promise<'purezza' | 'culligan_zip'> {
  if (!productId) return 'purezza'
  const { data: product } = await supabase
    .from('products')
    .select('brand')
    .eq('id', productId)
    .maybeSingle()
  const brand = (product?.brand ?? '').toLowerCase()
  if (brand === 'culligan' || brand === 'zip') return 'culligan_zip'
  return 'purezza'
}

// Loads the signature template for (user_id, brand_key) and substitutes the
// {{sending_mailbox_email}} placeholder with the actual sending inbox address.
// Returns null if no template row is configured for this user/brand — the
// caller should treat that as "no signature" and skip appending.
async function resolveSignature(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  orgId: string,
  brandKey: 'purezza' | 'culligan_zip',
  senderInboxId: string | null,
): Promise<string | null> {
  const { data: tpl } = await supabase
    .from('email_signature_templates')
    .select('body_text')
    .eq('user_id', userId)
    .eq('brand_key', brandKey)
    .maybeSingle()
  if (!tpl?.body_text) return null

  // Look up the actual mailbox email — sender_inbox_id when provided, else
  // the first active inbox for the org so the preview / cold draft still
  // matches a real inbox the user owns.
  let mailboxEmail: string | null = null
  if (senderInboxId) {
    const { data: acct } = await supabase
      .from('email_accounts')
      .select('email_address')
      .eq('id', senderInboxId)
      .maybeSingle()
    mailboxEmail = acct?.email_address ?? null
  }
  if (!mailboxEmail) {
    const { data: acct } = await supabase
      .from('email_accounts')
      .select('email_address')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    mailboxEmail = acct?.email_address ?? null
  }
  const substituted = (tpl.body_text as string).replace(
    /\{\{sending_mailbox_email\}\}/g,
    mailboxEmail ?? '',
  )
  return substituted
}

async function buildUnsubFooter(email: string): Promise<string> {
  // Caller is guarded by UNSUB_KEY_CHECK in the request handler — if we ever
  // reach here the key is present and ≥32 chars. Belt-and-braces throw so a
  // future refactor that moves the gate doesn't silently send footerless mail.
  if (!UNSUBSCRIBE_SIGNING_KEY) {
    throw new Error('UNSUBSCRIBE_SIGNING_KEY missing at footer build — gate bypass bug')
  }
  const normalised = email.trim().toLowerCase()
  const token = await signEmailHmac(normalised, UNSUBSCRIBE_SIGNING_KEY)
  const link = `${PUBLIC_APP_URL}/unsubscribe?email=${encodeURIComponent(normalised)}&token=${token}`
  return `\n\n---\nThis email was sent by Jordan Marziale (Premium Water AU). To unsubscribe, click here: ${link}`
}

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

  // Hard-fail (Spam Act 2003 s.18 gap): refuse to draft when the unsubscribe
  // signing key is missing or too short. Previously this silently skipped the
  // unsubscribe footer and shipped non-compliant commercial email.
  if (!UNSUB_KEY_CHECK.ok) {
    console.error(
      `generate-draft refused: UNSUBSCRIBE_SIGNING_KEY ${UNSUB_KEY_CHECK.reason}`,
    )
    return new Response(
      JSON.stringify({
        error: 'UNSUBSCRIBE_SIGNING_KEY not configured — refusing to draft commercial email (Spam Act 2003 s.18). Contact admin.',
        code: 'UNSUB_KEY_MISSING',
        reason: UNSUB_KEY_CHECK.reason,
      }),
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

  // Get caller's profile. No booking-tool integration — Jordan books meetings
  // manually in his calendar, so the system prompt does not expose a booking URL.
  const { data: userProfile } = await supabase
    .from('users')
    .select('org_id, full_name, email_signature, voice_rules')
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

  // Suppression check (Spam Act 2003 compliance + manual exclusions)
  if (contact.email) {
    const rawEmail = String(contact.email).trim().toLowerCase()
    const at = rawEmail.indexOf('@')
    const local = at >= 0 ? rawEmail.slice(0, at).split('+')[0] : rawEmail
    const domain = at >= 0 ? rawEmail.slice(at + 1) : ''
    const normalisedEmail = at >= 0 ? `${local}@${domain}` : rawEmail

    // Audit BE-P1-07: PostgREST `.or()` treats commas as separators, so any
    // comma in the email/domain literal (mangled CSV import, RFC-5322 group
    // syntax, attacker-controlled input) would corrupt the filter shape and
    // could over-/under-match. Switch to parameterised `.in('email', [...])`
    // — supabase-js will URL-encode each element safely.
    const suppressionLookups = domain
      ? [normalisedEmail, domain]
      : [normalisedEmail]
    const { data: suppressionHits } = await supabase
      .from('suppression_list')
      .select('email, reason, domain_suppression')
      .eq('org_id', userProfile.org_id)
      .in('email', suppressionLookups)

    const matched = (suppressionHits ?? []).find((row: {
      email: string
      reason: string
      domain_suppression: boolean
    }) => {
      if (row.domain_suppression) return row.email === domain
      return row.email === normalisedEmail
    })

    if (matched) {
      return new Response(
        JSON.stringify({
          error: `Cannot generate draft — email is on suppression list (${matched.reason}).`,
          suppressed: true,
          reason: matched.reason,
          domain_suppression: matched.domain_suppression,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  // Guard: cold_outreach is only valid for contacts with ZERO prior activities.
  // If we've already emailed, called, met, or booked with them, this is not a
  // cold contact — caller should use 'follow_up' or 'reply' instead. Without
  // this guard the model pulls prior-activity details (e.g. "Thanks for the call
  // we locked in last week") into what's supposed to be a first-touch email.
  if (draft_type === 'cold_outreach') {
    const { count: priorActivityCount } = await supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contact_id)

    if ((priorActivityCount ?? 0) > 0) {
      return new Response(
        JSON.stringify({
          error: `Cannot generate cold_outreach — contact has ${priorActivityCount} prior activity record(s). Use draft_type='follow_up' or 'reply' instead.`,
          not_cold: true,
          prior_activity_count: priorActivityCount,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  // Load last 3 activities for this contact
  const { data: activities } = await supabase
    .from('activities')
    .select('activity_type, subject, body, occurred_at')
    .eq('contact_id', contact_id)
    .order('occurred_at', { ascending: false })
    .limit(3)

  // Load any open deal for this contact. `product_id` drives signature-brand
  // resolution further down (deal.product_id → products.brand → signature).
  const { data: deal } = await supabase
    .from('deals')
    .select('id, title, contract_value, product_id, stage:pipeline_stages(name)')
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

  // This is intentionally a thin scaffold. Voice + style is owned by
  // `users.voice_rules` (canonical source: clients/jordan/STYLE-GUIDE.md).
  // Don't add brevity caps, sign-off rules, pricing, or segment language
  // here — those belong in voice_rules so the user can override them.
  const baseSystemPrompt = `You are Jordan Marziale, Business Development Manager at Purezza Australia. You sell across four brands: Purezza (premium hospitality), Culligan (offices, factories, healthcare, gyms, schools, public spaces), Zip (premium offices and residential), and Birko (commercial kitchen boilers, outright sale).

You write to Australian hospitality and commercial prospects — venue type ranges from cafés through to factories, offices, gyms, schools, and residential. Match register and brand selection to the segment.

One ask per email — a call, a meeting, a question, or a yes/no. Never two.

Do not include any external booking, scheduling, or calendar links. Jordan books meetings manually — when a meeting is appropriate, ask for it in plain English and let the contact reply with their availability.`

  const userVoiceRules = (userProfile.voice_rules ?? '').trim()
  const systemPrompt = userVoiceRules
    ? `${baseSystemPrompt}\n\n## Voice & Style Rules (user-configured)\nThese rules override the defaults above when they conflict.\n\n${userVoiceRules}`
    : baseSystemPrompt

  const userPrompt = `Write a ${draftTypeLabel} to ${contact.full_name}${venue ? ` at ${venue.name} (${venue.venue_type ?? 'venue'}, ${venue.cover_count ? venue.cover_count + ' covers, ' : ''}${venue.suburb ?? ''})` : ''}.

${venue?.competitor_water_usage && venue.competitor_water_usage !== 'purezza'
  ? `Current water setup: ${venue.competitor_water_usage} — this is an opportunity.`
  : ''}

Recent activity with this contact:
${activitySummary || 'No prior activity recorded — this is truly cold.'}

${deal ? `Open deal: ${deal.title ?? 'Unnamed deal'} — Stage: ${(deal.stage as { name: string } | null)?.name ?? 'Unknown'}` : ''}

${context_hint ? `Additional context from Jordan: ${context_hint}` : ''}

## Meeting-intent classification
Inspect the most recent inbound activity above. If the contact has expressed
intent to meet, talk, or schedule something (signals: "meet", "call", "chat",
"demo", "discuss", "available", "free", "your time", "hop on", "schedule",
"book a time", "catch up", "coffee", or any explicit ask for a time slot),
classify this draft as a proposed meeting and:
  1. Set "draft_kind" to "proposed_meeting" in your response.
  2. Embed the LITERAL token [YOUR_TIMES_HERE] (exactly that, including the
     square brackets and uppercase) somewhere in the body, in a sentence that
     reads naturally with placeholder times — e.g.
     "Happy to jump on a quick call — does either [YOUR_TIMES_HERE] suit?"
     Use the token exactly once. Do not invent your own placeholder format.
     Do not propose actual times yourself.

Otherwise set "draft_kind" to "standard" and write a normal draft (no token).

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{"subject": "email subject line here", "body": "email body here with \\n for line breaks", "draft_kind": "standard" | "proposed_meeting"}`

  // Call Anthropic API
  let subject = ''
  let body = ''
  let draftKind: 'standard' | 'proposed_meeting' = 'standard'

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

    // Trust-but-verify: only honour proposed_meeting when the body actually
    // contains the literal token. Likewise, if Claude embedded the token but
    // forgot to flag it, treat as proposed_meeting. This keeps the frontend
    // contract (token <=> kind) airtight regardless of model drift.
    const claimedKind = parsed.draft_kind === 'proposed_meeting' ? 'proposed_meeting' : 'standard'
    const hasToken = body.includes('[YOUR_TIMES_HERE]')
    if (claimedKind === 'proposed_meeting' && hasToken) {
      draftKind = 'proposed_meeting'
    } else if (hasToken) {
      draftKind = 'proposed_meeting'
    } else {
      draftKind = 'standard'
    }
  } catch (err) {
    console.error('Draft generation failed:', err)
    return new Response(
      JSON.stringify({ error: 'Failed to generate draft. Check logs.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Inject the per-brand signature between Claude's body and the unsub footer.
  // Brand resolves via deal.product_id → products.brand; falls back to Purezza
  // when there's no deal or no product (Jordan's explicit default 20/05/2026).
  // The {{sending_mailbox_email}} placeholder is substituted with the chosen
  // sender_inbox or the org's first active inbox so signature email line
  // matches the From address (Jordan's Option B).
  const brandKey = await resolveBrandKey(supabase, deal?.product_id ?? null)
  const signature = await resolveSignature(
    supabase,
    user.id,
    userProfile.org_id,
    brandKey,
    null,
  )
  if (signature) {
    body = `${body}\n\n${signature}`
  }

  // Append the Spam Act 2003 unsubscribe footer AFTER Claude has generated
  // the body — never via the prompt, so the legal copy can't be paraphrased.
  // We bake it into both `body` and `original_body` so the Learning Loop's
  // diff doesn't fire a false positive when Jordan leaves the footer alone.
  if (contact.email) {
    body = body + (await buildUnsubFooter(String(contact.email)))
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

  // Store draft (original_* mirrors subject/body at generation time — used by
  // the Learning Loop to detect what the rep edits before sending)
  const { data: draft, error: insertError } = await supabase
    .from('email_drafts')
    .insert({
      org_id: userProfile.org_id,
      contact_id,
      deal_id: deal?.id ?? null,
      draft_type,
      draft_kind: draftKind,
      subject,
      body,
      original_subject: subject,
      original_body: body,
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
