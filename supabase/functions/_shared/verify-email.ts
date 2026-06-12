/**
 * _shared/verify-email.ts — email verification behind a provider adapter.
 *
 * SETTLED DECISION (12/06/2026): verification stays INTERNAL — syntax shape,
 * MX lookup (DNS-over-HTTPS), role-address detection, gm@/manager@ tiering.
 * No NeverBounce / MillionVerifier. The adapter interface exists so a paid
 * provider can slot in later by adding a new implementation and flipping
 * EMAIL_VERIFY_PROVIDER — nothing else changes.
 *
 * Verdict semantics (written to contacts.verification_status):
 *   valid   — well-formed + domain has MX
 *   risky   — well-formed but role-address, or MX lookup failed (network)
 *   invalid — malformed or domain has no MX
 */
import { classifyEmailTier } from './email-tier.ts'

export type VerifyResult = 'valid' | 'risky' | 'invalid'

export interface VerifyVerdict {
  result: VerifyResult
  tier: 1 | 2 | 3
  flags: string[]
  provider: string
}

export interface VerifyProvider {
  name: string
  verify(email: string): Promise<VerifyVerdict>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ROLE_PREFIXES = new Set([
  'info', 'contact', 'hello', 'hi', 'sales', 'admin', 'office', 'support',
  'help', 'enquiries', 'enquiry', 'inquiries', 'inquiry', 'noreply',
  'no-reply', 'team', 'accounts', 'accounting', 'billing', 'marketing',
  'careers', 'jobs', 'hr', 'press', 'media', 'events', 'bookings', 'reservations',
])

async function hasMx(domain: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { Accept: 'application/dns-json' } },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { Answer?: Array<{ data: string }> }
    return Array.isArray(json.Answer) && json.Answer.length > 0
  } catch {
    return null
  }
}

export const internalProvider: VerifyProvider = {
  name: 'internal',
  async verify(email: string): Promise<VerifyVerdict> {
    const normalised = email.trim().toLowerCase()
    const tier = classifyEmailTier(normalised)
    const flags: string[] = []

    if (!EMAIL_RE.test(normalised)) {
      return { result: 'invalid', tier, flags: ['invalid_format'], provider: 'internal' }
    }
    const [local, domain] = normalised.split('@', 2)
    if (ROLE_PREFIXES.has(local.split('+')[0])) flags.push('role_address')

    const mx = await hasMx(domain)
    if (mx === false) {
      flags.push('no_mx')
      return { result: 'invalid', tier, flags, provider: 'internal' }
    }
    if (mx === null) {
      flags.push('mx_lookup_failed')
      return { result: 'risky', tier, flags, provider: 'internal' }
    }
    return {
      result: flags.includes('role_address') ? 'risky' : 'valid',
      tier,
      flags,
      provider: 'internal',
    }
  },
}

/** Future paid providers register here, selected via EMAIL_VERIFY_PROVIDER. */
export function getVerifyProvider(_name?: string): VerifyProvider {
  return internalProvider
}
