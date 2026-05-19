/**
 * HMAC-SHA256 token helper for the RFC 8058 one-click unsubscribe flow.
 *
 * Token format:   hex( HMAC-SHA256( `${contactId}:${sendQueueId}`, UNSUBSCRIBE_SIGNING_KEY ) )
 *
 * - Bound to a specific (contact, send) tuple so a leaked token can only
 *   suppress that one contact via that one send (it would suppress anyway,
 *   but the receiver can't pivot to other addresses).
 * - Deno-side (Web Crypto / crypto.subtle). Matches the Node-side existing
 *   `api/unsubscribe.ts` (createHmac) pattern but signs the tuple, not the
 *   bare email — RFC 8058 deliverability gate, not the older Wave 1A flow.
 *
 * `verifyTuple` does the constant-time check.
 */

const enc = new TextEncoder()

async function loadKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function toHex(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Constant-time byte compare. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function signUnsubTuple(
  contactId: string,
  sendQueueId: string,
  secret: string,
): Promise<string> {
  const key = await loadKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${contactId}:${sendQueueId}`))
  return toHex(sig)
}

export async function verifyUnsubTuple(
  contactId: string,
  sendQueueId: string,
  token: string,
  secret: string,
): Promise<boolean> {
  if (!token || token.length < 8) return false
  const provided = hexToBytes(token.trim().toLowerCase())
  if (provided.length === 0) return false
  const expectedHex = await signUnsubTuple(contactId, sendQueueId, secret)
  const expected = hexToBytes(expectedHex)
  return timingSafeEqual(provided, expected)
}
