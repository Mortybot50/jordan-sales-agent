/**
 * OAuth state helpers — HMAC-signed, single-use, time-limited state tokens
 * to defend the OAuth callback against CSRF / account-binding attacks (S3).
 *
 * The state is a base64url(JSON) blob carrying { user_id, nonce, ts } plus an
 * HMAC-SHA256 signature over those three fields. The callback verifies the
 * HMAC, the timestamp window, and that the nonce row exists in
 * `oauth_state_nonces` for the same user_id. Each nonce is single-use:
 * verifyState() deletes it on success.
 *
 * NOTE: filename starts with `_lib/` so Vercel does not treat it as a route.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function base64UrlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(s: string): string {
  // Restore padding
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
  return b.toString('utf8')
}

function computeHmac(secret: string, payload: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(payload).digest())
}

interface StatePayload {
  user_id: string
  nonce: string
  ts: number
}

/**
 * Sign + persist a one-time-use state for the given user.
 * Returns the encoded state to pass to Google's `state` query param.
 */
export async function signState(
  supabase: SupabaseClient,
  userId: string,
  secret: string,
): Promise<string> {
  const nonce = randomBytes(32).toString('hex')
  const ts = Date.now()
  const payload: StatePayload = { user_id: userId, nonce, ts }
  const payloadJson = JSON.stringify(payload)
  const sig = computeHmac(secret, payloadJson)

  // Persist nonce → user_id binding. Single-use; verifyState deletes on success.
  // Caller MUST use the service-role client; the table has RLS enabled with no policies.
  const { error } = await supabase.from('oauth_state_nonces').insert({
    nonce,
    user_id: userId,
    expires_at: new Date(ts + STATE_TTL_MS).toISOString(),
  })
  if (error) throw new Error(`Failed to persist oauth nonce: ${error.message}`)

  return `${base64UrlEncode(payloadJson)}.${sig}`
}

/**
 * Verify the state value returned by Google.
 * Returns the user_id on success, or null on any failure (bad shape, bad
 * HMAC, expired, nonce not found / already used).
 *
 * On success the nonce row is deleted (single-use).
 */
export async function verifyState(
  supabase: SupabaseClient,
  state: string,
  secret: string,
): Promise<string | null> {
  if (!state || typeof state !== 'string') return null
  const dot = state.indexOf('.')
  if (dot <= 0) return null

  const payloadB64 = state.slice(0, dot)
  const sig = state.slice(dot + 1)

  let payloadJson: string
  try {
    payloadJson = base64UrlDecode(payloadB64)
  } catch {
    return null
  }

  const expected = computeHmac(secret, payloadJson)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let payload: StatePayload
  try {
    payload = JSON.parse(payloadJson) as StatePayload
  } catch {
    return null
  }
  if (!payload.user_id || !payload.nonce || typeof payload.ts !== 'number') return null

  if (Date.now() - payload.ts > STATE_TTL_MS) return null

  // Atomic lookup-and-delete via .delete().select() — only succeeds if row still
  // exists, matches the user, and is not expired.
  const { data, error } = await supabase
    .from('oauth_state_nonces')
    .delete()
    .eq('nonce', payload.nonce)
    .eq('user_id', payload.user_id)
    .gt('expires_at', new Date().toISOString())
    .select('nonce')
    .maybeSingle()

  if (error || !data) return null
  return payload.user_id
}
