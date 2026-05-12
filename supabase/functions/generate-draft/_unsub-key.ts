/**
 * UNSUBSCRIBE_SIGNING_KEY presence + minimum-strength check.
 *
 * Pure helper — no Deno globals — so it can be unit-tested in Node via the
 * repo's `npm test` harness while also being usable from the Deno-served
 * Edge Function (`./index.ts`).
 *
 * Spam Act 2003 (Cth) s.18 mandates a functional unsubscribe on every
 * commercial electronic message. We refuse to generate the draft at all
 * when the signing key is missing, so a malformed configuration cannot
 * silently ship cold email without a working unsubscribe link.
 *
 * Pre-fix behaviour: missing key → `console.warn` + skip footer + draft
 * sent without unsubscribe. Up to $222,000/day under s.24.
 */
export type UnsubKeyCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'too_short' }

/**
 * Returns ok=true only when the key is a non-whitespace string at least 32
 * characters long. 32 chars is the recommended minimum for the HMAC-SHA256
 * mint flow (32 random bytes hex-encoded → 64 chars; we accept any 32+ for
 * forward-compat with raw-base64 alternatives).
 */
export function checkUnsubKey(raw: string | undefined | null): UnsubKeyCheck {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: 'missing' }
  }
  const trimmed = String(raw).trim()
  if (trimmed.length === 0) {
    return { ok: false, reason: 'missing' }
  }
  if (trimmed.length < 32) {
    return { ok: false, reason: 'too_short' }
  }
  return { ok: true }
}
