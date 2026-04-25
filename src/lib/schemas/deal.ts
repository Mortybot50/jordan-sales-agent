import { z } from 'zod'

export const dealFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  contact_id: z.string().uuid().optional(),
  stage_id: z.string().uuid('Stage is required'),
  contract_value: z.number().min(0, 'Value must be positive').optional(),
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
