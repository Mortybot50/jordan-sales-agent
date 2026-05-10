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
 * to a sensible neutral substitute (e.g. "there" for first_name) so cold
 * opens never read like a broken template. */
export function renderTemplate(template: string, ctx: RenderContext): string {
  const safe = {
    first_name: ctx.first_name?.trim() || 'there',
    venue_name: ctx.venue_name?.trim() || 'your venue',
    suburb: ctx.suburb?.trim() || 'the area',
  }
  return template.replace(/\{\{\s*(first_name|venue_name|suburb)\s*\}\}/g, (_m, key: string) => {
    return safe[key as keyof typeof safe] ?? ''
  })
}

/** Convenience helper — extract the first token of a full name. */
export function firstNameFromFullName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const trimmed = fullName.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0]
}

export const HOSPITALITY_VENUE_TYPES = HOSPITALITY_VENUE_TYPES_DEFAULT
