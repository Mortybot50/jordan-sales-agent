/**
 * Public unsubscribe endpoint — backs the `/unsubscribe` page.
 *
 * POST { email, token? }
 *   - If `token` is present and HMAC-valid for `email`, treat as a one-click
 *     unsubscribe (the link the native sender appends to outbound emails).
 *   - If `token` is missing/invalid, treat as a manual unsubscribe — we still
 *     accept it, but only when we can match the email to at least one contact
 *     across our orgs (so the form can't be used to mass-suppress arbitrary
 *     addresses against orgs that never emailed them).
 *
 * On match: insert one `suppression_list` row per org that has a contact with
 * this email, scoped by `reason='unsubscribe'`, `source='unsubscribe'`.
 *
 * Response is intentionally generic — we never reveal whether the address
 * exists in our DB.
 *
 * Required env vars:
 *   UNSUBSCRIBE_SIGNING_KEY         — HMAC-SHA256 secret used to sign tokens
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'

const UNSUBSCRIBE_SIGNING_KEY = process.env.UNSUBSCRIBE_SIGNING_KEY
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function signUnsubscribeToken(email: string, key: string): string {
  return createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex')
}

export function verifyUnsubscribeToken(email: string, token: string, key: string): boolean {
  let provided = token.trim()
  if (provided.startsWith('sha256=')) provided = provided.slice('sha256='.length)
  let a: Buffer
  try {
    a = Buffer.from(provided, 'hex')
  } catch {
    return false
  }
  const expected = Buffer.from(signUnsubscribeToken(email, key), 'hex')
  if (a.length !== expected.length) return false
  return timingSafeEqual(a, expected)
}

function isValidEmailShape(email: string): boolean {
  // Deliberately permissive — server-side gate, the suppression_list insert
  // also validates via its `email = lower(email)` check.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320
}

// Per-IP token bucket for the MANUAL form path (P2-1). The one-click signed
// path is HMAC-gated and exempt. In-memory is sufficient: the manual form is
// low-volume, and the bucket only needs to blunt a scripted enumeration burst
// from a single source within a Lambda's lifetime. Map is pruned on overflow.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 5
const ipBuckets = new Map<string, { count: number; resetAt: number }>()

function manualRateLimitOk(ip: string): boolean {
  const now = Date.now()
  const b = ipBuckets.get(ip)
  if (!b || now > b.resetAt) {
    if (ipBuckets.size > 5000) {
      for (const [k, v] of ipBuckets) if (now > v.resetAt) ipBuckets.delete(k)
    }
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (b.count >= RATE_MAX) return false
  b.count += 1
  return true
}

function callerIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim()
  if (Array.isArray(xff) && xff.length > 0) return xff[0]
  return req.socket?.remoteAddress ?? 'unknown'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = (req.body ?? {}) as { email?: unknown; token?: unknown }
  const rawEmail = typeof body.email === 'string' ? body.email : ''
  const rawToken = typeof body.token === 'string' ? body.token : ''

  const email = rawEmail.trim().toLowerCase()
  if (!email || !isValidEmailShape(email)) {
    return res.status(400).json({ error: 'Invalid email' })
  }

  let tokenValid = false
  if (rawToken && UNSUBSCRIBE_SIGNING_KEY) {
    tokenValid = verifyUnsubscribeToken(email, rawToken, UNSUBSCRIBE_SIGNING_KEY)
  }

  // Rate-limit the manual (no/invalid token) path only — signed one-click
  // links carry their own proof and shouldn't be throttled.
  if (!tokenValid && !manualRateLimitOk(callerIp(req))) {
    return res.status(429).json({ error: 'Too many requests — try again shortly.' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Find every org that has a contact with this email. Each gets its own row.
  const { data: contacts, error: contactErr } = await supabase
    .from('contacts')
    .select('org_id')
    .ilike('email', email)

  if (contactErr) {
    console.error('Unsubscribe: contact lookup failed', contactErr)
    return res.status(500).json({ error: 'Lookup failed' })
  }

  const orgIds = Array.from(new Set((contacts ?? []).map((c) => c.org_id as string)))

  // Manual fallback (no valid token) is only honoured if we actually have a
  // contact record for this email. Otherwise refuse silently — we don't want
  // the form being abused to suppress arbitrary addresses we never owned.
  if (!tokenValid && orgIds.length === 0) {
    console.info('Unsubscribe: manual submit, no contact match', { email })
    // Still return 200 — never confirm or deny existence to anonymous callers.
    return res.status(200).json({ status: 'ok' })
  }

  for (const orgId of orgIds) {
    const { data: existing } = await supabase
      .from('suppression_list')
      .select('id')
      .eq('org_id', orgId)
      .eq('email', email)
      .maybeSingle()

    if (existing) continue

    const { error: insertErr } = await supabase.from('suppression_list').insert({
      org_id: orgId,
      email,
      reason: 'unsubscribe',
      source: 'unsubscribe',
      notes: tokenValid
        ? 'Unsubscribed via signed link'
        : 'Unsubscribed via public form (manual)',
      domain_suppression: false,
    })

    if (insertErr) {
      console.error('Unsubscribe: suppression insert failed', { orgId, insertErr })
    }
  }

  return res.status(200).json({ status: 'ok' })
}
