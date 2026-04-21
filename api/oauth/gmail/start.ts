/**
 * Gmail OAuth start — redirects user to Google's consent screen.
 *
 * Required env vars:
 *   VITE_GOOGLE_OAUTH_CLIENT_ID  (public, used in redirect_uri construction)
 *   GOOGLE_OAUTH_CLIENT_SECRET   (server-side only)
 *
 * NOTE: Google OAuth verification is in progress (submitted 21/04/2026).
 * Until verified, only test users can connect. Jordan's email + demo email
 * must be added as test users in Google Cloud Console OAuth consent screen.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google OAuth client ID not configured' })
  }

  // Verify the caller is authenticated
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const redirectUri = `${req.headers.origin ?? process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173'}/api/oauth/gmail/callback`

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    state: user.id, // used to identify user in callback
  })

  return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}
