import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { getSuppressionSet, isSuppressed } from '@/lib/suppression'

export type DraftStatus =
  | 'pending'
  | 'edited'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'draft_failed'
  | 'queued'
  | 'suppressed'
export type DraftType = 'cold_outreach' | 'follow_up' | 'follow_up_soft' | 'follow_up_close' | 'reply'
export type DraftKind = 'standard' | 'proposed_meeting'

/**
 * Literal placeholder token embedded by the AI in proposed_meeting drafts.
 * Jordan must replace this with real diary slots before approving.
 * Match exactly — frontend regex / Edge Function guard depends on the literal.
 */
export const TIMES_PLACEHOLDER = '[YOUR_TIMES_HERE]'

/** True if a draft body still contains the unresolved diary placeholder. */
export function hasUnresolvedPlaceholder(body: string | null | undefined): boolean {
  return !!body && body.includes(TIMES_PLACEHOLDER)
}

/**
 * Variant label for a sequence-rendered draft.
 *
 * The sequence-tick worker stores the chosen template variant id on
 * `email_drafts.context_json.variant_id` whenever `production_path` is
 * `template` (rule-based copy path — see PR #42 / sequence-tick/index.ts).
 * LLM-rendered drafts have `production_path: 'llm'` and no variant.
 *
 * Returns a human-readable label like "Walk-by" / "LinkedIn" for the queue
 * and preview chips, or null when the draft wasn't rendered from a variant
 * template (LLM path, manual draft, ad-hoc reply, etc.).
 */
export function getDraftVariantLabel(draft: Pick<Draft, 'context_json'>): string | null {
  const ctx = draft.context_json
  if (!ctx || typeof ctx !== 'object') return null
  const productionPath = (ctx as { production_path?: unknown }).production_path
  if (productionPath !== 'template') return null
  const variantId = (ctx as { variant_id?: unknown }).variant_id
  if (typeof variantId !== 'string' || variantId.length === 0) return null
  return variantId
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export interface Draft {
  id: string
  org_id: string
  contact_id: string | null
  deal_id: string | null
  draft_type: DraftType
  draft_kind: DraftKind
  subject: string | null
  body: string | null
  context_json: Record<string, unknown> | null
  model: string | null
  status: DraftStatus
  generated_at: string | null
  approved_at: string | null
  created_at: string
  sequence_enrollment_id: string | null
  sequence_step_number: number | null
  sender_inbox_id: string | null
  suppression_reason: string | null
  sequence_enrollment?: {
    sequence?: {
      id: string
      name: string
    } | null
  } | null
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
          id, org_id, contact_id, deal_id, draft_type, draft_kind, subject, body,
          context_json, model, status, generated_at, approved_at, created_at,
          sequence_enrollment_id, sequence_step_number,
          sender_inbox_id, suppression_reason,
          contact:contacts(id, full_name, venue:venues(name, venue_type)),
          sequence_enrollment:sequence_enrollments(sequence:sequences(id, name))
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
 *
 * Also returns the subset that are proposed_meeting drafts — these need
 * Jordan's diary input before they can send, so the nav badge splits the
 * total into "X total / Y need diary" when both are non-zero.
 */
export interface DraftQueueCounts {
  total: number
  needsDiary: number
}

export function useDraftQueueCount() {
  return useQuery<DraftQueueCounts>({
    queryKey: ['drafts', 'queue-count'],
    queryFn: async (): Promise<DraftQueueCounts> => {
      const [totalRes, diaryRes] = await Promise.all([
        supabase
          .from('email_drafts')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'edited']),
        supabase
          .from('email_drafts')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'edited'])
          .eq('draft_kind', 'proposed_meeting'),
      ])

      if (totalRes.error) throw totalRes.error
      if (diaryRes.error) throw diaryRes.error

      return {
        total: totalRes.count ?? 0,
        needsDiary: diaryRes.count ?? 0,
      }
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
          id, org_id, contact_id, deal_id, draft_type, draft_kind, subject, body,
          context_json, model, status, generated_at, approved_at, created_at,
          sequence_enrollment_id, sequence_step_number,
          sender_inbox_id, suppression_reason,
          contact:contacts(id, full_name, venue:venues(name, venue_type)),
          sequence_enrollment:sequence_enrollments(sequence:sequences(id, name))
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      return data as unknown as Draft
    },
    enabled: !!id,
  })
}

export interface ApproveDraftResult {
  status: DraftStatus
  suppression_reason: string | null
  sender_inbox_id: string | null
  daily_cap_reached: boolean
}

export function useApproveDraft() {
  const qc = useQueryClient()
  return useMutation<ApproveDraftResult, Error, string>({
    mutationFn: async (id: string) => {
      // Outbound-readiness pre-flight — block approve when the user is still
      // missing profile name / signature / sending inbox. Without this, the
      // draft flips to 'approved', the worker picks it up, can't send, and
      // the failure is invisible to Jordan until the next morning briefing.
      // Same check the dashboard SetupChecklist surfaces.
      // Fail CLOSED if we can't resolve the current user — never skip the
      // readiness gate on an auth hiccup (the previous `if (user?.id)` silently
      // let approval through when getUser() returned null). The DB trigger
      // trg_email_drafts_approve_ready is the authoritative backstop, but the
      // client should surface a clear retry rather than a later DB rejection.
      const { data: authData, error: authErr } = await supabase.auth.getUser()
      const user = authData?.user
      if (authErr || !user?.id) {
        throw new Error('Could not confirm your sign-in — refresh the page and try approving again.')
      }
      {
        const [profileRes, sigRes, inboxRes] = await Promise.all([
          supabase.from('users').select('full_name').eq('id', user.id).maybeSingle(),
          supabase
            .from('email_signature_templates')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          supabase
            .from('email_accounts')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'active'),
        ])
        const profileNameSet = !!(profileRes.data?.full_name && (profileRes.data.full_name as string).trim())
        const hasSignature = (sigRes.count ?? 0) > 0
        const hasInbox = (inboxRes.count ?? 0) > 0
        if (!profileNameSet || !hasSignature || !hasInbox) {
          const missing: string[] = []
          if (!profileNameSet) missing.push('your profile name')
          if (!hasSignature) missing.push('at least one brand signature')
          if (!hasInbox) missing.push('a connected sending inbox')
          throw new Error(
            `Finish setup before approving — still need ${missing.join(' + ')}. Open Settings to fix.`,
          )
        }
      }

      // Learning Loop — read current vs original to capture the edit delta.
      // Approve is the "sent" signal in this app today; if Jordan changed
      // subject or body before approving, record the diff for weekly analysis.
      const { data: current } = await supabase
        .from('email_drafts')
        .select('subject, body, original_subject, original_body, org_id, contact_id')
        .eq('id', id)
        .single()

      // Hard block — proposed-meeting drafts must have real times in place
      // before they can be approved/sent. Mirrors the editor Send guard.
      if (current && hasUnresolvedPlaceholder(current.body)) {
        throw new Error(
          'Replace [YOUR_TIMES_HERE] with your proposed times before approving.',
        )
      }

      // Pick the next sender inbox via the SQL helper (weighted round-robin
      // honouring per-inbox daily caps in Australia/Melbourne TZ). Returns
      // null when every enabled inbox has hit its cap for the day — in that
      // case the draft still flips to 'approved' (so Jordan can see it),
      // but with no sender attached, and we log a daily_cap_reached activity
      // so the cap-hit is visible in the timeline.
      let senderInboxId: string | null = null
      let dailyCapReached = false
      if (current?.org_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: senderRow, error: senderErr } = await (supabase.rpc as any)(
          'select_next_sender',
          { p_org_id: current.org_id },
        )
        if (senderErr) {
          console.warn('select_next_sender failed', senderErr)
        }
        const picked = senderRow as { id: string } | null
        if (picked?.id) {
          senderInboxId = picked.id
        } else {
          dailyCapReached = true
        }
      }

      const now = new Date().toISOString()
      const subjectChanged = !!current && current.subject !== current.original_subject
      const bodyChanged = !!current && current.body !== current.original_body

      const updates: Record<string, unknown> = {
        status: 'approved',
        approved_at: now,
        edit_logged_at: now,
        sender_inbox_id: senderInboxId,
      }
      if (subjectChanged) updates.edited_subject = current?.subject ?? null
      if (bodyChanged) updates.edited_body = current?.body ?? null

      const { error } = await supabase
        .from('email_drafts')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(updates as any)
        .eq('id', id)
      if (error) throw error

      // Re-read the row — the BEFORE-UPDATE suppression-guard trigger may
      // have rewritten our 'approved' to 'suppressed' on the way in, so we
      // want the authoritative state to drive the toast.
      const { data: postUpdate } = await supabase
        .from('email_drafts')
        .select('status, suppression_reason, sender_inbox_id, contact_id, deal_id, org_id')
        .eq('id', id)
        .single()

      const finalStatus = (postUpdate?.status ?? 'approved') as DraftStatus
      const finalReason = postUpdate?.suppression_reason ?? null

      // Audit-trail activity rows so the draft suppression / cap-hit is
      // visible in the contact's timeline. Best-effort — failures here
      // shouldn't break the approve flow.
      if (postUpdate?.org_id && (finalStatus === 'suppressed' || dailyCapReached)) {
        const activityType =
          finalStatus === 'suppressed' ? 'draft_suppressed' : 'daily_cap_reached'
        await supabase.from('activities').insert({
          org_id: postUpdate.org_id,
          contact_id: postUpdate.contact_id ?? null,
          deal_id: postUpdate.deal_id ?? null,
          activity_type: activityType,
          subject: activityType === 'draft_suppressed'
            ? `Draft auto-suppressed (${finalReason ?? 'unknown'})`
            : 'Daily cap reached — no sender available',
          metadata: { draft_id: id, reason: finalReason },
        })
      }

      return {
        status: finalStatus,
        suppression_reason: finalReason,
        sender_inbox_id: postUpdate?.sender_inbox_id ?? null,
        daily_cap_reached: dailyCapReached,
      }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['drafts'] })
      if (result.status === 'suppressed') {
        toast.error(
          `Blocked — recipient is on the suppression list (${result.suppression_reason ?? 'unknown'}). No email will send.`,
        )
        return
      }
      if (result.daily_cap_reached) {
        toast.warning(
          'Approved, but every sender inbox has hit its daily cap. This draft will sit until tomorrow.',
        )
        return
      }
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

      if (error) {
        // supabase-js wraps non-2xx as a generic FunctionsHttpError. Try to
        // surface the function's own JSON `error` field so admin-actionable
        // failures (e.g. BE-P0-03 UNSUB_KEY_MISSING 503) reach the toast
        // instead of "Edge Function returned a non-2xx status code".
        let serverMsg: string | undefined
        try {
          const ctx = (error as { context?: Response }).context
          if (ctx && typeof ctx.clone === 'function') {
            const body = await ctx.clone().json()
            if (body && typeof body.error === 'string') serverMsg = body.error
          }
        } catch { /* fall through to generic message */ }
        throw new Error(serverMsg ?? error.message)
      }

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
