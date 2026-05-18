/**
 * click-redirect — records a click event then 302s to the real URL.
 *
 * URL:  GET /functions/v1/click-redirect/:send_queue_id?url=<encoded>
 *
 * For Week 1 we keep this trivial: trust the `url` query param verbatim,
 * but require it to be http:// or https:// to prevent open-redirect abuse
 * via `javascript:` or `data:` schemes. A more polished version (Week 2+)
 * would store a per-link token and look the destination up server-side so
 * the URL never leaks in the email body — but Week 1's scope is "we can
 * count clicks", and the link visibility was always going to be there
 * anyway because email clients display the href on hover.
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
  Deno.env.get('PUBLIC_APP_URL') ?? 'https://jordan-sales-agent.vercel.app'

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
  const sendQueueId = segments[segments.length - 1] ?? ''
  const destination = safeDestination(url.searchParams.get('url'))

  // If the queue id is malformed, still redirect — never strand the user on
  // an error page just because our analytics link rotted.
  if (!UUID_RE.test(sendQueueId)) {
    return redirectTo(destination)
  }

  const userAgent = req.headers.get('user-agent')
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('cf-connecting-ip') ??
    null

  // Fire-and-forget DB write — don't make the recipient wait on Postgres.
  ;(async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      const { data: queueRow } = await supabase
        .from('email_send_queue')
        .select('org_id, email_account_id, draft_id')
        .eq('id', sendQueueId)
        .maybeSingle()

      if (queueRow) {
        await supabase.from('email_send_events').insert({
          org_id: queueRow.org_id,
          send_queue_id: sendQueueId,
          draft_id: queueRow.draft_id,
          email_account_id: queueRow.email_account_id,
          event_type: 'clicked',
          metadata: {
            destination,
            user_agent: userAgent,
            ip,
          },
        })
      }
    } catch (err) {
      console.error('click-redirect DB write failed:', (err as Error).message)
    }
  })()

  return redirectTo(destination)
})
