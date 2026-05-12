/**
 * Pure-logic tests for the UNSUBSCRIBE_SIGNING_KEY presence + strength check
 * that gates `generate-draft` Edge Function. Spam Act 2003 (Cth) s.18 hard
 * requirement — see BE-P0-03 in docs/audits/CONSOLIDATED-AUDIT-2026-05-11.md.
 *
 * Run via the npm `test` script (node --test --experimental-strip-types).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkUnsubKey } from '../supabase/functions/generate-draft/_unsub-key.ts'

test('checkUnsubKey: undefined → missing', () => {
  assert.deepEqual(checkUnsubKey(undefined), { ok: false, reason: 'missing' })
})

test('checkUnsubKey: null → missing', () => {
  assert.deepEqual(checkUnsubKey(null), { ok: false, reason: 'missing' })
})

test('checkUnsubKey: empty string → missing', () => {
  assert.deepEqual(checkUnsubKey(''), { ok: false, reason: 'missing' })
})

test('checkUnsubKey: whitespace-only → missing', () => {
  assert.deepEqual(checkUnsubKey('   \n\t '), { ok: false, reason: 'missing' })
})

test('checkUnsubKey: too short (<32 chars) → too_short', () => {
  assert.deepEqual(checkUnsubKey('shortkey'), { ok: false, reason: 'too_short' })
  assert.deepEqual(
    checkUnsubKey('a'.repeat(31)),
    { ok: false, reason: 'too_short' },
  )
})

test('checkUnsubKey: exactly 32 chars → ok', () => {
  assert.deepEqual(checkUnsubKey('a'.repeat(32)), { ok: true })
})

test('checkUnsubKey: real-shape 64-char hex (openssl rand -hex 32) → ok', () => {
  const k = '3f8b1c9d2e7a5f4b6c8d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b'
  assert.deepEqual(checkUnsubKey(k), { ok: true })
})

test('checkUnsubKey: leading/trailing whitespace stripped before length check', () => {
  // 30 chars surrounded by whitespace — trims to 30 → too_short
  assert.deepEqual(
    checkUnsubKey('   ' + 'a'.repeat(30) + '   '),
    { ok: false, reason: 'too_short' },
  )
})
