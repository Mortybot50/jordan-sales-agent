/**
 * _shared/email-patterns.ts — standard address-pattern generation for the
 * pattern-guess-then-verify enrichment step.
 *
 * Given a domain (from a resolved website) and an optional person name, produce
 * the candidate addresses that hospitality venues actually use. The caller
 * sends these to ZeroBounce and keeps ONLY status=valid — a guessed address is
 * never stored as deliverable without provider confirmation.
 *
 * Role addresses (info@, bookings@ …) are flagged role_based downstream by the
 * contacts.role_based GENERATED column and are NOT outreach-ready even when
 * valid. Personal addresses (first@, first.last@ …) are the genuinely sendable
 * ones. We cap the total set to keep ZeroBounce credit burn bounded.
 */

export interface EmailCandidate {
  email: string
  kind: 'role' | 'personal'
}

// Role/shared inboxes, in rough order of hospitality prevalence. These map to
// role_based=true once stored, so they can never be auto-enrolled.
const ROLE_LOCALPARTS = [
  'info', 'hello', 'bookings', 'enquiries', 'contact', 'admin',
]

const MAX_CANDIDATES_DEFAULT = 8

function normaliseDomain(raw: string): string {
  let d = raw.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0].split('?')[0].split('#')[0]
  return d
}

// Reduce a name to ascii alpha tokens usable in a local-part.
function nameParts(name: string | null | undefined): { first?: string; last?: string } {
  if (!name) return {}
  const tokens = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip combining accents
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/['-]/g, ''))
    .filter((t) => t.length >= 2)
  if (tokens.length === 0) return {}
  if (tokens.length === 1) return { first: tokens[0] }
  return { first: tokens[0], last: tokens[tokens.length - 1] }
}

/**
 * Build the candidate set for a domain. Personal patterns come first (they're
 * the sendable win) when a name is supplied, then role patterns fill the rest
 * up to `max`. De-duped, all lower-case, capped.
 */
export function buildCandidates(
  domain: string,
  personName?: string | null,
  max: number = MAX_CANDIDATES_DEFAULT,
): EmailCandidate[] {
  const d = normaliseDomain(domain)
  if (!d || !d.includes('.')) return []

  const out: EmailCandidate[] = []
  const seen = new Set<string>()
  const push = (local: string, kind: 'role' | 'personal') => {
    const email = `${local}@${d}`
    if (seen.has(email)) return
    seen.add(email)
    out.push({ email, kind })
  }

  const { first, last } = nameParts(personName)
  if (first && last) {
    push(first, 'personal')
    push(`${first}.${last}`, 'personal')
    push(`${first}${last}`, 'personal')
    push(`${first[0]}${last}`, 'personal')
  } else if (first) {
    push(first, 'personal')
  }

  for (const r of ROLE_LOCALPARTS) push(r, 'role')

  return out.slice(0, Math.max(1, max))
}
