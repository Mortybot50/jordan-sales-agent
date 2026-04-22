import { supabase } from '@/lib/supabase'

/**
 * Suppression list — the outbound firewall.
 *
 * Any surface that could trigger a message to a contact (sequence enrolment,
 * AI draft generation, morning briefing digest) must consult this utility
 * BEFORE acting. Compliance is strict-liability under the Spam Act 2003 — err
 * on the side of over-suppressing.
 */

export interface SuppressionSet {
  emails: Set<string>
  domains: Set<string>
}

/**
 * Normalise an email for suppression comparison.
 * - Lowercases
 * - Strips surrounding whitespace
 * - Strips + aliases ("foo+promo@bar" → "foo@bar") so a single entry covers
 *   any plus-alias variant of the same mailbox.
 */
export function normaliseEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed.includes('@')) return trimmed
  const [local, domain] = trimmed.split('@', 2)
  const bareLocal = local.split('+')[0]
  return `${bareLocal}@${domain}`
}

/** Return the domain portion of an email, or the input lowercased if no '@'. */
export function extractDomain(input: string): string {
  const t = input.trim().toLowerCase()
  const at = t.indexOf('@')
  return at >= 0 ? t.slice(at + 1) : t
}

/** Basic RFC-lite email shape check. */
export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())
}

/** Basic domain shape check — must contain a dot, no '@'. */
export function isValidDomain(input: string): boolean {
  const t = input.trim().toLowerCase()
  return !t.includes('@') && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(t)
}

/**
 * Fetch the full suppression set for an org.
 *
 * Returns sets of normalised emails and suppressed domains. Call this once
 * per batch of outbound work and reuse — avoid per-contact roundtrips.
 */
export async function getSuppressionSet(orgId: string): Promise<SuppressionSet> {
  const { data, error } = await supabase
    .from('suppression_list')
    .select('email, domain_suppression')
    .eq('org_id', orgId)

  if (error) {
    // Fail closed — empty set means we'd over-send. Throw so caller decides.
    throw new Error(`Failed to load suppression list: ${error.message}`)
  }

  const emails = new Set<string>()
  const domains = new Set<string>()

  for (const row of data ?? []) {
    if (row.domain_suppression) {
      domains.add(row.email.trim().toLowerCase())
    } else {
      emails.add(normaliseEmail(row.email))
    }
  }

  return { emails, domains }
}

/**
 * Check whether a single email address is suppressed.
 *
 * Returns `true` if the exact email is on the list, or if any registered
 * domain is a suffix match. Empty / invalid input returns `false` (we don't
 * have enough to suppress — the caller's own validation should gate that).
 */
export function isSuppressed(email: string | null | undefined, set: SuppressionSet): boolean {
  if (!email) return false
  const normalised = normaliseEmail(email)
  if (!normalised.includes('@')) return false
  if (set.emails.has(normalised)) return true
  const domain = extractDomain(normalised)
  return set.domains.has(domain)
}
