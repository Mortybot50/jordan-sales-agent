/**
 * Calendly webhook status probe — used by the Settings UI to show a
 * "Connected / Not configured" badge based on whether the signing key is set.
 *
 * Returns:
 *   { configured: boolean }
 *
 * `configured` is true iff CALENDLY_WEBHOOK_SIGNING_KEY is set in the
 * deployment environment. It does NOT validate the key against Calendly —
 * just that something non-empty is wired in. The actual webhook handler
 * still HMAC-verifies every event.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const configured = !!process.env.CALENDLY_WEBHOOK_SIGNING_KEY
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ configured })
}
