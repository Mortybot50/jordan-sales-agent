/**
 * enrich-venue-contacts — in-house email enrichment for name-only venues.
 *
 * Closes the DISCOVERY gap (distinct from the verification gap ZeroBounce
 * covers): many venues arrived from media listings (Broadsheet, Hospitality
 * Mag, Good Food, News) and VCGLR with a NAME + SUBURB only — no website, so the
 * crawler had nothing to crawl and BEST EMAIL stayed empty. This function finds
 * a real, verified email WITHOUT any new paid provider, reusing the already-paid
 * Google Places (website resolution) and ZeroBounce (verification) keys.
 *
 * Two steps (single-venue or batch):
 *   resolve — "<name> <suburb>" → official website + phone via the shared
 *             Places client. Writes venues.website + enrich_source and flips
 *             contact_enrichment_status back to 'pending' so the EXISTING crawl
 *             cron (leadflow_drain_crawl_queue) then deep-crawls it for emails.
 *   guess   — pattern-guess-then-verify: for a venue that has a DOMAIN but no
 *             deliverable email, generate standard address patterns and let
 *             ZeroBounce confirm which are real. Only status=valid is stored.
 *             SAFELY NO-OPS when ZeroBounce is out of credits (never crashes).
 *
 * A guessed address is NEVER stored as valid without ZeroBounce confirming it.
 * Role inboxes (info@ …) are flagged role_based (generated column) and are NOT
 * outreach-ready. This function never sends and never changes approve-lead gate
 * semantics — it only feeds better data into the existing human-review chain.
 *
 * POST body (all optional except as noted):
 *   Single: { venue_id: uuid, step?: 'resolve'|'guess'|'auto' }   (default auto)
 *   Batch:  { batch: true, step?: 'resolve'|'guess', dry_run?: bool,
 *             limit?: number, org_id?: uuid }
 *
 * Caller: service-role only (cron / operator tooling). verify_jwt=true +
 * role-claim check. No user-facing UI surface.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_API_KEY.
 * Optional env: ZEROBOUNCE_API_KEY (guess step), PATTERN_GUESS_ENABLED
 *   ('false' disables the guess step entirely; default enabled).
 */

// @ts-expect-error Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveVenueWebsite, placesConfigured, placeTextSearch } from '../_shared/places.ts'
import { zeroBounceValidateBatch } from '../_shared/zerobounce.ts'
import { buildCandidates } from '../_shared/email-patterns.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const ZEROBOUNCE_API_KEY = Deno.env.get('ZEROBOUNCE_API_KEY') ?? ''
// @ts-expect-error Deno globals
const PATTERN_GUESS_ENABLED = (Deno.env.get('PATTERN_GUESS_ENABLED') ?? 'true').toLowerCase() !== 'false'

const DEFAULT_BATCH_LIMIT = 50
const MAX_BATCH_LIMIT = 200
const PLACES_RATE_LIMIT_MS = 150 // polite spacing between Places calls
const MAX_GUESS_CANDIDATES = 8

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Type alias for the service-role client (avoids repeating the generic).
type Supa = ReturnType<typeof createClient>

interface VenueRow {
  id: string
  org_id: string
  name: string
  suburb: string | null
  website: string | null
  phone: string | null
  place_id: string | null
  enrich_source: string | null
}

interface ContactRow {
  id: string
  email: string | null
  full_name: string | null
  verification_status: string | null
  catch_all_flag: boolean | null
  role_based: boolean | null
}

// ---------------------------------------------------------------------------
// resolve — name → website via Places
// ---------------------------------------------------------------------------

type ResolveOutcome =
  | 'resolved_website' | 'match_no_website' | 'dead_end' | 'has_website' | 'no_key' | 'error'

async function resolveVenue(
  supabase: Supa,
  v: VenueRow,
  dryRun: boolean,
): Promise<{ outcome: ResolveOutcome; website?: string }> {
  if (!placesConfigured()) return { outcome: 'no_key' }
  if (v.website && v.website.trim().length > 0) return { outcome: 'has_website' }

  const res = await resolveVenueWebsite(v.name, v.suburb)

  // Transient / config failure (REQUEST_DENIED, HTTP 4xx/5xx, network). Do NOT
  // write enrich_source — leaving it NULL keeps the venue in the queue so it is
  // retried once Places recovers, instead of being permanently dead-ended.
  if (res.status === 'error') return { outcome: 'error' }

  if (res.status === 'no_match') {
    if (!dryRun) {
      await supabase.from('venues')
        .update({ enrich_source: 'places_no_match', updated_at: new Date().toISOString() })
        .eq('id', v.id)
    }
    return { outcome: 'dead_end' }
  }

  const resolved = res.venue
  const hasWebsite = !!resolved.website && resolved.website.trim().length > 0

  if (dryRun) {
    return { outcome: hasWebsite ? 'resolved_website' : 'match_no_website', website: resolved.website }
  }

  // Live write. Only fill columns that are currently empty (never overwrite a
  // manually-corrected value). Flip status back to 'pending' ONLY when we found
  // a website, so the existing crawl cron picks it up; a match with no website
  // has nothing to crawl.
  const patch: Record<string, unknown> = {
    enrich_source: hasWebsite ? 'places_textsearch' : 'places_no_website',
    updated_at: new Date().toISOString(),
  }
  if (hasWebsite) {
    patch.website = resolved.website
    patch.contact_enrichment_status = 'pending'
  }
  if (!v.place_id && resolved.place_id) patch.place_id = resolved.place_id
  if (!v.phone && resolved.phone) patch.phone = resolved.phone

  // If the write fails we have NOT persisted the website — report an error so
  // the venue stays in the queue (enrich_source still NULL) and is retried,
  // rather than claiming a resolution the DB never recorded.
  const { error: upErr } = await supabase.from('venues').update(patch).eq('id', v.id)
  if (upErr) {
    console.error(`enrich: venue update failed for ${v.id}: ${upErr.message}`)
    return { outcome: 'error' }
  }

  return { outcome: hasWebsite ? 'resolved_website' : 'match_no_website', website: resolved.website }
}

// ---------------------------------------------------------------------------
// guess — pattern-guess-then-verify via ZeroBounce
// ---------------------------------------------------------------------------

type GuessSkip =
  | 'disabled' | 'no_zb_key' | 'no_website' | 'already_deliverable'
  | 'out_of_credits' | 'zerobounce_error' | 'no_candidates'

interface GuessResult {
  guessed_valid: number
  guessed_catch_all: number
  candidates: number
  role_candidates: number
  personal_candidates: number
  skipped?: GuessSkip
  error?: string
}

/**
 * Stamp guess_attempted_at so the guess batch stops re-selecting this venue and
 * re-spending ZeroBounce credits. Called ONLY after an attempt actually
 * concluded (verification ran, or there was nothing to try / already
 * deliverable) — never after an out-of-credits or provider-error pause, which
 * must leave the venue re-queued.
 */
async function markGuessAttempted(supabase: Supa, id: string): Promise<void> {
  await supabase.from('venues')
    .update({ guess_attempted_at: new Date().toISOString() })
    .eq('id', id)
}

/** Pull a plausible person name off the venue's existing contacts, if any. */
function pickPersonName(contacts: ContactRow[], venueName: string): string | null {
  const vn = venueName.trim().toLowerCase()
  for (const c of contacts) {
    const n = (c.full_name ?? '').trim()
    if (!n) continue
    if (n.toLowerCase() === vn) continue          // that's the venue, not a person
    if (n.split(/\s+/).length < 2) continue       // want first + last
    return n
  }
  return null
}

async function guessVenue(
  supabase: Supa,
  v: VenueRow,
  contacts: ContactRow[],
): Promise<GuessResult> {
  const empty: GuessResult = {
    guessed_valid: 0, guessed_catch_all: 0, candidates: 0,
    role_candidates: 0, personal_candidates: 0,
  }
  if (!PATTERN_GUESS_ENABLED) return { ...empty, skipped: 'disabled' }
  if (!ZEROBOUNCE_API_KEY) return { ...empty, skipped: 'no_zb_key' }
  if (!v.website || v.website.trim().length === 0) return { ...empty, skipped: 'no_website' }

  // Already have a genuinely deliverable email? Nothing to guess.
  const alreadyDeliverable = contacts.some((c) =>
    !!c.email && c.verification_status === 'valid' &&
    c.catch_all_flag !== true && c.role_based !== true,
  )
  if (alreadyDeliverable) {
    await markGuessAttempted(supabase, v.id)
    return { ...empty, skipped: 'already_deliverable' }
  }

  const personName = pickPersonName(contacts, v.name)
  const candidates = buildCandidates(v.website, personName, MAX_GUESS_CANDIDATES)
  if (candidates.length === 0) {
    await markGuessAttempted(supabase, v.id)
    return { ...empty, skipped: 'no_candidates' }
  }

  const roleCount = candidates.filter((c) => c.kind === 'role').length
  const personalCount = candidates.filter((c) => c.kind === 'personal').length

  const outcome = await zeroBounceValidateBatch(
    ZEROBOUNCE_API_KEY,
    candidates.map((c) => c.email),
  )

  if (!outcome.ok) {
    // Out-of-credits (the current state) is a clean pause, NOT an error: mark
    // nothing, never crash, let the caller report credits as the gate.
    const skipped: GuessSkip = outcome.outOfCredits ? 'out_of_credits' : 'zerobounce_error'
    if (outcome.outOfCredits) {
      console.log(`enrich: pattern-guess paused for ${v.id} — ZeroBounce out of credits`)
    } else {
      console.warn(`enrich: pattern-guess ZeroBounce error for ${v.id}: ${outcome.error}`)
    }
    return { ...empty, candidates: candidates.length, role_candidates: roleCount, personal_candidates: personalCount, skipped, error: outcome.error }
  }

  // Classify verdicts. valid → store as deliverable (role_based auto-flags role
  // inboxes). catch-all → the whole DOMAIN accepts everything, so no single
  // guess is provably real: store ONE representative flagged catch_all so the
  // human sees "catch-all domain, needs manual confirmation" and stop.
  const validRows: { email: string; role: boolean }[] = []
  let anyCatchAll = false
  for (const cand of candidates) {
    const verdict = outcome.verdicts.get(cand.email)
    if (!verdict) continue
    if (verdict.status === 'valid') {
      validRows.push({ email: cand.email, role: cand.kind === 'role' })
    } else if (verdict.status === 'catch-all' || verdict.status === 'catch_all') {
      anyCatchAll = true
    }
  }

  const rows: Record<string, unknown>[] = []
  for (const r of validRows) {
    rows.push({
      org_id: v.org_id,
      venue_id: v.id,
      email: r.email,
      full_name: personName ?? v.name,
      source: 'pattern_guess',
      verification_status: 'valid',
      catch_all_flag: false,
      verified_at: new Date().toISOString(),
    })
  }

  let guessedCatchAll = 0
  if (validRows.length === 0 && anyCatchAll) {
    // Prefer a personal representative over a role one for the catch-all marker.
    const rep = candidates.find((c) => c.kind === 'personal') ?? candidates[0]
    rows.push({
      org_id: v.org_id,
      venue_id: v.id,
      email: rep.email,
      full_name: personName ?? v.name,
      source: 'pattern_guess',
      verification_status: 'catch_all',
      catch_all_flag: true,
      verified_at: new Date().toISOString(),
    })
    guessedCatchAll = 1
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('contacts').upsert(rows, {
      onConflict: 'org_id,venue_id,email',
      ignoreDuplicates: true,
    })
    if (error) {
      console.error(`enrich: contact upsert failed for ${v.id}: ${error.message}`)
      return { ...empty, candidates: candidates.length, role_candidates: roleCount, personal_candidates: personalCount, skipped: 'zerobounce_error', error: error.message }
    }
  }

  // Verification concluded for this venue (whether or not anything deliverable
  // came back) — mark it so the batch moves on and never re-bills ZeroBounce.
  await markGuessAttempted(supabase, v.id)

  return {
    guessed_valid: validRows.length,
    guessed_catch_all: guessedCatchAll,
    candidates: candidates.length,
    role_candidates: roleCount,
    personal_candidates: personalCount,
  }
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

const VENUE_COLS = 'id, org_id, name, suburb, website, phone, place_id, enrich_source'

async function loadVenue(supabase: Supa, venueId: string): Promise<VenueRow | null> {
  const { data } = await supabase.from('venues').select(VENUE_COLS).eq('id', venueId).maybeSingle()
  return (data as VenueRow) ?? null
}

async function loadContacts(supabase: Supa, venueId: string): Promise<ContactRow[]> {
  const { data } = await supabase.from('contacts')
    .select('id, email, full_name, verification_status, catch_all_flag, role_based')
    .eq('venue_id', venueId)
  return (data as ContactRow[]) ?? []
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

// @ts-expect-error Deno serve
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const unauthorized = await requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  let body: {
    venue_id?: string
    batch?: boolean
    step?: string
    dry_run?: boolean
    limit?: number
    org_id?: string
  } = {}
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid JSON' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── Diagnostic mode ───────────────────────────────────────────────────
  // Service-role-only probe: runs a single Places Text Search for the top
  // name-only venue and returns the raw provider status + result sample, so an
  // operator can tell a "no plausible match" dead-end apart from a REQUEST_
  // DENIED / API-not-enabled key problem WITHOUT the key ever leaving the
  // function. Never writes.
  if (body.batch && body.step === 'diag') {
    if (!placesConfigured()) return json(500, { error: 'GOOGLE_PLACES_API_KEY not set' })
    const { data: venues } = await supabase.from('venues').select(VENUE_COLS)
      .or('website.is.null,website.eq.')
      .is('enrich_source', null)
      .neq('archived', true)
      .neq('is_excluded', true)
      .order('icp_score', { ascending: false, nullsFirst: false })
      .limit(3)
    const out: unknown[] = []
    for (const v of ((venues as VenueRow[]) ?? [])) {
      const query = [v.name, v.suburb, 'Victoria', 'Australia'].filter(Boolean).join(' ')
      const res = await placeTextSearch(query)
      out.push({
        venue: v.name,
        suburb: v.suburb,
        query,
        places_status: res.status,
        result_count: res.results.length,
        first_result: res.results[0]?.name ?? null,
      })
      await sleep(PLACES_RATE_LIMIT_MS)
    }
    return json(200, { step: 'diag', probes: out })
  }

  // ── Batch mode ────────────────────────────────────────────────────────
  if (body.batch) {
    const step = body.step === 'guess' ? 'guess' : 'resolve'
    const dryRun = body.dry_run === true
    const limit = Math.max(1, Math.min(MAX_BATCH_LIMIT, Math.floor(body.limit ?? DEFAULT_BATCH_LIMIT)))

    if (step === 'resolve') {
      if (!placesConfigured()) return json(500, { error: 'GOOGLE_PLACES_API_KEY not set' })

      // Name-only, not-yet-attempted venues, best-fit first. enrich_source IS
      // NULL guards idempotency: previously-attempted venues (resolved or
      // dead-ended) are skipped so we never re-bill Places.
      let q = supabase.from('venues').select(VENUE_COLS)
        .or('website.is.null,website.eq.')
        .is('enrich_source', null)
        .neq('archived', true)
        .neq('is_excluded', true)
        .order('icp_score', { ascending: false, nullsFirst: false })
        .limit(limit)
      if (body.org_id) q = q.eq('org_id', body.org_id)

      const { data: venues, error } = await q
      if (error) return json(500, { error: `venue read failed: ${error.message}` })

      const rows = (venues as VenueRow[]) ?? []
      const counts = { scanned: 0, resolved_website: 0, match_no_website: 0, dead_end: 0, errors: 0 }
      for (const v of rows) {
        counts.scanned++
        const { outcome } = await resolveVenue(supabase, v, dryRun)
        if (outcome === 'resolved_website') counts.resolved_website++
        else if (outcome === 'match_no_website') counts.match_no_website++
        else if (outcome === 'error' || outcome === 'no_key') counts.errors++
        else counts.dead_end++
        await sleep(PLACES_RATE_LIMIT_MS)
      }

      return json(200, { step: 'resolve', dry_run: dryRun, limit, ...counts })
    }

    // step === 'guess'
    // Dry-run: preview ONLY. Never claims (no lease burn), never calls
    // ZeroBounce (no credit spend), never writes contacts, never stamps
    // guess_attempted_at. A plain read of the same population the claim RPC
    // targets, counting how many venues would be tried and how many candidate
    // addresses would be generated.
    if (dryRun) {
      let pq = supabase.from('venues').select(VENUE_COLS)
        .not('website', 'is', null)
        .neq('website', '')
        .is('guess_attempted_at', null)
        .neq('archived', true)
        .neq('is_excluded', true)
        .order('icp_score', { ascending: false, nullsFirst: false })
        .limit(limit)
      if (body.org_id) pq = pq.eq('org_id', body.org_id)

      const { data: preview, error: pErr } = await pq
      if (pErr) return json(500, { error: `guess preview read failed: ${pErr.message}` })

      const pRows = ((preview as VenueRow[]) ?? []).filter((v) => v.website && v.website.trim().length > 0)
      let wouldTry = 0
      let candidateEmails = 0
      let skippedDeliverable = 0
      for (const v of pRows) {
        const contacts = await loadContacts(supabase, v.id)
        const alreadyDeliverable = contacts.some((c) =>
          !!c.email && c.verification_status === 'valid' &&
          c.catch_all_flag !== true && c.role_based !== true,
        )
        if (alreadyDeliverable) { skippedDeliverable++; continue }
        const n = buildCandidates(v.website!, pickPersonName(contacts, v.name), MAX_GUESS_CANDIDATES).length
        if (n > 0) { wouldTry++; candidateEmails += n }
      }
      return json(200, {
        step: 'guess', dry_run: true, limit,
        scanned: pRows.length,
        would_try: wouldTry,
        candidate_emails: candidateEmails,
        skipped_deliverable: skippedDeliverable,
      })
    }

    // Live run — atomically CLAIM a slice via leadflow_claim_guess_venues (FOR
    // UPDATE SKIP LOCKED + 15-min lease): this both reserves venues so overlapping
    // runs never double-spend ZeroBounce credits on the same venue, AND drains a
    // fresh slice each run (guess_attempted_at IS NULL) so the backlog past `limit`
    // is never starved. A concluded attempt then stamps guess_attempted_at
    // (terminal); an out-of-credits pause leaves it NULL so the lease expiry
    // re-queues it.
    const { data: venues, error } = await supabase
      .rpc('leadflow_claim_guess_venues', { p_limit: limit, p_org: body.org_id ?? null })
    if (error) return json(500, { error: `guess claim failed: ${error.message}` })

    const rows = ((venues as VenueRow[]) ?? []).filter((v) => v.website && v.website.trim().length > 0)
    const agg = {
      scanned: 0, guessed_valid: 0, guessed_catch_all: 0,
      out_of_credits: false, skipped_deliverable: 0,
    }
    for (const v of rows) {
      const contacts = await loadContacts(supabase, v.id)
      const r = await guessVenue(supabase, v, contacts)
      agg.scanned++
      agg.guessed_valid += r.guessed_valid
      agg.guessed_catch_all += r.guessed_catch_all
      if (r.skipped === 'out_of_credits') { agg.out_of_credits = true; break } // stop burning attempts
      if (r.skipped === 'already_deliverable') agg.skipped_deliverable++
    }

    return json(200, { step: 'guess', limit, ...agg })
  }

  // ── Single-venue mode ───────────────────────────────────────────────────
  const venueId = body.venue_id
  if (!venueId || typeof venueId !== 'string') {
    return json(400, { error: 'venue_id required (or set batch:true)' })
  }
  const step = ['resolve', 'guess', 'auto'].includes(body.step ?? '') ? body.step! : 'auto'
  const dryRun = body.dry_run === true

  const venue = await loadVenue(supabase, venueId)
  if (!venue) return json(404, { error: 'venue not found' })

  const hasWebsite = !!venue.website && venue.website.trim().length > 0
  const effective = step === 'auto' ? (hasWebsite ? 'guess' : 'resolve') : step

  if (effective === 'resolve') {
    const r = await resolveVenue(supabase, venue, dryRun)
    return json(200, { venue_id: venueId, step: 'resolve', dry_run: dryRun, ...r })
  }

  const contacts = await loadContacts(supabase, venueId)
  const g = await guessVenue(supabase, venue, contacts)
  return json(200, { venue_id: venueId, step: 'guess', ...g })
})
