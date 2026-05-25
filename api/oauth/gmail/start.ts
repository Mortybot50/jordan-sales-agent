/**
 * Gmail OAuth start — redirects user to Google's consent screen.
 *
 * Required env vars:
 *   VITE_GOOGLE_OAUTH_CLIENT_ID  (public, used in redirect_uri construction)
 *   GOOGLE_OAUTH_CLIENT_SECRET   (server-side only)
 *   OAUTH_STATE_SECRET           (server-side, 32+ char random — used to HMAC the state param)
 *
 * NOTE: Google OAuth verification is in progress (submitted 21/04/2026).
 * Until verified, only test users can connect. Jordan's email + demo email
 * must be added as test users in Google Cloud Console OAuth consent screen.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { signState } from '../../_lib/oauth-state.js'

const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google OAuth client ID not configured' })
  }
  if (!OAUTH_STATE_SECRET) {
    if (IS_PRODUCTION) {
      console.error('OAUTH_STATE_SECRET not configured — OAuth start disabled')
      return res.status(503).json({ error: 'OAuth not configured' })
    }
    console.warn('OAUTH_STATE_SECRET not set — refusing to start OAuth (dev: set this var)')
    return res.status(503).json({ error: 'OAuth not configured' })
  }

  // Verify the caller is authenticated.
  //
  // Two acceptable contracts:
  //   1. `Authorization: Bearer <jwt>` header — used by programmatic / fetch callers.
  //   2. `?access_token=<jwt>` query param — required for top-level browser
  //      navigations (e.g. `window.location.href = '/api/oauth/gmail/start?...'`),
  //      because browsers do NOT attach custom Authorization headers to
  //      navigations, only to XHR/fetch.
  //
  // The state HMAC signed below (via signState) remains the security primitive
  // for the OAuth round-trip: it binds nonce → user_id, is single-use, and is
  // verified by the callback. This token only proves user identity at start
  // time so we can issue a state for the right user. The token is NEVER logged
  // or persisted; it lives only on the wire and in this function's stack.
  const authHeader = req.headers.authorization
  const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : undefined
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken
  if (!token) {
    return res.status(401).json({ error: 'Missing access token (header or query)' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // S5: parenthesise so the request Origin header takes precedence over VERCEL_URL.
  const origin =
    (req.headers.origin as string | undefined) ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173')
  const redirectUri = `${origin}/api/oauth/gmail/callback`

  // S3: signed, single-use state — HMAC over { user_id, nonce, ts }, nonce row
  // persisted in oauth_state_nonces and deleted by callback on first use.
  let state: string
  try {
    state = await signState(supabase, user.id, OAUTH_STATE_SECRET)
  } catch (err) {
    console.error('Failed to sign OAuth state:', err)
    return res.status(500).json({ error: 'Failed to start OAuth' })
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    // gmail.readonly intentionally REMOVED 25/05/2026 — sensitive-scope justification
    // blocked redirect URI registration. Reply detection now uses IMAP polling instead
    // (see leadflow-sender-build-plan.md Phase 1). If readonly is ever restored, the
    // justification form on Data Access must be completed first.
    //
    // gmail.metadata is RETAINED because the callback at api/oauth/gmail/callback.ts
    // still calls users/me/profile (line ~88) to capture the connecting email and
    // users/me/watch (line ~98) to register the Pub/Sub watch. Both methods require
    // at minimum gmail.metadata per Google's Gmail API auth docs; with only
    // gmail.send the callback would 403 silently and persist a broken
    // gmail_connections row with no email. gmail.metadata is NOT a sensitive scope
    // (no message-body access) so it does not require the Data Access justification
    // form. When the callback is later refactored to drop the watch registration
    // (post-IMAP migration), gmail.metadata can be dropped too.
    scope: 'https://www.googleapis.com/auth/gmail.metadata https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}
