// audit-snapshot — read-only DB shape probe.
//
// Status: active utility. Source committed for DR rebuild parity per BE-P1-06.
// Returns a JSON snapshot of:
//   - cron.job rows
//   - public.* tables + column counts
//   - rls / pg_policies counts per table
//   - pg_indexes per table
//   - row counts for the canonical app tables
//
// Largely superseded by direct Supabase MCP probes (`list_tables`,
// `execute_sql` against `pg_indexes` / `pg_policies` / `cron.job`) in the
// audit workflow, but kept deployed because:
//   - non-MCP callers (curl from CI, smoke scripts, runbook automation) can
//     hit it with a service-role JWT and get a single-shot DB shape report
//   - the row-count loop covers a stable set of app tables; useful for cheap
//     "did we just lose all the contacts" sanity checks during DR or migration
//
// No DDL, no writes — read-only. Safe to keep live.

import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js'
const DB_URL = Deno.env.get('SUPABASE_DB_URL')!

// Constant-time bearer compare against the service-role key.
// Closes Codex P1 (BE-P1-06 PR #58 round 1): function exposes schema/cron
// metadata; an anon-key caller would otherwise be able to harvest it.
function requireServiceRole(req: Request): Response | null {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const got = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!expected || !got || got.length !== expected.length) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    })
  }
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i)
  if (diff !== 0) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    })
  }
  return null
}

Deno.serve(async (req: Request) => {
  const denied = requireServiceRole(req)
  if (denied) return denied

  const sql = postgres(DB_URL)
  try {
    const cron_jobs = await sql`SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobname`
    const tables = await sql`SELECT table_name, (SELECT count(*) FROM information_schema.columns c WHERE c.table_name=t.table_name AND c.table_schema='public') as cols FROM information_schema.tables t WHERE table_schema='public' ORDER BY table_name`
    const rls = await sql`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    const rls_policies = await sql`SELECT tablename, count(*) as policy_count FROM pg_policies WHERE schemaname='public' GROUP BY tablename ORDER BY tablename`
    const indexes = await sql`SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname`
    const counts: Record<string, number> = {}
    // Fixed Codex P2: canonical table is `sequence_enrollments` (double-l) per
    // 20260427000004_sequence_engine.sql; the typo in the original live version
    // always returned -1 for this entry, defeating the DR sanity check.
    for (const t of ['users', 'organizations', 'contacts', 'deals', 'activities', 'sequences', 'sequence_steps', 'sequence_enrollments', 'email_drafts', 'pipeline_stages', 'voice_rules', 'suppression_list', 'worker_runs']) {
      try { const r = await sql`SELECT count(*) FROM ${sql(t)}`; counts[t] = Number(r[0].count) } catch { counts[t] = -1 }
    }
    await sql.end()
    return new Response(JSON.stringify({ cron_jobs, tables, rls, rls_policies, indexes, counts }, null, 2), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    await sql.end().catch(()=>{})
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
