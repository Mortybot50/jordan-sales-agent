/**
 * Deno-side AES-256-GCM helpers — symmetric counterpart of api/_lib/token-crypto.ts
 * for use inside Supabase Edge Functions. Format is identical:
 *   `iv(hex) ":" authTag(hex) ":" ciphertext(hex)`
 *
 * Uses Web Crypto (crypto.subtle) which is available in the Deno Edge runtime.
 * For AES-GCM, Web Crypto returns ciphertext WITH the 16-byte auth tag
 * appended — we strip it back off to match the colon-separated format the
 * Vercel Node side writes.
 *
 * TOKEN_ENCRYPTION_KEY is a 64-char hex string (32 raw bytes). Set as a
 * Supabase function secret. Never log the key or the plaintext.
 */

const ALGO = { name: 'AES-GCM', length: 256 }
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex string must be even length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}

async function loadKey(): Promise<CryptoKey> {
  // @ts-expect-error Deno global
  const hex = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!hex || hex.length < 64) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY missing or too short (need 64-char hex / 32 bytes)',
    )
  }
  return await crypto.subtle.importKey('raw', hexToBytes(hex), ALGO, false, ['encrypt', 'decrypt'])
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = await loadKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ctWithTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  )
  // Web Crypto appends the 16-byte auth tag to the ciphertext — split it back.
  const ct = ctWithTag.slice(0, ctWithTag.length - AUTH_TAG_BYTES)
  const tag = ctWithTag.slice(ctWithTag.length - AUTH_TAG_BYTES)
  return `${bytesToHex(iv)}:${bytesToHex(tag)}:${bytesToHex(ct)}`
}

export async function decryptToken(payload: string): Promise<string> {
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format (expected iv:authTag:ciphertext)')
  }
  const [ivHex, tagHex, ctHex] = parts
  const key = await loadKey()
  const iv = hexToBytes(ivHex)
  const tag = hexToBytes(tagHex)
  const ct = hexToBytes(ctHex)
  // Reassemble what Web Crypto expects: ciphertext ‖ authTag.
  const combined = new Uint8Array(ct.length + tag.length)
  combined.set(ct, 0)
  combined.set(tag, ct.length)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined)
  return new TextDecoder().decode(plain)
}
