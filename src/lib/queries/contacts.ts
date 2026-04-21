import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export interface Contact {
  id: string
  org_id: string
  venue_id: string | null
  full_name: string
  role: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  is_primary: boolean | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
  venue?: {
    id: string
    name: string
    venue_type: string | null
    address: string | null
    suburb: string | null
    website: string | null
    cover_count: number | null
  } | null
  lead_score?: {
    score: number
    tier: 'hot' | 'warm' | 'cold'
  } | null
}

export function scoreToTier(score: number | null | undefined): 'hot' | 'warm' | 'cold' {
  if (score == null) return 'cold'
  if (score >= 80) return 'hot'
  if (score >= 50) return 'warm'
  return 'cold'
}

export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: async (): Promise<Contact[]> => {
      const { data, error } = await supabase
        .from('contacts')
        .select(`
          *,
          venue:venues(id, name, venue_type, address, suburb, website, cover_count)
        `)
        .order('full_name')

      if (error) throw error

      // Fetch latest lead scores for all deals linked to these contacts
      const contactIds = (data ?? []).map((c) => c.id)
      let scoreMap: Record<string, { score: number; tier: 'hot' | 'warm' | 'cold' }> = {}

      if (contactIds.length > 0) {
        const { data: deals } = await supabase
          .from('deals')
          .select('contact_id, id')
          .in('contact_id', contactIds)

        if (deals && deals.length > 0) {
          const dealIds = deals.map((d) => d.id)
          const { data: scores } = await supabase
            .from('lead_scores')
            .select('deal_id, score, tier, scored_at')
            .in('deal_id', dealIds)
            .order('scored_at', { ascending: false })

          if (scores) {
            // Latest score per deal
            const latestByDeal: Record<string, typeof scores[0]> = {}
            for (const s of scores) {
              if (s.deal_id && !latestByDeal[s.deal_id]) {
                latestByDeal[s.deal_id] = s
              }
            }
            // Map back to contact
            for (const deal of deals) {
              if (deal.contact_id && deal.id && latestByDeal[deal.id]) {
                const s = latestByDeal[deal.id]
                const existing = scoreMap[deal.contact_id]
                if (!existing || s.score > existing.score) {
                  scoreMap[deal.contact_id] = { score: s.score, tier: s.tier as 'hot' | 'warm' | 'cold' }
                }
              }
            }
          }
        }
      }

      return (data ?? []).map((c) => ({
        ...c,
        lead_score: scoreMap[c.id] ?? null,
      }))
    },
  })
}

export function useContact(id: string) {
  return useQuery({
    queryKey: ['contacts', id],
    queryFn: async (): Promise<Contact | null> => {
      const { data, error } = await supabase
        .from('contacts')
        .select(`
          *,
          venue:venues(id, name, venue_type, address, suburb, postcode, website, cover_count, phone, notes, licence_type, avg_spend_tier, neighbourhood, kitchen_type, competitor_water_usage, licensing_status, seasonality_window)
        `)
        .eq('id', id)
        .maybeSingle()

      if (error) throw error
      return data as unknown as Contact | null
    },
    enabled: !!id,
  })
}

export interface CreateContactInput {
  first_name: string
  last_name: string
  role?: string
  email?: string
  phone?: string
  linkedin_url?: string
  notes?: string
  venue_id?: string
  org_id: string
}

export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateContactInput) => {
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          org_id: input.org_id,
          full_name: `${input.first_name} ${input.last_name}`.trim(),
          role: input.role ?? null,
          email: input.email || null,
          phone: input.phone || null,
          linkedin_url: input.linkedin_url || null,
          notes: input.notes || null,
          venue_id: input.venue_id ?? null,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success('Contact created')
    },
    onError: (err: Error) => {
      toast.error(`Failed to create contact: ${err.message}`)
    },
  })
}

export function useUpdateContact(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (updates: Partial<Omit<Contact, 'id' | 'org_id' | 'created_at'>>) => {
      const { venue: _venue, lead_score: _ls, ...dbUpdates } = updates
      const { data, error } = await supabase
        .from('contacts')
        .update({ ...dbUpdates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contacts', id] })
      toast.success('Contact updated')
    },
    onError: (err: Error) => {
      toast.error(`Failed to update: ${err.message}`)
    },
  })
}
