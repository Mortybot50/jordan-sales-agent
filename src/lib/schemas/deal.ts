import { z } from 'zod'

// Hard ceiling on every monetary column on deals, enforced both client-side
// (this schema) and in the database via migration 20260605113000. Hospitality
// cold-outreach deals top out well under $200k — $1M leaves >5x headroom for
// any imaginable multi-year package and still catches the "$5,000 → $5,000,000"
// typo class (the prior $1T ceiling was vestigial from a 26/04 seed test).
export const DEAL_VALUE_MAX = 1_000_000
// Soft "are you sure?" threshold; above this the form surfaces a confirm dialog.
export const DEAL_VALUE_WARN = 100_000

export const dealFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  contact_id: z.string().uuid().optional(),
  stage_id: z.string().uuid('Stage is required'),
  contract_value: z
    .number()
    .min(0, 'Value must be positive')
    .max(DEAL_VALUE_MAX, 'Deal value seems unusually high for hospitality outreach (max $1,000,000) — double-check the figure before saving')
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
}).superRefine((v, ctx) => {
  // The DB caps acv/tcv at DEAL_VALUE_MAX (migration 20260605113000). Package
  // deals derive acv = weekly*52 and tcv = acv*term/12, so a large weekly_price
  // or long term can blow past the ceiling and pass this form but fail the DB
  // insert. Enforce the same ceiling on the derived figures up front.
  const acv = v.weekly_price * 52
  const tcv = (acv * v.term_months) / 12
  if (acv > DEAL_VALUE_MAX || tcv > DEAL_VALUE_MAX) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['weekly_price'],
      message: `This package computes to $${Math.round(Math.max(acv, tcv)).toLocaleString()} — above the $${DEAL_VALUE_MAX.toLocaleString()} ceiling. Double-check the weekly price and term.`,
    })
  }
})

export type PackageDealValues = z.infer<typeof packageDealSchema>
