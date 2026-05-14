// ensure-intent-idx — ONE-SHOT idempotent index creator.
//
// Status: one-shot, complete. Source committed for DR rebuild parity per BE-P1-06.
// The function creates `idx_activities_intent` (expression index on
// `activities ((metadata ->> 'intent'))`) if not exists, then reports the
// pg_indexes row. Was deployed when the migration tracker couldn't be replayed
// against live (pre-DB-P1-01a repair).
//
// The same index is now also tracked in migration
// `supabase/migrations/20260427000002_activities_intent_idx.sql`, repaired into
// the live tracker via PR #57 (DB-P1-01a). The migration is the canonical source
// of truth going forward.
//
// Recommendation (follow-up, P2): `supabase functions delete ensure-intent-idx`
// at the next housekeeping pass — the migration covers it, and an Edge Function
// running raw DDL via SUPABASE_DB_URL is a wider blast radius than necessary.

import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js'

const DB_URL = Deno.env.get('SUPABASE_DB_URL')!

Deno.serve(async () => {
  const sql = postgres(DB_URL)

  try {
    // Create index if not exists (idempotent)
    await sql`
      CREATE INDEX IF NOT EXISTS idx_activities_intent
        ON activities ((metadata ->> 'intent'))
    `

    // Verify it exists
    const rows = await sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'activities'
        AND indexname = 'idx_activities_intent'
    `

    await sql.end()

    return new Response(
      JSON.stringify({
        created_or_exists: true,
        index: rows[0] ?? null,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    await sql.end()
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
