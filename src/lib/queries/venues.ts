import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export interface Venue {
  id: string
  org_id: string
  name: string
  google_place_id: string | null
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  website: string | null
  phone: string | null
  venue_type: string | null
  service_style: string | null
  cover_count: number | null
  kitchen_type: string | null
  competitor_water_usage: string | null
  licensing_status: string | null
  seasonality_window: string | null
  icp_score: number | null
  source: string | null
  is_excluded: boolean | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export function useVenues() {
  return useQuery({
    queryKey: ['venues'],
    queryFn: async (): Promise<Venue[]> => {
      const { data, error } = await supabase
        .from('venues')
        .select('*')
        .order('name')

      if (error) throw error
      return data ?? []
    },
  })
}

export interface CreateVenueInput {
  org_id: string
  name: string
  venue_type?: string
  address?: string
  website?: string
  cover_count?: number | null
}

export function useCreateVenue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateVenueInput) => {
      const { data, error } = await supabase
        .from('venues')
        .insert({
          org_id: input.org_id,
          name: input.name,
          venue_type: input.venue_type ?? null,
          address: input.address ?? null,
          website: input.website || null,
          cover_count: input.cover_count ?? null,
          source: 'manual',
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] })
    },
    onError: (err: Error) => {
      toast.error(`Failed to create venue: ${err.message}`)
    },
  })
}
