import { z } from 'zod'

export const profileFormSchema = z.object({
  full_name: z.string().min(1, 'Name is required'),
  calendly_url: z.string().url('Enter a valid Calendly URL').optional().or(z.literal('')),
  email_signature: z.string().optional(),
})

export const icpFormSchema = z.object({
  venue_types: z.array(z.string()).optional(),
  excluded_types: z.array(z.string()).optional(),
  min_cover_count: z.number().int().min(0).optional().nullable(),
  max_cover_count: z.number().int().min(0).optional().nullable(),
  geo_radius_km: z.number().min(0).max(500).optional().nullable(),
  geo_postcode: z.string().optional(),
})

export type ProfileFormValues = z.infer<typeof profileFormSchema>
export type IcpFormValues = z.infer<typeof icpFormSchema>
