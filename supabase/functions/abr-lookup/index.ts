/**
 * abr-lookup — LeadFlow Sourcing Phase 2
 *
 * Free ABR (Australian Business Register) lookup for multi-site group linkage.
 *
 * POST { venue_id: uuid, abn?: string }
 *   → looks up ABN for the venue, links to existing group or creates new one
 *
 * POST { business_name: string, postcode?: string }
 *   → searches ABR by name, returns matches
 *
 * Multi-site detection:
 *   If the returned ABN already exists on another venue in the same org,
 *   set multi_site_flag=true on both and create/link a venue_groups entry.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * ABR API: free, no key required.
 *   ABN details: https://abr.business.gov.au/json/AbnDetails.aspx?abn=<ABN>&callback=callback
 *   Name search:  https://abr.business.gov.au/json/MatchingNames.aspx?name=<NAME>&maxResults=10&callback=callback
 */

// @ts-expect-error Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const ABR_BASE = 'https://abr.business.gov.au/json'
const ABR_GUID = '4c6b44e0-7c40-4a3a-9fa2-f0c9f3c3b8f1' // ABR public GUID

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// ABR types
// ---------------------------------------------------------------------------

interface AbrAbnResult {
  Abn?: string
  AbnStatus?: string
  AbnStatusEffectiveFrom?: string
  Acn?: string
  AddressDate?: string
  AddressPostcode?: string
  AddressState?: string
  BusinessName?: Array<{ OrganisationName?: string; EffectiveFrom?: string }>
  EntityName?: string
  EntityTypeCode?: string
  EntityTypeName?: string
  Gst?: string
  Message?: string
}

interface AbrNameResult {
  Name?: string
  Abn?: string
  AbnStatus?: string
  IsCurrent?: boolean
  Score?: number
  State?: string
  Postcode?: string
  TypeName?: string
  TypeCode?: string
}

interface AbnLookupResult {
  abn: string
  entity_name: string
  entity_type: string
  gst_status: string
  business_names: string[]
  state: string
  postcode: string
  abn_status: string
}

// ---------------------------------------------------------------------------
// ABR JSONP helpers
// ---------------------------------------------------------------------------

async function fetchAbrAbn(abn: string): Promise<AbnLookupResult | null> {
  // Strip spaces/dashes from ABN
  const cleanAbn = abn.replace(/\s|-/g, '')
  const url = `${ABR_BASE}/AbnDetails.aspx?abn=${cleanAbn}&guid=${ABR_GUID}&callback=callback`

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFlow/1.0)' },
    })
    if (!resp.ok) return null

    const text = await resp.text()
    const data = parseJsonp(text) as AbrAbnResult
    if (!data || data.Message) return null

    return {
      abn: data.Abn ?? cleanAbn,
      entity_name: data.EntityName ?? '',
      entity_type: data.EntityTypeName ?? data.EntityTypeCode ?? '',
      gst_status: data.Gst ?? 'Unknown',
      business_names: (data.BusinessName ?? [])
        .map((b) => b.OrganisationName ?? '')
        .filter(Boolean),
      state: data.AddressState ?? '',
      postcode: data.AddressPostcode ?? '',
      abn_status: data.AbnStatus ?? '',
    }
  } catch {
    return null
  }
}

async function searchAbrByName(
  name: string,
  postcode?: string,
): Promise<AbrNameResult[]> {
  const params = new URLSearchParams({
    name: name.trim(),
    guid: ABR_GUID,
    callback: 'callback',
    maxResults: '10',
  })
  if (postcode) params.set('postcode', postcode)

  const url = `${ABR_BASE}/MatchingNames.aspx?${params}`

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFlow/1.0)' },
    })
    if (!resp.ok) return []

    const text = await resp.text()
    const data = parseJsonp(text) as { Names?: AbrNameResult[] }
    return data?.Names ?? []
  } catch {
    return []
  }
}

/**
 * Strip the JSONP callback wrapper and parse the JSON payload.
 * ABR returns: callback({...}) or callback([...])
 */
function parseJsonp(text: string): unknown {
  const match = text.match(/^callback\(([\s\S]*)\);?\s*$/)
  if (!match) throw new Error('Not valid JSONP: ' + text.slice(0, 100))
  return JSON.parse(match[1])
}

// ---------------------------------------------------------------------------
// Multi-site linkage
// ---------------------------------------------------------------------------

async function linkMultiSite(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  venueId: string,
  abn: string,
  entityName: string,
): Promise<{ linked_venue_ids: string[]; group_id: string | null }> {
  // Find other venues in same org that share this ABN (stored in source_details->>'abn')
  const { data: siblings } = await supabase
    .from('venues')
    .select('id, name')
    .eq('org_id', orgId)
    .contains('source_details', { abn })
    .neq('id', venueId)

  const siblingIds = (siblings ?? []).map((v: { id: string }) => v.id)

  if (siblingIds.length === 0) {
    // Merge ABN into existing source_details (don't overwrite other metadata)
    const { data: existing } = await supabase
      .from('venues')
      .select('source_details')
      .eq('id', venueId)
      .single()
    const merged = { ...(existing?.source_details as Record<string, unknown> ?? {}), abn }
    await supabase
      .from('venues')
      .update({ source_details: merged, multi_site_flag: false })
      .eq('id', venueId)
    return { linked_venue_ids: [], group_id: null }
  }

  // Multi-site group detected
  // Find or create venue_groups entry
  const { data: existingGroup } = await supabase
    .from('venue_groups')
    .select('id')
    .eq('org_id', orgId)
    .eq('abn', abn)
    .maybeSingle()

  let groupId: string

  if (existingGroup) {
    groupId = existingGroup.id
  } else {
    const { data: newGroup, error: groupErr } = await supabase
      .from('venue_groups')
      .insert({
        org_id: orgId,
        name: entityName,
        abn,
      })
      .select('id')
      .single()

    if (groupErr || !newGroup) {
      return { linked_venue_ids: siblingIds, group_id: null }
    }
    groupId = newGroup.id
  }

  // Link all venues (this one + siblings) to the group, merging source_details
  const allIds = [venueId, ...siblingIds]
  for (const id of allIds) {
    const { data: existingVenue } = await supabase
      .from('venues')
      .select('source_details')
      .eq('id', id)
      .single()
    const mergedDetails = {
      ...(existingVenue?.source_details as Record<string, unknown> ?? {}),
      abn,
    }
    await supabase
      .from('venues')
      .update({
        group_id: groupId,
        multi_site_flag: true,
        source_details: mergedDetails,
      })
      .eq('id', id)
  }

  return { linked_venue_ids: siblingIds, group_id: groupId }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // Service-role only: this function writes venues/venue_groups via the
  // service-role client from caller-supplied ids, so it must never be
  // publicly callable. Requires verify_jwt=true at the gateway.
  const unauthorized = await requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let body: {
    venue_id?: string
    abn?: string
    business_name?: string
    postcode?: string
    org_id?: string
  } = {}

  try {
    body = await req.json()
  } catch {
    return jsonResp({ error: 'invalid JSON' }, 400)
  }

  // --- Path A: lookup by venue_id (with optional abn hint)
  if (body.venue_id) {
    const { data: venue, error: venueErr } = await supabase
      .from('venues')
      .select('id, org_id, name, suburb, postcode, source_details')
      .eq('id', body.venue_id)
      .single()

    if (venueErr || !venue) {
      return jsonResp({ error: venueErr?.message ?? 'venue not found' }, 404)
    }

    let abn = body.abn ?? (venue.source_details as Record<string, string> | null)?.abn

    // If no ABN provided, try searching by venue name
    if (!abn) {
      const nameResults = await searchAbrByName(
        venue.name,
        venue.postcode ?? undefined,
      )
      const match = nameResults.find((r) => r.IsCurrent)
      if (match?.Abn) abn = match.Abn
    }

    if (!abn) {
      return jsonResp({ found: false, message: 'No ABN found for this venue' }, 200)
    }

    const abnData = await fetchAbrAbn(abn)
    if (!abnData) {
      return jsonResp({ found: false, abn, message: 'ABR lookup returned no data' }, 200)
    }

    const { linked_venue_ids, group_id } = await linkMultiSite(
      supabase,
      venue.org_id,
      venue.id,
      abnData.abn,
      abnData.entity_name,
    )

    return jsonResp({
      found: true,
      abn: abnData.abn,
      entity_name: abnData.entity_name,
      entity_type: abnData.entity_type,
      gst_status: abnData.gst_status,
      business_names: abnData.business_names,
      state: abnData.state,
      postcode: abnData.postcode,
      multi_site: linked_venue_ids.length > 0,
      linked_venue_ids,
      group_id,
    }, 200)
  }

  // --- Path B: name search (no venue_id)
  if (body.business_name) {
    const results = await searchAbrByName(body.business_name, body.postcode)
    return jsonResp({ results }, 200)
  }

  return jsonResp({ error: 'provide venue_id or business_name' }, 400)
})

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
