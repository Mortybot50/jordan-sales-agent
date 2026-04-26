/**
 * Gmail Pub/Sub webhook — receives push notifications when new emails arrive.
 *
 * Google Pub/Sub pushes base64-encoded messages to this endpoint.
 * We use the historyId to fetch new messages via Gmail API and
 * insert matching ones as email_inbound activities.
 *
 * Required env vars:
 *   VITE_GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   TOKEN_ENCRYPTION_KEY
 *   GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL  required in prod — the service account
 *                                        configured on the Pub/Sub push subscription
 *   GMAIL_PUBSUB_AUDIENCE  optional — overrides the default `aud` claim, which is
 *                          inferred from the request URL otherwise
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createDecipheriv } from 'crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY
const PUBSUB_SERVICE_ACCOUNT_EMAIL = process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL
const PUBSUB_AUDIENCE_OVERRIDE = process.env.GMAIL_PUBSUB_AUDIENCE

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'

// Google OIDC JWKS — cached by jose internally (ETag/max-age aware).
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

function decryptToken(ciphertext: string): string {
  if (!ENCRYPTION_KEY || !ciphertext.includes(':')) return ciphertext
  const [ivHex, authTagHex, encHex] = ciphertext.split(':')
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) return null
  const data = await res.json() as { access_token: string }
  return data.access_token
}

function parseEmailHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function inferAudience(req: VercelRequest): string {
  if (PUBSUB_AUDIENCE_OVERRIDE) return PUBSUB_AUDIENCE_OVERRIDE
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https'
  const host = req.headers.host ?? 'jordan-sales-agent.vercel.app'
  // Strip query string from req.url defensively
  const path = (req.url ?? '/api/webhooks/gmail').split('?')[0]
  return `${proto}://${host}${path}`
}

/**
 * Verify the Pub/Sub push request carries a valid Google-signed OIDC JWT.
 * Returns true when verification passes; otherwise the response is sent
 * (401/503) and the caller should bail out.
 */
async function verifyPubSubJwt(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  if (!PUBSUB_SERVICE_ACCOUNT_EMAIL) {
    if (IS_PRODUCTION) {
      console.error('GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL not configured — webhook disabled')
      res.status(503).json({ error: 'Webhook not configured' })
      return false
    }
    console.warn('GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL not set — skipping JWT verification (dev mode only)')
    return true
  }

  const authHeader = (req.headers.authorization ?? req.headers.Authorization) as string | undefined
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' })
    return false
  }
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    res.status(401).json({ error: 'unauthorized' })
    return false
  }

  try {
    const audience = inferAudience(req)
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience,
    })
    const email = payload.email as string | undefined
    const emailVerified = payload.email_verified as boolean | undefined
    if (!email || email.toLowerCase() !== PUBSUB_SERVICE_ACCOUNT_EMAIL.toLowerCase()) {
      res.status(401).json({ error: 'unauthorized' })
      return false
    }
    if (emailVerified === false) {
      res.status(401).json({ error: 'unauthorized' })
      return false
    }
    return true
  } catch (err) {
    console.warn('Gmail Pub/Sub JWT verification failed:', (err as Error).message)
    res.status(401).json({ error: 'unauthorized' })
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // S2: verify Google-signed OIDC JWT BEFORE acknowledging or processing.
  const ok = await verifyPubSubJwt(req, res)
  if (!ok) return

  // Acknowledge immediately — Pub/Sub requires fast response
  res.status(204).end()

  try {
    const body = req.body as { message?: { data?: string; messageId?: string } }
    if (!body?.message?.data) return

    const decoded = JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8')) as {
      emailAddress: string
      historyId: string
    }

    const { emailAddress, historyId } = decoded
    if (!emailAddress || !historyId) return

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Find the gmail_connection for this email
    const { data: connection } = await supabase
      .from('gmail_connections')
      .select('*')
      .eq('email', emailAddress)
      .single()

    if (!connection) {
      console.warn('No gmail_connection found for', emailAddress)
      return
    }

    // Get or refresh access token
    let accessToken = connection.access_token_encrypted
      ? decryptToken(connection.access_token_encrypted)
      : null

    const isExpired = connection.access_token_expires_at
      ? new Date(connection.access_token_expires_at) < new Date()
      : true

    if (isExpired && connection.refresh_token_encrypted) {
      const refreshToken = decryptToken(connection.refresh_token_encrypted)
      accessToken = await refreshAccessToken(refreshToken)
      if (accessToken) {
        await supabase
          .from('gmail_connections')
          .update({
            access_token_encrypted: accessToken,
            access_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          })
          .eq('id', connection.id)
      }
    }

    if (!accessToken) {
      console.error('No valid access token for', emailAddress)
      return
    }

    const lastHistoryId = connection.history_id

    // Fetch history since last known historyId
    const historyUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history')
    historyUrl.searchParams.set('startHistoryId', lastHistoryId)
    historyUrl.searchParams.set('historyTypes', 'messageAdded')
    historyUrl.searchParams.set('labelId', 'INBOX')

    const historyRes = await fetch(historyUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!historyRes.ok) {
      console.error('Gmail history fetch failed:', await historyRes.text())
      return
    }

    const historyData = await historyRes.json() as {
      history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>
      historyId: string
    }

    // Update history_id
    await supabase
      .from('gmail_connections')
      .update({ history_id: historyData.historyId })
      .eq('id', connection.id)

    const messageIds = (historyData.history ?? [])
      .flatMap((h) => h.messagesAdded ?? [])
      .map((m) => m.message.id)

    if (messageIds.length === 0) return

    // Fetch full messages
    for (const messageId of messageIds) {
      try {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )

        if (!msgRes.ok) continue
        const msg = await msgRes.json() as {
          id: string
          payload: {
            headers: Array<{ name: string; value: string }>
            body?: { data?: string }
            parts?: Array<{ mimeType: string; body?: { data?: string } }>
          }
        }

        const headers = msg.payload.headers
        const fromHeader = parseEmailHeader(headers, 'From')
        const subject = parseEmailHeader(headers, 'Subject')
        const dateHeader = parseEmailHeader(headers, 'Date')
        const messageIdHeader = parseEmailHeader(headers, 'Message-ID')

        // Extract sender email
        const fromMatch = fromHeader.match(/<(.+?)>/) ?? [null, fromHeader]
        const fromEmail = fromMatch[1]?.toLowerCase().trim()

        if (!fromEmail) continue

        // Match against a contact in this org
        const { data: contact } = await supabase
          .from('contacts')
          .select('id, venue_id')
          .eq('org_id', connection.org_id)
          .ilike('email', fromEmail)
          .single()

        if (!contact) continue // not from a pipeline contact, ignore

        // Get associated deal
        const { data: deal } = await supabase
          .from('deals')
          .select('id')
          .eq('contact_id', contact.id)
          .is('closed_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // Extract plain text body
        let body = ''
        if (msg.payload.body?.data) {
          body = Buffer.from(msg.payload.body.data, 'base64url').toString('utf8')
        } else if (msg.payload.parts) {
          const textPart = msg.payload.parts.find((p) => p.mimeType === 'text/plain')
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64url').toString('utf8')
          }
        }

        const occurredAt = dateHeader
          ? new Date(dateHeader).toISOString()
          : new Date().toISOString()

        // Insert activity (dedupe on external_message_id)
        await supabase
          .from('activities')
          .upsert({
            org_id: connection.org_id,
            contact_id: contact.id,
            deal_id: deal?.id ?? null,
            activity_type: 'email_inbound',
            subject: subject.replace(/^Re:\s*/i, '').slice(0, 255),
            body: body.slice(0, 4000),
            external_message_id: messageIdHeader || messageId,
            raw_headers: { from: fromHeader, subject, date: dateHeader },
            occurred_at: occurredAt,
          }, { onConflict: 'org_id,external_message_id', ignoreDuplicates: true })

      } catch (msgErr) {
        console.error('Error processing message', messageId, msgErr)
      }
    }
  } catch (err) {
    console.error('Gmail webhook error:', err)
  }
}
