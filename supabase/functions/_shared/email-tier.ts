/**
 * Email tier classification — shared between discover-leads (Outscraper
 * enrichment ingest) and crawl-venue-contacts (website crawler).
 *
 * Tier 1 — named individual / personal mailbox (firstname.lastname@, free-mail)
 * Tier 2 — role mailbox where a decision-maker reads (gm@, manager@, owner@)
 * Tier 3 — generic catch-all (info@, hello@, enquiries@)
 */

const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'hotmail.com.au', 'yahoo.com', 'yahoo.com.au',
  'outlook.com', 'outlook.com.au', 'live.com', 'live.com.au', 'msn.com',
  'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'iinet.net.au',
  'xtra.co.nz', 'me.com', 'icloud.com',
])

const TIER2_PREFIXES = new Set([
  'gm', 'manager', 'owner', 'operations', 'functions', 'events', 'reception',
])

const TIER3_PREFIXES = new Set([
  'info', 'hello', 'enquiries', 'enquiry', 'reservations', 'contact',
  'admin', 'bookings', 'booking', 'sales', 'office', 'welcome', 'general',
])

export function classifyEmailTier(email: string): 1 | 2 | 3 {
  const lower = email.toLowerCase().trim()
  const atIdx = lower.indexOf('@')
  if (atIdx < 0) return 3

  const local = lower.slice(0, atIdx)
  const domain = lower.slice(atIdx + 1)

  if (FREEMAIL_DOMAINS.has(domain)) return 1

  for (const prefix of TIER2_PREFIXES) {
    if (local === prefix || local.startsWith(prefix + '.') || local.startsWith(prefix + '_')) {
      return 2
    }
  }

  for (const prefix of TIER3_PREFIXES) {
    if (local === prefix || local.startsWith(prefix + '.') || local.startsWith(prefix + '_')) {
      return 3
    }
  }

  if (local.includes('.') && !local.includes('@')) return 1

  return 1
}
