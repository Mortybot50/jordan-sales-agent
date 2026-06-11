import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normaliseEmail, isValidEmail, isValidDomain } from '@/lib/suppression'

export type SuppressionReason =
  | 'bounce_hard'
  | 'bounce_soft'
  | 'unsubscribe'
  | 'spam_complaint'
  | 'manual_exclude'

export type SuppressionSource =
  | 'sendgrid_webhook'
  | 'instantly_webhook'
  | 'manual'
  | 'manual_single'
  | 'manual_bulk'
  | 'manual_csv'
  | 'manual_domain'

export interface SuppressionEntry {
  id: string
  org_id: string
  email: string
  reason: SuppressionReason
  source: SuppressionSource | null
  notes: string | null
  added_by_user_id: string | null
  domain_suppression: boolean
  suppressed_at: string | null
}

// PostgREST caps a single select at 1000 rows. The list view shows the most
// recent 1000; headline counts come from useSuppressionCounts (exact, head-only)
// so the displayed total never silently understates the real list size.
export const SUPPRESSION_LIST_DISPLAY_CAP = 1000

export function useSuppressionList() {
  return useQuery({
    queryKey: ['suppression-list'],
    queryFn: async (): Promise<SuppressionEntry[]> => {
      const { data, error } = await supabase
        .from('suppression_list')
        .select(
          'id, org_id, email, reason, source, notes, added_by_user_id, domain_suppression, suppressed_at'
        )
        .order('suppressed_at', { ascending: false })
        .limit(SUPPRESSION_LIST_DISPLAY_CAP)

      if (error) throw error
      return (data ?? []) as SuppressionEntry[]
    },
  })
}

export function useSuppressionCounts() {
  return useQuery({
    queryKey: ['suppression-counts'],
    queryFn: async (): Promise<{ total: number; manual: number }> => {
      const [total, manual] = await Promise.all([
        supabase.from('suppression_list').select('id', { count: 'exact', head: true }),
        supabase
          .from('suppression_list')
          .select('id', { count: 'exact', head: true })
          .eq('reason', 'manual_exclude'),
      ])
      if (total.error) throw total.error
      if (manual.error) throw manual.error
      return { total: total.count ?? 0, manual: manual.count ?? 0 }
    },
  })
}

interface AddOneInput {
  org_id: string
  user_id: string
  email: string
  notes?: string | null
}

export function useAddSuppressionEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddOneInput) => {
      const email = normaliseEmail(input.email)
      if (!isValidEmail(email)) throw new Error('Invalid email address')

      const { error } = await supabase.from('suppression_list').insert({
        org_id: input.org_id,
        email,
        reason: 'manual_exclude',
        source: 'manual_single',
        notes: input.notes ?? null,
        added_by_user_id: input.user_id,
        domain_suppression: false,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppression-list'] })
      qc.invalidateQueries({ queryKey: ['suppression-counts'] })
      toast.success('Added to suppression list')
    },
    onError: (err: Error) => toast.error(`Failed to add: ${err.message}`),
  })
}

interface AddDomainInput {
  org_id: string
  user_id: string
  domain: string
  notes?: string | null
}

export function useAddSuppressionDomain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddDomainInput) => {
      const domain = input.domain.trim().toLowerCase().replace(/^@/, '')
      if (!isValidDomain(domain)) throw new Error('Invalid domain (e.g. puretu.com)')

      const { error } = await supabase.from('suppression_list').insert({
        org_id: input.org_id,
        email: domain,
        reason: 'manual_exclude',
        source: 'manual_domain',
        notes: input.notes ?? null,
        added_by_user_id: input.user_id,
        domain_suppression: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppression-list'] })
      qc.invalidateQueries({ queryKey: ['suppression-counts'] })
      toast.success('Domain suppressed')
    },
    onError: (err: Error) => toast.error(`Failed to add domain: ${err.message}`),
  })
}

interface BulkInput {
  org_id: string
  user_id: string
  rows: Array<{ email: string; notes?: string | null }>
  source: Extract<SuppressionSource, 'manual_bulk' | 'manual_csv'>
}

export interface BulkAddResult {
  inserted: number
  skippedInvalid: number
  skippedDuplicate: number
  totalParsed: number
}

export function useBulkAddSuppression() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: BulkInput): Promise<BulkAddResult> => {
      const seen = new Set<string>()
      const valid: Array<{ email: string; notes: string | null }> = []
      let skippedInvalid = 0

      for (const r of input.rows) {
        const normalised = normaliseEmail(r.email)
        if (!isValidEmail(normalised)) {
          skippedInvalid++
          continue
        }
        if (seen.has(normalised)) continue
        seen.add(normalised)
        valid.push({ email: normalised, notes: r.notes ?? null })
      }

      if (valid.length === 0) {
        return {
          inserted: 0,
          skippedInvalid,
          skippedDuplicate: input.rows.length - skippedInvalid,
          totalParsed: input.rows.length,
        }
      }

      // Pre-fetch existing emails for this org so we can report duplicates
      const { data: existing } = await supabase
        .from('suppression_list')
        .select('email')
        .eq('org_id', input.org_id)
        .in('email', valid.map((v) => v.email))

      const existingSet = new Set((existing ?? []).map((e) => e.email))
      const toInsert = valid
        .filter((v) => !existingSet.has(v.email))
        .map((v) => ({
          org_id: input.org_id,
          email: v.email,
          reason: 'manual_exclude' as const,
          source: input.source,
          notes: v.notes,
          added_by_user_id: input.user_id,
          domain_suppression: false,
        }))

      if (toInsert.length > 0) {
        const { error } = await supabase.from('suppression_list').insert(toInsert)
        if (error) throw error
      }

      return {
        inserted: toInsert.length,
        skippedInvalid,
        skippedDuplicate: valid.length - toInsert.length + (input.rows.length - valid.length - skippedInvalid),
        totalParsed: input.rows.length,
      }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['suppression-list'] })
      qc.invalidateQueries({ queryKey: ['suppression-counts'] })
      toast.success(
        `Added ${result.inserted} — ${result.skippedDuplicate} duplicate, ${result.skippedInvalid} invalid`
      )
    },
    onError: (err: Error) => toast.error(`Bulk add failed: ${err.message}`),
  })
}

export function useRemoveSuppression() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('suppression_list').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppression-list'] })
      qc.invalidateQueries({ queryKey: ['suppression-counts'] })
      toast.success('Removed from suppression list')
    },
    onError: (err: Error) => toast.error(`Failed to remove: ${err.message}`),
  })
}
