import { z } from 'zod'

export const profileFormSchema = z.object({
  full_name: z.string().min(1, 'Name is required'),
  calendly_url: z.string().url('Enter a valid Calendly URL').optional().or(z.literal('')),
  email_signature: z.string().optional(),
})

export const icpFormSchema = z.object({
  venue_types: z.array(z.string()).optional(),
  excluded_types: z.array(z.string()).optional(),
  cover_count_min: z.number().int().min(0).optional().nullable(),
  cover_count_max: z.number().int().min(0).optional().nullable(),
  suburbs: z.array(z.string()).optional(),
  licence_types: z.array(z.string()).optional(),
  avg_spend_tiers: z.array(z.string()).optional(),
  // Legacy fields kept for backward compatibility
  min_cover_count: z.number().int().min(0).optional().nullable(),
  max_cover_count: z.number().int().min(0).optional().nullable(),
  geo_radius_km: z.number().min(0).max(500).optional().nullable(),
  geo_postcode: z.string().optional(),
})

export type ProfileFormValues = z.infer<typeof profileFormSchema>
export type IcpFormValues = z.infer<typeof icpFormSchema>
