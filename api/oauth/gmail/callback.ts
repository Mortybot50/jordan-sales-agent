/**
 * Gmail OAuth callback — exchanges code for tokens, registers Pub/Sub watch.
 *
 * Required env vars:
 *   VITE_GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_PUBSUB_TOPIC  e.g. projects/jordan-sales-agent-prod/topics/gmail-inbound
 *   TOKEN_ENCRYPTION_KEY  32-byte hex key for AES-256-GCM
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createCipheriv, randomBytes } from 'crypto'
import { verifyState } from '../../_lib/oauth-state.ts'

const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const GOOGLE_PUBSUB_TOPIC = process.env.GOOGLE_PUBSUB_TOPIC
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY // 32-byte hex
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET

function encryptToken(plaintext: string): string {
  if (!ENCRYPTION_KEY) return plaintext // fallback: store plaintext if no key (dev only)
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state: rawState, error } = req.query

  if (error) {
    return res.redirect(302, `/settings?tab=integrations&error=${encodeURIComponent(String(error))}`)
  }

  if (!code || !rawState || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.redirect(302, '/settings?tab=integrations&error=missing_params')
  }
  if (!OAUTH_STATE_SECRET) {
    console.error('OAUTH_STATE_SECRET not configured — callback rejected')
    return res.redirect(302, '/settings?tab=integrations&error=oauth_not_configured')
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // S3: verify HMAC-signed, single-use state. Returns the user_id on success;
  // null on bad signature, expired window, or replayed/missing nonce.
  const userId = await verifyState(supabase, String(rawState), OAUTH_STATE_SECRET)
  if (!userId) {
    console.warn('OAuth callback: invalid/expired/replayed state')
    return res.redirect(302, '/settings?tab=integrations&error=invalid_state')
  }

  const origin = req.headers.origin ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173')
  const redirectUri = `${origin}/api/oauth/gmail/callback`

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    console.error('Token exchange failed:', err)
    return res.redirect(302, '/settings?tab=integrations&error=token_exchange_failed')
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  // Get Gmail user info
  const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const profile = await profileRes.json() as { emailAddress: string; historyId: string }

  // Register Gmail watch (Pub/Sub) if topic configured
  let watchExpiresAt: string | null = null
  let historyId = profile.historyId

  if (GOOGLE_PUBSUB_TOPIC) {
    const watchRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicName: GOOGLE_PUBSUB_TOPIC,
        labelIds: ['INBOX'],
      }),
    })

    if (watchRes.ok) {
      const watchData = await watchRes.json() as { historyId: string; expiration: string }
      historyId = watchData.historyId
      watchExpiresAt = new Date(Number(watchData.expiration)).toISOString()
    } else {
      console.warn('Gmail watch registration failed:', await watchRes.text())
    }
  }

  // Get org_id for this user
  const { data: userProfile } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', String(userId))
    .single()

  if (!userProfile) {
    return res.redirect(302, '/settings?tab=integrations&error=user_not_found')
  }

  // Upsert gmail_connections
  await supabase
    .from('gmail_connections')
    .upsert({
      org_id: userProfile.org_id,
      user_id: String(userId),
      email: profile.emailAddress,
      refresh_token_encrypted: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      access_token_encrypted: encryptToken(tokens.access_token),
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      history_id: historyId,
      watch_expires_at: watchExpiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  return res.redirect(302, '/settings?tab=integrations&connected=gmail')
}
