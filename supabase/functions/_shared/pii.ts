/**
 * PII redaction for logs. Never log full email addresses — Spam Act 2003
 * recordkeeping considers an email PII once attached to a real contact.
 * Convention: `<sha256(local).slice(0,8)>@<domain>`.
 */
const enc = new TextEncoder()

export async function redactEmail(email: string): Promise<string> {
  if (!email || !email.includes('@')) return '***'
  const [local, domain] = email.toLowerCase().trim().split('@', 2)
  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(local))
  const bytes = new Uint8Array(hashBuf)
  let hex = ''
  for (let i = 0; i < 4 && i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return `${hex}@${domain ?? 'unknown'}`
}
