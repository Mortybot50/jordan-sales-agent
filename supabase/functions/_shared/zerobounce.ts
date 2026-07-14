/**
 * _shared/zerobounce.ts — the SINGLE ZeroBounce validatebatch client.
 *
 * Used by verify-contacts (drains the pending backlog) and enrich-venue-contacts
 * (confirms pattern-guessed candidate addresses). One client so credit-
 * exhaustion detection and the deprecated-host fix live in exactly one place.
 *
 * CRITICAL — out-of-credits is a SAFE, NON-THROWING outcome. Callers must be
 * able to degrade to "leave everything pending" without crashing when the
 * account is out of credits (the current state). This never throws; it returns
 * a discriminated outcome with `outOfCredits` set so the caller can no-op.
 */

export interface ZbVerdict {
  email: string
  status: string      // lower-cased, e.g. 'valid' | 'invalid' | 'catch-all'
  sub_status: string  // lower-cased
}

export interface ZbBatchOutcome {
  ok: boolean
  /** true when the failure is specifically credit/quota exhaustion (or HTTP 402). */
  outOfCredits: boolean
  error?: string
  /** key: lower-cased email → verdict. Empty unless ok. */
  verdicts: Map<string, ZbVerdict>
}

// bulkapi.zerobounce.net is DEPRECATED (Cloudflare-WAF 403). The batch endpoint
// lives on the main API host. Confirmed 13/07/2026.
const VALIDATE_BATCH_URL = 'https://api.zerobounce.net/v2/validatebatch'

// Substrings that identify credit/quota exhaustion in a ZeroBounce error body.
const OUT_OF_CREDIT_MARKERS = [
  'credit', 'quota', 'insufficient', 'exceeded', 'ran out',
]

function looksOutOfCredits(text: string): boolean {
  const t = text.toLowerCase()
  return OUT_OF_CREDIT_MARKERS.some((m) => t.includes(m))
}

/**
 * Validate a batch of emails. Never throws. On any failure returns
 * { ok:false, verdicts:empty } with `outOfCredits` set when the failure is
 * a credit/quota problem so the caller can log-and-skip rather than error.
 */
export async function zeroBounceValidateBatch(
  apiKey: string,
  emails: string[],
): Promise<ZbBatchOutcome> {
  if (!apiKey) {
    return { ok: false, outOfCredits: false, error: 'no_api_key', verdicts: new Map() }
  }
  const clean = Array.from(new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean)))
  if (clean.length === 0) {
    return { ok: true, outOfCredits: false, verdicts: new Map() }
  }

  let resp: Response
  try {
    resp = await fetch(VALIDATE_BATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        email_batch: clean.map((e) => ({ email_address: e, ip_address: '' })),
      }),
    })
  } catch (e) {
    return { ok: false, outOfCredits: false, error: `network: ${String(e)}`, verdicts: new Map() }
  }

  if (resp.status === 402) {
    return { ok: false, outOfCredits: true, error: 'HTTP 402 payment required', verdicts: new Map() }
  }
  if (!resp.ok) {
    const text = (await resp.text().catch(() => '')).slice(0, 300)
    return {
      ok: false,
      outOfCredits: looksOutOfCredits(text),
      error: `HTTP ${resp.status}: ${text}`,
      verdicts: new Map(),
    }
  }

  let json: {
    email_batch?: Array<{ email_address?: string; address?: string; status?: string; sub_status?: string }>
    errors?: Array<{ error?: string; email_address?: string }>
  }
  try {
    json = await resp.json()
  } catch (e) {
    return { ok: false, outOfCredits: false, error: `bad json: ${String(e)}`, verdicts: new Map() }
  }

  const batch = json.email_batch ?? []
  const errors = json.errors ?? []

  // The migrated endpoint reports key/credit problems as HTTP 200 with an
  // `errors` array and an empty batch. Treat that as a non-throwing failure and
  // sniff for credit exhaustion so the caller can pause cleanly.
  if (batch.length === 0 && errors.length > 0) {
    const errStr = JSON.stringify(errors)
    return {
      ok: false,
      outOfCredits: looksOutOfCredits(errStr),
      error: errStr.slice(0, 300),
      verdicts: new Map(),
    }
  }

  const verdicts = new Map<string, ZbVerdict>()
  for (const r of batch) {
    const key = (r.address ?? r.email_address ?? '').toLowerCase().trim()
    if (!key) continue
    verdicts.set(key, {
      email: key,
      status: (r.status ?? '').toLowerCase(),
      sub_status: (r.sub_status ?? '').toLowerCase(),
    })
  }
  return { ok: true, outOfCredits: false, verdicts }
}
