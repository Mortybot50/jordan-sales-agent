import { z } from 'zod'
import { HOSPITALITY_CATEGORIES } from '@/lib/constants/hospitality-categories'

/**
 * Form schema for creating / editing a lead_searches row.
 *
 * Multi-suburb is captured client-side as `string[]` for UX (tag chips),
 * then joined with ", " on save into the single TEXT `suburb` column
 * (Option B — see PR description). discover-leads treats the column as
 * one phrase appended to the query string.
 */
export const sourcingFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Give the search a name')
    .max(120, 'Keep the name under 120 characters'),
  source_engine: z.enum(['outscraper', 'google_places']),
  region: z.string().min(1, 'Region is required').max(60),
  suburbs: z
    .array(z.string().min(1).max(60))
    .max(20, 'Max 20 suburbs per search'),
  categories: z
    .array(z.enum(HOSPITALITY_CATEGORIES))
    .min(1, 'Pick at least one category')
    .max(HOSPITALITY_CATEGORIES.length),
  limit_per_run: z.coerce
    .number()
    .int()
    .min(10, 'Minimum 10 per run')
    .max(5000, 'Maximum 5000 per run'),
  email_extraction: z.boolean(),
  schedule_cron: z
    .string()
    .max(120)
    .nullable()
    .optional(),
})

export type SourcingFormValues = z.infer<typeof sourcingFormSchema>

export const DEFAULT_SOURCING_FORM_VALUES: SourcingFormValues = {
  name: '',
  source_engine: 'outscraper',
  region: 'Victoria',
  suburbs: [],
  categories: [],
  limit_per_run: 1000,
  email_extraction: true,
  schedule_cron: null,
}

/**
 * Schedule preset pills shown in the form. The cron strings target
 * Australia/Melbourne wall-clock time the same way the rest of the
 * platform does — though cron itself is interpreted in UTC by
 * pg_cron, scheduling is deferred to a follow-up PR (no cron worker
 * for `lead_searches.schedule_cron` exists yet). Storing the value
 * means we don't have to migrate later.
 */
export const SCHEDULE_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Daily 6am', cron: '0 6 * * *' },
  { label: 'Weekly Mon 6am', cron: '0 6 * * 1' },
  { label: 'Monthly 1st 6am', cron: '0 6 1 * *' },
]
