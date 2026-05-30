/**
 * vcglr-sync — weekly bulk sync of Victorian liquor licences.
 *
 * Discovers the latest XLSX snapshot via the data.vic.gov.au CKAN API,
 * downloads + parses it, diffs against the previous snapshot stored in
 * `vcglr_licences`, and writes new_grant / cancellation events to
 * `vcglr_signals`. ICP-matching new_grant rows feed the existing per-org
 * `signals` table (signal_source='vcglr', signal_type='new_opening') so
 * Jordan's review queue picks them up automatically.
 *
 * Spike + GO verdict: clients/jordan/plans/VCGLR-VALIDATION-2026-05-27.md.
 *
 * Cron schedule: 0 14 * * 1 (Monday 14:00 UTC = Tuesday 00:00 AEST).
 * Idempotent — re-runs against an already-processed snapshot exit early.
 *
 * Auth: requireServiceRoleAuth (same as every other sourcing worker).
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

// @ts-expect-error Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-expect-error Deno edge runtime
import { unzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Parser-drift floor: weekly snapshots historically return ~23k rows. If the
// XLSX parser returns suspiciously few (e.g. a header rename quietly dropped
// every row), the worker should fail loudly rather than record `success` with
// near-zero coverage. Closes audit P1-CP-04. Overridable via env for ad-hoc
// reduced-scope runs.
const VCGLR_MIN_ROWS_ASSERT = Number(
  // @ts-expect-error Deno globals
  Deno.env.get('VCGLR_MIN_ROWS_ASSERT') ?? '10',
)

const CKAN_URL =
  'https://discover.data.vic.gov.au/api/3/action/package_show?id=victorian-liquor-licences-by-location'
const EVIDENCE_URL = 'https://www.vic.gov.au/victorian-liquor-licences-location'
const USER_AGENT =
  'LeadFlow/1.0 (+https://jordan-sales-agent.vercel.app)'

const UPSERT_BATCH = 500

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ---------------------------------------------------------------------------
// ICP filter — inner-Melbourne councils + hospitality-relevant licence
// categories. VCGLR strings are upper-case; match accordingly. Includes
// the legacy Moreland alias since the 2022 rename to Merri-bek may not be
// reflected uniformly across historical records.
// ---------------------------------------------------------------------------

// Actual VCGLR council values (sampled 27/05/2026 snapshot):
//   MELBOURNE CITY COUNCIL, YARRA CITY COUNCIL, STONNINGTON CITY COUNCIL,
//   PORT PHILLIP CITY COUNCIL, MORELAND CITY COUNCIL (not yet Merri-Bek
//   in the dataset), DAREBIN CITY COUNCIL, YARRA RANGES SHIRE COUNCIL.
// We also include the "CITY OF X" / "X CITY COUNCIL" / "MERRI-BEK"
// variants defensively in case VCGLR re-normalises mid-year.
const ICP_COUNCILS: ReadonlySet<string> = new Set([
  'MELBOURNE CITY COUNCIL',
  'CITY OF MELBOURNE',
  'YARRA CITY COUNCIL',
  'CITY OF YARRA',
  'STONNINGTON CITY COUNCIL',
  'CITY OF STONNINGTON',
  'PORT PHILLIP CITY COUNCIL',
  'CITY OF PORT PHILLIP',
  'MORELAND CITY COUNCIL',
  'MERRI-BEK CITY COUNCIL',
  'CITY OF MERRI-BEK',
  'DAREBIN CITY COUNCIL',
  'CITY OF DAREBIN',
  'YARRA RANGES SHIRE COUNCIL',
  'SHIRE OF YARRA RANGES',
])

// Hospitality-relevant categories. Excludes packaged-liquor-only,
// pre-retail, producer's, remote-seller's, and BYO categories per the
// spike's "hospitality-relevant ~12,839 of 23k" classification.
const HOSPITALITY_CATEGORY_KEYWORDS: readonly string[] = [
  'general licence',
  'on-premises licence',
  'on premises licence',
  'restaurant and cafe licence',
  'late night',
  'full club licence',
  'restricted club licence',
]

function isHospitalityCategory(category: string | null | undefined): boolean {
  if (!category) return false
  const lower = category.toLowerCase()
  return HOSPITALITY_CATEGORY_KEYWORDS.some((kw) => lower.includes(kw))
}

function isIcpCouncil(council: string | null | undefined): boolean {
  if (!council) return false
  return ICP_COUNCILS.has(council.trim().toUpperCase())
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LicenceRow {
  licence_number: string
  licensee: string | null
  trading_name: string | null
  category: string | null
  address: string | null
  suburb: string | null
  postcode: string | null
  lat: number | null
  lng: number | null
  council: string | null
  region: string | null
  trading_hours: string | null
}

interface CkanResource {
  url?: string
  format?: string
  last_modified?: string
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// @ts-expect-error Deno serve
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method not allowed' })
  }

  const unauthorized = await requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const startedAt = new Date()

  try {
    // 1. Discover latest XLSX via CKAN (sort by parsed snapshot date desc —
    //    last_modified is unreliable, often None across the resource list).
    const { url: xlsxUrl, snapshotDate } = await discoverLatestXlsx()

    // 2. Idempotency — already-current snapshot returns early
    const { data: existing, error: existingErr } = await supabase
      .from('vcglr_licences')
      .select('licence_number')
      .eq('snapshot_date', snapshotDate)
      .limit(1)
    if (existingErr) throw new Error(`idempotency lookup: ${existingErr.message}`)
    if ((existing?.length ?? 0) > 0) {
      const result = {
        status: 'already_current' as const,
        snapshot_date: snapshotDate,
        rows_inserted: 0,
        new_grants: 0,
        cancellations: 0,
        icp_new_grants: 0,
        duration_ms: Date.now() - startedAt.getTime(),
      }
      await logRun(supabase, 'success_empty', startedAt, 0, null, result)
      return json(200, result)
    }

    // 3. Load previous "current" set BEFORE we modify the table
    const priorSet = await loadCurrentSet(supabase)
    const priorSnapshotDate = await loadLatestPriorSnapshotDate(supabase)
    const isFirstRun = priorSet.size === 0

    // 4. Download + parse XLSX
    const newRows = await downloadAndParseXlsx(xlsxUrl)
    if (newRows.length === 0) {
      throw new Error('parser_empty_drift_likely: XLSX parsed to zero rows — header or structure changed')
    }
    // Drift guard — if the parser returned suspiciously few rows, fail loud
    // rather than ship a near-empty snapshot. Historical snapshots are ~23k
    // rows; anything under VCGLR_MIN_ROWS_ASSERT (default 10) almost
    // certainly means a header rename quietly dropped most rows.
    if (newRows.length < VCGLR_MIN_ROWS_ASSERT) {
      throw new Error(
        `parser_empty_drift_likely: parsed ${newRows.length} rows, below floor ${VCGLR_MIN_ROWS_ASSERT}`,
      )
    }

    // 5. Upsert all rows into vcglr_licences
    await upsertLicences(supabase, newRows, snapshotDate)

    // 6. Diff against prior current set
    const newSet = new Set(newRows.map((r) => r.licence_number))
    const newGrants = [...newSet].filter((l) => !priorSet.has(l))
    const cancellations = [...priorSet].filter((l) => !newSet.has(l))

    // 7. Flip disappeared licences to 'cancelled' (only those previously
    //    current; not re-flipping rows already cancelled in earlier diffs).
    if (cancellations.length > 0) {
      await markCancelled(supabase, cancellations)
    }

    // 8. Write vcglr_signals — skip on first run (everything looks "new"
    //    but is actually backfill, not a real new-grant event).
    if (!isFirstRun) {
      await writeVcglrSignals(
        supabase,
        newGrants,
        cancellations,
        priorSnapshotDate,
        snapshotDate,
      )
    }

    // 9. ICP candidate-queue plug-in — only on diff runs.
    let icpNewGrants = 0
    if (!isFirstRun && newGrants.length > 0) {
      const newGrantsSet = new Set(newGrants)
      const icpRows = newRows.filter(
        (r) =>
          newGrantsSet.has(r.licence_number) &&
          isIcpCouncil(r.council) &&
          isHospitalityCategory(r.category),
      )
      icpNewGrants = await enqueueIcpCandidates(supabase, icpRows, snapshotDate)
    }

    const result = {
      status: 'ok' as const,
      snapshot_date: snapshotDate,
      rows_inserted: newRows.length,
      new_grants: isFirstRun ? 0 : newGrants.length,
      cancellations: isFirstRun ? 0 : cancellations.length,
      icp_new_grants: icpNewGrants,
      first_run: isFirstRun,
      duration_ms: Date.now() - startedAt.getTime(),
    }
    await logRun(supabase, 'success', startedAt, newRows.length, null, result)
    return json(200, result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await logRun(supabase, 'failed', startedAt, 0, msg, null)
    return json(500, { status: 'error', error: msg })
  }
})

// ---------------------------------------------------------------------------
// CKAN discovery
// ---------------------------------------------------------------------------

async function discoverLatestXlsx(): Promise<{ url: string; snapshotDate: string }> {
  const resp = await fetch(CKAN_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  })
  if (!resp.ok) {
    throw new Error(`CKAN package_show ${resp.status} ${resp.statusText}`)
  }
  const body = await resp.json()
  const resources: CkanResource[] = body?.result?.resources ?? []
  const candidates: Array<{ url: string; snapshotDate: string }> = []
  for (const r of resources) {
    if (!r.url) continue
    if (!/\.xlsx(?:$|\?)/i.test(r.url)) continue
    const snap = parseSnapshotDate(r.url)
    if (!snap) continue
    candidates.push({ url: r.url, snapshotDate: snap })
  }
  if (candidates.length === 0) {
    throw new Error('CKAN package_show: no XLSX resources with parseable snapshot date')
  }
  // Sort by parsed date descending (ISO YYYY-MM-DD sorts lexicographically).
  candidates.sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))
  return candidates[0]
}

const MONTH_LOOKUP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
}

/**
 * Parse `YYYY-MM-DD` from filenames. Accepts variants:
 *   Current_Victorian_Licences_By_Location-30-April-2026.xlsx       (DD-Month-YYYY)
 *   Victorian-liquor-licences-geo-coded-location-31-October-2025.xlsx
 *   Current_Victorian_Licences_By_LocationMay2024.xlsx              (MonthYYYY, day=1)
 *   Current_Victorian_Licences_By_Location_July_2024.xlsx           (Month_YYYY, day=1)
 *
 * Returns null if no recognisable date pattern is present.
 */
function parseSnapshotDate(url: string): string | null {
  const filename = (url.split('/').pop() ?? '').split('?')[0]
  // 1. DD-Month-YYYY (or _ separators)
  let m = filename.match(/[-_](\d{1,2})[-_]([A-Za-z]+)[-_](\d{4})\.xlsx/i)
  if (m) return assembleDate(m[1], m[2], m[3])
  // 2. MonthYYYY or Month-YYYY or Month_YYYY (no day → use day=1)
  m = filename.match(/[-_]?([A-Za-z]+)[-_]?(\d{4})\.xlsx/i)
  if (m && MONTH_LOOKUP[m[1].toLowerCase()]) {
    return assembleDate('1', m[1], m[2])
  }
  return null
}

function assembleDate(d: string, mo: string, y: string): string | null {
  const month = MONTH_LOOKUP[mo.toLowerCase()]
  if (!month) return null
  const day = parseInt(d, 10)
  const year = parseInt(y, 10)
  if (!Number.isFinite(day) || day < 1 || day > 31) return null
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// XLSX download + parse
// ---------------------------------------------------------------------------

/**
 * Parse the XLSX by unzipping with fflate and regex-streaming the worksheet
 * XML directly. sheetjs builds an in-memory workbook representation that
 * exceeds the Edge Function 150MB compute budget on the 23k-row VCGLR
 * dataset (WORKER_RESOURCE_LIMIT @ 4.3s observed first deploy). The manual
 * path keeps peak memory under ~60MB: one Uint8Array of the .xlsx zip + one
 * decoded sheet XML string + optional sharedStrings.xml.
 */
async function downloadAndParseXlsx(url: string): Promise<LicenceRow[]> {
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!resp.ok) throw new Error(`XLSX download ${resp.status} ${resp.statusText}`)
  const buf = new Uint8Array(await resp.arrayBuffer())

  // Only extract the two files we actually need to keep peak memory low.
  // unzipSync is fully synchronous (no Web Workers — Deno Edge runtime
  // doesn't expose the Worker global, which fflate's async `unzip` requires).
  const files: Record<string, Uint8Array> = unzipSync(buf, {
    filter: (f: { name: string }) =>
      f.name === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name),
  })

  // 1. Shared strings (optional — many XLSX writers use inline strings).
  let sst: string[] = []
  const sharedBytes = files['xl/sharedStrings.xml']
  if (sharedBytes) {
    sst = parseSharedStrings(strFromU8(sharedBytes))
  }

  // 2. Find sheet1 (lowest-numbered worksheet — the bulk file ships one sheet).
  const sheetKey = Object.keys(files)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort()[0]
  if (!sheetKey) throw new Error('XLSX has no worksheets/sheet*.xml')
  const sheetXml = strFromU8(files[sheetKey])

  // 3. Stream the rows.
  const allRows: (string | null)[][] = parseSheetRows(sheetXml, sst)
  if (allRows.length === 0) throw new Error('XLSX sheet has no rows')

  // 4. Locate header row.
  let headerRowIdx = -1
  let header: string[] = []
  for (let i = 0; i < Math.min(allRows.length, 10); i++) {
    const candidate = allRows[i].map((c) => (c ?? '').trim())
    if (candidate.some((s) => /licence/i.test(s) && /(num|number)/i.test(s))) {
      headerRowIdx = i
      header = candidate
      break
    }
  }
  if (headerRowIdx < 0) {
    throw new Error('XLSX header row not found (no "Licence Number"-like column)')
  }

  const colIdx = (...labels: string[]): number => {
    for (const label of labels) {
      const i = header.findIndex((h) => h.trim().toLowerCase() === label.toLowerCase())
      if (i >= 0) return i
    }
    for (const label of labels) {
      const i = header.findIndex((h) => h.trim().toLowerCase().includes(label.toLowerCase()))
      if (i >= 0) return i
    }
    return -1
  }

  const colLic = colIdx('Licence Number', 'Licence Num')
  if (colLic < 0) throw new Error('Licence Number column missing')
  const colLicensee = colIdx('Licensee Legal Name', 'Licensee Name', 'Licensee')
  const colTrading = colIdx('Trading Name', 'Trading As')
  const colCategory = colIdx('Category')
  const colAddr = colIdx('Address Line 1', 'Trading Address', 'Address')
  const colSuburb = colIdx('Suburb', 'Locality')
  const colPostcode = colIdx('Postcode')
  const colLat = colIdx('Latitude', 'Lat')
  const colLng = colIdx('Longitude', 'Long', 'Lng')
  const colCouncil = colIdx('Council', 'Local Government Area', 'LGA')
  const colRegion = colIdx('Region')
  const colHours = colIdx('Trading Hours', 'Hours')

  const out: LicenceRow[] = []
  const seen = new Set<string>()
  for (let i = headerRowIdx + 1; i < allRows.length; i++) {
    const r = allRows[i]
    const lic = (r[colLic] ?? '').trim()
    if (!lic) continue
    if (seen.has(lic)) continue // bulk file occasionally repeats — keep first
    seen.add(lic)
    out.push({
      licence_number: lic,
      licensee: cellStr(r, colLicensee),
      trading_name: cellStr(r, colTrading),
      category: cellStr(r, colCategory),
      address: cellStr(r, colAddr),
      suburb: cellStr(r, colSuburb),
      postcode: cellStr(r, colPostcode),
      lat: cellNum(r, colLat),
      lng: cellNum(r, colLng),
      council: cellStr(r, colCouncil),
      region: cellStr(r, colRegion),
      trading_hours: cellStr(r, colHours),
    })
  }
  return out
}

function cellStr(r: (string | null)[], i: number): string | null {
  if (i < 0 || i >= r.length) return null
  const v = r[i]
  if (v == null) return null
  const trimmed = v.trim()
  return trimmed.length === 0 ? null : trimmed
}

function cellNum(r: (string | null)[], i: number): number | null {
  if (i < 0 || i >= r.length) return null
  const v = r[i]
  if (v == null || v === '') return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// XLSX XML helpers — minimal SAX-style regex parsing. NOT a general XLSX
// parser; only handles the cell types VCGLR emits (s/inlineStr/str/n).
// ---------------------------------------------------------------------------

function colLetterToIndex(letter: string): number {
  let n = 0
  for (let i = 0; i < letter.length; i++) {
    n = n * 26 + (letter.charCodeAt(i) - 64)
  }
  return n - 1
}

function xmlDecode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&')
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml)) !== null) {
    // Strings can be split into rich-text runs (<r><t>…</t></r>) — concat all <t>.
    const parts: string[] = []
    let tm: RegExpExecArray | null
    while ((tm = tRe.exec(m[1])) !== null) parts.push(xmlDecode(tm[1]))
    out.push(parts.join(''))
  }
  return out
}

/**
 * Parse worksheet rows into a 2D array of stringified cell values (null if
 * empty). Sparse cells are filled with null up to the max column seen.
 */
function parseSheetRows(xml: string, sst: string[]): (string | null)[][] {
  const out: (string | null)[][] = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowInner = rm[1]
    const row: (string | null)[] = []
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(rowInner)) !== null) {
      const attrs = cm[1]
      const inner = cm[2] ?? ''
      const refMatch = /\br="([A-Z]+)\d+"/.exec(attrs)
      if (!refMatch) continue
      const col = colLetterToIndex(refMatch[1])
      const tMatch = /\bt="([^"]+)"/.exec(attrs)
      const type = tMatch ? tMatch[1] : 'n'

      let val: string | null = null
      if (type === 's') {
        const vMatch = /<v>([^<]*)<\/v>/.exec(inner)
        const idx = vMatch ? parseInt(vMatch[1], 10) : NaN
        val = Number.isFinite(idx) && idx >= 0 && idx < sst.length ? sst[idx] : null
      } else if (type === 'inlineStr') {
        const parts: string[] = []
        const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
        let tm: RegExpExecArray | null
        while ((tm = tRe.exec(inner)) !== null) parts.push(xmlDecode(tm[1]))
        val = parts.length > 0 ? parts.join('') : null
      } else if (type === 'str') {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner)
        val = vMatch ? xmlDecode(vMatch[1]) : null
      } else if (type === 'b') {
        const vMatch = /<v>([^<]*)<\/v>/.exec(inner)
        val = vMatch ? (vMatch[1] === '1' ? 'TRUE' : 'FALSE') : null
      } else {
        // Numeric/date — leave as string, cellNum() will parseFloat later.
        const vMatch = /<v>([^<]*)<\/v>/.exec(inner)
        val = vMatch ? vMatch[1] : null
      }

      while (row.length <= col) row.push(null)
      row[col] = val
    }
    out.push(row)
  }
  return out
}

// ---------------------------------------------------------------------------
// DB writes
// ---------------------------------------------------------------------------

async function loadCurrentSet(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<Set<string>> {
  const set = new Set<string>()
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('vcglr_licences')
      .select('licence_number')
      .eq('status', 'current')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`load current set: ${error.message}`)
    if (!data || data.length === 0) break
    for (const row of data) set.add(row.licence_number)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return set
}

async function loadLatestPriorSnapshotDate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('vcglr_licences')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data?.snapshot_date ?? null
}

async function upsertLicences(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rows: LicenceRow[],
  snapshotDate: string,
): Promise<void> {
  const nowIso = new Date().toISOString()
  const payload = rows.map((r) => ({
    ...r,
    status: 'current',
    last_seen_at: nowIso,
    snapshot_date: snapshotDate,
  }))
  for (let i = 0; i < payload.length; i += UPSERT_BATCH) {
    const batch = payload.slice(i, i + UPSERT_BATCH)
    const { error } = await supabase
      .from('vcglr_licences')
      .upsert(batch, { onConflict: 'licence_number' })
    if (error) throw new Error(`vcglr_licences upsert @${i}: ${error.message}`)
  }
}

async function markCancelled(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  licences: string[],
): Promise<void> {
  for (let i = 0; i < licences.length; i += UPSERT_BATCH) {
    const batch = licences.slice(i, i + UPSERT_BATCH)
    const { error } = await supabase
      .from('vcglr_licences')
      .update({ status: 'cancelled' })
      .in('licence_number', batch)
      .eq('status', 'current')
    if (error) throw new Error(`mark cancelled @${i}: ${error.message}`)
  }
}

async function writeVcglrSignals(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  newGrants: string[],
  cancellations: string[],
  priorSnapshotDate: string | null,
  snapshotDateAfter: string,
): Promise<void> {
  const events: Array<{
    licence_number: string
    event_type: 'new_grant' | 'cancellation'
    snapshot_date_before: string | null
    snapshot_date_after: string
    payload: Record<string, unknown>
  }> = []
  for (const lic of newGrants) {
    events.push({
      licence_number: lic,
      event_type: 'new_grant',
      snapshot_date_before: priorSnapshotDate,
      snapshot_date_after: snapshotDateAfter,
      payload: {},
    })
  }
  for (const lic of cancellations) {
    events.push({
      licence_number: lic,
      event_type: 'cancellation',
      snapshot_date_before: priorSnapshotDate,
      snapshot_date_after: snapshotDateAfter,
      payload: {},
    })
  }
  for (let i = 0; i < events.length; i += UPSERT_BATCH) {
    const batch = events.slice(i, i + UPSERT_BATCH)
    const { error } = await supabase
      .from('vcglr_signals')
      .upsert(batch, {
        onConflict: 'licence_number,event_type,snapshot_date_after',
        ignoreDuplicates: true,
      })
    if (error) throw new Error(`vcglr_signals upsert @${i}: ${error.message}`)
  }
}

/**
 * For each ICP-matching new_grant, write to the existing per-org `signals`
 * table (and create a venue row to link). The unique partial index on
 * (org_id, signal_source, (detail->>'licence_number')) prevents duplicates
 * across re-runs and across orgs.
 *
 * Returns the count of newly-inserted per-org signals (across all orgs).
 */
async function enqueueIcpCandidates(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  icpRows: LicenceRow[],
  snapshotDate: string,
): Promise<number> {
  if (icpRows.length === 0) return 0

  const { data: orgs, error: orgsErr } = await supabase.from('orgs').select('id')
  if (orgsErr) throw new Error(`load orgs: ${orgsErr.message}`)
  if (!orgs || orgs.length === 0) return 0

  let inserted = 0
  for (const org of orgs) {
    for (const row of icpRows) {
      // Skip if we already have a signal for this licence on this org
      // (covers re-runs where the licence was inserted on a prior pass).
      const { data: existingSig } = await supabase
        .from('signals')
        .select('id')
        .eq('org_id', org.id)
        .eq('signal_source', 'vcglr')
        .filter('detail->>licence_number', 'eq', row.licence_number)
        .maybeSingle()
      if (existingSig) continue

      const venueName =
        (row.trading_name && row.trading_name.trim()) ||
        row.licensee ||
        'Unknown'

      const { data: venue, error: venueErr } = await supabase
        .from('venues')
        .insert({
          org_id: org.id,
          name: venueName,
          address: row.address,
          suburb: row.suburb,
          postcode: row.postcode,
          lat: row.lat,
          lng: row.lng,
          licence_type: row.category,
          business_status: 'UNKNOWN',
          source: 'vcglr',
        })
        .select('id')
        .maybeSingle()
      if (venueErr) {
        // Non-fatal — still try to write the signal without venue link.
        console.warn('[vcglr-sync] venue insert failed:', venueErr.message)
      }

      const { error: sigErr } = await supabase.from('signals').insert({
        org_id: org.id,
        venue_id: venue?.id ?? null,
        signal_type: 'new_opening',
        signal_source: 'vcglr',
        headline: `New ${row.category ?? 'liquor'} licence: ${venueName}`,
        suburb: row.suburb,
        evidence_url: EVIDENCE_URL,
        detail: {
          licence_number: row.licence_number,
          licence_type: row.category,
          licensee: row.licensee,
          trading_name: row.trading_name,
          address: row.address,
          suburb: row.suburb,
          postcode: row.postcode,
          council: row.council,
          region: row.region,
          trading_hours: row.trading_hours,
          snapshot_date: snapshotDate,
        },
      })
      if (sigErr) {
        // 23505 = unique violation against the vcglr dedup partial index;
        // that means a parallel run got there first. Safe to ignore.
        // deno-lint-ignore no-explicit-any
        const code = (sigErr as any).code
        if (code !== '23505') {
          throw new Error(`signals insert (${row.licence_number}): ${sigErr.message}`)
        }
        continue
      }
      inserted++
    }
  }
  return inserted
}

async function logRun(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  status: 'success' | 'success_empty' | 'failed' | 'partial',
  startedAt: Date,
  itemsProcessed: number,
  errorMessage: string | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  try {
    await supabase.from('worker_runs').insert({
      worker_name: 'vcglr_sync',
      status,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      items_processed: itemsProcessed,
      error_message: errorMessage ? errorMessage.slice(0, 1000) : null,
      metadata: metadata ?? {},
    })
  } catch (e) {
    // Never let logging failure shadow the real error.
    console.warn('[vcglr-sync] worker_runs log failed:', e)
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
