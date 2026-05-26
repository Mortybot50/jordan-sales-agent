import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

// ── Types ───────────────────────────────────────────────────────────

export type SourceEngine = 'outscraper' | 'google_places'

export type LeadSearchRunStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'partial'

export interface LeadSearch {
  id: string
  org_id: string
  user_id: string
  name: string
  region: string
  suburb: string | null
  categories: string[]
  source_engine: SourceEngine
  limit_per_run: number
  email_extraction: boolean
  schedule_cron: string | null
  last_run_at: string | null
  last_run_cost_usd: number | null
  last_run_result_count: number | null
  total_runs: number
  created_at: string | null
}

export interface LeadSearchRun {
  id: string
  search_id: string
  org_id: string
  started_at: string
  finished_at: string | null
  status: LeadSearchRunStatus | string
  result_count: number | null
  new_venue_count: number | null
  cost_usd: number | null
  error_message: string | null
}

export interface LeadSearchUpsert {
  name: string
  region: string
  suburb: string | null
  categories: string[]
  source_engine: SourceEngine
  limit_per_run: number
  email_extraction: boolean
  schedule_cron: string | null
}

// ── Read hooks ──────────────────────────────────────────────────────

export function useLeadSearches() {
  return useQuery({
    queryKey: ['lead-searches'],
    queryFn: async (): Promise<LeadSearch[]> => {
      const { data, error } = await supabase
        .from('lead_searches')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as LeadSearch[]
    },
  })
}

export function useLeadSearchRuns(searchId: string | null) {
  return useQuery({
    queryKey: ['lead-search-runs', searchId],
    queryFn: async (): Promise<LeadSearchRun[]> => {
      if (!searchId) return []
      const { data, error } = await supabase
        .from('lead_search_runs')
        .select('*')
        .eq('search_id', searchId)
        .order('started_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as LeadSearchRun[]
    },
    enabled: !!searchId,
  })
}

// ── Mutations ───────────────────────────────────────────────────────

export function useCreateLeadSearch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      org_id,
      user_id,
      payload,
    }: {
      org_id: string
      user_id: string
      payload: LeadSearchUpsert
    }): Promise<{ id: string }> => {
      const { data, error } = await supabase
        .from('lead_searches')
        .insert({
          org_id,
          user_id,
          name: payload.name,
          region: payload.region,
          suburb: payload.suburb,
          categories: payload.categories,
          source_engine: payload.source_engine,
          limit_per_run: payload.limit_per_run,
          email_extraction: payload.email_extraction,
          schedule_cron: payload.schedule_cron,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-searches'] })
      toast.success('Search created')
    },
    onError: (err: Error) =>
      toast.error(`Couldn't create search: ${err.message}`),
  })
}

export function useUpdateLeadSearch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string
      payload: LeadSearchUpsert
    }) => {
      const { error } = await supabase
        .from('lead_searches')
        .update({
          name: payload.name,
          region: payload.region,
          suburb: payload.suburb,
          categories: payload.categories,
          source_engine: payload.source_engine,
          limit_per_run: payload.limit_per_run,
          email_extraction: payload.email_extraction,
          schedule_cron: payload.schedule_cron,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-searches'] })
      toast.success('Search saved')
    },
    onError: (err: Error) =>
      toast.error(`Couldn't save search: ${err.message}`),
  })
}

export function useDeleteLeadSearch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('lead_searches')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-searches'] })
      toast.success('Search deleted')
    },
    onError: (err: Error) =>
      toast.error(`Couldn't delete search: ${err.message}`),
  })
}

export interface RunLeadSearchResult {
  venues_added: number
  contacts_added: number
  run_id: string
}

export function useRunLeadSearch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (searchId: string): Promise<RunLeadSearchResult> => {
      const { data, error } = await supabase.functions.invoke<
        RunLeadSearchResult & { error?: string }
      >('discover-leads', {
        body: { search_id: searchId },
      })
      if (error) throw error
      if (!data) throw new Error('No response from discover-leads')
      if ('error' in data && data.error) throw new Error(data.error)
      return data
    },
    onSuccess: (_data, searchId) => {
      qc.invalidateQueries({ queryKey: ['lead-searches'] })
      qc.invalidateQueries({ queryKey: ['lead-search-runs', searchId] })
    },
    onError: (err: Error) => toast.error(`Run failed: ${err.message}`),
  })
}
