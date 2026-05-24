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
 *  11. Update venue: contact_enrichment_status + last_crawled_at.
 *
 * POST body: { venue_id: uuid }
 * Caller: service-role only (cron drainer). No user-facing UI surface.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

// @ts-expect-error Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyEmailTier } from '../_shared/email-tier.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const MAILTO_REGEX = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi
const HREF_REGEX = /href=["']([^"']+)["']/gi

const ASSET_EXT = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'js', 'css']
const TRACKING_DOMAINS = [
  'sentry.io', 'wixpress.com', 'wordpress.com', 'sentry-cdn',
  'googleusercontent.com',
]

// ---------------------------------------------------------------------------
// URL + domain helpers
// ---------------------------------------------------------------------------

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
    return await resp.text()
  } catch {
    return ''
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

async function crawlVenue(website: string): Promise<CrawlResult> {
  const result: CrawlResult = { emails: new Map(), pagesChecked: 0, homepageOk: false }

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

/**
 * Guard: require a service-role bearer token. Cron drainer + internal
 * fire-and-forget callers pass it; nothing else should reach this function.
 */
function assertServiceRole(req: Request): boolean {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  const token = auth.slice('Bearer '.length).trim()
  return token === SUPABASE_SERVICE_ROLE_KEY && token.length > 0
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405)

  if (!assertServiceRole(req)) return jsonResp({ error: 'unauthorized' }, 401)

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
    .select('id, org_id, website')
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

  if (!crawl.homepageOk) {
    console.error(`crawl-venue-contacts: homepage fetch failed for ${venueId} (${venue.website})`)
    await supabase
      .from('venues')
      .update({
        contact_enrichment_status: 'failed',
        last_crawled_at: new Date().toISOString(),
      })
      .eq('id', venueId)
    return jsonResp({ venue_id: venueId, emails_added: 0, pages_checked: 0, status: 'failed' }, 200)
  }

  let emailsAdded = 0
  if (crawl.emails.size > 0) {
    const rows = [...crawl.emails.keys()].map((email) => ({
      org_id: venue.org_id,
      venue_id: venue.id,
      full_name: email.split('@')[0],
      email,
      email_tier: classifyEmailTier(email),
      source: 'website_crawl',
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

  // We "found" emails if the crawler produced any candidates, even if every
  // row was already in contacts (idempotent re-runs shouldn't flip the
  // status back to crawled_empty).
  const status = crawl.emails.size > 0 ? 'crawled_found' : 'crawled_empty'

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
    emails_found: crawl.emails.size,
    pages_checked: crawl.pagesChecked,
    status,
  }, 200)
})
