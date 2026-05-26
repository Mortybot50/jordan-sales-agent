// =============================================================================
// claude-chat — in-app conversational Claude surface for LeadFlow (P0-1)
// =============================================================================
// POST { conversation_id?, scope, contact_id?, message }
//   - scope='contact' requires contact_id (loads contact + venue + last 10
//     activities + active sequence enrolment into the system prompt).
//   - scope='global' loads recent contacts + today's pipeline/drafts/replies.
//   - Voice rules always loaded so Claude stays in Jordan's voice when asked
//     to draft.
//
// Streams the assistant response to the client as Anthropic's native SSE.
// On stream completion, persists the user + assistant turns to
// claude_messages. Read-only on the data — no tool/function calling in this
// PR (Phase 2).
//
// Rate limit: 10 messages per user per minute. In-memory counter (no Redis);
// cold-start reset is acceptable per the BUILD plan.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 1024
const RATE_LIMIT_PER_MIN = 10
const RATE_LIMIT_WINDOW_MS = 60_000

// Token cost (Sonnet 4.6, USD per 1M tokens). Used for the cost_usd column
// so Jordan can see spend per turn in the admin/workers page later. These
// rates may drift — they're a best-effort estimate, not authoritative billing.
const COST_PER_M_INPUT_USD = 3
const COST_PER_M_OUTPUT_USD = 15

// In-memory rate-limit window. user_id → array of request epoch-ms in the
// last RATE_LIMIT_WINDOW_MS. Cold-start resets the counter (acceptable per
// the BUILD plan — small risk window, individual user, no abuse vector here).
const rateLimitWindow = new Map<string, number[]>()

function checkRateLimit(userId: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now()
  const stamps = rateLimitWindow.get(userId) ?? []
  const recent = stamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_PER_MIN) {
    const oldest = recent[0]
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - oldest)
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
  }
  recent.push(now)
  rateLimitWindow.set(userId, recent)
  return { ok: true }
}

interface ContactCtx {
  id: string
  full_name: string | null
  role: string | null
  email: string | null
  phone: string | null
  notes: string | null
  org_id: string
  venue: {
    name: string | null
    venue_type: string | null
    suburb: string | null
    address: string | null
    rating: number | null
    review_count: number | null
    social_instagram: string | null
    social_facebook: string | null
    social_linkedin: string | null
    working_hours: unknown
    group_id: string | null
  } | null
}

interface ActivityCtx {
  activity_type: string
  subject: string | null
  body: string | null
  occurred_at: string | null
}

interface SequenceEnrolmentCtx {
  sequence_name: string | null
  current_step: number | null
  next_step_due_at: string | null
  last_status_message: string | null
  status: string | null
}

interface GlobalCtx {
  recent_contacts: Array<{ full_name: string | null; venue_name: string | null; role: string | null }>
  drafts_today: number
  replies_today: number
  pipeline_moves_today: number
}

async function loadContactContext(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  contactId: string,
): Promise<{ contact: ContactCtx | null; activities: ActivityCtx[]; enrolment: SequenceEnrolmentCtx | null }> {
  const { data: contact } = await supabase
    .from('contacts')
    .select(`
      id, full_name, role, email, phone, notes, org_id,
      venue:venues(name, venue_type, suburb, address, rating, review_count,
        social_instagram, social_facebook, social_linkedin, working_hours, group_id)
    `)
    .eq('id', contactId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!contact) return { contact: null, activities: [], enrolment: null }

  const { data: activities } = await supabase
    .from('activities')
    .select('activity_type, subject, body, occurred_at')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .limit(10)

  // Try to load active sequence enrolment if the schema has it. Don't crash
  // if the table/columns differ — surface as null and let Claude work without.
  let enrolment: SequenceEnrolmentCtx | null = null
  try {
    const { data: enrol } = await supabase
      .from('sequence_enrolments')
      .select(`
        status, current_step, next_step_due_at, last_status_message,
        sequence:sequences(name)
      `)
      .eq('contact_id', contactId)
      .in('status', ['active', 'paused'])
      .order('enrolled_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (enrol) {
      const seq = (enrol as { sequence?: { name?: string | null } | null }).sequence
      enrolment = {
        sequence_name: seq?.name ?? null,
        current_step: (enrol as { current_step?: number | null }).current_step ?? null,
        next_step_due_at: (enrol as { next_step_due_at?: string | null }).next_step_due_at ?? null,
        last_status_message: (enrol as { last_status_message?: string | null }).last_status_message ?? null,
        status: (enrol as { status?: string | null }).status ?? null,
      }
    }
  } catch {
    enrolment = null
  }

  return {
    contact: contact as unknown as ContactCtx,
    activities: (activities ?? []) as ActivityCtx[],
    enrolment,
  }
}

async function loadGlobalContext(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
): Promise<GlobalCtx> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayIso = todayStart.toISOString()

  const [recentContacts, draftsToday, repliesToday, pipelineMoves] = await Promise.all([
    supabase
      .from('contacts')
      .select(`full_name, role, venue:venues(name)`)
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(5),
    supabase
      .from('email_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('generated_at', todayIso),
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('activity_type', 'reply_received')
      .gte('occurred_at', todayIso),
    supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('updated_at', todayIso),
  ])

  return {
    recent_contacts: ((recentContacts.data ?? []) as Array<{
      full_name: string | null
      role: string | null
      venue?: { name?: string | null } | null
    }>).map((c) => ({
      full_name: c.full_name ?? null,
      role: c.role ?? null,
      venue_name: c.venue?.name ?? null,
    })),
    drafts_today: draftsToday.count ?? 0,
    replies_today: repliesToday.count ?? 0,
    pipeline_moves_today: pipelineMoves.count ?? 0,
  }
}

function buildSystemPrompt(args: {
  voiceRules: string | null
  fullName: string | null
  scope: 'global' | 'contact'
  contact?: ContactCtx | null
  activities?: ActivityCtx[]
  enrolment?: SequenceEnrolmentCtx | null
  global?: GlobalCtx | null
}): string {
  const base = `You are Claude, an in-app assistant for ${args.fullName ?? 'a LeadFlow user'} — a B2B sales rep at Purezza Australia. You have read-only access to their LeadFlow CRM context (loaded below). You CANNOT take actions: no sending emails, no updating contacts, no enrolling sequences, no advancing pipeline. If asked to do any of those, explain that you're read-only in this version and suggest the in-app button instead.

Be concise. Match the user's tone. Australian English. When asked to rewrite or draft email copy, stay in the user's voice as defined by the Voice Rules below.`

  const voice = (args.voiceRules ?? '').trim()
  const voiceBlock = voice
    ? `\n\n## Voice & Style Rules\n${voice}`
    : ''

  let ctxBlock = ''

  if (args.scope === 'contact' && args.contact) {
    const c = args.contact
    const v = c.venue
    const venueLine = v
      ? `${v.name ?? '(no venue name)'}${v.venue_type ? ` · ${v.venue_type}` : ''}${v.suburb ? ` · ${v.suburb}` : ''}${v.rating != null ? ` · ${v.rating}★ (${v.review_count ?? 0} reviews)` : ''}`
      : '(no linked venue)'
    const socials = v
      ? [
          v.social_instagram && `IG: ${v.social_instagram}`,
          v.social_facebook && `FB: ${v.social_facebook}`,
          v.social_linkedin && `LinkedIn: ${v.social_linkedin}`,
        ].filter(Boolean).join(' · ')
      : ''
    const activitiesText = (args.activities ?? []).length
      ? (args.activities ?? [])
          .map((a) =>
            `- [${a.activity_type}] ${a.occurred_at?.slice(0, 10) ?? '?'} — ${a.subject ?? '(no subject)'}${a.body ? `: ${a.body.slice(0, 240)}` : ''}`,
          )
          .join('\n')
      : '(no activity recorded)'
    const enrolmentText = args.enrolment
      ? `Sequence: ${args.enrolment.sequence_name ?? '(unnamed)'} — step ${args.enrolment.current_step ?? '?'}, status ${args.enrolment.status ?? '?'}${args.enrolment.next_step_due_at ? `, next due ${args.enrolment.next_step_due_at.slice(0, 10)}` : ''}${args.enrolment.last_status_message ? ` — ${args.enrolment.last_status_message}` : ''}`
      : '(not enrolled in a sequence)'

    ctxBlock = `\n\n## Contact context (read-only)\n` +
      `Name: ${c.full_name ?? '(no name)'}${c.role ? ` · ${c.role}` : ''}\n` +
      `Email: ${c.email ?? '(none)'}\n` +
      `Phone: ${c.phone ?? '(none)'}\n` +
      `Venue: ${venueLine}\n` +
      (socials ? `Socials: ${socials}\n` : '') +
      (c.notes ? `Notes: ${c.notes}\n` : '') +
      `Enrolment: ${enrolmentText}\n\n` +
      `Last 10 activities (newest first):\n${activitiesText}`
  } else if (args.scope === 'global' && args.global) {
    const g = args.global
    const recent = g.recent_contacts.length
      ? g.recent_contacts
          .map((c) => `- ${c.full_name ?? '(no name)'}${c.role ? ` (${c.role})` : ''}${c.venue_name ? ` at ${c.venue_name}` : ''}`)
          .join('\n')
      : '(no recent contacts)'
    ctxBlock = `\n\n## Today's pipeline snapshot (read-only)\n` +
      `Drafts generated today: ${g.drafts_today}\n` +
      `Replies received today: ${g.replies_today}\n` +
      `Deals updated today: ${g.pipeline_moves_today}\n\n` +
      `Most recent contacts:\n${recent}`
  }

  return base + voiceBlock + ctxBlock
}

interface AnthropicMessage { role: 'user' | 'assistant'; content: string }

async function findOrCreateConversation(
  supabase: ReturnType<typeof createClient>,
  args: { orgId: string; userId: string; scope: 'global' | 'contact'; contactId: string | null },
): Promise<{ id: string }> {
  let q = supabase
    .from('claude_conversations')
    .select('id')
    .eq('user_id', args.userId)
    .eq('scope', args.scope)
  q = args.scope === 'contact' && args.contactId
    ? q.eq('contact_id', args.contactId)
    : q.is('contact_id', null)

  const { data: existing } = await q.maybeSingle()
  if (existing?.id) return { id: existing.id as string }

  const { data: created, error } = await supabase
    .from('claude_conversations')
    .insert({
      org_id: args.orgId,
      user_id: args.userId,
      scope: args.scope,
      contact_id: args.scope === 'contact' ? args.contactId : null,
    })
    .select('id')
    .single()
  if (error || !created) {
    // Race with another concurrent request — re-select.
    const { data: retry } = await q.maybeSingle()
    if (retry?.id) return { id: retry.id as string }
    throw error ?? new Error('Failed to create conversation')
  }
  return { id: created.id as string }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Anthropic API key not configured — ask admin.' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing auth header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const rl = checkRateLimit(user.id)
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded', retryAfterSec: rl.retryAfterSec }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(rl.retryAfterSec ?? 30),
        },
      },
    )
  }

  let body: { conversation_id?: string; scope?: string; contact_id?: string | null; message?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const scope = body.scope === 'contact' || body.scope === 'global' ? body.scope : null
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const contactId = scope === 'contact' ? (body.contact_id ?? null) : null

  if (!scope) {
    return new Response(JSON.stringify({ error: 'scope must be "global" or "contact"' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (scope === 'contact' && !contactId) {
    return new Response(JSON.stringify({ error: 'contact_id required when scope=contact' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!message) {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (message.length > 8000) {
    return new Response(JSON.stringify({ error: 'message too long (max 8000 chars)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: userProfile } = await supabase
    .from('users')
    .select('org_id, full_name, voice_rules')
    .eq('id', user.id)
    .single()

  if (!userProfile) {
    return new Response(JSON.stringify({ error: 'User profile not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // If a contact-scoped conversation, verify the contact belongs to the org.
  if (scope === 'contact' && contactId) {
    const { data: contactRow } = await supabase
      .from('contacts')
      .select('org_id')
      .eq('id', contactId)
      .maybeSingle()
    if (!contactRow || contactRow.org_id !== userProfile.org_id) {
      return new Response(JSON.stringify({ error: 'Contact not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // Find-or-create conversation
  let conversationId: string
  try {
    if (body.conversation_id) {
      // Verify ownership
      const { data: convo } = await supabase
        .from('claude_conversations')
        .select('id, org_id, user_id, scope, contact_id')
        .eq('id', body.conversation_id)
        .maybeSingle()
      if (!convo || convo.org_id !== userProfile.org_id || convo.user_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Conversation not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      conversationId = convo.id as string
    } else {
      const c = await findOrCreateConversation(supabase, {
        orgId: userProfile.org_id as string,
        userId: user.id,
        scope,
        contactId,
      })
      conversationId = c.id
    }
  } catch (err) {
    console.error('[claude-chat] conversation lookup failed:', err)
    return new Response(JSON.stringify({ error: 'Failed to open conversation' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Load context for the system prompt
  let contactCtx: { contact: ContactCtx | null; activities: ActivityCtx[]; enrolment: SequenceEnrolmentCtx | null } | null = null
  let globalCtx: GlobalCtx | null = null
  if (scope === 'contact' && contactId) {
    contactCtx = await loadContactContext(supabase, userProfile.org_id as string, contactId)
  } else {
    globalCtx = await loadGlobalContext(supabase, userProfile.org_id as string)
  }

  const systemPrompt = buildSystemPrompt({
    voiceRules: userProfile.voice_rules as string | null,
    fullName: userProfile.full_name as string | null,
    scope,
    contact: contactCtx?.contact ?? null,
    activities: contactCtx?.activities ?? [],
    enrolment: contactCtx?.enrolment ?? null,
    global: globalCtx,
  })

  // Load prior turns for this conversation
  const { data: priorMessages } = await supabase
    .from('claude_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(40)

  const messages: AnthropicMessage[] = ((priorMessages ?? []) as Array<{ role: string; content: string }>)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  messages.push({ role: 'user', content: message })

  // Persist the user turn before calling Anthropic so it survives a stream
  // failure. We accept the small write-amp cost (one extra insert) for the
  // operability of being able to see "what did the user actually ask?" when
  // the call fails.
  const { data: userMsg, error: userInsertErr } = await supabase
    .from('claude_messages')
    .insert({
      conversation_id: conversationId,
      org_id: userProfile.org_id as string,
      role: 'user',
      content: message,
    })
    .select('id')
    .single()
  if (userInsertErr || !userMsg) {
    console.error('[claude-chat] failed to persist user message:', userInsertErr)
    return new Response(JSON.stringify({ error: 'Failed to save message' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Call Anthropic with streaming enabled
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  })

  if (!anthropicRes.ok || !anthropicRes.body) {
    const errText = await anthropicRes.text().catch(() => '(no body)')
    console.error('[claude-chat] Anthropic error:', anthropicRes.status, errText)
    return new Response(
      JSON.stringify({ error: `Anthropic API returned ${anthropicRes.status}` }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Stream Anthropic's SSE body straight to the client, accumulating the
  // assistant text + token counts as we go. On stream end, persist the
  // assistant turn and append a final SSE event with the message_id and
  // cost so the client can dedup + display cost.
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let assistantText = ''
  let inputTokens = 0
  let outputTokens = 0
  let sseBuffer = ''

  const stream = new ReadableStream({
    async start(controller) {
      const reader = anthropicRes.body!.getReader()
      try {
        // Pass through pump
        // We re-emit each chunk as-is so the client SSE parser sees the
        // exact event shape Anthropic produces.
        // We also tee the chunk to a parser that accumulates text deltas
        // and usage data — needed for persistence + cost.
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
          sseBuffer += decoder.decode(value, { stream: true })
          let idx
          while ((idx = sseBuffer.indexOf('\n\n')) !== -1) {
            const eventBlock = sseBuffer.slice(0, idx)
            sseBuffer = sseBuffer.slice(idx + 2)
            // Each event is one or more "field: value" lines. We only need
            // the "data: " line for content_block_delta + message_delta.
            for (const line of eventBlock.split('\n')) {
              if (!line.startsWith('data: ')) continue
              const payload = line.slice(6).trim()
              if (!payload || payload === '[DONE]') continue
              try {
                const evt = JSON.parse(payload)
                if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                  assistantText += evt.delta.text as string
                } else if (evt.type === 'message_start' && evt.message?.usage) {
                  inputTokens = evt.message.usage.input_tokens ?? inputTokens
                  outputTokens = evt.message.usage.output_tokens ?? outputTokens
                } else if (evt.type === 'message_delta' && evt.usage) {
                  outputTokens = evt.usage.output_tokens ?? outputTokens
                }
              } catch {
                /* not JSON — skip */
              }
            }
          }
        }

        // Persist assistant turn + emit final META event
        const costUsd =
          (inputTokens / 1_000_000) * COST_PER_M_INPUT_USD +
          (outputTokens / 1_000_000) * COST_PER_M_OUTPUT_USD

        const { data: assistantMsg } = await supabase
          .from('claude_messages')
          .insert({
            conversation_id: conversationId,
            org_id: userProfile.org_id as string,
            role: 'assistant',
            content: assistantText,
            tokens_in: inputTokens,
            tokens_out: outputTokens,
            cost_usd: costUsd,
            model: MODEL,
          })
          .select('id')
          .single()

        const meta = {
          type: 'leadflow_meta',
          conversation_id: conversationId,
          user_message_id: userMsg.id,
          assistant_message_id: assistantMsg?.id ?? null,
          tokens_in: inputTokens,
          tokens_out: outputTokens,
          cost_usd: costUsd,
          model: MODEL,
        }
        controller.enqueue(encoder.encode(`event: leadflow_meta\ndata: ${JSON.stringify(meta)}\n\n`))
        controller.close()
      } catch (err) {
        console.error('[claude-chat] stream pump error:', err)
        // Best-effort: persist whatever text we got so the turn isn't lost.
        if (assistantText) {
          await supabase
            .from('claude_messages')
            .insert({
              conversation_id: conversationId,
              org_id: userProfile.org_id as string,
              role: 'assistant',
              content: assistantText,
              tokens_in: inputTokens,
              tokens_out: outputTokens,
              model: MODEL,
            })
        }
        controller.error(err)
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
})
