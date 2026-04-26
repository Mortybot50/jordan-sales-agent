import { z } from 'zod'

// Matches the numeric(14,2) ceiling on deals.contract_value (and sibling money columns)
// after migration 20260426000007. Fits ~$1T per deal — a real $9.9M typo with an extra
// zero ($99M) clears the column without overflow. Above this the form should bail before
// the round-trip rather than 500.
export const DEAL_VALUE_MAX = 999_999_999_999.99
// Soft "are you sure?" threshold; above this, surface a confirmation toast/dialog in the form.
export const DEAL_VALUE_WARN = 50_000_000

export const dealFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  contact_id: z.string().uuid().optional(),
  stage_id: z.string().uuid('Stage is required'),
  contract_value: z
    .number()
    .min(0, 'Value must be positive')
    .max(DEAL_VALUE_MAX, 'Value exceeds the maximum supported amount')
    .optional(),
  follow_up_due: z.string().optional(),
  notes: z.string().optional(),
})

export const dealEditSchema = dealFormSchema

export type DealFormValues = z.infer<typeof dealFormSchema>

const TERM_VALUES = [12, 24, 36, 48, 60] as const
const BRAND_VALUES = ['purezza', 'culligan', 'zip'] as const

export const packageDealSchema = z.object({
  brand: z.enum(BRAND_VALUES, { message: 'Brand is required' }),
  product_id: z.string().uuid('Package is required'),
  term_months: z.number().refine((n) => (TERM_VALUES as readonly number[]).includes(n), {
    message: 'Term must be 12, 24, 36, 48, or 60 months',
  }),
  weekly_price: z.number().min(0.01, 'Weekly price must be positive'),
  commission_pct: z
    .number()
    .min(0, 'Commission must be ≥ 0')
    .max(100, 'Commission cannot exceed 100%'),
  stage_id: z.string().uuid('Stage is required'),
  title: z.string().min(1, 'Title is required'),
  follow_up_due: z.string().optional(),
  notes: z.string().optional(),
})

export type PackageDealValues = z.infer<typeof packageDealSchema>
