// create-demo-user — ONE-SHOT seed function (Week 1 demo bootstrap).
//
// Status: one-shot, complete. Source committed for DR rebuild parity per BE-P1-06.
// The function creates `demo@jordan-sales-agent.test` in Supabase Auth if absent.
// It was used once during Week 1 to seed the demo Auth user; the user has since
// been password-rotated by Morty directly via the Supabase Auth admin API
// (see CLAUDE.md "Demo password drift" L1 incident, 2026-04-21).
//
// Security: password is read from DEMO_USER_PASSWORD at invocation time.
// No repo literal. If the env var is missing or shorter than 12 chars the
// function 400s. DR operator should set the env var just-in-time, invoke
// once, then unset.
//
// The original Week-1 deployment embedded a literal password directly in
// source. That literal is no longer in this file — Codex round-2 P2 caught
// the DR-rebuild risk. The live deployed version was NOT rotated to this
// safer source (audit recommendation is dashboard deletion); see PR body.
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

  // Closes Codex round-2 P2: password must come from env at invocation time,
  // never a repo literal. DR rebuild operator sets DEMO_USER_PASSWORD just-in-
  // time, invokes the function once, then unsets it. If the env var is missing
  // we hard-fail rather than silently creating with a default.
  const demoPassword = Deno.env.get('DEMO_USER_PASSWORD') ?? ''
  if (!demoPassword || demoPassword.length < 12) {
    return new Response(JSON.stringify({
      error: 'DEMO_USER_PASSWORD env var missing or too short (need >=12 chars). Set it just-in-time and retry.'
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: 'demo@jordan-sales-agent.test',
    password: demoPassword,
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
