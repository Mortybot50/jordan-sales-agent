import { z } from 'zod'

/**
 * Form schema for creating / editing a venue_groups row.
 *
 * ABN is loosely validated (digits + optional spaces, 11 digits when stripped)
 * so the field stays helpful for Jordan typing it from a business card without
 * being strict enough to reject perfectly valid corporate group names that
 * don't have an ABN to hand.
 */
export const venueGroupFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the group a name')
    .max(120, 'Keep the name under 120 characters'),
  abn: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .optional()
    .refine(
      (v) => {
        if (!v) return true
        const digits = v.replace(/\s+/g, '')
        return /^\d{11}$/.test(digits)
      },
      { message: 'ABN should be 11 digits' },
    ),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export type VenueGroupFormValues = z.infer<typeof venueGroupFormSchema>

export const DEFAULT_VENUE_GROUP_FORM_VALUES: VenueGroupFormValues = {
  name: '',
  abn: null,
  notes: null,
}
