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
  metadata: Record<string, unknown> | null | undefined
  do_not_contact: boolean
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
  tags?: string[]
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

      // Tags — fetch all and group by contact_id
      const tagMap: Record<string, string[]> = {}
      if (contactIds.length > 0) {
        const { data: tagRows } = await supabase
          .from('contact_tags')
          .select('contact_id, tag')
          .in('contact_id', contactIds)
        if (tagRows) {
          for (const t of tagRows) {
            const arr = tagMap[t.contact_id] ?? (tagMap[t.contact_id] = [])
            arr.push(t.tag)
          }
        }
      }

      return (data ?? []).map((c) => ({
        ...c,
        lead_score: scoreMap[c.id] ?? null,
        tags: tagMap[c.id] ?? [],
      })) as Contact[]
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

/* ── Bulk actions ──────────────────────────────────────────────── */

/**
 * Tag-name validation — lowercase, 1-30 chars, alphanumeric + dashes.
 * Mirrors the contact_tags_tag_format CHECK constraint in the database.
 */
export function isValidTag(tag: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,29}$/.test(tag)
}

export function useBulkDeleteContacts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0
      const { error } = await supabase.from('contacts').delete().in('id', ids)
      if (error) throw error
      return ids.length
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success(`Deleted ${count} contact${count === 1 ? '' : 's'}.`)
    },
    onError: (err: Error) => toast.error(`Bulk delete failed: ${err.message}`),
  })
}

export function useBulkSetDnc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, value }: { ids: string[]; value: boolean }) => {
      if (ids.length === 0) return 0
      const { error } = await supabase
        .from('contacts')
        .update({ do_not_contact: value, updated_at: new Date().toISOString() })
        .in('id', ids)
      if (error) throw error
      return ids.length
    },
    onSuccess: (count, vars) => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success(
        vars.value
          ? `Marked ${count} as DNC.`
          : `Cleared DNC on ${count} contact${count === 1 ? '' : 's'}.`,
      )
    },
    onError: (err: Error) => toast.error(`Bulk DNC failed: ${err.message}`),
  })
}

interface BulkTagInput {
  org_id: string
  ids: string[]
  tag: string
}

export function useBulkTagContacts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: BulkTagInput) => {
      const tag = input.tag.trim().toLowerCase()
      if (!isValidTag(tag)) {
        throw new Error('Tag must be lowercase, 1-30 chars, letters/numbers/dashes only.')
      }
      if (input.ids.length === 0) return { tag, count: 0 }
      const rows = input.ids.map((contact_id) => ({
        org_id: input.org_id,
        contact_id,
        tag,
      }))
      // ON CONFLICT DO NOTHING via upsert + ignoreDuplicates.
      const { error } = await supabase
        .from('contact_tags')
        .upsert(rows, { onConflict: 'org_id,contact_id,tag', ignoreDuplicates: true })
      if (error) throw error
      return { tag, count: input.ids.length }
    },
    onSuccess: ({ tag, count }) => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contact-tags', 'distinct'] })
      toast.success(`Tagged ${count} contact${count === 1 ? '' : 's'} as ${tag}.`)
    },
    onError: (err: Error) => toast.error(`Tagging failed: ${err.message}`),
  })
}

/**
 * Distinct tags currently in use for the user's org.
 * Used to render the tag-pill filter strip + tag suggestions.
 */
export function useDistinctContactTags() {
  return useQuery({
    queryKey: ['contact-tags', 'distinct'],
    queryFn: async (): Promise<Array<{ tag: string; count: number }>> => {
      const { data, error } = await supabase
        .from('contact_tags')
        .select('tag')
      if (error) throw error
      const counts = new Map<string, number>()
      for (const r of data ?? []) {
        counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1)
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => ({ tag, count }))
    },
  })
}

export function useUpdateContact(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (updates: Partial<Omit<Contact, 'id' | 'org_id' | 'created_at'>>) => {
      const { venue: _venue, lead_score: _ls, tags: _tags, ...dbUpdates } = updates
      const { data, error } = await supabase
        .from('contacts')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ ...dbUpdates, updated_at: new Date().toISOString() } as any)
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
