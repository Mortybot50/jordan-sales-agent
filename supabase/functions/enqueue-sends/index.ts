/**
 * enqueue-sends — cron Edge Function (every 5 min via pg_cron).
 *
 * Promotes approved drafts from public.email_drafts into public.email_send_queue.
 * Applies the safety controls that turn a "send a draft" feature into a
 * deliverability-conscious cold-email engine:
 *
 *   1. Suppression-list filter — drafts to suppressed addresses are marked
 *      status='suppressed' and skipped, no queue row.
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

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const EMAIL_VERIFICATION_API_KEY = Deno.env.get('EMAIL_VERIFICATION_API_KEY') ?? ''
// @ts-expect-error Deno globals
const EMAIL_VERIFICATION_PROVIDER = (Deno.env.get('EMAIL_VERIFICATION_PROVIDER') ?? 'neverbounce')
  .toLowerCase()

const MIN_INBOX_GAP_SECONDS = 90
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

// Return the current hour (0..23) in the given IANA timezone.
function currentHourInTz(tz: string, now: Date = new Date()): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-AU', {
      hour: 'numeric', hour12: false, timeZone: tz,
    })
    const parts = fmt.formatToParts(now)
    const h = parts.find((p) => p.type === 'hour')?.value ?? '0'
    return parseInt(h, 10) % 24  // some locales emit '24' for midnight
  } catch {
    return now.getUTCHours()
  }
}

// Push `from` forward into the next [startHourLocal, endHourLocal) window in tz.
// If `from` is already inside the window, return `from`.
function clampToWorkingWindow(from: Date, tz: string, startHourLocal: number, endHourLocal: number): Date {
  const h = currentHourInTz(tz, from)
  if (h >= startHourLocal && h < endHourLocal) return from

  // Push forward by 1 hour at a time until we land inside the window.
  // Bounded loop — never more than 24 iterations.
  let candidate = new Date(from.getTime())
  for (let i = 0; i < 48; i++) {
    candidate = new Date(candidate.getTime() + 60 * 60 * 1000)
    const ch = currentHourInTz(tz, candidate)
    if (ch === startHourLocal) {
      // Snap to top of the start-hour by zeroing the minutes/seconds in local TZ.
      // We can't easily set local minutes from Deno; instead, walk back to the
      // first minute of the start-hour by stepping forward in 1-min until the
      // 'minute' part is 0..2 (close enough for a pacing scheduler).
      for (let j = 0; j < 60; j++) {
        const m = parseInt(
          new Intl.DateTimeFormat('en-AU', { minute: 'numeric', timeZone: tz })
            .formatToParts(candidate)
            .find((p) => p.type === 'minute')?.value ?? '0',
          10,
        )
        if (m <= 2) return candidate
        candidate = new Date(candidate.getTime() + 60 * 1000)
      }
      return candidate
    }
  }
  return candidate
}

function poissonJitterSeconds(rateLambdaPerMin = 6): number {
  // Inverse-CDF for an exponential with mean 60/lambda seconds.
  // u in (0,1] — guard against u=0 (Math.random() can return it).
  const u = Math.max(Math.random(), 1e-9)
  const meanSec = 60 / Math.max(rateLambdaPerMin, 0.1)
  const sec = -Math.log(u) * meanSec
  // Clip to a sane range so a heavy tail doesn't park a send 4 hours from now.
  return Math.min(Math.max(sec, MIN_INBOX_GAP_SECONDS), 15 * 60)
}

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

  // Service-role auth gate. verify_jwt=true at the Edge only proves the
  // caller has *some* valid JWT (anon key included). pg_cron posts with the
  // service-role bearer; reject anything else so a leaked anon key can't
  // trigger the send pipeline.
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return json(401, { success: false, error: 'unauthorized' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 1. Pull approved drafts that aren't already in the queue.
  // Approved means: drafts.status='approved' AND no email_send_queue row for this draft_id.
  // (A unique index on email_send_queue.draft_id keeps this idempotent at the DB layer too.)
  const { data: drafts, error: draftsErr } = await supabase
    .from('email_drafts')
    .select('id, org_id, contact_id, subject, body, edited_subject, edited_body, sender_inbox_id, draft_kind, created_by')
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
    .select('id, email, org_id')
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

  // 3b. Pre-compute today's send count per account so we can enforce
  // email_accounts.daily_send_cap. Counts any row scheduled today UTC in
  // {queued,sending,sent} — failed/cancelled don't burn cap. Used 24h sliding
  // window for v1; a per-user-tz day boundary is a Week 3 followup.
  const allAccountIds = (accounts ?? []).map((a) => a.id)
  const dayWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const usedTodayByAccount = new Map<string, number>()
  if (allAccountIds.length > 0) {
    const { data: todayRows } = await supabase
      .from('email_send_queue')
      .select('email_account_id, status')
      .in('email_account_id', allAccountIds)
      .gte('scheduled_for', dayWindowStart)
      .in('status', ['queued', 'sending', 'sent'])
    for (const r of (todayRows ?? [])) {
      usedTodayByAccount.set(r.email_account_id, (usedTodayByAccount.get(r.email_account_id) ?? 0) + 1)
    }
  }
  // Helper — returns true when account still has cap headroom for one more send.
  function hasCap(accountId: string, cap: number | null | undefined): boolean {
    if (cap == null || cap <= 0) return true  // null cap = unlimited
    return (usedTodayByAccount.get(accountId) ?? 0) < cap
  }

  // 4. Per-user working window config.
  const { data: users } = await supabase
    .from('users')
    .select('id, send_timezone, working_hours_start_local, working_hours_end_local')
    .in('id', userIds)
  const userCfg = new Map((users ?? []).map((u) => [u.id, u]))

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
