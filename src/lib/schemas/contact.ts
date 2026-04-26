import { z } from 'zod'

export const venueInlineSchema = z.object({
  name: z.string().min(1, 'Venue name is required'),
  venue_type: z.enum(['restaurant', 'cafe', 'hotel', 'event_space', 'bar', 'club', 'pub', 'qsr', 'function_centre', 'other']).optional(),
  address: z.string().optional(),
  suburb: z.string().optional(),
  state: z.string().optional(),
  postcode: z.string().optional(),
  website: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  cover_count: z.number().int().min(1).max(10000).optional().nullable(),
})

export const contactFormSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  role: z.enum(['venue_manager', 'owner', 'f_b_director', 'head_chef', 'events_manager']).optional(),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  linkedin_url: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  notes: z.string().optional(),
  venue_id: z.string().uuid().optional(),
  // When creating a new venue inline
  new_venue: venueInlineSchema.optional(),
})

export type ContactFormValues = z.infer<typeof contactFormSchema>
export type VenueInlineValues = z.infer<typeof venueInlineSchema>
