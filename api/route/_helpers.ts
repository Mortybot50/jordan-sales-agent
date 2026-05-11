/**
 * Shared helpers for /api/route/* handlers.
 *
 * Auth + rate-limit pattern matches /api/places/autocomplete (per-user
 * in-memory bucket). The buckets are intentionally separate per-handler
 * so a flood on `generate-day` doesn't lock out reads.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
export const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface Bucket { count: number; resetAt: number }

export interface AuthedUser {
  id: string
  org_id: string
}

export interface RateLimitConfig {
  windowMs: number
  max: number
  buckets: Map<string, Bucket>
}

export function makeRateLimiter(windowMs: number, max: number): RateLimitConfig {
  return { windowMs, max, buckets: new Map() }
}

export function rateLimitOk(cfg: RateLimitConfig, key: string): boolean {
  const now = Date.now()
  const b = cfg.buckets.get(key)
  if (!b || now > b.resetAt) {
    cfg.buckets.set(key, { count: 1, resetAt: now + cfg.windowMs })
    return true
  }
  if (b.count >= cfg.max) return false
  b.count += 1
  return true
}

/**
 * Validate the bearer token and resolve the caller's org_id from public.users.
 * Returns null after writing the appropriate response on failure.
 */
export async function authenticate(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ user: AuthedUser; userClient: SupabaseClient; admin: SupabaseClient } | null> {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return null
  }
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' })
    return null
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }

  // Resolve org_id from the public.users row (RLS-bound). Mirror Supabase v2
  // pattern used by api/webhooks/instantly et al.
  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .maybeSingle()
  if (userErr || !userRow?.org_id) {
    res.status(403).json({ error: 'No org for caller' })
    return null
  }

  // A user-scoped client uses the JWT so RLS policies fire as the caller.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return {
    user: { id: user.id, org_id: userRow.org_id as string },
    userClient,
    admin,
  }
}

/** ISO weekday accepted by route_days: 1=Mon..6=Sat. */
export function isValidDayOfWeek(d: unknown): d is number {
  return typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 6
}

/** Convert a JS Date.getDay() (0=Sun..6=Sat) to ISO weekday (1=Mon..7=Sun). */
export function jsDayToIsoWeekday(day: number): number {
  return ((day + 6) % 7) + 1
}
