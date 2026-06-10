/**
 * Recovery helpers for the `?reauth=1` round-trip used by useAuth when the
 * Supabase session-restore hard cap fires (most often: an orphaned
 * `navigator.locks` lock on `sb-<ref>-auth-token` held by a previous mount or
 * a stale tab).
 *
 * The recovery path is:
 *   1. hardCapTimer fires in useAuth
 *   2. clear `sb-*` localStorage + `window.location.replace(path + '?reauth=1')`
 *      — a hard reload terminates this browsing context, releasing every Web
 *      Lock it held. There is no app-level API to forcibly release another
 *      context's lock.
 *   3. On the next mount, if the URL carries `?reauth=1`:
 *        - strip the flag once auth init settles (so a manual refresh doesn't
 *          re-trigger), OR
 *        - if the hard cap ALSO fires this attempt, escalate to /login —
 *          we've now tried twice and it's a real auth problem, not a lock.
 */

export const REAUTH_FLAG = 'reauth'

function getSearchParams(): URLSearchParams | null {
  if (typeof window === 'undefined') return null
  try {
    return new URLSearchParams(window.location.search)
  } catch {
    return null
  }
}

export function isReauthAttempt(): boolean {
  const params = getSearchParams()
  return params?.get(REAUTH_FLAG) === '1'
}

export function stripReauthFlag(): void {
  if (typeof window === 'undefined') return
  const params = getSearchParams()
  if (!params || !params.has(REAUTH_FLAG)) return
  params.delete(REAUTH_FLAG)
  const query = params.toString()
  const newUrl =
    window.location.pathname +
    (query ? `?${query}` : '') +
    window.location.hash
  try {
    window.history.replaceState(window.history.state, '', newUrl)
  } catch (err) {
    console.error('[auth-recovery] history.replaceState failed:', err)
  }
}

export function buildReauthUrl(): string {
  if (typeof window === 'undefined') return `?${REAUTH_FLAG}=1`
  const params = getSearchParams() ?? new URLSearchParams()
  params.set(REAUTH_FLAG, '1')
  return (
    window.location.pathname + `?${params.toString()}` + window.location.hash
  )
}

/**
 * True iff `raw` looks like a corrupt Supabase auth-token blob.
 *
 * The Supabase JS SDK persists the session as a JSON object under
 * `sb-<ref>-auth-token`. If the blob is malformed, `gotrue`'s `_initialize()`
 * can swallow the parse error and never deliver INITIAL_SESSION — useAuth
 * would otherwise see this only via the 8s hard cap (a full 8s blank).
 *
 * Pre-flight detection lets us steer to `/login?reset=1` immediately.
 *
 * Inputs:
 *   null        → not corrupt (absent ≠ corrupt; caller distinguishes).
 *   ""          → corrupt (JSON.parse throws on empty string).
 *   "{...}"     → corrupt unless the parsed object has an `access_token` key.
 *   "garbage"   → corrupt.
 */
export function isCorruptCachedSessionBlob(raw: string | null): boolean {
  if (raw === null) return false
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'access_token' in (parsed as Record<string, unknown>)
    ) {
      return false
    }
    return true
  } catch {
    return true
  }
}
