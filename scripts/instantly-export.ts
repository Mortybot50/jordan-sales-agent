#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read --allow-write
/**
 * instantly-export.ts
 *
 * One-off Instantly → LeadFlow native sender migration script.
 *
 * EXPORTS three artefacts from Instantly's REST API:
 *   1. Full suppression list (unsubscribes + bounces + spam complaints)
 *   2. Sequence states (which contact is on which step of which sequence)
 *   3. Contact statuses (active/unsubscribed/bounced/replied)
 *
 * Then BULK-INSERTS the suppression list into LeadFlow's `suppression_list`
 * table, mapping Instantly reasons to LeadFlow reason codes. The +alias
 * normalisation trigger (migration 20260511103200) handles dedup automatically.
 *
 * Sequence states + contact statuses are exported to JSON for manual review —
 * Jordan decides whether to re-enrol any in-flight Instantly sequences into
 * LeadFlow's own sequence engine (most ship Day 4-7 per the cutover runbook).
 *
 * SAFETY:
 *   - Defaults to DRY-RUN. Prints expected counts, writes JSON to /tmp, does
 *     NOT touch the live suppression_list table.
 *   - Bulk insert only runs with --confirm flag.
 *   - Audit log written to {export_dir}/migration.log AND
 *     {export_dir}/migration.json — review before / after to verify.
 *
 * USAGE:
 *   # dry-run (default — safe, prints counts only)
 *   VITE_INSTANTLY_API_KEY=... \
 *   SUPABASE_URL=https://bsevgxhnxlkzkcalevbb.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   ORG_ID=<jordan-org-uuid> \
 *   deno run --allow-env --allow-net --allow-read --allow-write \
 *     scripts/instantly-export.ts
 *
 *   # live import (requires explicit confirmation)
 *   ... same env vars ... scripts/instantly-export.ts --confirm
 *
 * Out-of-scope (deferred to Jordan's manual review):
 *   - Sequence template porting (Instantly's per-step delays + variants ≠
 *     LeadFlow's sequence engine 1-to-1; mapping is a judgement call)
 *   - Open / click event history (LeadFlow starts the stats clock fresh on
 *     cutover; old Instantly stats stay readable in Instantly UI until
 *     Jordan cancels the subscription)
 */

const INSTANTLY_API_KEY = Deno.env.get('VITE_INSTANTLY_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ORG_ID = Deno.env.get('ORG_ID')

const CONFIRM = Deno.args.includes('--confirm')
const DRY_RUN = !CONFIRM

if (!INSTANTLY_API_KEY) {
  console.error('Error: VITE_INSTANTLY_API_KEY must be set')
  Deno.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  Deno.exit(1)
}
if (!ORG_ID) {
  console.error('Error: ORG_ID must be set (Jordan\'s org uuid)')
  Deno.exit(1)
}

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2'
const PAGE_LIMIT = 100

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const exportDir = `/tmp/instantly-export-${timestamp}`
await Deno.mkdir(exportDir, { recursive: true })

console.log(`instantly-export: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} mode`)
console.log(`export dir: ${exportDir}`)
console.log('')

type InstantlyContact = {
  id: string
  email: string
  status?: string
  // Instantly v2 uses status codes: 1=active, 2=paused, 3=completed, -1=bounced, -2=unsubscribed, -3=skipped
  status_code?: number
  campaign_id?: string
  current_step?: number
  unsubscribed_at?: string
  bounced_at?: string
  replied_at?: string
  last_activity_at?: string
}

type InstantlyBlockedContact = {
  email: string
  reason?: string
  blocked_at?: string
}

async function instantlyFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${INSTANTLY_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${INSTANTLY_API_KEY}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Instantly ${path} ${res.status}: ${body.slice(0, 500)}`)
  }
  return res.json()
}

async function fetchAllPages<T>(
  path: string,
  itemsKey: string,
  extraParams: Record<string, string> = {},
): Promise<T[]> {
  const out: T[] = []
  let nextToken: string | undefined
  let page = 0
  do {
    page++
    const params: Record<string, string> = {
      limit: String(PAGE_LIMIT),
      ...extraParams,
    }
    if (nextToken) params.starting_after = nextToken
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await instantlyFetch<any>(path, params)
    const items = (data[itemsKey] ?? data.items ?? data.data ?? []) as T[]
    out.push(...items)
    nextToken = data.next_starting_after ?? data.next_cursor ?? undefined
    console.log(`  ${path} page ${page}: +${items.length} (total ${out.length})`)
    if (items.length < PAGE_LIMIT) break
  } while (nextToken)
  return out
}

// ---------------------------------------------------------------------------
// 1. Suppression list — both unsubscribes and bounces live in Instantly's
//    "blocked contacts" endpoint with a reason field.
// ---------------------------------------------------------------------------
console.log('Fetching Instantly blocked contacts (unsubscribes + bounces)...')
const blocked = await fetchAllPages<InstantlyBlockedContact>(
  '/blocked-contacts',
  'blocked_contacts',
)
console.log(`  → ${blocked.length} blocked contacts\n`)

// ---------------------------------------------------------------------------
// 2. All contacts — to derive per-contact status (active/paused/etc).
// ---------------------------------------------------------------------------
console.log('Fetching Instantly contacts...')
const contacts = await fetchAllPages<InstantlyContact>('/leads', 'leads')
console.log(`  → ${contacts.length} contacts\n`)

// ---------------------------------------------------------------------------
// 3. Sequence states — campaigns + which contact is at which step.
// ---------------------------------------------------------------------------
console.log('Fetching Instantly campaigns...')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const campaigns = await fetchAllPages<any>('/campaigns', 'campaigns')
console.log(`  → ${campaigns.length} campaigns\n`)

// Derive per-contact status from status_code.
const contactStatusRows = contacts.map((c) => ({
  instantly_id: c.id,
  email: c.email?.toLowerCase().trim(),
  status: deriveStatus(c.status_code, c.unsubscribed_at, c.bounced_at, c.replied_at),
  status_code: c.status_code,
  campaign_id: c.campaign_id,
  current_step: c.current_step,
  last_activity_at: c.last_activity_at,
}))

function deriveStatus(
  code: number | undefined,
  unsub: string | undefined,
  bounce: string | undefined,
  reply: string | undefined,
): string {
  if (unsub) return 'unsubscribed'
  if (bounce) return 'bounced'
  if (reply) return 'replied'
  if (code === -2) return 'unsubscribed'
  if (code === -1) return 'bounced'
  if (code === 1) return 'active'
  if (code === 2) return 'paused'
  if (code === 3) return 'completed'
  return 'unknown'
}

// Map Instantly suppression reasons → LeadFlow reason codes.
// Instantly's reason field is freeform; we normalise heuristically.
function mapReason(raw: string | undefined): 'unsubscribe' | 'bounce_hard' | 'spam_complaint' | 'manual_exclude' {
  const r = (raw ?? '').toLowerCase()
  if (r.includes('unsub') || r.includes('opt')) return 'unsubscribe'
  if (r.includes('bounce') || r.includes('invalid') || r.includes('hard')) return 'bounce_hard'
  if (r.includes('spam') || r.includes('complain') || r.includes('abuse')) return 'spam_complaint'
  return 'manual_exclude'
}

// Build suppression_list insert rows. The +alias normalisation trigger
// (normalise_suppression_email) handles dedup at insert time.
const suppressionRows = blocked
  .filter((b) => b.email && b.email.includes('@'))
  .map((b) => ({
    org_id: ORG_ID!,
    email: b.email.toLowerCase().trim(),
    reason: mapReason(b.reason),
    source: 'instantly_webhook' as const,
    suppressed_at: b.blocked_at ?? new Date().toISOString(),
    notes: `Imported from Instantly migration ${timestamp}. Original reason: ${b.reason ?? '(none)'}`,
    domain_suppression: false,
  }))

// Reason-count breakdown for the report.
const reasonCounts: Record<string, number> = {}
for (const r of suppressionRows) {
  reasonCounts[r.reason] = (reasonCounts[r.reason] ?? 0) + 1
}

// ---------------------------------------------------------------------------
// Write JSON artefacts (always — both dry-run and live).
// ---------------------------------------------------------------------------
await Deno.writeTextFile(
  `${exportDir}/suppression-list.json`,
  JSON.stringify(suppressionRows, null, 2),
)
await Deno.writeTextFile(
  `${exportDir}/contact-statuses.json`,
  JSON.stringify(contactStatusRows, null, 2),
)
await Deno.writeTextFile(
  `${exportDir}/campaigns.json`,
  JSON.stringify(campaigns, null, 2),
)
await Deno.writeTextFile(
  `${exportDir}/raw-blocked-contacts.json`,
  JSON.stringify(blocked, null, 2),
)
await Deno.writeTextFile(
  `${exportDir}/raw-contacts.json`,
  JSON.stringify(contacts, null, 2),
)

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const sequenceStateCount = contactStatusRows.filter(
  (c) => c.status === 'active' || c.status === 'paused',
).length

console.log('─── EXPORT SUMMARY ──────────────────────────────')
console.log(`Suppression rows (will insert): ${suppressionRows.length}`)
for (const [reason, n] of Object.entries(reasonCounts).sort()) {
  console.log(`  - ${reason}: ${n}`)
}
console.log(`Contacts exported: ${contacts.length}`)
console.log(`  - active/paused (in-flight sequences): ${sequenceStateCount}`)
console.log(`  - bounced: ${contactStatusRows.filter((c) => c.status === 'bounced').length}`)
console.log(`  - unsubscribed: ${contactStatusRows.filter((c) => c.status === 'unsubscribed').length}`)
console.log(`  - replied: ${contactStatusRows.filter((c) => c.status === 'replied').length}`)
console.log(`  - completed: ${contactStatusRows.filter((c) => c.status === 'completed').length}`)
console.log(`Campaigns exported: ${campaigns.length}`)
console.log('─────────────────────────────────────────────────')
console.log('')

const auditLog = {
  run_at: new Date().toISOString(),
  mode: DRY_RUN ? 'dry_run' : 'live',
  org_id: ORG_ID,
  suppression_rows_total: suppressionRows.length,
  suppression_reason_breakdown: reasonCounts,
  contacts_total: contacts.length,
  contact_status_breakdown: {
    active_or_paused: sequenceStateCount,
    bounced: contactStatusRows.filter((c) => c.status === 'bounced').length,
    unsubscribed: contactStatusRows.filter((c) => c.status === 'unsubscribed').length,
    replied: contactStatusRows.filter((c) => c.status === 'replied').length,
    completed: contactStatusRows.filter((c) => c.status === 'completed').length,
  },
  campaigns_total: campaigns.length,
  inserted_to_supabase: 0,
  insert_errors: 0,
  insert_skipped_duplicates: 0,
}

if (DRY_RUN) {
  console.log('DRY-RUN: not inserting to suppression_list. Re-run with --confirm to commit.')
  console.log(`Inspect first:`)
  console.log(`  cat ${exportDir}/suppression-list.json | head -50`)
  console.log(`  jq 'length' ${exportDir}/suppression-list.json`)
  await Deno.writeTextFile(
    `${exportDir}/migration.json`,
    JSON.stringify(auditLog, null, 2),
  )
  await Deno.writeTextFile(
    `${exportDir}/migration.log`,
    `[${new Date().toISOString()}] DRY-RUN complete. ${suppressionRows.length} rows would insert. No DB writes.\n`,
  )
  Deno.exit(0)
}

// ---------------------------------------------------------------------------
// LIVE: bulk insert into suppression_list.
// ---------------------------------------------------------------------------
console.log('LIVE MODE: inserting suppression rows into Supabase...')
console.log('(The +alias normalisation trigger handles dedup automatically.)')
console.log('')

const BATCH = 100
let inserted = 0
let errors = 0
let skipped = 0
const logLines: string[] = [
  `[${new Date().toISOString()}] LIVE import started. ${suppressionRows.length} rows queued.`,
]

for (let i = 0; i < suppressionRows.length; i += BATCH) {
  const batch = suppressionRows.slice(i, i + BATCH)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/suppression_list`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      // resolution=ignore-duplicates skips rows that collide with the unique
      // index on (org_id, lower(email)) — expected when running re-import.
      Prefer: 'return=minimal,resolution=ignore-duplicates',
    },
    body: JSON.stringify(batch),
  })
  if (!res.ok) {
    const body = await res.text()
    errors += batch.length
    const msg = `Batch ${i}–${i + batch.length} failed: ${res.status} ${body.slice(0, 200)}`
    console.error(`  ✗ ${msg}`)
    logLines.push(`[${new Date().toISOString()}] ${msg}`)
    continue
  }
  inserted += batch.length
  console.log(`  ✓ Batch ${i}–${i + batch.length}: ok`)
  logLines.push(`[${new Date().toISOString()}] Batch ${i}–${i + batch.length}: inserted (resolution=ignore-duplicates).`)
}

// Verify final row count for this source on the live table.
const verifyRes = await fetch(
  `${SUPABASE_URL}/rest/v1/suppression_list?source=eq.instantly_webhook&org_id=eq.${ORG_ID}&select=count`,
  {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
    },
  },
)
const finalCountHeader = verifyRes.headers.get('content-range') ?? '?/?'
const finalCount = parseInt(finalCountHeader.split('/')[1] ?? '0', 10) || 0
skipped = Math.max(0, inserted - finalCount + (finalCount - suppressionRows.length))

console.log('')
console.log(`Done. ${inserted} batched, ${errors} errored. Live row count for source=instantly_webhook: ${finalCount}`)

auditLog.inserted_to_supabase = inserted
auditLog.insert_errors = errors
auditLog.insert_skipped_duplicates = skipped

logLines.push(`[${new Date().toISOString()}] Live import complete. inserted=${inserted}, errors=${errors}, live_count=${finalCount}.`)

await Deno.writeTextFile(
  `${exportDir}/migration.json`,
  JSON.stringify(auditLog, null, 2),
)
await Deno.writeTextFile(`${exportDir}/migration.log`, logLines.join('\n') + '\n')

console.log(`Audit log: ${exportDir}/migration.json`)
console.log(`Run log:   ${exportDir}/migration.log`)
if (errors > 0) Deno.exit(1)
