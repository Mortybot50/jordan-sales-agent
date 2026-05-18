/**
 * Symmetric AES-256-GCM helpers for application secrets stored at rest.
 * Format matches the encryptToken() helper inlined in api/oauth/gmail/callback.ts
 * (which predates this module): `iv(hex) ":" authTag(hex) ":" ciphertext(hex)`.
 *
 * Use for SMTP app passwords (email_accounts.smtp_password_encrypted) and any
 * other secret that must be stored in Postgres but readable by the Edge
 * Function runtime. The key (TOKEN_ENCRYPTION_KEY) is a 64-char hex string =
 * 32 raw bytes. Never bundle it into the browser.
 *
 * NOTE: filename starts with `_lib/` so Vercel does not treat it as a route.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

function loadKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY
  if (!hex || hex.length < 64) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY missing or too short (need 64-char hex / 32 bytes)',
    )
  }
  return Buffer.from(hex, 'hex')
}

export function encryptToken(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptToken(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format (expected iv:authTag:ciphertext)')
  }
  const [ivHex, authTagHex, ctHex] = parts
  const key = loadKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const ct = Buffer.from(ctHex, 'hex')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()])
  return decrypted.toString('utf8')
}
