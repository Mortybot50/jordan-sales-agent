/**
 * _shared/auth.ts — service-role JWT role-claim check for cron-driven functions.
 *
 * Background. The Week 1+2 functions all gated themselves with:
 *
 *   if (auth !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) ...
 *
 * That string-equality check is brittle: it requires the cron's bearer string
 * to byte-match the env var injected into the Edge runtime. Any rotation, any
 * difference in encoding, and every cron tick 401s silently. The Week 2 test
 * gate on 19/05/2026 caught this in production — see
 * /tmp/gstack-leadflow-week2-test-gate-73465.log.
 *
 * Fix: defence-in-depth, two layers.
 *   1. Gateway (verify_jwt=true on the function): Supabase has already
 *      verified the JWT's HS256 signature against the project's JWT secret
 *      before any request reaches our handler. If the signature is invalid
 *      the function code never runs.
 *   2. Function-side (this helper): decode the verified JWT and require the
 *      `role` claim == 'service_role' so a leaked anon-key JWT cannot trigger
 *      the send pipeline.
 *
 * We deliberately do NOT re-verify the signature here. The Edge runtime does
 * not inject SUPABASE_JWT_SECRET into functions by default, and re-verifying
 * would require a new manually-provisioned secret with no security benefit
 * over what the gateway already enforced.
 *
 * No env vars required. Works in every Supabase Edge runtime out of the box.
 */

interface ServiceRolePayload {
  role?: string
  iss?: string
  exp?: number
  iat?: number
}

/**
 * Verify the request carries a service-role JWT (role-claim only — the
 * gateway has already verified the signature via verify_jwt=true).
 *
 * Returns null on success; returns a 401 Response (ready to return from the
 * handler) on failure. Callers use the early-return pattern:
 *
 *   const unauthorized = await requireServiceRoleAuth(req)
 *   if (unauthorized) return unauthorized
 */
export async function requireServiceRoleAuth(req: Request): Promise<Response | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return unauthorized()
  const token = auth.slice('Bearer '.length).trim()
  if (!token) return unauthorized()

  const payload = decodeJwtPayload(token)
  if (!payload) return unauthorized()
  if (payload.role !== 'service_role') return unauthorized()

  // Optional belt-and-braces: reject expired tokens. The gateway should have
  // caught this already, but if a misconfigured proxy ever forwards an
  // expired JWT, we still want to refuse it.
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    return unauthorized()
  }
  return null
}

function decodeJwtPayload(token: string): ServiceRolePayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    // base64-decode with padding tolerance.
    const padLen = (4 - (padded.length % 4)) % 4
    const b64 = padded + '='.repeat(padLen)
    // @ts-expect-error Deno globals
    const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8')
    return JSON.parse(json) as ServiceRolePayload
  } catch {
    return null
  }
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ success: false, error: 'unauthorized' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  )
}
