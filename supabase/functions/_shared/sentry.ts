/**
 * _shared/sentry.ts — Sentry init + capture helper for Edge Functions.
 *
 * Reuses the same DSN as the SPA runtime SDK. Configure once per project via:
 *   supabase secrets set SENTRY_DSN=<dsn-from-VITE_SENTRY_DSN>
 *
 * Used by the 4 critical cold-send functions (send-via-smtp, drain-send-queue,
 * send-warmup-tick, poll-replies) to capture unhandled errors so operators
 * don't have to actively pull Supabase function logs to notice a regression.
 *
 * Defensive: if SENTRY_DSN is unset, init is a no-op and captureException
 * falls back to console.error. Local `supabase functions serve` and
 * preview-branch deploys without the secret continue working unchanged.
 *
 * AUDIT-2026-05-28 P1-OBS-02 closure.
 */

// @ts-expect-error Deno globals
const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? ''
// @ts-expect-error Deno globals
const SENTRY_ENV = Deno.env.get('SENTRY_ENV') ?? (Deno.env.get('SUPABASE_URL')?.includes('localhost') ? 'local' : 'production')

// Lazy import — only paid for when DSN is set. esm.sh path is the standard
// Supabase Edge pattern; npm: specifier also works but pins the registry.
type SentryModule = {
  init: (opts: Record<string, unknown>) => void
  captureException: (err: unknown, ctx?: Record<string, unknown>) => void
  setTag: (k: string, v: string) => void
}

let sentry: SentryModule | null = null
let initInFlight: Promise<void> | null = null

async function ensureSentry(serviceName: string): Promise<void> {
  if (!SENTRY_DSN) return
  if (sentry) return
  if (initInFlight) return initInFlight
  initInFlight = (async () => {
    try {
      // @ts-expect-error Deno edge runtime
      const mod = await import('https://esm.sh/@sentry/deno@8.45.0')
      sentry = mod as SentryModule
      sentry.init({
        dsn: SENTRY_DSN,
        environment: SENTRY_ENV,
        sampleRate: 1.0,
        tracesSampleRate: 0,  // no perf events for now — error capture only
        release: serviceName,
      })
      sentry.setTag('service', serviceName)
    } catch (err) {
      console.warn(`[sentry] init failed for ${serviceName}:`, (err as Error).message)
      sentry = null
    } finally {
      initInFlight = null
    }
  })()
  return initInFlight
}

/**
 * Init Sentry for this Edge Function. Safe to call multiple times — first call
 * triggers the dynamic import, subsequent calls are no-ops. Pass the function's
 * slug as the `serviceName` so error events are tagged for filtering.
 */
export function initSentry(serviceName: string): void {
  // Fire-and-forget; the captureException calls await the same in-flight
  // promise if it's still resolving when the first error lands.
  void ensureSentry(serviceName)
}

/**
 * Capture an exception. Always logs via console.error (so Supabase function
 * logs still show the trace), then forwards to Sentry when init succeeded.
 * `ctx` is attached as tags / extras for filtering.
 */
export async function captureException(
  err: unknown,
  ctx?: Record<string, unknown>,
): Promise<void> {
  console.error('[edge-error]', err, ctx ?? {})
  if (!SENTRY_DSN) return
  await ensureSentry(ctx?.service as string ?? 'unknown')
  try {
    sentry?.captureException(err, ctx ? { extra: ctx } : undefined)
  } catch (e) {
    console.warn('[sentry] captureException failed:', (e as Error).message)
  }
}

/**
 * Wrap an async handler so any thrown error is captured before re-throwing.
 * Use as: `Deno.serve(withSentry('my-fn', async (req) => { ... }))`.
 */
export function withSentry<T extends (req: Request) => Promise<Response>>(
  serviceName: string,
  handler: T,
): T {
  initSentry(serviceName)
  return (async (req: Request) => {
    try {
      return await handler(req)
    } catch (err) {
      await captureException(err, { service: serviceName, url: req.url })
      throw err
    }
  }) as T
}
