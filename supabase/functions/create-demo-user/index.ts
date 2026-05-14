// create-demo-user — ONE-SHOT seed function (Week 1 demo bootstrap).
//
// Status: one-shot, complete. Source committed for DR rebuild parity per BE-P1-06.
// The function creates `demo@jordan-sales-agent.test` in Supabase Auth if absent.
// It was used once during Week 1 to seed the demo Auth user; the user has since
// been password-rotated by Morty directly via the Supabase Auth admin API
// (see CLAUDE.md "Demo password drift" L1 incident, 2026-04-21).
//
// Security note: this function embeds the literal Week-1 demo password.
// Repo is private so this is acceptable, but the live demo password no longer
// matches this literal — invoking would either:
//   (a) skip the create (user already exists, returns `already_exists`), or
//   (b) attempt to create with a stale password, which Supabase would reject
//       on the unique-email constraint after the auth row already exists.
// Either way it cannot reach a "creates user with old credentials" path. Safe to
// keep deployed, but the next time this is touched it should be deleted from
// the dashboard and replaced with a direct CLI invocation against the Auth
// admin API rather than a public-ish edge function.
//
// Recommendation (follow-up, P2): `supabase functions delete create-demo-user`
// once Jordan is past the demo phase and onto live Apollo data.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Constant-time bearer compare against the service-role key.
// Closes Codex P1 (BE-P1-06 PR #58 round 1): function runs with privileged
// credentials, so any anon-key caller would otherwise be able to spawn the
// demo user in a fresh DR / empty-Auth project.
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Check if user already exists
  const { data: listData } = await supabase.auth.admin.listUsers()
  const existing = listData?.users?.find((u: any) => u.email === 'demo@jordan-sales-agent.test')
  if (existing) {
    return new Response(JSON.stringify({ id: existing.id, email: existing.email, status: 'already_exists' }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: 'demo@jordan-sales-agent.test',
    password: 'DemoLogin2026!',
    email_confirm: true,
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ id: data.user.id, email: data.user.email, status: 'created' }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
