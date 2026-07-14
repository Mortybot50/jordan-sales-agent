/**
 * Shared field-visit outcome enum + label list.
 *
 * Used by FieldPage (`/field`) and RoutePage (`/route` mark-visited drawer)
 * so both surfaces stay in sync with the DB check constraint on
 * `field_visits.outcome`.
 */

export type FieldOutcome =
  | 'interested'
  | 'not_now'
  | 'closed'
  | 'not_in'
  | 'dm_absent'
  | 'collected_email'
  | 'other'

export const FIELD_OUTCOME_OPTIONS: Array<{ value: FieldOutcome; label: string }> = [
  { value: 'interested', label: 'Interested' },
  { value: 'not_now', label: 'Not now' },
  { value: 'closed', label: 'Closed/quiet' },
  { value: 'not_in', label: 'Not in' },
  { value: 'dm_absent', label: 'DM absent' },
  { value: 'collected_email', label: 'Got email' },
  { value: 'other', label: 'Other' },
]

const OUTCOME_LABELS = Object.fromEntries(
  FIELD_OUTCOME_OPTIONS.map((o) => [o.value, o.label]),
) as Record<FieldOutcome, string>

/** Human-readable label for a stored outcome value. */
export function outcomeLabel(o: FieldOutcome | string | null | undefined): string {
  if (!o) return ''
  return OUTCOME_LABELS[o as FieldOutcome] ?? String(o).replace(/_/g, ' ')
}
