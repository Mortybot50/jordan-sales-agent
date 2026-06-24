/**
 * dealTitle.ts — Clean deal title utilities + display helpers for LeadFlow Pipeline
 *
 * PURPOSE
 * -------
 * All deal titles must be clean venue/business names (e.g. "Chronicles Bar",
 * "Marquis of Lorne"). Historically, creation/import paths baked status
 * suffixes directly into the `deals.title` column:
 *   - " — Purezza intro"
 *   - " — COLD from PST" / " — WARM from PST" / " — HOT from PST"
 *   - "from PST" (bare variant)
 *   - "[WALK-26APR] Plain Venue" (bracket-code prefix variants)
 *   - Email domains used as titles, e.g. "industrykitchens.com.au"
 *
 * The PST retriage migration (20260612071902_pst_retriage.sql) already
 * rewrote PST-imported titles to business-name form for the stored rows.
 * This util strips any residual suffixes at RENDER TIME and applies the
 * correct fallback order so nothing looks raw in the UI.
 *
 * FALLBACK ORDER (dealDisplayTitle)
 * ----------------------------------
 *   1. venue.name (authoritative — venue record set by Jordan or importer)
 *   2. deal.title stripped of suffixes, if not email-ish
 *   3. contact.full_name (if not email-ish)
 *   4. email domain (never the full address — domain is more readable)
 *   5. "Untitled deal"
 *
 * SOURCE FIX CONTRACT
 * -------------------
 * Every creation/import path MUST call `cleanDealTitle(rawTitle)` before
 * inserting into `deals.title`. Heat and source go into their own fields
 * (temperature, temperature_source, source) — never baked into the title.
 */

// ---------------------------------------------------------------------------
// Suffix patterns to strip from stored or user-typed titles
// ---------------------------------------------------------------------------

/**
 * Ordered list of suffix patterns to strip (case-insensitive).
 * Applied iteratively so combinations like " — COLD from PST — Purezza intro"
 * are fully cleaned in a single pass.
 */
const SUFFIX_PATTERNS: RegExp[] = [
  /\s*—\s*COLD\s+from\s+PST/i,
  /\s*—\s*WARM\s+from\s+PST/i,
  /\s*—\s*HOT\s+from\s+PST/i,
  /\s*—\s*from\s+PST/i,
  /\s+from\s+PST\s*$/i,
  /\s*—\s*Purezza\s+intro/i,
]

/**
 * Prefix patterns to strip (e.g. "[WALK-26APR] ").
 * The bracket-code was a staging marker — the real venue name follows it.
 */
const PREFIX_PATTERNS: RegExp[] = [
  /^\s*\[[\w\s\-]+\]\s*/,  // e.g. "[WALK-26APR] " or "[REVIEW-MAY]"
]

// ---------------------------------------------------------------------------
// Domain detection + cleaning
// ---------------------------------------------------------------------------

const EMAILISH = /\S+@\S+/
const DOMAIN_ONLY = /^[\w.-]+\.[a-z]{2,}$/i  // looks like "industrykitchens.com.au"

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.au',
  'hotmail.com', 'hotmail.com.au', 'outlook.com', 'outlook.com.au',
  'live.com', 'live.com.au', 'bigpond.com', 'bigpond.net.au',
  'icloud.com', 'me.com', 'msn.com', 'aol.com',
  'optusnet.com.au', 'iinet.net.au', 'internode.on.net',
  'protonmail.com', 'proton.me',
])

/**
 * cleanDomain — Convert a raw domain/URL into a human-readable Title Case name.
 * Strips protocol, www, multi-part AU TLDs (.com.au, .net.au, etc.) and
 * generic TLDs (.com, .net, .org, .io, .co, .au, etc.), replaces separators
 * (hyphens, underscores, dots) with spaces, then Title Cases each word.
 *
 * @example
 * cleanDomain('twoboysbrew.com.au')    // 'Twoboysbrew'
 * cleanDomain('industrykitchens.com.au') // 'Industrykitchens'
 * cleanDomain('two-boys-brew.com')      // 'Two Boys Brew'
 * cleanDomain('bhbh.com.au')            // 'Bhbh'
 * cleanDomain('www.someplace.net.au')   // 'Someplace'
 */
export function cleanDomain(domain: string): string {
  // Strip protocol and www prefix
  let d = domain.replace(/^https?:\/\//i, '').replace(/^www\./, '')
  // Remove path/query/fragment
  d = d.split('/')[0].split('?')[0].split('#')[0]
  // Strip multi-part AU TLDs first (.com.au, .net.au, .org.au, .gov.au, .edu.au)
  d = d.replace(/\.(com|net|org|gov|edu|id|asn)\.au$/i, '')
  // Then strip remaining single-part TLDs (.com, .net, .org, .io, .co, .au, .nz, etc.)
  d = d.replace(/\.[a-z]{2,6}$/i, '')
  // Replace separators (- _ .) with spaces
  d = d.replace(/[-_.]+/g, ' ').trim()
  // Title Case each word
  return d
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    || domain // never return empty
}

// ---------------------------------------------------------------------------
// Core strip util
// ---------------------------------------------------------------------------

/**
 * stripTitleSuffixes — Remove known status suffixes and bracket prefixes
 * from a raw deal title string. Returns the trimmed clean title.
 *
 * Safe to call on already-clean titles (idempotent).
 *
 * @example
 * stripTitleSuffixes("Chronicles Bar — COLD from PST") // "Chronicles Bar"
 * stripTitleSuffixes("[WALK-26APR] Plain Venue")        // "Plain Venue"
 * stripTitleSuffixes("Marquis of Lorne — Purezza intro")// "Marquis of Lorne"
 * stripTitleSuffixes("The Espy")                        // "The Espy"  (no-op)
 */
export function stripTitleSuffixes(raw: string): string {
  let t = raw.trim()
  // Strip bracket prefixes first
  for (const pat of PREFIX_PATTERNS) {
    t = t.replace(pat, '').trim()
  }
  // Strip suffixes iteratively (handles multi-suffix titles)
  let changed = true
  while (changed) {
    const before = t
    for (const pat of SUFFIX_PATTERNS) {
      t = t.replace(pat, '').trim()
    }
    changed = t !== before
  }
  return t || raw.trim()  // never return empty if we stripped everything
}

/**
 * cleanDealTitle — Intended for SOURCE paths (creation/import).
 * Strips suffixes and returns a clean title ready to store in `deals.title`.
 * Use this in every insert path instead of the raw user/import input.
 */
export function cleanDealTitle(raw: string | null | undefined): string {
  if (!raw) return ''
  return stripTitleSuffixes(raw)
}

// ---------------------------------------------------------------------------
// Display name (render-time fallback chain)
// ---------------------------------------------------------------------------

/**
 * Shape of the minimal deal data needed for display-name resolution.
 * Matches the Deal type from @/lib/queries/deals but typed narrowly so this
 * util can be unit-tested without importing the full query module.
 */
export interface DealLike {
  title?: string | null
  venue?: { name?: string | null } | null
  contact?: {
    full_name?: string | null
    email?: string | null
  } | null
}

/**
 * dealDisplayTitle — Render-time display name for a deal card or list row.
 *
 * Fallback chain:
 *   1. venue.name
 *   2. deal.title (suffix-stripped, if not email-ish or domain-only)
 *   3. contact.full_name (if not email-ish)
 *   4. email domain portion (business domain only — not freemail)
 *   5. email local part (last resort if freemail)
 *   6. "Untitled deal"
 *
 * @example
 * dealDisplayTitle({ title: "Chronicles Bar — COLD from PST" })
 * // => "Chronicles Bar"
 *
 * dealDisplayTitle({ title: "industrykitchens.com.au", contact: { email: "john@industrykitchens.com.au" } })
 * // => "industrykitchens.com.au"  (domain-only title IS the business name)
 *
 * dealDisplayTitle({ title: "jane@gmail.com", contact: { full_name: "Jane Smith" } })
 * // => "Jane Smith"
 */
// ---------------------------------------------------------------------------
// Relative date helper (moved here so it's co-located with display utils)
// ---------------------------------------------------------------------------

import { format as _fnsFormat } from 'date-fns'

/**
 * relDays — "today" / "3d ago" / "11 Mar" (>90d) compact relative date.
 * Re-exported from DealCard for backwards compat.
 */
export function relDays(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const days = Math.floor((Date.now() - t) / 864e5)
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  if (days <= 90) return `${days}d ago`
  return _fnsFormat(new Date(iso), 'd MMM')
}

/**
 * notesSummary — One-line notes summary. PST import blocks are machine
 * notes — surface their Action/Trigger line. Otherwise: first real line.
 * Re-exported from DealCard for backwards compat.
 */
export function notesSummary(notes: string | null | undefined): string | null {
  if (!notes) return null
  if (notes.includes('[purezza-pst-promote]')) {
    const action = /Action:[ \t]*([^\n]+)/.exec(notes)?.[1]?.trim()
    if (action) return action
    const trigger = /Trigger:[ \t]*([^\n]+)/.exec(notes)?.[1]?.trim()
    return trigger || null
  }
  const line = notes.split('\n').map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith('['))
  return line ?? null
}

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

export function dealDisplayTitle(deal: DealLike): string {
  // 1. Venue name is always the most authoritative
  if (deal.venue?.name) return deal.venue.name

  // 2. Clean deal title (if not an email or a domain-only placeholder)
  if (deal.title) {
    const cleaned = stripTitleSuffixes(deal.title)
    // If the title looks like a full email address, skip it
    if (!EMAILISH.test(cleaned)) {
      if (DOMAIN_ONLY.test(cleaned)) {
        const lower = cleaned.toLowerCase()
        if (FREE_MAIL_DOMAINS.has(lower)) {
          // freemail domain used as title — fall through
        } else {
          // Business domain: clean it to a readable name (never render raw TLD)
          return cleanDomain(cleaned)
        }
      } else {
        return cleaned
      }
    }
  }

  // 3. Contact name
  if (deal.contact?.full_name && !EMAILISH.test(deal.contact.full_name)) {
    return deal.contact.full_name
  }

  // 4. Email domain / local part — clean the domain rather than returning it raw
  const email = deal.contact?.email
  if (email && email.includes('@')) {
    const [local, domain] = email.split('@')
    if (domain && !FREE_MAIL_DOMAINS.has(domain.toLowerCase())) {
      return cleanDomain(domain)  // business domain — cleaned, no raw TLD
    }
    return local ?? email  // freemail — use local part
  }

  return deal.title ?? 'Untitled deal'
}
