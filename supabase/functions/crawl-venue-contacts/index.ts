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
 *   3. Parse <a href> for paths matching common contact-page slugs (incl.
 *      hospitality pages: bookings/functions/events/private-dining/careers).
 *   4. Always include /contact + /contact-us as fallbacks.
 *   5. Fetch up to 6 additional candidate pages (7 pages total), 8s timeout.
 *   5b. Capture social profile links (FB/IG/LinkedIn/Twitter) from the
 *      homepage; when the on-site crawl found 0 emails, fetch the IG/FB bio
 *      page(s) (bounded reader, ≤2 pages) and extract any published email,
 *      dropping platform-owned/no-reply domains.
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
  // Hospitality-specific pages that commonly carry a bookings/events inbox.
  'book', 'book-now', 'function', 'functions', 'events', 'private-dining',
  'private-events', 'catering', 'group-bookings', 'venue-hire', 'hire',
  'work-with-us', 'careers', 'hello',
] as const

const FALLBACK_PATHS = ['contact', 'contact-us'] as const

const MAX_CANDIDATE_PAGES = 6   // homepage + this = 7 pages total
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

// --- Social handles -------------------------------------------------------
// Extracted from the homepage so a venue that only publishes an email in its
// Instagram/Facebook bio can still be reached. The handle regexes capture the
// first path segment; EXCLUDE sets drop the platform's own utility paths
// (share dialogs, post permalinks, login) that are not a venue's profile.
const IG_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/gi
const FB_RE = /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([A-Za-z0-9_.\-]+)/gi
const LI_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(company|in)\/([A-Za-z0-9_.\-]+)/gi
const TW_RE = /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]+)/gi

const IG_EXCLUDE = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'about', 'developer', 'directory', 'legal'])
const FB_EXCLUDE = new Set(['sharer', 'sharer.php', 'plugins', 'dialog', 'tr', 'tr.php', 'login', 'login.php', 'profile.php', 'pages', 'groups', 'events', 'watch', 'marketplace', 'gaming', 'help', 'policies'])
const TW_EXCLUDE = new Set(['intent', 'share', 'home', 'hashtag', 'search', 'i', 'settings', 'privacy', 'tos', 'login'])

// Free-mail + platform-owned domains. Emails on these are never a venue's own
// address when scraped from a social bio (they're the platform's, or generic
// no-reply), so we drop them before storing bio-sourced contacts.
const SOCIAL_OWN_DOMAINS = [
  'instagram.com', 'facebook.com', 'fb.com', 'fbcdn.net', 'meta.com',
  'cdninstagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'licdn.com',
  'sentry.io', 'example.com',
]

const MAX_SOCIAL_PAGES = 2   // IG + FB bio pages, bounded like every other fetch

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

export interface VenueSocials {
  facebook?: string
  instagram?: string
  linkedin?: string
  twitter?: string
}

/**
 * Pull the first plausible profile URL for each platform out of homepage HTML.
 * Returns canonical `https://<platform>/<handle>` URLs (www + query stripped),
 * skipping the platform's own utility paths via the EXCLUDE sets. Best-effort:
 * a platform with no match is simply omitted.
 */
function extractSocials(html: string): VenueSocials {
  const out: VenueSocials = {}

  for (const m of html.matchAll(IG_RE)) {
    const h = m[1].toLowerCase()
    if (IG_EXCLUDE.has(h)) continue
    out.instagram = `https://instagram.com/${m[1]}`
    break
  }
  for (const m of html.matchAll(FB_RE)) {
    const h = m[1].toLowerCase()
    if (FB_EXCLUDE.has(h)) continue
    out.facebook = `https://facebook.com/${m[1]}`
    break
  }
  for (const m of html.matchAll(LI_RE)) {
    out.linkedin = `https://linkedin.com/${m[1].toLowerCase()}/${m[2]}`
    break
  }
  for (const m of html.matchAll(TW_RE)) {
    const h = m[1].toLowerCase()
    if (TW_EXCLUDE.has(h)) continue
    out.twitter = `https://twitter.com/${m[1]}`
    break
  }

  return out
}

function isSocialOwnDomain(emailDomain: string): boolean {
  const d = emailDomain.toLowerCase()
  return SOCIAL_OWN_DOMAINS.some((own) => d === own || d.endsWith('.' + own))
}

// Minimal unescape for values pulled out of the embedded JSON model (\/ → /,
// @ → @, \n → space). Enough to recover an email that JSON-escaped its
// separators without pulling in a full JSON parser.
function unescapeJsonish(s: string): string {
  return s
    .replace(/\\u0040/gi, '@')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, ' ')
    .replace(/\\"/g, '"')
}

/**
 * Instagram/Facebook profile HTML is mostly NOT the profile owner: recommended
 * accounts, adverts, embedded metadata and login/support chrome all carry their
 * own email addresses. Scanning the whole document attributes those strangers'
 * emails to the venue. So restrict extraction to regions that ARE owner-owned:
 *   • the og:description meta (the human bio line both platforms render), and
 *   • the profile's own JSON fields — biography, public_email, business_email,
 *     and the generic email field pro accounts expose.
 * Only emails appearing inside those windows are treated as venue-owned.
 */
function extractSocialBioEmails(html: string): Set<string> {
  const windows: string[] = []

  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
  if (og) windows.push(og[1])

  const jsonFields = [
    /"biography":"((?:[^"\\]|\\.)*)"/gi,
    /"public_email":"((?:[^"\\]|\\.)*)"/gi,
    /"business_email":"((?:[^"\\]|\\.)*)"/gi,
    /"email":"((?:[^"\\]|\\.)*)"/gi,
  ]
  for (const re of jsonFields) {
    for (const m of html.matchAll(re)) windows.push(unescapeJsonish(m[1]))
  }

  const out = new Set<string>()
  for (const w of windows) {
    for (const e of extractEmails(w)) out.add(e)
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
    // Preallocated fixed buffers. We COPY bytes into these (never retain the
    // stream's own chunk buffers), so a single multi-MB read can't keep its
    // whole backing ArrayBuffer alive — memory is bounded at HEAD+TAIL.
    const headBuf = new Uint8Array(HEAD_BYTES)
    let headBytes = 0
    const tailBuf = new Uint8Array(TAIL_BYTES) // circular ring
    let tailWritten = 0 // total bytes ever routed to the tail (for wrap math)

    const pushTail = (src: Uint8Array) => {
      // Only the last TAIL_BYTES matter; if one chunk exceeds the ring, keep
      // just its final TAIL_BYTES.
      const from = src.byteLength > TAIL_BYTES ? src.byteLength - TAIL_BYTES : 0
      for (let i = from; i < src.byteLength; i++) {
        tailBuf[tailWritten % TAIL_BYTES] = src[i]
        tailWritten++
      }
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value || value.byteLength === 0) continue
        let chunk = value
        // Copy into the head up to exactly HEAD_BYTES, splitting if needed.
        if (headBytes < HEAD_BYTES) {
          const room = HEAD_BYTES - headBytes
          const take = Math.min(room, chunk.byteLength)
          headBuf.set(chunk.subarray(0, take), headBytes)
          headBytes += take
          if (take === chunk.byteLength) continue
          chunk = chunk.subarray(take) // remainder overflows into the tail
        }
        pushTail(chunk)
      }
    } finally {
      try { await reader.cancel() } catch { /* already closed */ }
    }

    // Truncated only if bytes actually overflowed past the head.
    const truncated = tailWritten > 0
    let tail: Uint8Array
    if (!truncated) {
      tail = new Uint8Array(0)
    } else if (tailWritten <= TAIL_BYTES) {
      tail = tailBuf.subarray(0, tailWritten)
    } else {
      const start = tailWritten % TAIL_BYTES
      tail = new Uint8Array(TAIL_BYTES)
      tail.set(tailBuf.subarray(start))
      tail.set(tailBuf.subarray(0, start), TAIL_BYTES - start)
    }
    const headView = headBuf.subarray(0, headBytes)

    if (!truncated) {
      // Whole page fit inside the head window — decode it as one contiguous
      // buffer so nothing (email, href, or UTF-8 char) is ever split.
      return new TextDecoder().decode(headView)
    }
    // Head and tail are non-contiguous slices of the document; decode each
    // independently and separate them with an HTML comment marker so a
    // boundary-straddling href/email can't splice into a false positive.
    const headHtml = new TextDecoder().decode(headView)
    const tailHtml = new TextDecoder().decode(tail)
    return `${headHtml}\n<!-- crawl-venue-contacts: middle truncated -->\n${tailHtml}`
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
  socials: VenueSocials
  socialEmailUsed: boolean
  pagesChecked: number
  homepageOk: boolean
}

async function crawlVenue(rawWebsite: string): Promise<CrawlResult> {
  const result: CrawlResult = {
    emails: new Map(),
    socials: {},
    socialEmailUsed: false,
    pagesChecked: 0,
    homepageOk: false,
  }

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

  // Capture social profile links from the homepage regardless of whether we
  // found emails — the handles are independently useful and get persisted.
  result.socials = extractSocials(homepage)

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

  // Social-bio fallback: only when the on-site crawl surfaced nothing. Many
  // small venues publish just an Instagram/Facebook bio email and no website
  // address. Fetch the profile page(s) with the same bounded reader, extract
  // emails, and drop platform-owned/no-reply domains. Domain-match is NOT
  // required here (bio emails are frequently free-mail), so these still flow
  // through ZeroBounce verification downstream like every other contact.
  if (result.emails.size === 0) {
    const socialUrls = [result.socials.instagram, result.socials.facebook]
      .filter((u): u is string => Boolean(u))
      .slice(0, MAX_SOCIAL_PAGES)
    for (const socialUrl of socialUrls) {
      if (result.emails.size >= MAX_ACCEPTED_EMAILS) break
      const html = await fetchPage(socialUrl, SUBPAGE_TIMEOUT_MS)
      if (!html) continue
      result.pagesChecked++
      // Owner-bio-scoped only — never the whole profile document, which is full
      // of unrelated (recommended-account / advert / chrome) email addresses.
      for (const email of extractSocialBioEmails(html)) {
        if (result.emails.size >= MAX_ACCEPTED_EMAILS) break
        if (isJunk(email)) continue
        const atIdx = email.indexOf('@')
        if (atIdx < 0) continue
        if (isSocialOwnDomain(email.slice(atIdx + 1))) continue
        if (!result.emails.has(email)) {
          result.emails.set(email, socialUrl)
          result.socialEmailUsed = true
        }
      }
    }
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
    .select('id, org_id, name, website, social_facebook, social_instagram, social_linkedin, social_twitter')
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

  // Only fill social columns that are currently empty — never overwrite a
  // handle that arrived from a richer source (Outscraper, manual entry).
  const venueUpdate: Record<string, unknown> = {
    contact_enrichment_status: status,
    last_crawled_at: new Date().toISOString(),
  }
  if (crawl.socials.facebook && !venue.social_facebook) venueUpdate.social_facebook = crawl.socials.facebook
  if (crawl.socials.instagram && !venue.social_instagram) venueUpdate.social_instagram = crawl.socials.instagram
  if (crawl.socials.linkedin && !venue.social_linkedin) venueUpdate.social_linkedin = crawl.socials.linkedin
  if (crawl.socials.twitter && !venue.social_twitter) venueUpdate.social_twitter = crawl.socials.twitter

  await supabase
    .from('venues')
    .update(venueUpdate)
    .eq('id', venueId)

  return jsonResp({
    venue_id: venueId,
    emails_added: emailsAdded,
    emails_found: emailSources.size,
    crawl_emails: crawl.emails.size,
    social_email_used: crawl.socialEmailUsed,
    socials_captured: Object.keys(crawl.socials).length,
    hunter_used: hunterUsed,
    pages_checked: crawl.pagesChecked,
    status,
  }, 200)
})
