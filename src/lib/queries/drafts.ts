import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { getSuppressionSet, isSuppressed } from '@/lib/suppression'

export type DraftStatus = 'pending' | 'edited' | 'approved' | 'rejected' | 'sent' | 'draft_failed'
export type DraftType = 'cold_outreach' | 'follow_up' | 'follow_up_soft' | 'follow_up_close' | 'reply'

export interface Draft {
  id: string
  org_id: string
  contact_id: string | null
  deal_id: string | null
  draft_type: DraftType
  subject: string | null
  body: string | null
  context_json: Record<string, unknown> | null
  model: string | null
  status: DraftStatus
  generated_at: string | null
  approved_at: string | null
  created_at: string
  contact?: {
    id: string
    full_name: string
    venue?: { name: string; venue_type: string | null } | null
  } | null
}

export function useDrafts() {
  return useQuery({
    queryKey: ['drafts'],
    queryFn: async (): Promise<Draft[]> => {
      const { data, error } = await supabase
        .from('email_drafts')
        .select(`
          id, org_id, contact_id, deal_id, draft_type, subject, body,
          context_json, model, status, generated_at, approved_at, created_at,
          contact:contacts(id, full_name, venue:venues(name, venue_type))
        `)
        .in('status', ['pending', 'edited'])
        .order('generated_at', { ascending: false })

      if (error) throw error
      return (data ?? []) as unknown as Draft[]
    },
  })
}

/**
 * Count of drafts awaiting review (pending or edited).
 * Drives the nav badge so Jordan can see the queue from anywhere.
 */
export function useDraftQueueCount() {
  return useQuery({
    queryKey: ['drafts', 'queue-count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('email_drafts')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'edited'])

      if (error) throw error
      return count ?? 0
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useDraft(id: string) {
  return useQuery({
    queryKey: ['draft', id],
    queryFn: async (): Promise<Draft> => {
      const { data, error } = await supabase
        .from('email_drafts')
        .select(`
          id, org_id, contact_id, deal_id, draft_type, subject, body,
          context_json, model, status, generated_at, approved_at, created_at,
          contact:contacts(id, full_name, venue:venues(name, venue_type))
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      return data as unknown as Draft
    },
    enabled: !!id,
  })
}

export function useApproveDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // Learning Loop — read current vs original to capture the edit delta.
      // Approve is the "sent" signal in this app today; if Jordan changed
      // subject or body before approving, record the diff for weekly analysis.
      const { data: current } = await supabase
        .from('email_drafts')
        .select('subject, body, original_subject, original_body')
        .eq('id', id)
        .single()

      const now = new Date().toISOString()
      const subjectChanged = !!current && current.subject !== current.original_subject
      const bodyChanged = !!current && current.body !== current.original_body

      const updates: Record<string, unknown> = {
        status: 'approved',
        approved_at: now,
        edit_logged_at: now,
      }
      if (subjectChanged) updates.edited_subject = current?.subject ?? null
      if (bodyChanged) updates.edited_body = current?.body ?? null

      const { error } = await supabase
        .from('email_drafts')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(updates as any)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts'] })
      toast.success('Approved — will send when email integration is connected')
    },
    onError: (err: Error) => toast.error(`Failed to approve: ${err.message}`),
  })
}

export function useRejectDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('email_drafts')
        .update({ status: 'rejected' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts'] })
      toast.success('Draft rejected')
    },
    onError: (err: Error) => toast.error(`Failed to reject: ${err.message}`),
  })
}

export function useEditDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      subject,
      body,
      originalBody,
    }: {
      id: string
      subject: string
      body: string
      originalBody: string
    }) => {
      const { data: draft } = await supabase
        .from('email_drafts')
        .select('org_id, body')
        .eq('id', id)
        .single()

      if (!draft) throw new Error('Draft not found')

      // Log edit
      await supabase.from('draft_edits').insert({
        org_id: draft.org_id,
        draft_id: id,
        original: originalBody,
        edited: body,
        edit_delta: {
          before: originalBody,
          after: body,
          subject_changed: true,
        },
      })

      // Update draft
      const { error } = await supabase
        .from('email_drafts')
        .update({ subject, body, status: 'edited' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['drafts'] })
      qc.invalidateQueries({ queryKey: ['draft', vars.id] })
      toast.success('Draft saved')
    },
    onError: (err: Error) => toast.error(`Failed to save edit: ${err.message}`),
  })
}

export function useGenerateDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      contact_id,
      draft_type,
      context_hint,
    }: {
      contact_id: string
      draft_type: DraftType
      context_hint?: string
    }) => {
      // Pre-flight suppression + DNC check — avoids API spend on a hit
      const { data: contact } = await supabase
        .from('contacts')
        .select('email, org_id, do_not_contact')
        .eq('id', contact_id)
        .single()

      if (contact?.do_not_contact) {
        throw new Error('Cannot generate draft — contact is marked Do Not Call.')
      }

      if (contact?.email && contact.org_id) {
        try {
          const set = await getSuppressionSet(contact.org_id)
          if (isSuppressed(contact.email, set)) {
            throw new Error('Cannot generate draft — email is on suppression list.')
          }
        } catch (e) {
          // Re-throw suppression errors, but don't fail on transient lookup errors
          if ((e as Error).message.startsWith('Cannot generate draft')) throw e
        }
      }

      const { data, error } = await supabase.functions.invoke('generate-draft', {
        body: { contact_id, draft_type, context_hint },
      })

      if (error) throw error

      if (data?.error) {
        throw new Error(data.error)
      }

      return data.draft as Draft
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts'] })
    },
    onError: (err: Error) => toast.error(`Generation failed: ${err.message}`),
  })
}
