#!/usr/bin/env -S deno run --allow-env --allow-net
/**
 * classify-backlog.ts
 *
 * One-shot script to run the classify-reply-intent Edge Function against all
 * existing inbound activities that haven't been classified yet.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   deno run --allow-env --allow-net scripts/classify-backlog.ts
 *
 * Or via npm script:
 *   npm run classify-backlog
 *
 * Options (env vars):
 *   BATCH_SIZE   — activities per batch (default: 20)
 *   DELAY_MS     — ms between batches (default: 500) — avoids rate-limiting
 *   DRY_RUN      — set to "1" to print activity IDs without calling classifier
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const BATCH_SIZE = parseInt(Deno.env.get('BATCH_SIZE') ?? '20', 10)
const DELAY_MS = parseInt(Deno.env.get('DELAY_MS') ?? '500', 10)
const DRY_RUN = Deno.env.get('DRY_RUN') === '1'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  Deno.exit(1)
}

const CLASSIFY_URL = `${SUPABASE_URL}/functions/v1/classify-reply-intent`
const ACTIVITIES_URL = `${SUPABASE_URL}/rest/v1/activities`

async function fetchUnclassified(): Promise<Array<{ id: string; activity_type: string }>> {
  const params = new URLSearchParams({
    select: 'id,activity_type',
    activity_type: 'in.(reply_received,email_inbound)',
    'metadata->>intent': 'is.null',
    order: 'occurred_at.asc',
    limit: '1000',
  })

  const res = await fetch(`${ACTIVITIES_URL}?${params}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to fetch activities: ${res.status} ${body}`)
  }

  return res.json()
}

async function classify(activityId: string): Promise<{ intent: string; confidence: number } | null> {
  const res = await fetch(CLASSIFY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ activity_id: activityId }),
  })

  const body = await res.json()

  if (!res.ok) {
    console.error(`  ✗ ${activityId} — ${res.status}: ${body.error ?? JSON.stringify(body)}`)
    return null
  }

  return { intent: body.intent, confidence: body.confidence }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

console.log('classify-backlog: fetching unclassified inbound activities…')
const all = await fetchUnclassified()
console.log(`Found ${all.length} unclassified activities`)

if (all.length === 0) {
  console.log('Nothing to do.')
  Deno.exit(0)
}

if (DRY_RUN) {
  console.log('DRY_RUN=1 — would classify:')
  all.forEach((a) => console.log(`  ${a.id} (${a.activity_type})`))
  Deno.exit(0)
}

let ok = 0
let fail = 0

for (let i = 0; i < all.length; i += BATCH_SIZE) {
  const batch = all.slice(i, i + BATCH_SIZE)
  console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(all.length / BATCH_SIZE)} (${batch.length} activities)`)

  await Promise.all(
    batch.map(async (a) => {
      const result = await classify(a.id)
      if (result) {
        console.log(`  ✓ ${a.id} → ${result.intent} (${(result.confidence * 100).toFixed(0)}%)`)
        ok++
      } else {
        fail++
      }
    }),
  )

  if (i + BATCH_SIZE < all.length) {
    await sleep(DELAY_MS)
  }
}

console.log(`\nDone. ${ok} classified, ${fail} failed.`)
if (fail > 0) Deno.exit(1)
