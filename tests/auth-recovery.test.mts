/**
 * Pure-logic tests for src/lib/auth-recovery.ts — the `?reauth=1` round-trip
 * helpers used by useAuth when the Supabase session-restore hard cap fires.
 *
 * Placed in tests/ (not src/) to match this project's npm `test` runner
 * (node --test --experimental-strip-types tests/*.test.mts). Brief asked for
 * src/lib/auth-recovery.test.ts but that location is not executed by the
 * existing test script; tests/ is.
 *
 * Run via the npm `test` script.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  REAUTH_FLAG,
  buildReauthUrl,
  isCorruptCachedSessionBlob,
  isReauthAttempt,
  stripReauthFlag,
} from '../src/lib/auth-recovery.ts'

type MockHistory = {
  state: unknown
  calls: Array<[unknown, string, string]>
  replaceState: (state: unknown, _unused: string, url: string) => void
}

type MockLocation = {
  pathname: string
  search: string
  hash: string
}

type MockWindow = {
  location: MockLocation
  history: MockHistory
}

function installMockWindow(loc: Partial<MockLocation> = {}): MockWindow {
  const calls: MockHistory['calls'] = []
  const win: MockWindow = {
    location: {
      pathname: loc.pathname ?? '/',
      search: loc.search ?? '',
      hash: loc.hash ?? '',
    },
    history: {
      state: null,
      calls,
      replaceState(state, _unused, url) {
        calls.push([state, _unused, url])
        // Mirror the browser: parse the new URL into our mock location so
        // subsequent reads see the updated state.
        const parsed = new URL(url, 'http://example.test')
        win.location.pathname = parsed.pathname
        win.location.search = parsed.search
        win.location.hash = parsed.hash
        win.history.state = state
      },
    },
  }
  ;(globalThis as { window?: unknown }).window = win
  return win
}

function clearMockWindow(): void {
  delete (globalThis as { window?: unknown }).window
}

beforeEach(() => {
  clearMockWindow()
})

afterEach(() => {
  clearMockWindow()
})

test('REAUTH_FLAG is the string literal "reauth"', () => {
  assert.equal(REAUTH_FLAG, 'reauth')
})

test('isReauthAttempt: no window → false (SSR-safe)', () => {
  assert.equal(isReauthAttempt(), false)
})

test('isReauthAttempt: window with no search → false', () => {
  installMockWindow({ search: '' })
  assert.equal(isReauthAttempt(), false)
})

test('isReauthAttempt: ?reauth=1 → true', () => {
  installMockWindow({ search: '?reauth=1' })
  assert.equal(isReauthAttempt(), true)
})

test('isReauthAttempt: ?reauth=0 → false (only "1" counts)', () => {
  installMockWindow({ search: '?reauth=0' })
  assert.equal(isReauthAttempt(), false)
})

test('isReauthAttempt: ?reauth=true → false (only "1" counts)', () => {
  installMockWindow({ search: '?reauth=true' })
  assert.equal(isReauthAttempt(), false)
})

test('isReauthAttempt: ?foo=bar&reauth=1 → true', () => {
  installMockWindow({ search: '?foo=bar&reauth=1' })
  assert.equal(isReauthAttempt(), true)
})

test('stripReauthFlag: no window → no throw', () => {
  assert.doesNotThrow(() => stripReauthFlag())
})

test('stripReauthFlag: ?reauth=1 only → strips to bare path', () => {
  const win = installMockWindow({ pathname: '/dashboard', search: '?reauth=1' })
  stripReauthFlag()
  assert.equal(win.history.calls.length, 1)
  assert.equal(win.history.calls[0][2], '/dashboard')
  assert.equal(win.location.search, '')
})

test('stripReauthFlag: ?foo=bar&reauth=1 → keeps foo, drops reauth', () => {
  const win = installMockWindow({
    pathname: '/dashboard',
    search: '?foo=bar&reauth=1',
  })
  stripReauthFlag()
  assert.equal(win.history.calls.length, 1)
  assert.equal(win.history.calls[0][2], '/dashboard?foo=bar')
})

test('stripReauthFlag: ?reauth=1#section → preserves hash', () => {
  const win = installMockWindow({
    pathname: '/dashboard',
    search: '?reauth=1',
    hash: '#leads',
  })
  stripReauthFlag()
  assert.equal(win.history.calls[0][2], '/dashboard#leads')
})

test('stripReauthFlag: no reauth in URL → no-op (no replaceState call)', () => {
  const win = installMockWindow({ pathname: '/dashboard', search: '?foo=bar' })
  stripReauthFlag()
  assert.equal(win.history.calls.length, 0)
})

test('stripReauthFlag: empty search → no-op', () => {
  const win = installMockWindow({ pathname: '/dashboard', search: '' })
  stripReauthFlag()
  assert.equal(win.history.calls.length, 0)
})

test('buildReauthUrl: no window → minimal fallback', () => {
  assert.equal(buildReauthUrl(), '?reauth=1')
})

test('buildReauthUrl: from bare path → appends ?reauth=1', () => {
  installMockWindow({ pathname: '/dashboard', search: '', hash: '' })
  assert.equal(buildReauthUrl(), '/dashboard?reauth=1')
})

test('buildReauthUrl: from path with other params → preserves them', () => {
  installMockWindow({ pathname: '/dashboard', search: '?tab=leads', hash: '' })
  assert.equal(buildReauthUrl(), '/dashboard?tab=leads&reauth=1')
})

test('buildReauthUrl: with hash → preserves hash', () => {
  installMockWindow({
    pathname: '/dashboard',
    search: '?tab=leads',
    hash: '#row-7',
  })
  assert.equal(buildReauthUrl(), '/dashboard?tab=leads&reauth=1#row-7')
})

test('buildReauthUrl: already on ?reauth=1 → still just one flag (idempotent)', () => {
  installMockWindow({ pathname: '/dashboard', search: '?reauth=1', hash: '' })
  assert.equal(buildReauthUrl(), '/dashboard?reauth=1')
})

// --- isCorruptCachedSessionBlob -------------------------------------------
// Pre-flight tripwire for the corrupt-token failure mode (path A from the
// 2026-06-10 hotfix brief). The Supabase SDK persists the session as
// `{ access_token, refresh_token, ... }` JSON; anything else is corrupt.

test('isCorruptCachedSessionBlob: null → not corrupt (absent ≠ corrupt)', () => {
  assert.equal(isCorruptCachedSessionBlob(null), false)
})

test('isCorruptCachedSessionBlob: empty string → corrupt (JSON.parse throws)', () => {
  assert.equal(isCorruptCachedSessionBlob(''), true)
})

test('isCorruptCachedSessionBlob: garbage → corrupt', () => {
  assert.equal(isCorruptCachedSessionBlob('not-json-at-all'), true)
})

test('isCorruptCachedSessionBlob: truncated JSON → corrupt', () => {
  assert.equal(isCorruptCachedSessionBlob('{"access_token":"abc"'), true)
})

test('isCorruptCachedSessionBlob: parses to null → corrupt (no access_token)', () => {
  assert.equal(isCorruptCachedSessionBlob('null'), true)
})

test('isCorruptCachedSessionBlob: parses to array → corrupt (no access_token)', () => {
  assert.equal(isCorruptCachedSessionBlob('[1,2,3]'), true)
})

test('isCorruptCachedSessionBlob: parses to object without access_token → corrupt', () => {
  assert.equal(isCorruptCachedSessionBlob('{"refresh_token":"x"}'), true)
})

test('isCorruptCachedSessionBlob: valid session shape → ok', () => {
  const valid = JSON.stringify({
    access_token: 'ey...',
    refresh_token: 'rt-xyz',
    expires_at: 1_899_999_999,
    user: { id: 'uuid' },
  })
  assert.equal(isCorruptCachedSessionBlob(valid), false)
})

test('isCorruptCachedSessionBlob: minimal valid shape (just access_token) → ok', () => {
  assert.equal(isCorruptCachedSessionBlob('{"access_token":"x"}'), false)
})
