/**
 * pixel-track — 1×1 transparent GIF for email open tracking.
 *
 * URL:  GET /functions/v1/pixel-track/:send_queue_id
 *
 * On every hit:
 *   - Records a row in `email_pixel_hits` with the UA + IP + Apple-MPP flag.
 *   - If this is the FIRST non-MPP hit for the send_queue_id, also writes an
 *     `email_send_events` row of type='opened' (so the events table stays
 *     deduped — pixels can fire dozens of times per email, but we only want
 *     one "opened" event per real human view).
 *   - Always returns the same 1×1 transparent GIF with no-cache headers so
 *     downstream proxies don't suppress repeat hits.
 *
 * Apple Mail Privacy Protection (MPP) prefetches images server-side
 * regardless of whether the human ever opened the email. We detect it
 * heuristically from the user-agent and the (very tight) timing of the
 * fetch relative to send (MPP fires almost immediately, often within
 * seconds). The flag is purely informational — we store the hit either
 * way; analytics filters on `is_apple_mpp = false`.
 *
 * Required Supabase function secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Deployed with --no-verify-jwt — the pixel is loaded by random email
 * clients with no auth token attached.
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// 1×1 transparent GIF, 43 bytes. Encoded once at module-load.
const PIXEL_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
])

const PIXEL_HEADERS = {
  'Content-Type': 'image/gif',
  'Content-Length': String(PIXEL_BYTES.length),
  // No-cache: each load = one hit. Downstream caches would otherwise silently
  // suppress repeat opens; we want every fire on the wire.
  'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  // CORS open — image elements don't send credentials, but some clients are
  // picky about CORS on cross-origin <img>.
  'Access-Control-Allow-Origin': '*',
}

function pixelResponse(): Response {
  return new Response(PIXEL_BYTES, { status: 200, headers: PIXEL_HEADERS })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Heuristic Apple MPP detection. MPP requests come from
 * `Mozilla/5.0 (Macintosh; ...) AppleWebKit/... (KHTML, like Gecko)` with
 * an `image/*` accept header, but more reliably the UA string contains
 * `iCloud` or the request comes from Apple's image-proxy IP ranges
 * (17.x.x.x). We use UA + Accept header — IP-range matching would be
 * brittle here and is overkill for the analytics fidelity we need.
 */
function detectAppleMpp(userAgent: string | null, accept: string | null): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  // The two strongest signals seen in practice.
  if (ua.includes('icloud')) return true
  if (ua.includes('mail.app') || ua.includes('mailproxy')) return true
  // MPP UA pattern observed: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
  // AppleWebKit/605.1.15 (KHTML, like Gecko)" with NO browser identifier and
  // an `image/...` Accept header.
  const looksLikeAppleWebKit =
    ua.includes('applewebkit') &&
    ua.includes('macintosh') &&
    !ua.includes('chrome') &&
    !ua.includes('safari/') &&
    !ua.includes('firefox')
  const acceptsOnlyImages = (accept ?? '').toLowerCase().startsWith('image/')
  return looksLikeAppleWebKit && acceptsOnlyImages
}

function clientIp(req: Request): string | null {
  // Edge runtime exposes the caller IP via `x-forwarded-for` (Supabase routes
  // through Cloudflare-style proxies). First entry is the real client.
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('cf-connecting-ip') ?? null
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  // CORS preflight — image clients don't send these, but be defensive.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: PIXEL_HEADERS })
  }

  // Parse the trailing UUID from the URL. Path is
  // `/functions/v1/pixel-track/<uuid>` — we want the last non-empty segment.
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const sendQueueId = segments[segments.length - 1] ?? ''

  // Always return the pixel — never leak whether the ID was valid (would
  // help an attacker enumerate queue rows). Logging happens out-of-band.
  if (!UUID_RE.test(sendQueueId)) {
    return pixelResponse()
  }

  const userAgent = req.headers.get('user-agent')
  const accept = req.headers.get('accept')
  const ip = clientIp(req)
  const isAppleMpp = detectAppleMpp(userAgent, accept)

  // Fire-and-forget the DB writes — never block the pixel response on them.
  // The client is an <img> tag; if we delay, we delay the entire email render.
  ;(async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

      // Always insert the raw hit.
      await supabase.from('email_pixel_hits').insert({
        send_queue_id: sendQueueId,
        user_agent: userAgent,
        ip_address: ip,
        is_apple_mpp: isAppleMpp,
      })

      // For the events table, dedupe: only emit `opened` once per send,
      // and only for non-MPP hits (Apple prefetches don't represent a real
      // human view). Check if there's already an 'opened' event for this
      // send_queue_id; insert one if not.
      if (!isAppleMpp) {
        // Look up the queue row to get org_id + email_account_id + draft_id
        // for the event. The queue row may have been deleted — that's fine,
        // we just skip the event write in that case.
        const { data: queueRow } = await supabase
          .from('email_send_queue')
          .select('org_id, email_account_id, draft_id')
          .eq('id', sendQueueId)
          .maybeSingle()

        if (queueRow) {
          const { data: existing } = await supabase
            .from('email_send_events')
            .select('id')
            .eq('send_queue_id', sendQueueId)
            .eq('event_type', 'opened')
            .limit(1)
            .maybeSingle()

          if (!existing) {
            await supabase.from('email_send_events').insert({
              org_id: queueRow.org_id,
              send_queue_id: sendQueueId,
              draft_id: queueRow.draft_id,
              email_account_id: queueRow.email_account_id,
              event_type: 'opened',
              metadata: {
                user_agent: userAgent,
                ip: ip,
              },
            })
          }
        }
      }
    } catch (err) {
      console.error('pixel-track DB write failed:', (err as Error).message)
    }
  })()

  return pixelResponse()
})
