/**
 * Build a sensible contact full_name when only an email + venue are known.
 *
 * The bug we're closing: crawlers that scrape generic inbox aliases
 * (bookings@, info@, hello@) used `email.split('@')[0]` as a name fallback,
 * which made the Contacts list show "bookings", "info", "hello" as the
 * primary names — unreadable on a phone, and worse, none of them looked
 * like real people. Jordan rightly flagged this on 05/06/2026.
 *
 * Rule of thumb:
 *  - If we have a real name (passed in), use it. Never override.
 *  - If we don't, build "<Initcap(role)> — <Venue Name>" so the row reads
 *    e.g. "Bookings — The Kingston" rather than the bare "bookings".
 *  - If neither real name nor venue name is known, fall back to the email
 *    itself — at least it's distinguishable.
 *  - We never want a bare lowercase role-style word as the display name.
 */
export function deriveContactName(opts: {
  realName?: string | null
  email: string | null | undefined
  venueName?: string | null
}): string {
  const real = opts.realName?.trim()
  if (real) return real

  const email = opts.email?.trim()
  if (!email) return opts.venueName?.trim() || 'Unknown contact'

  const localPart = email.includes('@') ? email.split('@')[0] : email
  const cleanedLocal = localPart.replace(/[._+-]+/g, ' ').trim()
  const titled = cleanedLocal
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')

  const venue = opts.venueName?.trim()
  if (venue) {
    return titled ? `${titled} — ${venue}` : venue
  }

  return titled || email
}
