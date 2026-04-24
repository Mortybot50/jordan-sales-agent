/**
 * Email hygiene helpers for CSV import.
 *
 * - Regex + MX DNS-over-HTTPS validation
 * - Role-based address detection (info@, sales@, etc.)
 * - Freemail detection (gmail, yahoo, etc.)
 *
 * Designed to keep imports hospitality-grade — you only want decision-maker
 * inboxes in Jordan's pipeline, not shared mailboxes or personal addresses.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ROLE_PREFIXES = new Set([
  'info',
  'contact',
  'hello',
  'hi',
  'sales',
  'admin',
  'office',
  'support',
  'help',
  'enquiries',
  'enquiry',
  'inquiries',
  'inquiry',
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'team',
  'accounts',
  'accounting',
  'billing',
  'marketing',
  'careers',
  'jobs',
  'hr',
  'press',
  'media',
  'events',
  'bookings',
  'reservations',
])

const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.com.au',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.com.au',
  'outlook.com',
  'outlook.com.au',
  'live.com',
  'live.com.au',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'bigpond.com',
  'bigpond.net.au',
  'optusnet.com.au',
  'internode.on.net',
  'iinet.net.au',
])

export type HygieneFlag =
  | 'invalid_format'
  | 'role_address'
  | 'freemail'
  | 'no_mx'
  | 'mx_lookup_failed'

export interface HygieneVerdict {
  email: string
  normalised: string
  flags: HygieneFlag[]
  suspicious: boolean
}

export interface HygieneSummary {
  total: number
  valid: number
  invalid: number
  role: number
  freemail: number
  noMx: number
  lookupFailed: number
  domainsChecked: number
}

function getLocalAndDomain(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@')
  if (at < 1) return null
  return {
    local: email.slice(0, at).toLowerCase(),
    domain: email.slice(at + 1).toLowerCase(),
  }
}

/**
 * Look up MX records via DNS-over-HTTPS (Google).
 * Returns `true` if the domain has at least one MX record, `false` if none,
 * `null` on network/parse error (so the caller can treat it as "unknown").
 *
 * Capped concurrency is handled by `runMxLookups` below.
 */
export async function hasMxRecord(domain: string): Promise<boolean | null> {
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

/**
 * Run MX lookups for a unique set of domains, capped to `concurrency` in
 * flight at once. Returns a domain → verdict map.
 */
export async function runMxLookups(
  domains: string[],
  concurrency = 20,
): Promise<Record<string, boolean | null>> {
  const unique = Array.from(new Set(domains.filter(Boolean)))
  const result: Record<string, boolean | null> = {}

  let idx = 0
  async function worker() {
    while (idx < unique.length) {
      const d = unique[idx++]
      result[d] = await hasMxRecord(d)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, () => worker())
  await Promise.all(workers)
  return result
}

/** Classify an email without hitting the network. */
export function classifyEmail(raw: string): Omit<HygieneVerdict, 'flags'> & { flags: HygieneFlag[] } {
  const normalised = raw.trim().toLowerCase()
  const flags: HygieneFlag[] = []

  if (!EMAIL_REGEX.test(normalised)) {
    flags.push('invalid_format')
    return { email: raw, normalised, flags, suspicious: true }
  }

  const parts = getLocalAndDomain(normalised)
  if (!parts) {
    flags.push('invalid_format')
    return { email: raw, normalised, flags, suspicious: true }
  }

  const { local, domain } = parts

  // Strip +tag before checking role prefix
  const localPrefix = local.split('+')[0]
  if (ROLE_PREFIXES.has(localPrefix)) flags.push('role_address')
  if (FREEMAIL_DOMAINS.has(domain)) flags.push('freemail')

  return { email: raw, normalised, flags, suspicious: flags.length > 0 }
}

/**
 * Full batch evaluation: classify + MX-lookup unique domains.
 * Emails are matched back to their original index for easy filtering.
 */
export async function evaluateBatch(
  emails: string[],
  opts: { concurrency?: number } = {},
): Promise<{ verdicts: HygieneVerdict[]; summary: HygieneSummary }> {
  const verdicts: HygieneVerdict[] = emails.map((e) => classifyEmail(e))

  const domains = verdicts
    .filter((v) => !v.flags.includes('invalid_format'))
    .map((v) => v.normalised.split('@')[1])

  const mxMap = await runMxLookups(domains, opts.concurrency ?? 20)

  for (const v of verdicts) {
    if (v.flags.includes('invalid_format')) continue
    const domain = v.normalised.split('@')[1]
    const mx = mxMap[domain]
    if (mx === false) {
      v.flags.push('no_mx')
      v.suspicious = true
    } else if (mx === null) {
      v.flags.push('mx_lookup_failed')
      // Don't mark suspicious just because the lookup failed — network hiccup
      // shouldn't block a well-formed address.
    }
  }

  const summary: HygieneSummary = {
    total: verdicts.length,
    valid: verdicts.filter((v) => !v.suspicious).length,
    invalid: verdicts.filter((v) => v.flags.includes('invalid_format')).length,
    role: verdicts.filter((v) => v.flags.includes('role_address')).length,
    freemail: verdicts.filter((v) => v.flags.includes('freemail')).length,
    noMx: verdicts.filter((v) => v.flags.includes('no_mx')).length,
    lookupFailed: verdicts.filter((v) => v.flags.includes('mx_lookup_failed')).length,
    domainsChecked: Object.keys(mxMap).length,
  }

  return { verdicts, summary }
}

export const HYGIENE_FLAG_LABEL: Record<HygieneFlag, string> = {
  invalid_format: 'Invalid format',
  role_address: 'Role address',
  freemail: 'Freemail',
  no_mx: 'No MX record',
  mx_lookup_failed: 'MX lookup failed',
}
