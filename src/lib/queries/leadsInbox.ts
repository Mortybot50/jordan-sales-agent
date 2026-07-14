import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

/**
 * Leads inbox — venues with review_status='pending' (the scraper's output,
 * consolidated 12/06; the legacy auto_sourced_candidates model is gone).
 *
 * Approve runs the full server-side chain in the approve-lead Edge Function:
 * crawl → internal verify → deal in New → enroll in canonical sequence →
 * sequence tick (step-1 draft lands in the review queue).
 */

export interface InboxLead {
  id: string
  name: string
  source: string | null
  suburb: string | null
  created_at: string | null
  icp_score: number | null
  website: string | null
  address: string | null
  licence_type: string | null
  venue_type: string | null
  contact_enrichment_status: string | null
  review_notes: string | null
  source_details: Record<string, unknown> | null
  /** Aggregated from contacts: none | crawled_empty | found */
  contact_status: 'none' | 'crawled_empty' | 'found'
  /**
   * Jordan's rule: a venue is a "lead" only once we've discovered an email.
   * Derived, not stored — equals contact_status === 'found'. Everything else
   * (no crawl, or crawled with no email) is a prospect/candidate.
   */
  is_lead: boolean
  contact_count: number
  best_contact: {
    full_name: string | null
    email: string | null
    verification_status: string | null
    email_tier: number | null
    catch_all_flag: boolean | null
    role_based: boolean | null
  } | null
  /**
   * Honest send-readiness: at least one contact whose email is
   * verification_status='valid' AND NOT catch-all AND NOT role-based. Mirrors
   * the approve-lead + enqueue-sends gate exactly. Derived, not stored.
   */
  outreach_ready: boolean
}

export function useLeadsInbox() {
  return useQuery({
    queryKey: ['leads-inbox'],
    queryFn: async (): Promise<InboxLead[]> => {
      const { data: venues, error } = await supabase
        .from('venues')
        .select(
          'id, name, source, suburb, created_at, icp_score, website, address, licence_type, venue_type, contact_enrichment_status, review_notes, source_details',
        )
        .eq('review_status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) throw error

      const rows = venues ?? []
      const ids = rows.map((v) => v.id)
      const contactsByVenue: Record<string, Array<{
        full_name: string | null
        email: string | null
        verification_status: string | null
        email_tier: number | null
        catch_all_flag: boolean | null
        role_based: boolean | null
      }>> = {}
      // Chunk the venue_id list: an .in() over ~650 UUIDs builds a >20 KB
      // request URL that trips PostgREST/proxy size limits, and because the
      // error was previously swallowed the whole contacts fetch failed
      // silently — every venue rendered "no email yet". Page in batches and
      // surface any error so a real failure throws instead of hiding.
      const CHUNK = 200
      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK)
        const { data: contacts, error: cErr } = await supabase
          .from('contacts')
          .select('venue_id, full_name, email, verification_status, email_tier, catch_all_flag, role_based')
          .in('venue_id', batch)
        if (cErr) throw cErr
        for (const c of contacts ?? []) {
          if (!c.venue_id) continue
          ;(contactsByVenue[c.venue_id] ??= []).push(c)
        }
      }

      return rows.map((v) => {
        const list = (contactsByVenue[v.id] ?? []).filter((c) => c.email)
        const best = [...list].sort(
          (a, b) => (a.email_tier ?? 3) - (b.email_tier ?? 3),
        )[0] ?? null
        const contact_status: InboxLead['contact_status'] =
          list.length > 0
            ? 'found'
            : v.contact_enrichment_status && v.contact_enrichment_status !== 'pending'
              ? 'crawled_empty'
              : 'none'
        const outreach_ready = list.some(
          (c) =>
            c.verification_status === 'valid' &&
            c.catch_all_flag !== true &&
            c.role_based !== true,
        )
        return {
          ...v,
          source_details: (v.source_details ?? null) as InboxLead['source_details'],
          contact_status,
          is_lead: contact_status === 'found',
          contact_count: list.length,
          best_contact: best,
          outreach_ready,
        }
      })
    },
  })
}

/** Nav badge — exact count, head-only. */
export function usePendingLeadsCount() {
  return useQuery({
    queryKey: ['leads-inbox-count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('venues')
        .select('id', { count: 'exact', head: true })
        .eq('review_status', 'pending')
      if (error) throw error
      return count ?? 0
    },
    staleTime: 60_000,
  })
}

export interface ApproveStep {
  step: string
  status: 'ok' | 'skipped' | 'failed'
  detail: string
}

export function useApproveLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (venueId: string): Promise<{ ok: boolean; needs_contact?: boolean; awaiting_verification?: boolean; steps: ApproveStep[] }> => {
      const { data, error } = await supabase.functions.invoke('approve-lead', {
        body: { venue_id: venueId },
      })
      if (error) throw error
      return data as { ok: boolean; needs_contact?: boolean; awaiting_verification?: boolean; steps: ApproveStep[] }
    },
    onSuccess: (res) => {
      invalidateInbox(qc)
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['drafts'] })
      if (res.awaiting_verification) {
        toast.info('Kept in the inbox — email still being verified', {
          description: 'ZeroBounce hasn\'t confirmed a deliverable email yet. It stays here; approve again once verification completes.',
        })
      } else if (res.needs_contact) {
        toast.warning('Approved — but no usable contact found', {
          description: 'The venue is flagged "needs contact". Add an email manually, then enrol.',
        })
      } else if (res.ok) {
        const enrol = res.steps.find((s) => s.step === 'enroll')
        toast.success('Lead approved — outreach starting', {
          description: enrol?.detail ?? 'Deal created and contact enrolled.',
        })
      } else {
        const failed = res.steps.find((s) => s.status === 'failed')
        toast.error('Approve chain hit a snag', {
          description: failed ? `${failed.step}: ${failed.detail}` : 'Check the lead and retry.',
        })
      }
    },
    onError: (e: Error) =>
      toast.error('Approve failed', { description: e.message }),
  })
}

export function useDiscardLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ venueId, orgId, userId }: { venueId: string; orgId: string; userId: string }) => {
      // 1. Reject the venue (kept on file — dedupe excludes it from re-scrape).
      const { error: vErr } = await supabase
        .from('venues')
        .update({
          review_status: 'rejected',
          review_decided_at: new Date().toISOString(),
          review_decided_by: userId,
        })
        .eq('id', venueId)
      if (vErr) throw vErr

      // 2. Suppress every known contact email under the DISTINCT
      //    'lead_rejected' source (reversible if the venue is un-rejected).
      const { data: contacts } = await supabase
        .from('contacts')
        .select('email')
        .eq('venue_id', venueId)
        .not('email', 'is', null)
      const emails = Array.from(new Set((contacts ?? []).map((c) => c.email!.trim().toLowerCase())))
      if (emails.length > 0) {
        const { data: existing } = await supabase
          .from('suppression_list')
          .select('email')
          .eq('org_id', orgId)
          .in('email', emails)
        const have = new Set((existing ?? []).map((e) => e.email))
        const toInsert = emails
          .filter((e) => !have.has(e))
          .map((email) => ({
            org_id: orgId,
            email,
            reason: 'manual_exclude' as const,
            source: 'lead_rejected',
            notes: 'Lead discarded from sourcing inbox',
            added_by_user_id: userId,
            domain_suppression: false,
          }))
        if (toInsert.length > 0) {
          const { error: sErr } = await supabase.from('suppression_list').insert(toInsert)
          if (sErr) throw sErr
        }
      }
      return { suppressed: emails.length }
    },
    onSuccess: (r) => {
      invalidateInbox(qc)
      qc.invalidateQueries({ queryKey: ['suppression-list'] })
      qc.invalidateQueries({ queryKey: ['suppression-counts'] })
      toast.success('Lead discarded', {
        description: r.suppressed > 0
          ? `${r.suppressed} email${r.suppressed === 1 ? '' : 's'} added to the suppression list (source: lead_rejected).`
          : 'Excluded from future sourcing runs.',
      })
    },
    onError: (e: Error) => toast.error('Discard failed', { description: e.message }),
  })
}

export function useDeferLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ venueId, userId, until }: { venueId: string; userId: string; until: Date }) => {
      const { error } = await supabase
        .from('venues')
        .update({
          review_status: 'deferred',
          review_defer_until: until.toISOString(),
          review_decided_at: new Date().toISOString(),
          review_decided_by: userId,
        })
        .eq('id', venueId)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateInbox(qc)
      toast.success('Deferred — it will return to the inbox automatically')
    },
    onError: (e: Error) => toast.error('Defer failed', { description: e.message }),
  })
}

function invalidateInbox(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['leads-inbox'] })
  qc.invalidateQueries({ queryKey: ['leads-inbox-count'] })
}
