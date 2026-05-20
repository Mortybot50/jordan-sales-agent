/**
 * vcglr-poll — LeadFlow Sourcing Phase 2
 *
 * Scrapes the VCGLR public liquor licence applications register and ingests
 * new filings as venues + signals (type=new_opening, source=vcglr).
 *
 * Weekly cron: Sunday 16:00 UTC (Monday 02:00 AEST).
 *
 * Dedup: signals.detail->>'licence_number' has a unique partial index on
 * (org_id, signal_source, licence_number) — safe to re-run without duplicates.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-expect-error Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const VCGLR_BASE = 'https://www.vcglr.vic.gov.au'
const VCGLR_PATH = '/licences/licence-applications'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LicenceFiling {
  licence_number: string
  licence_type: string
  applicant_name: string
  venue_name: string
  address: string
  suburb: string
  application_date: string
  status: string
  evidence_url: string
}

// ---------------------------------------------------------------------------
// VCGLR scrape
// ---------------------------------------------------------------------------

async function scrapeLicenceApplications(): Promise<LicenceFiling[]> {
  const url = `${VCGLR_BASE}${VCGLR_PATH}`
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LeadFlow/1.0; +https://jordan-sales-agent.vercel.app)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  })

  if (!resp.ok) {
    throw new Error(`VCGLR fetch failed: ${resp.status} ${resp.statusText}`)
  }

  const html = await resp.text()
  return parseApplicationsHtml(html, url)
}

/**
 * Parse licence applications from VCGLR HTML page.
 *
 * VCGLR renders a table with columns:
 *   Application No | Licence Type | Applicant | Venue Name | Address | Date | Status
 *
 * We parse table rows using regex since we're in a Deno environment without
 * a full DOM parser for HTML (DOMParser is XML-only in some Deno versions).
 */
function parseApplicationsHtml(html: string, pageUrl: string): LicenceFiling[] {
  const filings: LicenceFiling[] = []

  // Extract table rows from the main applications table
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) {
    console.warn('[vcglr-poll] No table found in VCGLR HTML — page structure may have changed')
    return []
  }

  const tableHtml = tableMatch[1]
  const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)

  let isFirstRow = true
  for (const rowMatch of rowMatches) {
    if (isFirstRow) {
      isFirstRow = false
      continue // skip header row
    }

    const rowHtml = rowMatch[1]
    const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => stripTags(m[1]).trim())

    if (cells.length < 6) continue

    const licence_number = cells[0] ?? ''
    const licence_type = cells[1] ?? ''
    const applicant_name = cells[2] ?? ''
    const venue_name = cells[3] ?? applicant_name
    const rawAddress = cells[4] ?? ''
    const application_date = cells[5] ?? ''
    const status = cells[6] ?? 'Unknown'

    if (!licence_number) continue

    // Extract suburb from address (last component before state/postcode)
    const suburb = extractSuburb(rawAddress)

    filings.push({
      licence_number,
      licence_type,
      applicant_name,
      venue_name: venue_name || applicant_name,
      address: rawAddress,
      suburb,
      application_date,
      status,
      evidence_url: pageUrl,
    })
  }

  return filings
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()
}

function extractSuburb(address: string): string {
  if (!address) return ''
  // "123 Main St, Carlton VIC 3053" → "Carlton"
  const match = address.match(/,?\s*([A-Z][a-zA-Z\s]+)\s+VIC\s+\d{4}/i)
  if (match) return match[1].trim()
  // Fallback: second-to-last comma-separated component
  const parts = address.split(',').map((p) => p.trim())
  if (parts.length >= 2) return parts[parts.length - 2]
  return ''
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const startedAt = new Date().toISOString()
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: orgs, error: orgsErr } = await supabase.from('orgs').select('id')
  if (orgsErr) return jsonResp({ error: orgsErr.message }, 500)

  let totalFilings = 0
  let newSignals = 0
  let newVenues = 0
  const errors: string[] = []

  try {
    const filings = await scrapeLicenceApplications()
    totalFilings = filings.length

    for (const org of orgs ?? []) {
      for (const filing of filings) {
        // Check if we already have this licence_number for this org
        const { data: existing } = await supabase
          .from('signals')
          .select('id')
          .eq('org_id', org.id)
          .eq('signal_source', 'vcglr')
          .contains('detail', { licence_number: filing.licence_number })
          .maybeSingle()

        if (existing) continue // already ingested

        // Create venue row (business_status=UNKNOWN — not on Google yet)
        const { data: venue } = await supabase
          .from('venues')
          .insert({
            org_id: org.id,
            name: filing.venue_name,
            address: filing.address,
            suburb: filing.suburb || null,
            licence_type: filing.licence_type,
            business_status: 'UNKNOWN',
            source: 'vcglr',
          })
          .select('id')
          .maybeSingle()

        if (venue) newVenues++

        // Create signal row
        const { error: sigErr } = await supabase
          .from('signals')
          .insert({
            org_id: org.id,
            venue_id: venue?.id ?? null,
            signal_type: 'new_opening',
            signal_source: 'vcglr',
            headline: `New ${filing.licence_type} licence application: ${filing.venue_name}`,
            suburb: filing.suburb || null,
            evidence_url: filing.evidence_url,
            detail: {
              licence_number: filing.licence_number,
              licence_type: filing.licence_type,
              applicant_name: filing.applicant_name,
              venue_name: filing.venue_name,
              address: filing.address,
              application_date: filing.application_date,
              status: filing.status,
            },
          })

        if (!sigErr) newSignals++
        else errors.push(`signal insert: ${sigErr.message}`)
      }
    }
  } catch (e) {
    errors.push(String(e))
  }

  const status = errors.length === 0
    ? (totalFilings > 0 ? 'success' : 'success_empty')
    : (newSignals > 0 ? 'partial' : 'failed')

  await supabase.from('worker_runs').insert({
    worker_name: 'vcglr_poll',
    status,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    items_processed: totalFilings,
    error_message: errors.length > 0 ? errors.slice(0, 10).join('; ').slice(0, 1000) : null,
    metadata: { new_signals: newSignals, new_venues: newVenues, total_filings: totalFilings },
  })

  return jsonResp({
    total_filings: totalFilings,
    new_signals: newSignals,
    new_venues: newVenues,
    errors: errors.slice(0, 10),
  }, 200)
})

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
