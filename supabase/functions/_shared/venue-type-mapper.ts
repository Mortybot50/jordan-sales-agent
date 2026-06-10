/**
 * Maps Outscraper / Google Places category strings to the constrained
 * `venues.venue_type` enum.
 *
 * Used by:
 *   - `discover-leads` (when inserting a new venue from a sourcing run)
 *   - the backfill migration (mirrored in SQL — keep both in sync if you
 *     change the priority order)
 *
 * The DB CHECK constraint (see migration 20260421000003_week2_additions.sql)
 * allows these 10 values only:
 *   restaurant, cafe, hotel, event_space, bar, club, pub, qsr,
 *   function_centre, other
 *
 * The mapper deliberately returns `null` instead of `'other'` for unknown
 * categories, so the canonical sequence's "venue_suburb_present_only" safety
 * net (see sequence-tick/templates.ts) still picks Variant A on suburb alone.
 */

export type VenueType =
  | 'restaurant'
  | 'cafe'
  | 'hotel'
  | 'event_space'
  | 'bar'
  | 'club'
  | 'pub'
  | 'qsr'
  | 'function_centre'
  | 'other'

interface MapperRule {
  /** Lowercase substring to look for in the joined category blob. */
  needle: string
  type: VenueType
}

/**
 * Priority-ordered rule list. First match wins.
 *
 * Ordering rationale:
 *   - Specific bar variants (wine/cocktail/sports) first — they collapse to
 *     `bar` anyway, but listing them up top documents intent.
 *   - Generic `bar` is placed BEFORE the restaurant rules so an Outscraper
 *     blob like "Italian restaurant and pizza bar" classifies as `bar`. The
 *     hospitality cold-send variant rules treat bars as the canonical
 *     walk-by case, so it's the safer default for ambiguous venues.
 *   - `gastropub` and `irish pub` precede generic `pub` so they classify
 *     consistently even though both targets are `pub` (no behavioural
 *     difference, but the explicit listing aids future re-mappings).
 *   - `nightclub` (one word) and `night club` (two words) both listed.
 *   - `coffee shop` precedes `coffee` so the more specific category wins
 *     even though both target `cafe`.
 *   - `event venue` / `wedding venue` / etc. map to `function_centre`
 *     because that's how Jordan wants the variant rules to treat them.
 *     `event space` (different word) maps to `event_space`.
 *
 * Matching uses TOKEN-BOUNDARY substring lookup (Unicode-aware): the needle
 * must be either at the start of the haystack or preceded by a non-letter /
 * non-digit character, and followed by the same. This avoids false positives
 * such as `"dinner restaurant"` matching the `inn` rule or
 * `"barber shop"` matching the `bar` rule, while still being lenient about
 * surrounding whitespace, punctuation, and Outscraper's "|" delimiter.
 */
const RULES: ReadonlyArray<MapperRule> = [
  // ── Bar variants (specific → generic) ─────────────────────────────
  { needle: 'wine bar', type: 'bar' },
  { needle: 'cocktail bar', type: 'bar' },
  { needle: 'sports bar', type: 'bar' },

  // ── Generic 'bar' — placed BEFORE restaurant so ambiguous "X and Y
  //     bar" venues classify as bar (see ordering rationale above) ──
  { needle: 'bar', type: 'bar' },

  // ── Pub variants ──────────────────────────────────────────────────
  { needle: 'gastropub', type: 'pub' },
  { needle: 'irish pub', type: 'pub' },
  { needle: 'pub', type: 'pub' },

  // ── Hotel / lodging ───────────────────────────────────────────────
  { needle: 'hotel', type: 'hotel' },
  { needle: 'inn', type: 'hotel' },

  // ── Club / nightclub ──────────────────────────────────────────────
  { needle: 'nightclub', type: 'club' },
  { needle: 'night club', type: 'club' },
  { needle: 'club', type: 'club' },

  // ── Cafe / coffee ─────────────────────────────────────────────────
  { needle: 'coffee shop', type: 'cafe' },
  { needle: 'café', type: 'cafe' },
  { needle: 'cafe', type: 'cafe' },
  { needle: 'coffee', type: 'cafe' },

  // ── QSR / fast food ───────────────────────────────────────────────
  { needle: 'fast food restaurant', type: 'qsr' },
  { needle: 'fast food', type: 'qsr' },
  { needle: 'qsr', type: 'qsr' },
  { needle: 'takeaway', type: 'qsr' },
  { needle: 'take-out', type: 'qsr' },

  // ── Restaurant variants ───────────────────────────────────────────
  { needle: 'pizza restaurant', type: 'restaurant' },
  { needle: 'italian restaurant', type: 'restaurant' },
  { needle: 'mexican restaurant', type: 'restaurant' },
  { needle: 'asian restaurant', type: 'restaurant' },
  { needle: 'restaurant', type: 'restaurant' },

  // ── Function centre / wedding venue ───────────────────────────────
  { needle: 'wedding venue', type: 'function_centre' },
  { needle: 'event venue', type: 'function_centre' },
  { needle: 'function centre', type: 'function_centre' },
  { needle: 'function center', type: 'function_centre' },
  { needle: 'banquet hall', type: 'function_centre' },

  // ── Event space / meeting / conference ────────────────────────────
  { needle: 'event space', type: 'event_space' },
  { needle: 'meeting room', type: 'event_space' },
  { needle: 'conference centre', type: 'event_space' },
]

/**
 * Classify a venue based on one or more category strings.
 *
 * Accepts the full set of category signals available — typically:
 *   - `category` (Outscraper primary, Google Places `types[0]`)
 *   - `subtypes` (Outscraper secondary, possibly comma-separated)
 *   - `place_types` (Google Places full array)
 *
 * All non-empty strings are joined into one search blob (lowercased) and
 * the rules are tried in priority order. Returns null if no rule matches,
 * so callers can leave `venue_type` null and let the suburb-only safety
 * net handle the variant selection.
 */
export function classifyVenueType(
  categories: ReadonlyArray<string | null | undefined>,
): VenueType | null {
  if (!categories || categories.length === 0) return null

  // Lowercase + join with " | " between sources. Also collapse underscores
  // to spaces so Google Places snake_case types (`night_club`,
  // `fast_food_restaurant`, `meal_takeaway`) match the same multi-word
  // needles as the Outscraper user-facing strings. The SQL backfill
  // migration mirrors this normalisation.
  const haystack = categories
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .map((c) => c.toLowerCase().replace(/_/g, ' '))
    .join(' | ')

  if (!haystack) return null

  for (const rule of RULES) {
    if (matchesNeedle(haystack, rule.needle)) return rule.type
  }

  return null
}

/** Token-boundary substring match. The needle must start/end on a non-letter,
 * non-digit boundary (or string boundary). Iterates all occurrences so a
 * later match still wins if the first happens to overlap a longer word
 * (e.g. "barber shop and bar" → "bar" matches at the trailing position). */
function matchesNeedle(haystack: string, needle: string): boolean {
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx < 0) return false
    const before = idx > 0 ? haystack[idx - 1] : null
    const after = idx + needle.length < haystack.length
      ? haystack[idx + needle.length]
      : null
    if (
      (before === null || !isWordChar(before)) &&
      (after === null || !isWordChar(after))
    ) {
      return true
    }
    from = idx + 1
  }
}

function isWordChar(c: string): boolean {
  return /[\p{L}\p{N}]/u.test(c)
}

/** Convenience overload — classify a single category string. */
export function classifyVenueTypeFromCategory(
  category: string | null | undefined,
): VenueType | null {
  return classifyVenueType([category])
}
