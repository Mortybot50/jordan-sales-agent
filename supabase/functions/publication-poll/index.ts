/**
 * publication-poll — LeadFlow Sourcing Phase 2
 *
 * Monitors 7 Melbourne hospitality publications + Google News RSS for new
 * venue openings, expansions, acquisitions and key hires.
 *
 * Sources + cadences (set by cron, not this function):
 *   - broadsheet, concrete_playground, hospitality_mag  → every 4h
 *   - timeout, urban_list, general_news                 → daily
 *   - good_food                                         → weekly
 *
 * Flow per article:
 *   1. Fetch RSS / sitemap / scrape page
 *   2. Claude classifier → venue_name + suburb + signal_type + confidence
 *   3. If confidence ≥ 0.6: fuzzy match against venues table
 *   4. Create/update signals row
 *
 * POST { source?: SourceKey }          — single source
 * POST { sources?: SourceKey[] }       — multiple sources
 * POST {}                              — all sources
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY
 */

// @ts-expect-error Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

const MODEL = 'claude-sonnet-4-6'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type SourceKey =
  | 'broadsheet'
  | 'timeout'
  | 'concrete_playground'
  | 'good_food'
  | 'urban_list'
  | 'hospitality_mag'
  | 'general_news'

type SignalType = 'new_opening' | 'expansion' | 'refurb' | 'acquisition' | 'key_hire'

interface Article {
  title: string
  summary: string
  url: string
  published_at: string | null
  source: SourceKey
}

interface ClassifierResult {
  venue_name: string | null
  suburb: string | null
  signal_type: SignalType | 'other'
  confidence: number
}

// ---------------------------------------------------------------------------
// RSS fetcher + parser
// ---------------------------------------------------------------------------

async function fetchRss(url: string, source: SourceKey): Promise<Article[]> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LeadFlow/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  })
  if (!resp.ok) throw new Error(`RSS fetch failed for ${source}: ${resp.status}`)
  const xml = await resp.text()
  return parseRssXml(xml, source)
}

function parseRssXml(xml: string, source: SourceKey): Article[] {
  const articles: Article[] = []
  const items = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)

  for (const item of items) {
    const content = item[1]
    const title = extractXmlTag(content, 'title')
    const link = extractXmlTag(content, 'link') ??
      extractXmlAttr(content, 'guid', 'isPermaLink') ??
      extractXmlTag(content, 'guid')
    const description = extractXmlTag(content, 'description') ??
      extractXmlTag(content, 'content:encoded') ?? ''
    const pubDate = extractXmlTag(content, 'pubDate')

    if (!title || !link) continue

    const published_at = pubDate ? parsePubDate(pubDate) : null

    // Only consider items from last 7 days
    if (published_at) {
      const age = Date.now() - new Date(published_at).getTime()
      if (age > 7 * 24 * 60 * 60 * 1000) continue
    }

    articles.push({
      title: stripHtml(title),
      summary: stripHtml(description).slice(0, 500),
      url: link.trim(),
      published_at,
      source,
    })
  }

  return articles
}

function extractXmlTag(xml: string, tag: string): string | null {
  // Handle CDATA
  const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
  if (cdataMatch) return cdataMatch[1].trim()
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? match[1].trim() : null
}

function extractXmlAttr(xml: string, tag: string, _attr: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? match[1].trim() : null
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePubDate(dateStr: string): string | null {
  try {
    return new Date(dateStr).toISOString()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Source configs
// ---------------------------------------------------------------------------

async function fetchArticles(source: SourceKey): Promise<Article[]> {
  switch (source) {
    case 'broadsheet':
      return fetchBroadsheetSitemap(source)

    case 'concrete_playground':
      return fetchRss('https://concreteplayground.com/melbourne/eat-drink/feed', source)

    case 'hospitality_mag':
      return fetchRss('https://www.hospitalitymagazine.com.au/feed', source)

    case 'urban_list':
      return [
        ...await fetchRss('https://www.theurbanlist.com/melbourne/feed', source),
        ...await scrapeUrbanListNewOpenings(source),
      ]

    case 'timeout':
      return scrapeTimeoutMelbourne(source)

    case 'good_food':
      return scrapeGoodFood(source)

    case 'general_news':
      return fetchRss(
        'https://news.google.com/rss/search?q=(restaurant+OR+cafe+OR+bar+OR+hotel)+(opening+OR+launch+OR+appointed+OR+acquired)+Melbourne&hl=en-AU&gl=AU&ceid=AU:en',
        source,
      )

    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Broadsheet sitemap fetcher (replaces dead RSS feeds — 24/05/2026)
// ---------------------------------------------------------------------------
//
// Broadsheet killed site-wide RSS in May 2026. Their public XML sitemap
// (https://www.broadsheet.com.au/sitemap/melbourne/articles) lists every
// article URL with an ISO <lastmod>, sorted newest-first. We filter the
// food-and-drink cohort, restrict to the last 14 days, cap at 30 entries,
// then fetch each article in parallel (max 10 concurrent) to pull title +
// body text for the classifier.

const BROADSHEET_SITEMAP_URL = 'https://www.broadsheet.com.au/sitemap/melbourne/articles'
const BROADSHEET_ARTICLE_PATH_PREFIX = '/melbourne/food-and-drink/article/'
const BROADSHEET_MAX_ARTICLES = 30
const BROADSHEET_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const BROADSHEET_SITEMAP_TIMEOUT_MS = 10_000
const BROADSHEET_ARTICLE_TIMEOUT_MS = 8_000
const BROADSHEET_CONCURRENCY = 10

async function fetchWithTimeout(url: string, timeoutMs: number, headers: HeadersInit): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { headers, signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchBroadsheetSitemap(source: SourceKey): Promise<Article[]> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; LeadFlow/1.0; +https://leadflow.ai)',
    'Accept': 'application/xml, text/xml, */*',
  }

  const resp = await fetchWithTimeout(BROADSHEET_SITEMAP_URL, BROADSHEET_SITEMAP_TIMEOUT_MS, headers)
  if (!resp || !resp.ok) {
    console.warn(`[broadsheet] sitemap fetch failed: ${resp?.status ?? 'no-response'}`)
    return []
  }

  const xml = await resp.text()
  const cutoff = Date.now() - BROADSHEET_MAX_AGE_MS

  // Collect candidate URL/lastmod pairs
  type Candidate = { url: string; lastmod: string; lastmodMs: number }
  const candidates: Candidate[] = []

  const urlBlocks = xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)
  for (const block of urlBlocks) {
    const content = block[1]
    const loc = extractXmlTag(content, 'loc')
    const lastmod = extractXmlTag(content, 'lastmod')
    if (!loc || !lastmod) continue
    if (!loc.includes(BROADSHEET_ARTICLE_PATH_PREFIX)) continue

    const lastmodMs = new Date(lastmod).getTime()
    if (isNaN(lastmodMs) || lastmodMs < cutoff) continue

    candidates.push({ url: loc, lastmod, lastmodMs })
  }

  // Sort newest-first and cap
  candidates.sort((a, b) => b.lastmodMs - a.lastmodMs)
  const selected = candidates.slice(0, BROADSHEET_MAX_ARTICLES)

  // Bounded-concurrency parallel fetch
  const articles: Article[] = []
  for (let i = 0; i < selected.length; i += BROADSHEET_CONCURRENCY) {
    const batch = selected.slice(i, i + BROADSHEET_CONCURRENCY)
    const results = await Promise.all(batch.map((c) => fetchBroadsheetArticle(c.url, c.lastmod, source, headers)))
    for (const r of results) {
      if (r) articles.push(r)
    }
  }

  return articles
}

async function fetchBroadsheetArticle(
  url: string,
  lastmod: string,
  source: SourceKey,
  headers: HeadersInit,
): Promise<Article | null> {
  const resp = await fetchWithTimeout(url, BROADSHEET_ARTICLE_TIMEOUT_MS, headers)
  if (!resp || !resp.ok) {
    console.warn(`[broadsheet] article fetch failed: ${url} (${resp?.status ?? 'no-response'})`)
    return null
  }

  const html = await resp.text()
  const title = extractBroadsheetTitle(html)
  if (!title) return null

  const summary = extractBroadsheetBody(html)
  const published_at = parsePubDate(lastmod)

  return { title, summary, url, published_at, source }
}

function extractBroadsheetTitle(html: string): string | null {
  // Prefer og:title, fall back to <title>. Broadsheet's og:title is the
  // headline without the " | Broadsheet" suffix.
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (og) return stripHtml(og[1]).trim() || null

  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!t) return null
  const raw = stripHtml(t[1]).trim()
  // Drop trailing " | Broadsheet" if present
  return raw.replace(/\s*\|\s*Broadsheet\s*$/i, '').trim() || null
}

function extractBroadsheetBody(html: string): string {
  let cleaned = html
  for (const tag of ['script', 'style', 'nav', 'header', 'footer']) {
    cleaned = cleaned.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  }
  const text = stripHtml(cleaned)
  return text.slice(0, 1500)
}

async function scrapeUrbanListNewOpenings(source: SourceKey): Promise<Article[]> {
  try {
    const resp = await fetch('https://www.theurbanlist.com/melbourne/food-drink/whats-new', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFlow/1.0)' },
    })
    if (!resp.ok) return []
    const html = await resp.text()

    // Extract article cards — look for anchor + heading patterns
    const articles: Article[] = []
    const linkMatches = html.matchAll(/<a[^>]+href="(https?:\/\/[^"]*theurbanlist[^"]*)"[^>]*>[\s\S]*?<h[123][^>]*>([\s\S]*?)<\/h[123]>/gi)
    for (const m of linkMatches) {
      const url = m[1]
      const title = stripHtml(m[2])
      if (!title || title.length < 10) continue
      articles.push({ title, summary: '', url, published_at: null, source })
      if (articles.length >= 20) break
    }
    return articles
  } catch {
    return []
  }
}

async function scrapeTimeoutMelbourne(source: SourceKey): Promise<Article[]> {
  try {
    const sitemapResp = await fetch('https://www.timeout.com/melbourne/sitemap.xml', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFlow/1.0)' },
    })
    if (!sitemapResp.ok) return []
    const sitemap = await sitemapResp.text()

    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    const articles: Article[] = []

    const urlBlocks = sitemap.matchAll(/<url>([\s\S]*?)<\/url>/gi)
    for (const block of urlBlocks) {
      const content = block[1]
      const loc = extractXmlTag(content, 'loc') ?? ''
      const lastmod = extractXmlTag(content, 'lastmod') ?? ''

      if (!loc.includes('/news') && !loc.includes('/restaurants') && !loc.includes('/bars')) continue

      if (lastmod) {
        const modTime = new Date(lastmod).getTime()
        if (isNaN(modTime) || modTime < cutoff) continue
      }

      articles.push({ title: loc.split('/').pop() ?? '', summary: '', url: loc, published_at: lastmod || null, source })
      if (articles.length >= 30) break
    }
    return articles
  } catch {
    return []
  }
}

async function scrapeGoodFood(source: SourceKey): Promise<Article[]> {
  try {
    const resp = await fetch('https://www.goodfood.com.au/melbourne', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFlow/1.0)' },
    })
    if (!resp.ok) return []
    const html = await resp.text()

    const articles: Article[] = []
    const cardMatches = html.matchAll(/<a[^>]+href="(\/[^"]*)"[^>]*>[\s\S]*?<h[123][^>]*>([\s\S]*?)<\/h[123]>/gi)
    for (const m of cardMatches) {
      const url = `https://www.goodfood.com.au${m[1]}`
      const title = stripHtml(m[2])
      if (!title || title.length < 10) continue
      articles.push({ title, summary: '', url, published_at: null, source })
      if (articles.length >= 20) break
    }
    return articles
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Claude classifier
// ---------------------------------------------------------------------------

async function classifyArticle(article: Article): Promise<ClassifierResult | null> {
  const prompt = `You are a hospitality industry news classifier for Melbourne, Australia.

Given an article title and summary, extract:
- venue_name: the name of the venue/restaurant/bar/hotel mentioned (null if not about a specific venue)
- suburb: Melbourne suburb if mentioned (null if not found)
- signal_type: one of "new_opening", "expansion", "refurb", "acquisition", "key_hire", "other"
- confidence: 0.0 to 1.0 (how confident are you this is about a Melbourne hospitality venue signal?)

Return ONLY valid JSON, no other text:
{"venue_name": "...", "suburb": "...", "signal_type": "...", "confidence": 0.0}

Article title: ${article.title}
Article summary: ${article.summary}`

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) return null
    const data = await resp.json() as { content?: Array<{ text: string }> }
    const text = data.content?.[0]?.text ?? ''

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as ClassifierResult
    return parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Levenshtein distance (for fuzzy venue name matching)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function fuzzyMatchVenueName(target: string, candidate: string): boolean {
  const t = target.toLowerCase().trim()
  const c = candidate.toLowerCase().trim()
  if (t === c) return true
  if (Math.abs(t.length - c.length) > 5) return false
  return levenshtein(t, c) <= 3
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const unauthorized = await requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let body: { source?: SourceKey; sources?: SourceKey[] } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    // ignore
  }

  const allSources: SourceKey[] = [
    'broadsheet', 'timeout', 'concrete_playground',
    'good_food', 'urban_list', 'hospitality_mag', 'general_news',
  ]

  let sources: SourceKey[]
  if (body.source) {
    sources = [body.source]
  } else if (body.sources && body.sources.length > 0) {
    sources = body.sources
  } else {
    sources = allSources
  }

  const { data: orgs } = await supabase.from('orgs').select('id')
  const summary: Record<string, { articles: number; signals_created: number; errors: string[] }> = {}

  for (const source of sources) {
    summary[source] = { articles: 0, signals_created: 0, errors: [] }

    let articles: Article[] = []
    try {
      articles = await fetchArticles(source)
      summary[source].articles = articles.length
    } catch (e) {
      summary[source].errors.push(`fetch: ${String(e)}`)
      continue
    }

    for (const article of articles) {
      const classification = await classifyArticle(article)
      if (!classification || classification.confidence < 0.6) continue
      if (!classification.venue_name || classification.signal_type === 'other') continue

      for (const org of orgs ?? []) {
        // Check for duplicate signal by URL
        const { data: dupCheck } = await supabase
          .from('signals')
          .select('id')
          .eq('org_id', org.id)
          .contains('detail', { url: article.url })
          .maybeSingle()

        if (dupCheck) continue

        // Fuzzy match against existing venues
        let matchedVenueId: string | null = null

        if (classification.venue_name) {
          const { data: candidates } = await supabase
            .from('venues')
            .select('id, name, suburb')
            .eq('org_id', org.id)
            .ilike('name', `%${classification.venue_name.slice(0, 10)}%`)
            .limit(10)

          for (const candidate of candidates ?? []) {
            const nameMatch = fuzzyMatchVenueName(classification.venue_name, candidate.name)
            const suburbMatch = !classification.suburb ||
              !candidate.suburb ||
              candidate.suburb.toLowerCase() === classification.suburb.toLowerCase()

            if (nameMatch && suburbMatch) {
              matchedVenueId = candidate.id
              break
            }
          }
        }

        // If no match, create a new venue stub
        if (!matchedVenueId && classification.venue_name) {
          const { data: newVenue } = await supabase
            .from('venues')
            .insert({
              org_id: org.id,
              name: classification.venue_name,
              suburb: classification.suburb ?? null,
              business_status: 'UNKNOWN',
              source,
            })
            .select('id')
            .maybeSingle()

          matchedVenueId = newVenue?.id ?? null
        }

        // Create signal
        const { error: sigErr } = await supabase
          .from('signals')
          .insert({
            org_id: org.id,
            venue_id: matchedVenueId,
            signal_type: classification.signal_type as SignalType,
            signal_source: source,
            headline: article.title,
            suburb: classification.suburb ?? null,
            evidence_url: article.url,
            detail: {
              url: article.url,
              published_at: article.published_at,
              confidence: classification.confidence,
              venue_name_extracted: classification.venue_name,
            },
          })

        if (!sigErr) {
          summary[source].signals_created++
        } else {
          summary[source].errors.push(sigErr.message)
        }
      }
    }
  }

  return jsonResp({ summary }, 200)
})

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
