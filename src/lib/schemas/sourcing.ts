import { z } from 'zod'
import { HOSPITALITY_CATEGORIES } from '@/lib/constants/hospitality-categories'
import { isValidCron } from '@/lib/cron/match'

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
    .trim()
    .min(1, 'Give the search a name')
    .max(120, 'Keep the name under 120 characters'),
  source_engine: z.enum(['outscraper', 'google_places']),
  region: z.string().trim().min(1, 'Region is required').max(60),
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
    .optional()
    .refine(
      (v) => v == null || v.trim() === '' || isValidCron(v),
      'Cron expression must be 5 space-separated fields (e.g. 0 20 * * *)',
    ),
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
 * Schedule preset pills shown in the form.
 *
 * pg_cron interprets schedules in UTC. The labels here describe the UTC
 * fire time (6am UTC ≈ 4pm AEST winter / 5pm AEDT summer). If Jordan
 * wants strict Melbourne-morning runs he uses the custom cron field
 * (e.g. `0 20 * * *` for 06:00 AEST = 20:00 UTC prev day). Keeping
 * presets UTC-anchored avoids DST drift and matches the cron strings
 * the codebase has already shipped via PR #75.
 */
export const SCHEDULE_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Daily 6am UTC', cron: '0 6 * * *' },
  { label: 'Weekly Mon 6am UTC', cron: '0 6 * * 1' },
  { label: 'Weekly Mon+Thu 6am UTC', cron: '0 6 * * 1,4' },
  { label: 'Monthly 1st 6am UTC', cron: '0 6 1 * *' },
]
