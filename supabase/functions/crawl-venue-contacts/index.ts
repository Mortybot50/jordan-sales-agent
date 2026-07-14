/**
 * crawl-venue-contacts — LeadFlow Sourcing contact-page crawler
 *
 * Closes the Outscraper email-extraction gap: Outscraper's
 * `emails_and_contacts` enrichment only scans homepages, so venues that
 * publish their emails on /contact-us/, /about/, /get-in-touch/, etc.
 * return 0 contacts even when emails are clearly listed.
 *
 * Logic mirrors the proven Python POC against Carlton venues:
 *   1. Load venue by id; bail if no website.
 *   2. Fetch homepage with browser UA, 10s timeout.
 *   3. Parse <a href> for paths matching common contact-page slugs.
 *   4. Always include /contact + /contact-us as fallbacks.
 *   5. Fetch up to 4 additional candidate pages (5 pages total), 8s timeout.
 *   6. Extract emails via mailto: + raw-text regex.
 *   7. Junk filter — drop asset filenames, tracking pixels, CDN domains.
 *   8. Domain-match — strip TLDs from email + website apex; brand roots
 *      must match (handles .com ↔ .com.au swaps).
 *   9. Cap at 4 accepted emails per venue.
 *  10. Insert into contacts with source='website_crawl', dedup'd via the
 *      (org_id, venue_id, email) unique index.
 *  10b. Hunter.io fallback — whenever the crawl found 0 emails AND a website
 *      exists AND HUNTER_API_KEY is set: domain-search the apex, keep
 *      confidence>=50 + domain-matched addresses, insert as source=
 *      'hunter_enrich'. Runs even when the homepage fetch failed (a valid
 *      domain with a bot-blocked/timed-out homepage is exactly the
 *      domain-enrichment case). Absent key ⇒ silent no-op, crawl-only intact.
 *  11. Update venue: contact_enrichment_status + last_crawled_at.
 *
 * POST body: { venue_id: uuid }
 * Caller: service-role only (cron drainer). No user-facing UI surface.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional env: HUNTER_API_KEY (enables the domain-search fallback above).
 */

// @ts-expect-error Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyEmailTier } from '../_shared/email-tier.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { deriveContactName } from '../_shared/contact-name.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Optional enrichment fallback. When the page crawl finds 0 emails but the
// venue has a website, we ask Hunter.io's domain-search for published
// addresses on that apex. Absent key ⇒ the fallback is a silent no-op, so the
// function stays fully operational without it (crawl-only behaviour unchanged).
// @ts-expect-error Deno globals
const HUNTER_API_KEY = Deno.env.get('HUNTER_API_KEY') ?? ''
const HUNTER_MIN_CONFIDENCE = 50   // drop low-confidence guesses Hunter returns
const HUNTER_MAX_EMAILS = 4

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const CONTACT_PATHS = [
  'contact', 'contact-us', 'contact_us', 'contactus',
  'about', 'about-us', 'get-in-touch',
  'team', 'our-team', 'staff',
  'info', 'enquiries', 'find-us', 'visit', 'reservations', 'bookings',
] as const

const FALLBACK_PATHS = ['contact', 'contact-us'] as const

const MAX_CANDIDATE_PAGES = 4   // homepage + this = 5 pages total
const MAX_ACCEPTED_EMAILS = 4
const HOMEPAGE_TIMEOUT_MS = 10_000
const SUBPAGE_TIMEOUT_MS = 8_000

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const MAILTO_REGEX = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
const HREF_REGEX = /href=["']([^"']+)["']/gi

const ASSET_EXT = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'js', 'css']
const TRACKING_DOMAINS = [
  'sentry.io', 'wixpress.com', 'wordpress.com', 'sentry-cdn',
  'googleusercontent.com',
]

// ---------------------------------------------------------------------------
// URL + domain helpers
// ---------------------------------------------------------------------------

/**
 * Normalise the venue website URL before crawling.
 * - Decode percent-encoded query separators (Brunetti's GBP-tracked URL
 *   stores the `?` as %3F so the path becomes `/carlton/%3Futm_source=...`
 *   which 404s when fetched literally).
 * - Strip query string + fragment — they don't help us find contact pages
 *   and only inflate path-comparison noise.
 * Returns '' if the URL cannot be parsed at all.
 */
function normaliseWebsite(raw: string): string {
  try {
    const decoded = decodeURIComponent(raw)
    const u = new URL(decoded)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    try {
      const u = new URL(raw)
      return `${u.protocol}//${u.host}${u.pathname}`
    } catch {
      return ''
    }
  }
}

function apexDomain(url: string): string {
  try {
    const u = new URL(url)
    let host = u.hostname.toLowerCase()
    if (host.startsWith('www.')) host = host.slice(4)
    return host
  } catch {
    return ''
  }
}

function baseUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

function domainRoot(domain: string): string {
  let d = domain.toLowerCase()
  if (d.startsWith('www.')) d = d.slice(4)
  for (const suffix of [
    '.com.au', '.net.au', '.org.au',
    '.com', '.net', '.org', '.au', '.co',
  ]) {
    if (d.endsWith(suffix)) return d.slice(0, -suffix.length)
  }
  return d
}

function domainMatch(emailDomain: string, venueDomain: string): boolean {
  const er = domainRoot(emailDomain)
  const vr = domainRoot(venueDomain)
  return er.length > 0 && er === vr
}

// ---------------------------------------------------------------------------
// Email + junk filter
// ---------------------------------------------------------------------------

function isJunk(email: string): boolean {
  const e = email.toLowerCase()

  // Asset filenames mistaken for emails (e.g. icon@2x.png)
  for (const ext of ASSET_EXT) {
    if (e.endsWith('.' + ext)) return true
  }
  if (/@\d+x\./.test(e) || /-\d+x\d+@/.test(e) || /^\d+x@/.test(e)) return true
  if (e.startsWith('sentry') || e.startsWith('wp-') || e.startsWith('noreply.example')) {
    return true
  }

  const atIdx = e.indexOf('@')
  if (atIdx < 0) return true
  const domain = e.slice(atIdx + 1)
  for (const td of TRACKING_DOMAINS) {
    if (domain.includes(td)) return true
  }

  return false
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

function findLinkedPaths(html: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(HREF_REGEX)) {
    const href = m[1].toLowerCase()
    for (const p of CONTACT_PATHS) {
      if (href.includes(`/${p}`)) found.add(p)
    }
  }
  return [...found].sort()
}

function extractEmails(html: string): Set<string> {
  const out = new Set<string>()
  for (const m of html.matchAll(MAILTO_REGEX)) {
    out.add(m[1].toLowerCase())
  }
  for (const m of html.matchAll(EMAIL_REGEX)) {
    out.add(m[0].toLowerCase())
  }
  return out
}

// ---------------------------------------------------------------------------
// HTTP fetch
// ---------------------------------------------------------------------------

// Per-page memory bound. Some venue homepages ship multi-MB of inlined HTML /
// base64 images; reading the whole body with resp.text() and then running
// several global regexes over it was the cause of the edge function hitting
// HTTP 546 WORKER_RESOURCE_LIMIT (OOM), so discovery found zero new emails.
//
// We can't just read the prefix: venues commonly put their email address and
// contact links (/about, /team, /get-in-touch) in the FOOTER, at the end of the
// document. So instead of buffering the whole page we keep a bounded HEAD +
// TAIL window — the first HEAD_BYTES and the last TAIL_BYTES — and drop the
// middle. Both header/nav and footer are scanned; total memory stays bounded
// regardless of page size. For pages under the cap this returns the full page
// unchanged. A visible marker is inserted where the middle was dropped so a
// truncated <a href> can never accidentally splice into a valid-looking one.
const HEAD_BYTES = 384 * 1024
const TAIL_BYTES = 256 * 1024

async function fetchPage(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
      signal: ctrl.signal,
    })
    if (!resp.ok) return ''
    const ct = resp.headers.get('content-type') ?? ''
    if (ct && !ct.includes('text/html') && !ct.includes('application/xhtml')) return ''
    if (!resp.body) return ''

    const reader = resp.body.getReader()
    const head: Uint8Array[] = []
    let headBytes = 0
    // Fixed-size ring for the tail: a single preallocated buffer we write into
    // circularly, so tail memory is exactly TAIL_BYTES no matter the chunk
    // sizes the runtime hands us.
    const tailBuf = new Uint8Array(TAIL_BYTES)
    let tailWritten = 0 // total bytes ever routed to the tail (for wrap math)
    let truncated = false

    const pushTail = (bytes: Uint8Array) => {
      // Only the last TAIL_BYTES matter; if a single chunk is bigger than the
      // ring, keep just its final TAIL_BYTES.
      let src = bytes
      if (src.byteLength > TAIL_BYTES) src = src.subarray(src.byteLength - TAIL_BYTES)
      for (let i = 0; i < src.byteLength; i++) {
        tailBuf[(tailWritten + i) % TAIL_BYTES] = src[i]
      }
      tailWritten += src.byteLength
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value || value.byteLength === 0) continue
        let chunk = value
        // Fill the head up to exactly HEAD_BYTES, splitting the chunk if needed.
        if (headBytes < HEAD_BYTES) {
          const room = HEAD_BYTES - headBytes
          if (chunk.byteLength <= room) {
            head.push(chunk)
            headBytes += chunk.byteLength
            continue
          }
          head.push(chunk.subarray(0, room))
          headBytes = HEAD_BYTES
          chunk = chunk.subarray(room) // remainder overflows into the tail
        }
        // Anything past the head goes to the bounded tail ring.
        truncated = true
        pushTail(chunk)
      }
    } finally {
      try { await reader.cancel() } catch { /* already closed */ }
    }

    // Reassemble the tail ring in chronological order.
    let tail: Uint8Array
    if (!truncated || tailWritten === 0) {
      tail = new Uint8Array(0)
    } else if (tailWritten <= TAIL_BYTES) {
      tail = tailBuf.subarray(0, tailWritten)
    } else {
      const start = tailWritten % TAIL_BYTES
      tail = new Uint8Array(TAIL_BYTES)
      tail.set(tailBuf.subarray(start))
      tail.set(tailBuf.subarray(0, start), TAIL_BYTES - start)
    }

    const decoder = new TextDecoder()
    let html = ''
    for (const c of head) html += decoder.decode(c, { stream: true })
    html += decoder.decode() // flush head
    if (truncated && tail.byteLength > 0) {
      html += '\n<!-- crawl-venue-contacts: middle truncated -->\n'
      html += new TextDecoder().decode(tail)
    }
    return html
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Hunter.io domain-search fallback
// ---------------------------------------------------------------------------

/**
 * Ask Hunter.io for published addresses on `apex` when the page crawl found
 * nothing. Returns junk-filtered, domain-matched, confidence-gated emails
 * (deduped, lower-cased, capped). Any failure — missing key, non-200, network,
 * malformed JSON — resolves to [] so the caller degrades to "still empty"
 * rather than throwing. Never spends a call when HUNTER_API_KEY is unset.
 */
async function hunterDomainSearch(apex: string): Promise<string[]> {
  if (!HUNTER_API_KEY || !apex) return []
  const url =
    `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(apex)}` +
    `&limit=10&api_key=${encodeURIComponent(HUNTER_API_KEY)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SUBPAGE_TIMEOUT_MS)
  try {
    const resp = await fetch(url, { signal: ctrl.signal })
    if (!resp.ok) {
      console.warn(`crawl-venue-contacts: hunter HTTP ${resp.status} for ${apex}`)
      return []
    }
    const data = await resp.json() as {
      data?: { emails?: Array<{ value?: string; confidence?: number }> }
    }
    const out = new Set<string>()
    for (const e of data.data?.emails ?? []) {
      const email = (e.value ?? '').toLowerCase().trim()
      if (!email) continue
      if ((e.confidence ?? 0) < HUNTER_MIN_CONFIDENCE) continue
      if (isJunk(email)) continue
      const atIdx = email.indexOf('@')
      if (atIdx < 0) continue
      if (!domainMatch(email.slice(atIdx + 1), apex)) continue
      out.add(email)
      if (out.size >= HUNTER_MAX_EMAILS) break
    }
    return [...out]
  } catch (e) {
    console.warn(`crawl-venue-contacts: hunter fetch threw for ${apex}: ${String(e)}`)
    return []
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Crawl one venue
// ---------------------------------------------------------------------------

interface CrawlResult {
  emails: Map<string, string>  // email -> source page url
  pagesChecked: number
  homepageOk: boolean
}

async function crawlVenue(rawWebsite: string): Promise<CrawlResult> {
  const result: CrawlResult = { emails: new Map(), pagesChecked: 0, homepageOk: false }

  const website = normaliseWebsite(rawWebsite)
  if (!website) return result

  const apex = apexDomain(website)
  const base = baseUrl(website)
  if (!apex || !base) return result

  const homepage = await fetchPage(website, HOMEPAGE_TIMEOUT_MS)
  if (!homepage) return result
  result.homepageOk = true

  const consider = (html: string, src: string) => {
    result.pagesChecked++
    for (const email of extractEmails(html)) {
      if (result.emails.size >= MAX_ACCEPTED_EMAILS) return
      if (isJunk(email)) continue
      const atIdx = email.indexOf('@')
      if (atIdx < 0) continue
      const edom = email.slice(atIdx + 1)
      if (!domainMatch(edom, apex)) continue
      if (!result.emails.has(email)) result.emails.set(email, src)
    }
  }

  consider(homepage, website)

  // Build candidate-path list: linked-from-home first, then fallbacks.
  const linked = findLinkedPaths(homepage)
  const candidates: string[] = [...linked]
  for (const fb of FALLBACK_PATHS) {
    if (!candidates.includes(fb)) candidates.push(fb)
  }

  for (const path of candidates.slice(0, MAX_CANDIDATE_PAGES)) {
    if (result.emails.size >= MAX_ACCEPTED_EMAILS) break
    const pageUrl = `${base}/${path}`
    const html = await fetchPage(pageUrl, SUBPAGE_TIMEOUT_MS)
    if (html) consider(html, pageUrl)
  }

  return result
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405)

  // Gateway has verify_jwt=true; this re-checks the role claim is service_role
  // (so a leaked anon JWT cannot trigger crawls).
  const unauthorized = await requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  let body: { venue_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    return jsonResp({ error: 'invalid JSON' }, 400)
  }

  const venueId = body.venue_id
  if (!venueId || typeof venueId !== 'string') {
    return jsonResp({ error: 'venue_id required' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: venue, error: vErr } = await supabase
    .from('venues')
    .select('id, org_id, name, website')
    .eq('id', venueId)
    .single()

  if (vErr || !venue) {
    return jsonResp({ error: vErr?.message ?? 'venue not found' }, 404)
  }

  if (!venue.website) {
    await supabase
      .from('venues')
      .update({
        contact_enrichment_status: 'crawled_empty',
        last_crawled_at: new Date().toISOString(),
      })
      .eq('id', venueId)
    return jsonResp({
      venue_id: venueId,
      emails_added: 0,
      pages_checked: 0,
      status: 'crawled_empty',
    }, 200)
  }

  let crawl: CrawlResult
  try {
    crawl = await crawlVenue(venue.website)
  } catch (e) {
    console.error(`crawl-venue-contacts: crawl threw for ${venueId}: ${String(e)}`)
    await supabase
      .from('venues')
      .update({
        contact_enrichment_status: 'failed',
        last_crawled_at: new Date().toISOString(),
      })
      .eq('id', venueId)
    return jsonResp({ venue_id: venueId, emails_added: 0, pages_checked: 0, status: 'failed' }, 200)
  }

  // Assemble the accepted emails with their discovery source. The page crawl
  // wins; only when it returns nothing do we fall back to Hunter.io (and only
  // if a key is configured). Hunter rows are tagged source='hunter_enrich' so
  // the provenance stays honest in reporting and the (org,venue,email) unique
  // index still dedupes across both paths.
  //
  // NOTE: a failed homepage fetch (bot-block, timeout, non-HTML) is NOT
  // terminal — a venue with a valid website domain but an unreachable homepage
  // is exactly the domain-enrichment case, so Hunter still runs below. Only if
  // Hunter also comes back empty does a homepage failure resolve to 'failed'.
  const emailSources = new Map<string, 'website_crawl' | 'hunter_enrich'>()
  for (const email of crawl.emails.keys()) emailSources.set(email, 'website_crawl')

  let hunterUsed = false
  if (emailSources.size === 0 && HUNTER_API_KEY) {
    const apex = apexDomain(venue.website)
    const hunterEmails = await hunterDomainSearch(apex)
    hunterUsed = true
    for (const email of hunterEmails) {
      if (!emailSources.has(email)) emailSources.set(email, 'hunter_enrich')
    }
    if (hunterEmails.length > 0) {
      console.log(`crawl-venue-contacts: hunter fallback found ${hunterEmails.length} email(s) for ${venueId} (${apex})`)
    }
  }

  let emailsAdded = 0
  if (emailSources.size > 0) {
    const rows = [...emailSources.entries()].map(([email, source]) => ({
      org_id: venue.org_id,
      venue_id: venue.id,
      full_name: deriveContactName({ email, venueName: venue.name }),
      email,
      email_tier: classifyEmailTier(email),
      source,
      verification_status: 'pending',
    }))

    const { data: inserted, error: insErr } = await supabase
      .from('contacts')
      .upsert(rows, {
        onConflict: 'org_id,venue_id,email',
        ignoreDuplicates: true,
      })
      .select('id')

    if (insErr) {
      console.error(`crawl-venue-contacts: contact upsert failed for ${venueId}: ${insErr.message}`)
    } else {
      emailsAdded = inserted?.length ?? 0
    }
  }

  // We "found" emails if either path produced any candidates, even if every
  // row was already in contacts (idempotent re-runs shouldn't flip the
  // status back to crawled_empty). If nothing was found AND the homepage never
  // loaded, the run is 'failed' (unreachable site) rather than a genuine
  // 'crawled_empty' (site loaded, no emails published).
  const status = emailSources.size > 0
    ? 'crawled_found'
    : crawl.homepageOk
      ? 'crawled_empty'
      : 'failed'
  if (!crawl.homepageOk && emailSources.size === 0) {
    console.error(`crawl-venue-contacts: homepage fetch failed for ${venueId} (${venue.website}), hunter yielded nothing`)
  }

  await supabase
    .from('venues')
    .update({
      contact_enrichment_status: status,
      last_crawled_at: new Date().toISOString(),
    })
    .eq('id', venueId)

  return jsonResp({
    venue_id: venueId,
    emails_added: emailsAdded,
    emails_found: emailSources.size,
    crawl_emails: crawl.emails.size,
    hunter_used: hunterUsed,
    pages_checked: crawl.pagesChecked,
    status,
  }, 200)
})
