/**
 * click-redirect — records a click event then 302s to the real URL.
 *
 * URL:  GET /functions/v1/click-redirect/:token
 *
 * The destination is stored server-side in public.tracked_links and resolved
 * by `token`; the ?url= query param is NO LONGER read (P2-2, 12/06). An opaque
 * token can't be repointed on the wire, and the destination never leaves our
 * DB. An unknown/malformed token redirects to the app — there is no
 * attacker-controllable destination path. (Safe to drop the legacy param:
 * verified nothing in the send pipeline ever emitted ?url= links.)
 *
 * Click event semantics:
 *   - Inserts one `email_send_events` row of type='clicked' PER click. We
 *     intentionally do NOT dedupe here (unlike pixel-track for 'opened'):
 *     repeated clicks from the same recipient ARE signal — they're often
 *     forwarding the link or revisiting it.
 *
 * Deployed with --no-verify-jwt — email recipients are anonymous.
 *
 * Required Supabase function secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// @ts-expect-error Deno globals
const FALLBACK_URL =
  Deno.env.get('PUBLIC_APP_URL') ?? 'https://premiumwaterau.com.au'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeDestination(raw: string | null): string {
  if (!raw) return FALLBACK_URL
  try {
    const u = new URL(raw)
    // Allow-list schemes: http(s) only. Blocks javascript:, data:, file:,
    // ftp:, mailto:, etc. — anything that could weaponise the redirect.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return FALLBACK_URL
    }
    return u.toString()
  } catch {
    return FALLBACK_URL
  }
}

function redirectTo(destination: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: destination,
      // Don't let intermediate caches memoise this redirect — we want every
      // click logged independently.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    },
  })
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const token = segments[segments.length - 1] ?? ''

  if (!UUID_RE.test(token)) {
    // Malformed token — straight to the app. Never read a wire-supplied URL.
    return redirectTo(FALLBACK_URL)
  }

  const userAgent = req.headers.get('user-agent')
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('cf-connecting-ip') ??
    null

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Resolve the destination from the stored link — NOT from the wire. This is
  // the open-redirect fix: the URL the recipient lands on is whatever WE stored
  // at send time, immune to query-param tampering.
  const { data: link } = await supabase
    .from('tracked_links')
    .select('org_id, send_queue_id, destination_url')
    .eq('token', token)
    .maybeSingle()

  // Unknown token → app. No wire URL is ever read; no click logged.
  if (!link) {
    return redirectTo(FALLBACK_URL)
  }
  const destination = safeDestination(link.destination_url)

  // Fire-and-forget click event — don't make the recipient wait on Postgres.
  ;(async () => {
    try {
      let acct: string | null = null
      let draft: string | null = null
      if (link.send_queue_id) {
        const { data: queueRow } = await supabase
          .from('email_send_queue')
          .select('email_account_id, draft_id')
          .eq('id', link.send_queue_id)
          .maybeSingle()
        acct = queueRow?.email_account_id ?? null
        draft = queueRow?.draft_id ?? null
      }
      await supabase.from('email_send_events').insert({
        org_id: link.org_id,
        send_queue_id: link.send_queue_id,
        draft_id: draft,
        email_account_id: acct,
        event_type: 'clicked',
        metadata: { destination, user_agent: userAgent, ip },
      })
    } catch (err) {
      console.error('click-redirect DB write failed:', (err as Error).message)
    }
  })()

  return redirectTo(destination)
})
