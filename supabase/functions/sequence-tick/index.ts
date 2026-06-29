/**
 * sequence-tick — hourly worker that progresses sequence enrolments.
 *
 * For each active enrolment whose next_step_due_at has elapsed:
 *   1. If contact has any inbound activity since last_step_fired_at → mark
 *      reply_received and stop. (Reply detection — sequences end on engagement.)
 *   2. If contact is Do-Not-Contact or on suppression list → mark cancelled.
 *   3. Otherwise produce the next step's draft and save it to email_drafts
 *      with sequence_enrollment_id + sequence_step_number set, bump
 *      current_step, and schedule next_step_due_at from the upcoming step's
 *      delay_days. If no further steps exist → mark completed.
 *
 *      Two production paths:
 *        a. Template path (canonical hospitality 3-touch and any future
 *           verbatim sequences) — used when the step has `template_variants`
 *           set. The worker picks a variant by rule, renders
 *           `{{first_name}}` / `{{venue_name}}` / `{{suburb}}`, and skips
 *           the LLM entirely so Jordan's verbatim copy is preserved.
 *        b. Prompt path (legacy + future LLM-driven sequences) — used when
 *           `template_variants` is null. Calls Anthropic with the rep's
 *           voice rules + per-step `prompt_instructions`.
 *
 *   4. On generation error → bump failure_count; at 3 → mark failed.
 *
 * --------------------------------------------------------------------------
 * Variant A/B selection logic (template path) — VERBATIM, locked 2026-05-10:
 *
 *   If `contact.venue.suburb` matches a row in `field_visits.suburb` for
 *   this user in the last 30 days → use Variant A with `{{suburb}}` filled.
 *   Else if `contact.venue.venue_type` is hospitality (restaurant/cafe/
 *   bar/hotel/function/fine_dining) AND we have a non-null suburb → use
 *   Variant A with the contact's suburb.
 *   Else → use Variant B.
 *
 * The actual rule list lives on each step's `template_variants.variants[].when`
 * JSON so it's editable without redeploying — but the canonical hospitality
 * 3-touch ships pre-loaded with exactly the two rules above.
 *
 * `field_visits.suburb` is derived (the table has no suburb column directly):
 * we join through `venue_observations.suburb` for visits whose
 * `venue_observation_id` is set, and through `contacts → venues.suburb` for
 * visits whose `contact_id` is set. Distinct list of suburbs is built per
 * tick per enrolment.
 * --------------------------------------------------------------------------
 *
 * Process up to BATCH_SIZE enrolments per tick — leftover work is picked up
 * on the next hour to keep the function within Vercel/Supabase serverless
 * timeouts.
 *
 * Locked rule (Jordan, 26/04/2026): never auto-send. This worker only
 * creates pending drafts in the existing review queue.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  type TemplateVariantsConfig,
  type SelectionContext,
  selectVariant,
  renderTemplate,
  firstNameFromFullName,
} from './templates.ts'
import {
  assembleHtmlBody,
  substituteMailbox,
  substituteMailboxHtml,
  unsubFooterHtml,
  unsubFooterText,
} from '../_shared/email-html.ts'

// @ts-expect-error Deno globals
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL =
  // @ts-expect-error Deno globals
  Deno.env.get('VITE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const UNSUBSCRIBE_SIGNING_KEY = Deno.env.get('UNSUBSCRIBE_SIGNING_KEY')
const PUBLIC_APP_URL =
  // @ts-expect-error Deno globals
  Deno.env.get('PUBLIC_APP_URL') ?? 'https://jordan-sales-agent.vercel.app'

const MODEL = 'claude-sonnet-4-6'

// HMAC-SHA256(email, UNSUBSCRIBE_SIGNING_KEY), hex-encoded. Matches
// signUnsubscribeToken() in api/unsubscribe.ts so the footer link verifies
// at the public endpoint. Spam Act 2003 mandates a working unsubscribe on
// every commercial email — appended after Claude's body so the legal copy
// is never paraphrased by the model.
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

// Resolve the per-brand signature for this contact's open deal. Mirrors the
// logic in generate-draft: deals.product_id → products.brand → brand_key,
// then load email_signature_templates and substitute {{sending_mailbox_email}}
// with the org's first active inbox. Returns null when no template row exists
// for this user/brand — caller appends nothing.
async function resolveSignatureForContact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  orgId: string,
  contactId: string,
): Promise<{ text: string; html: string | null } | null> {
  // Pick the most recent open deal for this contact, if any.
  const { data: deal } = await supabase
    .from('deals')
    .select('product_id')
    .eq('contact_id', contactId)
    .is('closed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let brandKey: 'purezza' | 'culligan_zip' = 'purezza'
  if (deal?.product_id) {
    const { data: product } = await supabase
      .from('products')
      .select('brand')
      .eq('id', deal.product_id)
      .maybeSingle()
    const brand = (product?.brand ?? '').toLowerCase()
    if (brand === 'culligan' || brand === 'zip') brandKey = 'culligan_zip'
  }

  const { data: tpl } = await supabase
    .from('email_signature_templates')
    .select('body_text, body_html')
    .eq('user_id', userId)
    .eq('brand_key', brandKey)
    .maybeSingle()
  if (!tpl?.body_text) return null

  const { data: acct } = await supabase
    .from('email_accounts')
    .select('email_address')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const mailboxEmail = acct?.email_address ?? ''

  const text = substituteMailbox(tpl.body_text as string, mailboxEmail)
  const html = tpl.body_html
    ? substituteMailboxHtml(tpl.body_html as string, mailboxEmail)
    : null
  return { text, html }
}

async function buildUnsubFooter(email: string): Promise<{ text: string; html: string } | null> {
  if (!UNSUBSCRIBE_SIGNING_KEY) {
    console.warn('UNSUBSCRIBE_SIGNING_KEY not set — skipping unsub footer')
    return null
  }
  const normalised = email.trim().toLowerCase()
  const token = await signEmailHmac(normalised, UNSUBSCRIBE_SIGNING_KEY)
  const link = `${PUBLIC_APP_URL}/unsubscribe?email=${encodeURIComponent(normalised)}&token=${token}`
  return { text: unsubFooterText(link), html: unsubFooterHtml(link) }
}
const BATCH_SIZE = 10
const MAX_FAILURES = 3

interface EnrolmentRow {
  id: string
  org_id: string
  sequence_id: string
  contact_id: string | null
  current_step: number
  next_step_due_at: string
  last_step_fired_at: string | null
  failure_count: number
}

interface SequenceStepRow {
  id: string
  sequence_id: string
  step_number: number
  delay_days: number
  prompt_instructions: string | null
  template_variants: TemplateVariantsConfig | null
}

interface ContactRow {
  id: string
  org_id: string
  full_name: string
  role: string | null
  email: string | null
  do_not_contact: boolean
  venue: {
    id: string
    name: string
    venue_type: string | null
    cover_count: number | null
    suburb: string | null
    address: string | null
    kitchen_type: string | null
    service_style: string | null
    competitor_water_usage: string | null
    licensing_status: string | null
  } | null
}

interface UserRow {
  id: string
  org_id: string
  full_name: string | null
  email_signature: string | null
  voice_rules: string | null
}

interface ActivityRow {
  activity_type: string
  subject: string | null
  body: string | null
  occurred_at: string | null
}

function buildSystemPrompt(voiceRules: string | null): string {
  const base = `You are Jordan Smith, a sales manager at Purezza — a premium filtered water company that installs under-bench or bar-top water filtration units for hospitality venues across Melbourne.

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

  const trimmed = (voiceRules ?? '').trim()
  return trimmed
    ? `${base}\n\n## Voice & Style Rules (user-configured)\nThese rules override the defaults above when they conflict.\n\n${trimmed}`
    : base
}

function buildUserPrompt(
  contact: ContactRow,
  step: SequenceStepRow,
  activities: ActivityRow[],
): string {
  const venue = contact.venue
  const stepLabel =
    step.step_number === 1
      ? 'cold outreach email (first contact in sequence)'
      : `follow-up email (step ${step.step_number} in a multi-touch sequence — the prior touches went unanswered)`

  const activitySummary = activities.length
    ? activities
        .map(
          (a) =>
            `[${a.activity_type}] ${a.occurred_at?.slice(0, 10)} — ${
              a.subject ?? 'no subject'
            }: ${(a.body ?? '').slice(0, 200)}`,
        )
        .join('\n')
    : 'No prior activity recorded — this is truly cold.'

  const stepInstr =
    step.prompt_instructions?.trim() ??
    'Write a brief, on-voice email following the sequence guidance.'

  return `Write a ${stepLabel} to ${contact.full_name}${
    venue
      ? ` at ${venue.name} (${venue.venue_type ?? 'venue'}, ${
          venue.cover_count ? venue.cover_count + ' covers, ' : ''
        }${venue.suburb ?? ''})`
      : ''
  }.

${
  venue?.competitor_water_usage && venue.competitor_water_usage !== 'purezza'
    ? `Current water setup: ${venue.competitor_water_usage} — this is an opportunity.`
    : ''
}

Recent activity with this contact:
${activitySummary}

## Step-specific guidance (sequence step ${step.step_number})
${stepInstr}

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{"subject": "email subject line here", "body": "email body here with \\n for line breaks"}`
}

async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ subject: string; body: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 500)}`)
  }
  const data = await res.json()
  const raw = data.content?.[0]?.text ?? ''
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned)
  return {
    subject: parsed.subject ?? '',
    body: parsed.body ?? '',
  }
}

// Returns the distinct suburbs the user visited in the last `lookbackDays`
// days. Used for Variant A selection on the canonical hospitality 3-touch
// — the walk-by hook is only legitimate when Jordan was actually nearby.
//
// `field_visits` doesn't carry a suburb column directly, so we fan out via
// (a) `venue_observations.suburb` for visits with a venue_observation_id,
// and (b) `contacts → venues.suburb` for visits with a contact_id. Either
// path is enough — if a visit has both, both contribute the same suburb
// from independent sources, which is fine.
async function fetchRecentVisitSuburbs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  userId: string,
  lookbackDays: number,
): Promise<string[]> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('field_visits')
    .select(
      `visited_at,
       venue_observation:venue_observations(suburb),
       contact:contacts(venue:venues(suburb))`,
    )
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('visited_at', since)
  if (error) {
    console.warn(`fetchRecentVisitSuburbs: ${error.message}`)
    return []
  }
  const suburbs = new Set<string>()
  for (const row of (data ?? []) as Array<{
    venue_observation: { suburb: string | null } | null
    contact: { venue: { suburb: string | null } | null } | null
  }>) {
    const s1 = row.venue_observation?.suburb
    if (s1 && s1.trim()) suburbs.add(s1.trim())
    const s2 = row.contact?.venue?.suburb
    if (s2 && s2.trim()) suburbs.add(s2.trim())
  }
  return Array.from(suburbs)
}

// Returns true if the contact is on the org's suppression list (email or
// domain match). Mirrors the logic in generate-draft so worker drafts are
// blocked by the same rules a manual generation would be.
async function isSuppressed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  email: string | null,
): Promise<boolean> {
  if (!email) return false
  const raw = String(email).trim().toLowerCase()
  const at = raw.indexOf('@')
  if (at < 0) return false
  const local = raw.slice(0, at).split('+')[0]
  const domain = raw.slice(at + 1)
  const normalised = `${local}@${domain}`

  const { data: hits } = await supabase
    .from('suppression_list')
    .select('email, domain_suppression')
    .eq('org_id', orgId)
    .or(`email.eq.${normalised},email.eq.${domain}`)

  const matched = (hits ?? []).find(
    (row: { email: string; domain_suppression: boolean }) =>
      row.domain_suppression ? row.email === domain : row.email === normalised,
  )
  return !!matched
}

interface ProcessResult {
  enrolment_id: string
  outcome:
    | 'drafted'
    | 'reply_received'
    | 'cancelled_suppressed'
    | 'cancelled_dnc'
    | 'completed'
    | 'failed'
    | 'skipped_no_steps'
  step_number?: number
  error?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processEnrolment(supabase: any, enr: EnrolmentRow): Promise<ProcessResult> {
  if (!enr.contact_id) {
    // Legacy enrolment without a contact_id — cancel so it doesn't loop forever.
    await supabase
      .from('sequence_enrollments')
      .update({ status: 'cancelled', last_status_message: 'No contact_id on enrolment' })
      .eq('id', enr.id)
    return { enrolment_id: enr.id, outcome: 'cancelled_dnc', error: 'no contact_id' }
  }

  // Load step list for this sequence.
  const { data: stepsData, error: stepsErr } = await supabase
    .from('sequence_steps')
    .select('id, sequence_id, step_number, delay_days, prompt_instructions, template_variants')
    .eq('sequence_id', enr.sequence_id)
    .order('step_number', { ascending: true })

  if (stepsErr) throw stepsErr
  const steps = (stepsData ?? []) as SequenceStepRow[]
  if (steps.length === 0) {
    await supabase
      .from('sequence_enrollments')
      .update({ status: 'cancelled', last_status_message: 'Sequence has no steps' })
      .eq('id', enr.id)
    return { enrolment_id: enr.id, outcome: 'skipped_no_steps' }
  }

  const nextStepNumber = enr.current_step + 1
  const step = steps.find((s) => s.step_number === nextStepNumber)
  if (!step) {
    // No step matching current_step + 1 → sequence complete.
    await supabase
      .from('sequence_enrollments')
      .update({ status: 'completed', last_status_message: 'All steps fired' })
      .eq('id', enr.id)
    return { enrolment_id: enr.id, outcome: 'completed' }
  }

  // Reply detection — but only after step 1 has fired (no prior touch
  // means there's nothing to reply to).
  if (enr.last_step_fired_at) {
    const inboundTypes = ['email_inbound', 'reply_received']
    const { data: inbound } = await supabase
      .from('activities')
      .select('id')
      .eq('contact_id', enr.contact_id)
      .gt('occurred_at', enr.last_step_fired_at)
      .in('activity_type', inboundTypes)
      .limit(1)
    if (inbound && inbound.length > 0) {
      await supabase
        .from('sequence_enrollments')
        .update({
          status: 'reply_received',
          last_status_message: 'Reply detected — sequence stopped',
        })
        .eq('id', enr.id)
      return { enrolment_id: enr.id, outcome: 'reply_received' }
    }
  }

  // Load contact + venue.
  const { data: contactData, error: contactErr } = await supabase
    .from('contacts')
    .select(
      `
      id, org_id, full_name, role, email, do_not_contact,
      venue:venues(id, name, venue_type, cover_count, suburb, address, kitchen_type, service_style, competitor_water_usage, licensing_status)
    `,
    )
    .eq('id', enr.contact_id)
    .single()

  if (contactErr || !contactData) {
    throw new Error(`Contact ${enr.contact_id} not found`)
  }
  const contact = contactData as ContactRow

  // DNC + suppression checks — cancel the enrolment so the worker doesn't
  // keep trying. These are commercial / Spam Act 2003 must-haves.
  if (contact.do_not_contact) {
    await supabase
      .from('sequence_enrollments')
      .update({ status: 'cancelled', last_status_message: 'Contact marked Do Not Contact' })
      .eq('id', enr.id)
    return { enrolment_id: enr.id, outcome: 'cancelled_dnc' }
  }
  if (await isSuppressed(supabase, enr.org_id, contact.email)) {
    await supabase
      .from('sequence_enrollments')
      .update({ status: 'cancelled', last_status_message: 'Contact email is suppressed' })
      .eq('id', enr.id)
    return { enrolment_id: enr.id, outcome: 'cancelled_suppressed' }
  }

  // Pick a user for voice + signature — prefer the original enroller, fall
  // back to any user in the org. Needed by the LLM path; the template path
  // only needs the user_id for the field_visits suburb lookup.
  const { data: enrolDetails } = await supabase
    .from('sequence_enrollments')
    .select('enrolled_by_user_id')
    .eq('id', enr.id)
    .single()

  let user: UserRow | null = null
  if (enrolDetails?.enrolled_by_user_id) {
    const { data: u } = await supabase
      .from('users')
      .select('id, org_id, full_name, email_signature, voice_rules')
      .eq('id', enrolDetails.enrolled_by_user_id)
      .maybeSingle()
    if (u) user = u as UserRow
  }
  if (!user) {
    const { data: u } = await supabase
      .from('users')
      .select('id, org_id, full_name, email_signature, voice_rules')
      .eq('org_id', enr.org_id)
      .limit(1)
      .maybeSingle()
    if (u) user = u as UserRow
  }
  if (!user) {
    throw new Error(`No user found for org ${enr.org_id}`)
  }

  // ── Production path A — verbatim template (canonical sequences) ──────
  // If the step has `template_variants` set, skip the LLM and render the
  // selected variant's templates directly. Variant selection rules are
  // documented in the file header (search "Variant A/B selection logic").
  let subject = ''
  let body = ''
  let bodyHtml: string | null = null
  let chosenVariantId: string | null = null

  if (step.template_variants) {
    const recentSuburbs = await fetchRecentVisitSuburbs(
      supabase,
      enr.org_id,
      enrolDetails?.enrolled_by_user_id ?? user.id,
      30,
    )
    const selectionCtx: SelectionContext = {
      contactSuburb: contact.venue?.suburb ?? null,
      venueType: contact.venue?.venue_type ?? null,
      recentVisitSuburbs: recentSuburbs,
    }
    const variant = selectVariant(step.template_variants, selectionCtx)
    chosenVariantId = variant.id
    const renderCtx = {
      first_name: firstNameFromFullName(contact.full_name),
      venue_name: contact.venue?.name ?? '',
      suburb: contact.venue?.suburb ?? '',
    }
    subject = renderTemplate(variant.subject_template, renderCtx)
    body = renderTemplate(variant.body_template, renderCtx)
    const claudeBody = body
    // Append per-brand signature (resolved via the contact's open deal's
    // product brand → 'purezza' default) BEFORE the unsub footer so the
    // legal copy stays at the very bottom of the email.
    const signature = await resolveSignatureForContact(
      supabase,
      user.id,
      enr.org_id,
      contact.id,
    )
    if (signature) body = `${body}\n\n${signature.text}`
    let footerHtml: string | null = null
    if (contact.email) {
      const footer = await buildUnsubFooter(String(contact.email))
      if (footer) {
        body = body + footer.text
        footerHtml = footer.html
      }
    }
    bodyHtml = signature?.html
      ? assembleHtmlBody(claudeBody, signature.html, footerHtml)
      : null
  } else {
    // ── Production path B — LLM-generated draft (legacy / future) ──────
    // Pull recent activities for context (same shape generate-draft uses).
    const { data: activitiesData } = await supabase
      .from('activities')
      .select('activity_type, subject, body, occurred_at')
      .eq('contact_id', enr.contact_id)
      .order('occurred_at', { ascending: false })
      .limit(3)
    const activities = (activitiesData ?? []) as ActivityRow[]

    try {
      const result = await callAnthropic(
        buildSystemPrompt(user.voice_rules ?? null),
        buildUserPrompt(contact, step, activities),
      )
      subject = result.subject
      body = result.body
      const claudeBody = body
      // Same brand-signature resolution as the template path above —
      // appended between Claude's body and the Spam Act unsub footer.
      const signature = await resolveSignatureForContact(
        supabase,
        user.id,
        enr.org_id,
        contact.id,
      )
      if (signature) body = `${body}\n\n${signature.text}`
      let footerHtml: string | null = null
      if (contact.email) {
        const footer = await buildUnsubFooter(String(contact.email))
        if (footer) {
          body = body + footer.text
          footerHtml = footer.html
        }
      }
      bodyHtml = signature?.html
        ? assembleHtmlBody(claudeBody, signature.html, footerHtml)
        : null
    } catch (err) {
      const message = (err as Error).message ?? 'Unknown error'
      const newFailureCount = (enr.failure_count ?? 0) + 1
      if (newFailureCount >= MAX_FAILURES) {
        await supabase
          .from('sequence_enrollments')
          .update({
            status: 'failed',
            failure_count: newFailureCount,
            last_status_message: `Failed ${newFailureCount}x: ${message.slice(0, 200)}`,
          })
          .eq('id', enr.id)
      } else {
        // Don't advance current_step — leave next_step_due_at where it is so
        // the next tick retries this same step.
        await supabase
          .from('sequence_enrollments')
          .update({
            failure_count: newFailureCount,
            last_status_message: `Retry ${newFailureCount}/${MAX_FAILURES}: ${message.slice(0, 200)}`,
          })
          .eq('id', enr.id)
      }
      return { enrolment_id: enr.id, outcome: 'failed', error: message }
    }
  }

  // Insert draft.
  const draftType =
    step.step_number === 1
      ? 'cold_outreach'
      : step.step_number === 2
        ? 'follow_up_soft'
        : 'follow_up_close'

  const { error: draftErr } = await supabase
    .from('email_drafts')
    .insert({
      org_id: enr.org_id,
      contact_id: contact.id,
      draft_type: draftType,
      draft_kind: 'standard',
      subject,
      body,
      body_html: bodyHtml,
      original_subject: subject,
      original_body: body,
      context_json: {
        sequence_id: enr.sequence_id,
        sequence_enrollment_id: enr.id,
        sequence_step_number: step.step_number,
        production_path: step.template_variants ? 'template' : 'llm',
        variant_id: chosenVariantId,
        contact: {
          name: contact.full_name,
          venue: contact.venue?.name,
          suburb: contact.venue?.suburb,
        },
      },
      // For template-rendered drafts, record the variant id as the "model"
      // so analytics + the review UI can tell at a glance which variant
      // produced the copy without joining sequence_steps.
      model: step.template_variants
        ? `template:${chosenVariantId ?? 'unknown'}`
        : MODEL,
      status: 'pending',
      generated_at: new Date().toISOString(),
      created_by: user.id,
      sequence_enrollment_id: enr.id,
      sequence_step_number: step.step_number,
    })

  if (draftErr) {
    throw new Error(`Insert draft failed: ${draftErr.message}`)
  }

  // Compute next due time. If a future step exists, schedule from its
  // delay_days; if not, mark completed.
  const upcoming = steps.find((s) => s.step_number === step.step_number + 1)
  const now = new Date()
  if (upcoming) {
    const next = new Date(now.getTime() + upcoming.delay_days * 86_400_000)
    await supabase
      .from('sequence_enrollments')
      .update({
        current_step: step.step_number,
        last_step_fired_at: now.toISOString(),
        next_step_due_at: next.toISOString(),
        failure_count: 0,
        last_status_message: `Drafted step ${step.step_number}, next step ${upcoming.step_number} in ${upcoming.delay_days}d`,
      })
      .eq('id', enr.id)
  } else {
    await supabase
      .from('sequence_enrollments')
      .update({
        current_step: step.step_number,
        last_step_fired_at: now.toISOString(),
        status: 'completed',
        failure_count: 0,
        last_status_message: `Drafted final step ${step.step_number}`,
      })
      .eq('id', enr.id)
  }

  return { enrolment_id: enr.id, outcome: 'drafted', step_number: step.step_number }
}

// @ts-expect-error Deno serve
// eslint-disable-next-line @typescript-eslint/no-unused-vars
Deno.serve(async (_req: Request) => {
  const startedAt = new Date().toISOString()
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Service-role insert; the metadata field captures per-enrolment outcomes.
  async function logRun(
    status: 'success' | 'success_empty' | 'failed' | 'partial',
    items: number,
    metadata: Record<string, unknown>,
    errorMessage?: string,
  ) {
    await supabase.from('worker_runs').insert({
      worker_name: 'sequence_tick',
      status,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      items_processed: items,
      error_message: errorMessage ?? null,
      metadata,
    })
  }

  if (!ANTHROPIC_API_KEY) {
    await logRun('failed', 0, { reason: 'ANTHROPIC_API_KEY not set' }, 'ANTHROPIC_API_KEY missing')
    return new Response(
      JSON.stringify({ error: 'Anthropic API key not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Pick up due enrolments. ORDER BY next_step_due_at so the oldest go first.
  const { data: dueData, error: dueErr } = await supabase
    .from('sequence_enrollments')
    .select(
      'id, org_id, sequence_id, contact_id, current_step, next_step_due_at, last_step_fired_at, failure_count',
    )
    .eq('status', 'active')
    .lte('next_step_due_at', new Date().toISOString())
    .order('next_step_due_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (dueErr) {
    await logRun('failed', 0, {}, dueErr.message)
    return new Response(
      JSON.stringify({ error: 'Failed to load due enrolments', detail: dueErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const due = (dueData ?? []) as EnrolmentRow[]
  if (due.length === 0) {
    await logRun('success_empty', 0, { batch_size: BATCH_SIZE })
    return new Response(
      JSON.stringify({ ok: true, processed: 0, message: 'No enrolments due' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  const results: ProcessResult[] = []
  const errors: string[] = []
  for (const enr of due) {
    try {
      const r = await processEnrolment(supabase, enr)
      results.push(r)
      if (r.outcome === 'failed' && r.error) errors.push(`${enr.id}: ${r.error}`)
    } catch (err) {
      const message = (err as Error).message ?? 'Unknown error'
      errors.push(`${enr.id}: ${message}`)
      // Best-effort failure marker so the row doesn't get stuck in retry-loop.
      try {
        const newCount = (enr.failure_count ?? 0) + 1
        await supabase
          .from('sequence_enrollments')
          .update({
            failure_count: newCount,
            last_status_message: `Worker exception: ${message.slice(0, 200)}`,
            ...(newCount >= MAX_FAILURES ? { status: 'failed' } : {}),
          })
          .eq('id', enr.id)
      } catch {
        /* swallow — already in error path */
      }
      results.push({ enrolment_id: enr.id, outcome: 'failed', error: message })
    }
  }

  const drafted = results.filter((r) => r.outcome === 'drafted').length
  const status =
    errors.length === 0
      ? drafted > 0
        ? 'success'
        : 'success_empty'
      : drafted > 0
        ? 'partial'
        : 'failed'

  await logRun(status, results.length, {
    batch_size: BATCH_SIZE,
    drafted,
    outcomes: results.reduce<Record<string, number>>((acc, r) => {
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1
      return acc
    }, {}),
  }, errors.length > 0 ? errors.join(' | ').slice(0, 1000) : undefined)

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, drafted, results }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
