/**
 * enqueue-sends — cron Edge Function (every 5 min via pg_cron).
 *
 * Promotes approved drafts from public.email_drafts into public.email_send_queue.
 * Applies the safety controls that turn a "send a draft" feature into a
 * deliverability-conscious cold-email engine:
 *
 *   1. Suppression-list filter — drafts to suppressed addresses are marked
 *      status='suppressed' and skipped, no queue row.
 *   1b. Verified-deliverable gate — the contact's STORED verdict must be
 *      verification_status='valid' AND NOT catch_all_flag AND NOT role_based.
 *      Permanently-undeliverable contacts (role-based, or a settled invalid /
 *      catch_all / disposable verdict) are parked at 'suppressed' (reason=
 *      'not_verified_deliverable') with a 'failed' event. Contacts still
 *      undecided ('pending'/'unknown') keep the draft 'approved' and are simply
 *      skipped this tick, so they requeue automatically once verified 'valid'.
 *      This mirrors the approve-lead enrolment gate as defence in depth: every
 *      send passes through here, so a draft from any creation path is
 *      re-checked against the honest verdict.
 *   2. Email verification — calls NeverBounce / ZeroBounce (configurable via
 *      EMAIL_VERIFICATION_PROVIDER) BEFORE enqueueing. status != 'valid'
 *      results in the draft being parked at 'suppressed' + a 'failed' event
 *      with metadata.reason='verification_failed'.
 *   3. Working-hours window — 08:00-18:00 in users.send_timezone (default
 *      Australia/Melbourne). Sends outside the window are scheduled at the
 *      next window opening.
 *   4. Inbox pacing — >=90s gap between consecutive sends from the same
 *      email_account, with Poisson-style jitter on top.
 *   5. Domain anti-clustering — within one cron tick we never schedule two
 *      back-to-back sends from the same sending domain to the same recipient
 *      domain; if we'd violate the rule we rotate sender accounts (or push
 *      scheduled_for forward).
 *
 * Auth model: cron.schedule() posts with the service-role JWT, so this
 * function expects an authenticated service-role caller. verify_jwt=true.
 *
 * Idempotency: a unique partial index on email_send_queue(draft_id) prevents
 * duplicate enqueueing if the cron fires while a previous batch is still
 * in flight. (Indexed in migration 20260519000004.)
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: EMAIL_VERIFICATION_API_KEY, EMAIL_VERIFICATION_PROVIDER
 */

// @ts-expect-error Deno edge runtime import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { redactEmail } from '../_shared/pii.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import {
  MIN_INBOX_GAP_SECONDS,
  clampToWorkingWindow,
  dayStartInTz,
  poissonJitterSeconds,
} from '../_shared/send-window.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const EMAIL_VERIFICATION_PROVIDER = (Deno.env.get('EMAIL_VERIFICATION_PROVIDER') ?? 'neverbounce')
  .toLowerCase()
// Fall back to a provider-specific env var when EMAIL_VERIFICATION_API_KEY
// is unset — historical Vercel/Supabase deployments seeded ZEROBOUNCE_API_KEY
// directly. Keeps the verifier active without forcing an operator to copy a
// secret across two env stores.
// @ts-expect-error Deno globals
const EMAIL_VERIFICATION_API_KEY =
  (Deno.env.get('EMAIL_VERIFICATION_API_KEY') ?? '')
  // @ts-expect-error Deno globals
  || (EMAIL_VERIFICATION_PROVIDER === 'zerobounce' ? (Deno.env.get('ZEROBOUNCE_API_KEY') ?? '') : '')
  // @ts-expect-error Deno globals
  || (EMAIL_VERIFICATION_PROVIDER === 'neverbounce' ? (Deno.env.get('NEVERBOUNCE_API_KEY') ?? '') : '')

const MAX_DRAFTS_PER_TICK = 100  // safety bound — one tick should never overwhelm

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Scheduling helpers (working window, tz day-start, Poisson pacing) live in
// _shared/send-window.ts so they can be unit-tested outside the Deno runtime.

interface VerificationResult {
  result: 'valid' | 'invalid' | 'risky' | 'unknown'
  provider: string
  raw?: unknown
}

async function verifyEmail(email: string): Promise<VerificationResult> {
  if (!EMAIL_VERIFICATION_API_KEY) {
    return { result: 'unknown', provider: 'none' }
  }
  try {
    if (EMAIL_VERIFICATION_PROVIDER === 'zerobounce') {
      const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(EMAIL_VERIFICATION_API_KEY)}&email=${encodeURIComponent(email)}`
      const resp = await fetch(url)
      if (!resp.ok) return { result: 'unknown', provider: 'zerobounce' }
      const data = await resp.json() as { status?: string }
      const s = (data.status ?? '').toLowerCase()
      if (s === 'valid') return { result: 'valid', provider: 'zerobounce', raw: data }
      if (s === 'invalid' || s === 'do_not_mail') return { result: 'invalid', provider: 'zerobounce', raw: data }
      if (s === 'catch-all' || s === 'unknown' || s === 'spamtrap' || s === 'abuse') return { result: 'risky', provider: 'zerobounce', raw: data }
      return { result: 'unknown', provider: 'zerobounce', raw: data }
    }
    // Default: NeverBounce.
    const url = `https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(EMAIL_VERIFICATION_API_KEY)}&email=${encodeURIComponent(email)}`
    const resp = await fetch(url)
    if (!resp.ok) return { result: 'unknown', provider: 'neverbounce' }
    const data = await resp.json() as { result?: string; status?: number }
    const r = (data.result ?? '').toLowerCase()
    if (r === 'valid') return { result: 'valid', provider: 'neverbounce', raw: data }
    if (r === 'invalid') return { result: 'invalid', provider: 'neverbounce', raw: data }
    if (r === 'catchall' || r === 'unknown' || r === 'disposable') return { result: 'risky', provider: 'neverbounce', raw: data }
    return { result: 'unknown', provider: 'neverbounce', raw: data }
  } catch (err) {
    console.warn('verifyEmail failed:', (err as Error).message)
    return { result: 'unknown', provider: EMAIL_VERIFICATION_PROVIDER }
  }
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { success: false, error: 'Method not allowed' })
  }

  // Service-role auth gate. verify_jwt=true at the Edge gateway is REQUIRED —
  // it's the layer that verifies the JWT's HS256 signature. The helper below
  // decodes the (gateway-verified) JWT and requires `role` claim ==
  // 'service_role' so a leaked anon-key JWT cannot trigger the send pipeline.
  // Do NOT disable verify_jwt on this function — without the gateway check
  // the role claim alone is unsigned and trivially forgeable. See
  // ../_shared/auth.ts for the rationale.
  const unauthorizedResp = await requireServiceRoleAuth(req)
  if (unauthorizedResp) return unauthorizedResp

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 1. Pull approved drafts that aren't already in the queue.
  // Approved means: drafts.status='approved' AND no email_send_queue row for this draft_id.
  // (A unique index on email_send_queue.draft_id keeps this idempotent at the DB layer too.)
  const { data: drafts, error: draftsErr } = await supabase
    .from('email_drafts')
    .select('id, org_id, contact_id, subject, body, body_html, edited_subject, edited_body, edited_body_html, sender_inbox_id, draft_kind, created_by')
    .eq('status', 'approved')
    .order('approved_at', { ascending: true, nullsFirst: true })
    .limit(MAX_DRAFTS_PER_TICK)

  if (draftsErr) {
    console.error('drafts query failed:', draftsErr.message)
    return json(500, { success: false, error: draftsErr.message })
  }
  if (!drafts || drafts.length === 0) {
    return json(200, { success: true, enqueued: 0, skipped: 0, message: 'no approved drafts' })
  }

  // Filter out drafts that already have a queue row (defensive — unique idx is authoritative).
  const draftIds = drafts.map((d) => d.id)
  const { data: existingQueue } = await supabase
    .from('email_send_queue')
    .select('draft_id')
    .in('draft_id', draftIds)
  const alreadyQueued = new Set((existingQueue ?? []).map((r) => r.draft_id))

  // 2. Resolve contact emails for the remaining drafts.
  const fresh = drafts.filter((d) => !alreadyQueued.has(d.id))
  if (fresh.length === 0) {
    return json(200, { success: true, enqueued: 0, skipped: drafts.length, message: 'all already queued' })
  }
  const contactIds = Array.from(new Set(fresh.map((d) => d.contact_id).filter(Boolean) as string[]))
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, email, org_id, verification_status, catch_all_flag, role_based')
    .in('id', contactIds)
  const contactMap = new Map((contacts ?? []).map((c) => [c.id, c]))

  // 3. Load active email_accounts grouped by user.
  const userIds = Array.from(new Set(fresh.map((d) => d.created_by).filter(Boolean) as string[]))
  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('id, org_id, user_id, email_address, domain, status, daily_send_cap, last_send_at')
    .in('user_id', userIds)
    .eq('status', 'active')
  const accountsByUser = new Map<string, typeof accounts>()
  for (const a of (accounts ?? [])) {
    const list = accountsByUser.get(a.user_id) ?? []
    list.push(a)
    accountsByUser.set(a.user_id, list)
  }

  // 3b. Per-user working-window + timezone config — needed BEFORE the
  // daily-cap computation so the cap can use per-tz day boundaries.
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, send_timezone, working_hours_start_local, working_hours_end_local')
    .in('id', userIds)
  const userCfg = new Map((users ?? []).map((u) => [u.id, u]))

  // 3b2. P2-9 safety net — re-verify outbound-send readiness server-side before
  // queuing. The DB trigger trg_email_drafts_approve_ready already blocks the
  // ->approved transition unless the owner is ready, but readiness can lapse
  // AFTER approval (inbox deactivated, signature deleted). Mirror the same three
  // checks (profile name + >=1 signature + >=1 active inbox) here as defence in
  // depth, and park any now-unready draft instead of sending half-configured.
  const profileNameByUser = new Map(
    (users ?? []).map((u) => [u.id, !!((u as { full_name?: string | null }).full_name
      && String((u as { full_name?: string | null }).full_name).trim())]),
  )
  const { data: sigRows } = await supabase
    .from('email_signature_templates')
    .select('user_id')
    .in('user_id', userIds)
  const usersWithSignature = new Set((sigRows ?? []).map((r) => r.user_id))
  function isSenderReady(userId: string | null | undefined): boolean {
    if (!userId) return false
    const hasName = profileNameByUser.get(userId) ?? false
    const hasSignature = usersWithSignature.has(userId)
    const hasInbox = ((accountsByUser.get(userId) ?? []) as unknown[]).length > 0
    return hasName && hasSignature && hasInbox
  }

  // 3c. Per-account day-start (in user's tz). Used by the daily_send_cap
  // computation below — counts rows scheduled at-or-after the account's
  // user-local midnight, not the trailing-24h UTC window. Closes audit
  // P1-CP-01: pre-fix, a Melbourne user who burned half their cap at 11pm
  // could send the other half at 12:30am, then start a fresh cap allocation
  // from "midnight Melbourne" — total well above the daily limit.
  const allAccountIds = (accounts ?? []).map((a) => a.id)
  const dayStartByAccount = new Map<string, Date>()
  const nowForCap = new Date()
  for (const a of (accounts ?? [])) {
    const tz = userCfg.get(a.user_id)?.send_timezone ?? 'Australia/Melbourne'
    dayStartByAccount.set(a.id, dayStartInTz(nowForCap, tz))
  }
  const earliestDayStart = allAccountIds.length > 0
    ? new Date(Math.min(...allAccountIds.map((id) => dayStartByAccount.get(id)!.getTime())))
    : nowForCap

  // 3d. Count today's per-account sends. Floor query at the earliest day-start
  // across all accounts to keep the SQL window tight, then JS-filter rows by
  // each account's own per-tz day boundary. Counts {queued,sending,sent} —
  // failed/cancelled don't burn cap.
  const usedTodayByAccount = new Map<string, number>()
  if (allAccountIds.length > 0) {
    const { data: todayRows } = await supabase
      .from('email_send_queue')
      .select('email_account_id, scheduled_for, status')
      .in('email_account_id', allAccountIds)
      .gte('scheduled_for', earliestDayStart.toISOString())
      .in('status', ['queued', 'sending', 'sent'])
    for (const r of (todayRows ?? [])) {
      const dayStart = dayStartByAccount.get(r.email_account_id)
      if (!dayStart) continue
      if (new Date(r.scheduled_for).getTime() < dayStart.getTime()) continue
      usedTodayByAccount.set(r.email_account_id, (usedTodayByAccount.get(r.email_account_id) ?? 0) + 1)
    }
  }

  // Helper — returns true when account still has cap headroom for one more send.
  function hasCap(accountId: string, cap: number | null | undefined): boolean {
    if (cap == null || cap <= 0) return true  // null cap = unlimited
    return (usedTodayByAccount.get(accountId) ?? 0) < cap
  }

  // 5. Load suppression-list once per org_id touched.
  const orgIds = Array.from(new Set(fresh.map((d) => d.org_id).filter(Boolean) as string[]))
  const { data: supp } = await supabase
    .from('suppression_list')
    .select('org_id, email, domain_suppression')
    .in('org_id', orgIds)
  const suppByOrg = new Map<string, Set<string>>()
  const suppDomainByOrg = new Map<string, Set<string>>()
  for (const s of (supp ?? [])) {
    const set = suppByOrg.get(s.org_id) ?? new Set()
    set.add(s.email.toLowerCase())
    suppByOrg.set(s.org_id, set)
    if (s.domain_suppression) {
      const dset = suppDomainByOrg.get(s.org_id) ?? new Set()
      const domain = s.email.toLowerCase().split('@', 2)[1]
      if (domain) dset.add(domain)
      suppDomainByOrg.set(s.org_id, dset)
    }
  }

  // 6. Build a per-account "next-available scheduled_for" map so we can space
  // sends 90s+ apart from previous sends in this tick.
  const nextSlotByAccount = new Map<string, number>()  // ms epoch
  // Recipient-domain → sender-domain LAST-USED map (for anti-clustering)
  const lastSenderDomainPerRecipientDomain = new Map<string, string>()

  let enqueued = 0
  let skipped = 0
  const now = new Date()

  for (const draft of fresh) {
    const contact = contactMap.get(draft.contact_id)
    if (!contact || !contact.email) {
      skipped++
      continue
    }
    // P2-9 safety net — owner's send-readiness may have lapsed since approval.
    // Leave the draft 'approved' so it requeues automatically once setup is
    // restored; do NOT send half-configured.
    if (!isSenderReady(draft.created_by)) {
      console.warn(`enqueue-sends: skipping draft ${draft.id} — sender ${draft.created_by ?? 'unknown'} no longer send-ready`)
      skipped++
      continue
    }
    const recipient = String(contact.email).toLowerCase()
    const recipientDomain = recipient.split('@', 2)[1] ?? ''
    const orgSupp = suppByOrg.get(draft.org_id) ?? new Set()
    const orgSuppDomains = suppDomainByOrg.get(draft.org_id) ?? new Set()
    if (orgSupp.has(recipient) || (recipientDomain && orgSuppDomains.has(recipientDomain))) {
      await supabase.from('email_drafts').update({
        status: 'suppressed',
        suppression_reason: 'suppression_list',
      }).eq('id', draft.id)
      skipped++
      continue
    }

    // Verified-deliverable gate (defence in depth). approve-lead only enrols a
    // contact when it's valid AND not catch-all AND not role-based, but that's
    // a single chokepoint at enrolment time — a draft can also arrive here from
    // generate-draft or a manually-created row, and a contact's stored verdict
    // can lapse after enrolment. Every send passes through enqueue-sends, so we
    // re-assert the same rule here against the STORED ZeroBounce verdict:
    // outreach-ready ⇔ verification_status='valid' AND NOT catch_all_flag AND
    // NOT role_based.
    //
    // Two distinct not-ready cases, handled differently so we never strand a
    // draft that could legitimately send later:
    //   • PERMANENTLY undeliverable — role-based inbox (deterministic, never
    //     changes), OR a settled bad verdict (invalid/catch_all/disposable),
    //     OR 'unknown'. 'unknown' is terminal too: leadflow_claim_pending_contacts
    //     only re-claims rows still at 'pending', so an 'unknown' verdict never
    //     becomes 'valid' — leaving the draft approved would loop the cron on it
    //     forever. Park at 'suppressed' (terminal) + a 'failed' event.
    //   • TEMPORARILY not decided — verification_status still 'pending' (or null:
    //     verdict not final, e.g. ZeroBounce hasn't drained yet). Leave the
    //     draft 'approved' and skip this tick — the same requeue pattern used
    //     for the daily-cap / sender-not-ready branches — so it re-enters the
    //     queue automatically once the contact verifies 'valid'.
    const storedOk =
      contact.verification_status === 'valid' &&
      contact.catch_all_flag !== true &&
      contact.role_based !== true
    if (!storedOk) {
      const permanentlyUndeliverable =
        contact.role_based === true ||
        contact.catch_all_flag === true ||
        contact.verification_status === 'invalid' ||
        contact.verification_status === 'catch_all' ||
        contact.verification_status === 'disposable' ||
        contact.verification_status === 'unknown'
      if (permanentlyUndeliverable) {
        await supabase.from('email_drafts').update({
          status: 'suppressed',
          suppression_reason: 'not_verified_deliverable',
        }).eq('id', draft.id)
        await supabase.from('email_send_events').insert({
          org_id: draft.org_id,
          draft_id: draft.id,
          event_type: 'failed',
          metadata: {
            reason: 'not_verified_deliverable',
            verification_status: contact.verification_status ?? null,
            catch_all_flag: contact.catch_all_flag ?? null,
            role_based: contact.role_based ?? null,
            to_hashed: await redactEmail(recipient),
          },
        })
      }
      // else: still 'pending' (or null) — leave 'approved', requeue next tick.
      skipped++
      continue
    }

    // Verification gate
    if (EMAIL_VERIFICATION_API_KEY) {
      const v = await verifyEmail(recipient)
      if (v.result === 'invalid') {
        await supabase.from('email_drafts').update({
          status: 'suppressed',
          suppression_reason: `verification_${v.result}`,
        }).eq('id', draft.id)
        await supabase.from('email_send_events').insert({
          org_id: draft.org_id,
          draft_id: draft.id,
          event_type: 'failed',
          metadata: {
            reason: 'verification_failed',
            provider: v.provider,
            result: v.result,
            to_hashed: await redactEmail(recipient),
          },
        })
        skipped++
        continue
      }
      // risky/unknown still proceed (Jordan's call); document choice in metadata.
    }

    // Pick a sending account. Prefer the draft's pinned sender_inbox_id when active.
    // Filter out accounts that have hit daily_send_cap.
    const userAccountsAll = (accountsByUser.get(draft.created_by ?? '') ?? []).filter(Boolean)
    const userAccounts = userAccountsAll.filter((a) => hasCap(a.id, a.daily_send_cap))
    if (!userAccounts || userAccounts.length === 0) {
      // No account has headroom today — skip this draft, leave it 'approved'
      // so the next cron tick (after midnight UTC reset) picks it up.
      skipped++
      continue
    }
    const pinned = userAccounts.find((a) => a.id === draft.sender_inbox_id)
    let chosen = pinned ?? userAccounts[Math.floor(Math.random() * userAccounts.length)]

    // Anti-clustering: rotate if the same recipient domain just received from
    // this sender's domain (within this tick). Try at most N rotations.
    const senderDomainCandidate = (chosen?.domain ?? chosen?.email_address?.split('@', 2)[1] ?? '').toLowerCase()
    if (
      recipientDomain
      && senderDomainCandidate
      && lastSenderDomainPerRecipientDomain.get(recipientDomain) === senderDomainCandidate
      && userAccounts.length > 1
    ) {
      const alt = userAccounts.find((a) => {
        const ad = (a.domain ?? a.email_address.split('@', 2)[1] ?? '').toLowerCase()
        return ad !== senderDomainCandidate
      })
      if (alt) chosen = alt
    }
    const chosenAccount = chosen!
    const chosenDomain = (chosenAccount.domain ?? chosenAccount.email_address.split('@', 2)[1] ?? '').toLowerCase()

    // Compute scheduled_for
    const lastSlotMs = nextSlotByAccount.get(chosenAccount.id)
      ?? (chosenAccount.last_send_at ? new Date(chosenAccount.last_send_at).getTime() : 0)
    const earliestMs = Math.max(lastSlotMs + MIN_INBOX_GAP_SECONDS * 1000, now.getTime())
    const jitterSec = poissonJitterSeconds()
    const candidateMs = earliestMs + Math.round(jitterSec * 1000)

    // Clamp to user's working window
    const ucfg = userCfg.get(chosenAccount.user_id) ?? {
      send_timezone: 'Australia/Melbourne',
      working_hours_start_local: 8,
      working_hours_end_local: 18,
    }
    const clamped = clampToWorkingWindow(
      new Date(candidateMs),
      ucfg.send_timezone ?? 'Australia/Melbourne',
      ucfg.working_hours_start_local ?? 8,
      ucfg.working_hours_end_local ?? 18,
    )
    const scheduledFor = clamped.toISOString()

    // Insert the queue row
    const { error: insErr } = await supabase
      .from('email_send_queue')
      .insert({
        org_id: draft.org_id,
        user_id: chosenAccount.user_id,
        draft_id: draft.id,
        email_account_id: chosenAccount.id,
        to_email: recipient,
        subject: draft.edited_subject ?? draft.subject ?? '',
        body: draft.edited_body ?? draft.body ?? '',
        // Parallel HTML body (image-logo signature) — MUST track the same source
        // as `body` above. If a rep edited the text (edited_body) but no matching
        // edited_body_html exists, sending the original body_html would show
        // HTML recipients the un-edited copy. In that case queue NULL so
        // drain-send-queue falls back to textToHtml(edited_body) and the two
        // parts stay consistent.
        body_html: draft.edited_body
          ? (draft.edited_body_html ?? null)
          : (draft.body_html ?? null),
        scheduled_for: scheduledFor,
        status: 'queued',
      })
    if (insErr) {
      // Most common cause: a duplicate from a concurrent tick (unique idx on draft_id).
      // Log and move on.
      console.warn('enqueue insert failed:', insErr.message, 'draft=', draft.id)
      skipped++
      continue
    }

    // Mark draft 'queued' so we don't re-pick it next tick.
    await supabase.from('email_drafts').update({ status: 'queued' }).eq('id', draft.id)

    // Bump today's usage count so subsequent iterations in this tick respect the cap.
    usedTodayByAccount.set(chosenAccount.id, (usedTodayByAccount.get(chosenAccount.id) ?? 0) + 1)

    // Update pacing maps
    nextSlotByAccount.set(chosenAccount.id, new Date(scheduledFor).getTime())
    if (recipientDomain) {
      lastSenderDomainPerRecipientDomain.set(recipientDomain, chosenDomain)
    }

    enqueued++
  }

  return json(200, {
    success: true,
    enqueued,
    skipped,
    examined: drafts.length,
  })
})
