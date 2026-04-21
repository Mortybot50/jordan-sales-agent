import { z } from 'zod'

export const venueFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  venue_type: z.enum(['restaurant', 'cafe', 'hotel', 'event_space', 'bar', 'club', 'pub', 'qsr', 'function_centre', 'other']).optional(),
  address: z.string().optional(),
  suburb: z.string().optional(),
  postcode: z.string().optional(),
  website: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  phone: z.string().optional(),
  cover_count: z.coerce.number().int().min(1).max(10000).optional().nullable(),
  notes: z.string().optional(),
})

export type VenueFormValues = z.infer<typeof venueFormSchema>
