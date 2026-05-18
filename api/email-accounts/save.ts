/**
 * Email accounts save — server-side encrypts the SMTP app password with
 * TOKEN_ENCRYPTION_KEY and upserts an email_accounts row for the caller.
 *
 * Why a Vercel API route and not direct browser writes? The browser must
 * never see TOKEN_ENCRYPTION_KEY. The client POSTs the plaintext password
 * over HTTPS to this route, which encrypts and inserts via service_role.
 *
 * POST /api/email-accounts/save
 *   Authorization: Bearer <supabase access token>
 *   {
 *     id?: string,                  // for updates; omit to create
 *     email_address: string,
 *     display_name?: string,
 *     smtp_host?: string,
 *     smtp_port?: number,
 *     smtp_username?: string,
 *     smtp_password?: string,       // plaintext; encrypted server-side. Omit to keep existing.
 *     reply_to_address?: string | null,
 *     send_signature?: string | null,
 *     daily_send_cap?: number,
 *     brand?: 'purezza' | 'culligan' | 'zip' | null,
 *     icp_segment?: 'hospitality' | 'office' | 'trade' | null,
 *     status?: 'active' | 'paused' | 'warming' | 'bounced_recently'
 *   }
 *
 * Required env vars:
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { encryptToken } from '../_lib/token-crypto.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const ALLOWED_STATUSES = new Set(['active', 'paused', 'warming', 'bounced_recently'])
const ALLOWED_BRANDS = new Set(['purezza', 'culligan', 'zip'])
const ALLOWED_SEGMENTS = new Set(['hospitality', 'office', 'trade'])

interface SaveBody {
  id?: string
  email_address?: string
  display_name?: string | null
  smtp_host?: string
  smtp_port?: number
  smtp_username?: string
  smtp_password?: string
  reply_to_address?: string | null
  send_signature?: string | null
  daily_send_cap?: number
  brand?: string | null
  icp_segment?: string | null
  status?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!process.env.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY.length < 64) {
    return res.status(503).json({ error: 'TOKEN_ENCRYPTION_KEY not configured' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Resolve the caller's org_id from public.users.
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr || !profile) {
    return res.status(403).json({ error: 'No org membership' })
  }

  const body = (req.body ?? {}) as SaveBody

  // Validate inputs at the boundary.
  const isUpdate = !!body.id
  if (!isUpdate) {
    if (!body.email_address || typeof body.email_address !== 'string') {
      return res.status(400).json({ error: 'email_address is required' })
    }
    if (!body.smtp_username || typeof body.smtp_username !== 'string') {
      return res.status(400).json({ error: 'smtp_username is required' })
    }
    if (!body.smtp_password || typeof body.smtp_password !== 'string') {
      return res.status(400).json({ error: 'smtp_password is required on create' })
    }
  }

  if (body.smtp_port != null && (typeof body.smtp_port !== 'number' || body.smtp_port < 1 || body.smtp_port > 65535)) {
    return res.status(400).json({ error: 'smtp_port out of range' })
  }
  if (body.daily_send_cap != null && (typeof body.daily_send_cap !== 'number' || body.daily_send_cap < 0 || body.daily_send_cap > 1000)) {
    return res.status(400).json({ error: 'daily_send_cap out of range' })
  }
  if (body.status != null && !ALLOWED_STATUSES.has(body.status)) {
    return res.status(400).json({ error: 'invalid status' })
  }
  if (body.brand != null && body.brand !== '' && !ALLOWED_BRANDS.has(body.brand)) {
    return res.status(400).json({ error: 'invalid brand' })
  }
  if (body.icp_segment != null && body.icp_segment !== '' && !ALLOWED_SEGMENTS.has(body.icp_segment)) {
    return res.status(400).json({ error: 'invalid icp_segment' })
  }

  // Build the row. Don't include smtp_password_encrypted unless the caller
  // provided a new password — keeps existing ciphertext on edits.
  const row: Record<string, unknown> = {
    org_id: profile.org_id,
    user_id: user.id,
  }
  if (body.email_address) row.email_address = body.email_address.trim().toLowerCase()
  if (body.display_name !== undefined) row.display_name = body.display_name
  if (body.smtp_host) row.smtp_host = body.smtp_host
  if (body.smtp_port) row.smtp_port = body.smtp_port
  if (body.smtp_username) row.smtp_username = body.smtp_username
  if (body.smtp_password) row.smtp_password_encrypted = encryptToken(body.smtp_password)
  if (body.reply_to_address !== undefined) row.reply_to_address = body.reply_to_address
  if (body.send_signature !== undefined) row.send_signature = body.send_signature
  if (body.daily_send_cap != null) row.daily_send_cap = body.daily_send_cap
  if (body.brand !== undefined) row.brand = body.brand === '' ? null : body.brand
  if (body.icp_segment !== undefined) row.icp_segment = body.icp_segment === '' ? null : body.icp_segment
  if (body.status) row.status = body.status

  let result
  if (isUpdate) {
    // Defensively scope by org_id + user_id; service_role would otherwise bypass.
    const { data, error } = await supabase
      .from('email_accounts')
      .update(row)
      .eq('id', body.id!)
      .eq('org_id', profile.org_id)
      .eq('user_id', user.id)
      .select('id, email_address, status, daily_send_cap, updated_at')
      .single()
    if (error) {
      console.error('email-accounts/save update error:', error)
      return res.status(500).json({ error: error.message })
    }
    if (!data) {
      return res.status(404).json({ error: 'Not found' })
    }
    result = data
  } else {
    const { data, error } = await supabase
      .from('email_accounts')
      .insert(row)
      .select('id, email_address, status, daily_send_cap, updated_at')
      .single()
    if (error) {
      console.error('email-accounts/save insert error:', error)
      // 23505 = unique violation (duplicate email per org)
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An account with that email already exists' })
      }
      return res.status(500).json({ error: error.message })
    }
    result = data
  }

  return res.status(200).json({ account: result })
}
