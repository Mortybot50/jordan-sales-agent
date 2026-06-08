/**
 * Pure helpers for the canonical hospitality sequence's template-driven steps.
 *
 * Used by sequence-tick when a step has `template_variants` set (i.e. the
 * canonical hospitality cadence) — short-circuits the LLM and renders Jordan's
 * verbatim copy with placeholder substitution. Keeping this in a sibling
 * file (not _shared) so Supabase's edge bundler picks it up via relative
 * import from index.ts, and so it stays unit-testable with `deno test`.
 */

// ── Types reflecting the JSON shape stored in sequence_steps.template_variants
export interface TemplateVariant {
  id: string
  subject_template: string
  body_template: string
  /** Optional rule predicates. First variant whose `when` evaluates true wins.
   * The last variant should have `when: null` to act as fallback. */
  when: VariantPredicate | null
}

export interface VariantPredicate {
  any_of: VariantRule[]
}

export type VariantRule =
  | {
      kind: 'field_visit_suburb_match'
      lookback_days: number
    }
  | {
      kind: 'venue_type_in'
      values: string[]
      and_suburb_present: boolean
    }
  | {
      /** Safety net for venues whose venue_type is null but we still want
       * walk-by phrasing as long as we have a suburb to mention in the body.
       * Picks the variant solely on suburb presence — useful for Outscraper-
       * sourced venues where venue_type isn't always populated. */
      kind: 'venue_suburb_present_only'
    }

export interface TemplateVariantsConfig {
  selection: 'rule_based' | 'single'
  variants: TemplateVariant[]
}

// ── Selection context (everything the rules need to evaluate)
export interface SelectionContext {
  contactSuburb: string | null
  venueType: string | null
  /** Distinct suburbs the user visited (via field_visits) within lookback window. */
  recentVisitSuburbs: string[]
}

const HOSPITALITY_VENUE_TYPES_DEFAULT = [
  'restaurant',
  'cafe',
  'bar',
  'hotel',
  'function',
  'fine_dining',
]

export function selectVariant(
  config: TemplateVariantsConfig,
  ctx: SelectionContext,
): TemplateVariant {
  if (config.variants.length === 0) {
    throw new Error('template_variants config has no variants')
  }
  if (config.selection === 'single') return config.variants[0]

  for (const v of config.variants) {
    if (v.when === null) continue
    if (matchesPredicate(v.when, ctx)) return v
  }
  // Fallback: last variant with when === null, else last variant.
  const fallback = config.variants.find((v) => v.when === null)
  return fallback ?? config.variants[config.variants.length - 1]
}

function matchesPredicate(p: VariantPredicate, ctx: SelectionContext): boolean {
  return p.any_of.some((rule) => evaluateRule(rule, ctx))
}

function evaluateRule(rule: VariantRule, ctx: SelectionContext): boolean {
  if (rule.kind === 'field_visit_suburb_match') {
    if (!ctx.contactSuburb) return false
    const target = normaliseSuburb(ctx.contactSuburb)
    return ctx.recentVisitSuburbs
      .map(normaliseSuburb)
      .some((s) => s === target)
  }
  if (rule.kind === 'venue_type_in') {
    if (!ctx.venueType) return false
    if (!rule.values.includes(ctx.venueType)) return false
    if (rule.and_suburb_present && !ctx.contactSuburb) return false
    return true
  }
  if (rule.kind === 'venue_suburb_present_only') {
    return !!ctx.contactSuburb && ctx.contactSuburb.trim() !== ''
  }
  return false
}

function normaliseSuburb(s: string): string {
  return s.trim().toLowerCase()
}

// ── Placeholder rendering
export interface RenderContext {
  first_name: string
  venue_name: string
  suburb: string
}

/** Render `{{first_name}}` / `{{venue_name}}` / `{{suburb}}` placeholders.
 * Unknown placeholders are left untouched. Missing context values fall back
 * to a sensible neutral substitute so cold opens never read like a broken
 * template. When `first_name` is empty we pick "team" if we know a venue
 * (cold-to-venue-inbox idiom — "Hi team,") and "there" otherwise. */
export function renderTemplate(template: string, ctx: RenderContext): string {
  const trimmedFirst = ctx.first_name?.trim() ?? ''
  const trimmedVenue = ctx.venue_name?.trim() ?? ''
  const safe = {
    first_name: trimmedFirst || (trimmedVenue ? 'team' : 'there'),
    venue_name: trimmedVenue || 'your venue',
    suburb: ctx.suburb?.trim() || 'the area',
  }
  return template.replace(/\{\{\s*(first_name|venue_name|suburb)\s*\}\}/g, (_m, key: string) => {
    return safe[key as keyof typeof safe] ?? ''
  })
}

/** Common generic mailbox-alias local-parts. When `full_name` is just one of
 * these (or has one of these as the bit before the em-dash that Outscraper
 * stamps on its scraped contacts), there is no useful real first name to
 * surface — the helper returns '' and the renderer falls back to "team". */
const GENERIC_MAILBOX_ALIASES: ReadonlySet<string> = new Set([
  'hello', 'info', 'bookings', 'enquiries', 'enquiry', 'reservations',
  'events', 'functions', 'admin', 'office', 'hi', 'hey', 'team', 'staff',
  'eat', 'dine', 'ciao', 'food', 'kitchen', 'bar', 'manager', 'gm', 'owner',
  'contact', 'customerservice', 'marketing', 'accounts', 'sales', 'support',
])

/** True when a token is so generic it cannot stand in for a first name.
 * Covers common venue-inbox aliases plus tokens with no letters at all
 * (digits, punctuation, the empty string). Case-insensitive. */
export function looksLikeGenericMailboxAlias(token: string | null | undefined): boolean {
  if (!token) return true
  const t = token.trim().toLowerCase()
  if (!t) return true
  if (!/[a-z]/.test(t)) return true
  return GENERIC_MAILBOX_ALIASES.has(t)
}

/** Extract the first name from a `full_name` string.
 *
 * Outscraper auto-stamps scraped contacts with `"<local-part> [—–-] <venue-name>"`
 * where `<local-part>` is the email's local-part (which may be a real first
 * name like "Sarah" or a generic mailbox alias like "hello"/"bookings"/"info").
 * We strip that preamble first so we evaluate only the alias, then fall back
 * to whitespace tokenisation for normal names. Returns '' whenever the result
 * would be a generic mailbox alias — the renderer will substitute "team". */
export function firstNameFromFullName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const trimmed = fullName.trim()
  if (!trimmed) return ''

  // Match "<alias> [—–-] <rest>" (em-dash, en-dash, hyphen — all three).
  // The dash MUST be whitespace-separated to avoid matching hyphenated names
  // like "Mary-Jane" or surnames like "O'Connor".
  const aliasPrefix = trimmed.match(/^([^\s—–-]+)\s+[—–-]\s+\S/)
  if (aliasPrefix) {
    const alias = aliasPrefix[1]
    return looksLikeGenericMailboxAlias(alias) ? '' : alias
  }

  const first = trimmed.split(/\s+/)[0]
  return looksLikeGenericMailboxAlias(first) ? '' : first
}

export const HOSPITALITY_VENUE_TYPES = HOSPITALITY_VENUE_TYPES_DEFAULT
