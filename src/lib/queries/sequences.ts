import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

export const MAX_STEPS_PER_SEQUENCE = 5

export type EnrolmentStatus =
  | 'active'
  | 'completed'
  | 'paused'
  | 'cancelled'
  | 'reply_received'
  | 'failed'

export interface Sequence {
  id: string
  org_id: string
  name: string
  description: string | null
  is_active: boolean | null
  is_canonical?: boolean | null
  created_at: string | null
  updated_at: string | null
}

export interface SequenceStep {
  id: string
  sequence_id: string | null
  step_number: number
  delay_days: number
  prompt_instructions: string | null
}

export interface SequenceWithCounts extends Sequence {
  step_count: number
  active_enrolments: number
}

export interface SequenceEnrolment {
  id: string
  org_id: string
  sequence_id: string | null
  contact_id: string | null
  current_step: number | null
  status: EnrolmentStatus | string | null
  enrolled_at: string | null
  next_step_due_at: string
  last_step_fired_at: string | null
  last_status_message: string | null
  failure_count: number
  contact?: {
    id: string
    full_name: string
    venue?: { name: string | null } | null
  } | null
}

// ── Read hooks ────────────────────────────────────────────────────

export function useSequences() {
  return useQuery({
    queryKey: ['sequences'],
    queryFn: async (): Promise<SequenceWithCounts[]> => {
      const { data, error } = await supabase
        .from('sequences')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error

      const ids = (data ?? []).map((s) => s.id)
      if (ids.length === 0) return []

      const [stepsRes, enrolRes] = await Promise.all([
        supabase
          .from('sequence_steps')
          .select('sequence_id')
          .in('sequence_id', ids),
        supabase
          .from('sequence_enrollments')
          .select('sequence_id, status')
          .in('sequence_id', ids),
      ])

      const stepCounts = new Map<string, number>()
      for (const row of stepsRes.data ?? []) {
        if (row.sequence_id) {
          stepCounts.set(row.sequence_id, (stepCounts.get(row.sequence_id) ?? 0) + 1)
        }
      }
      const activeCounts = new Map<string, number>()
      for (const row of enrolRes.data ?? []) {
        if (row.sequence_id && row.status === 'active') {
          activeCounts.set(row.sequence_id, (activeCounts.get(row.sequence_id) ?? 0) + 1)
        }
      }

      return (data ?? []).map((s) => ({
        ...s,
        step_count: stepCounts.get(s.id) ?? 0,
        active_enrolments: activeCounts.get(s.id) ?? 0,
      }))
    },
  })
}

/**
 * The org's canonical Hospitality 3-Touch sequence — seeded by the
 * `seed_jordan_canonical_sequence` migration. Used to back the quick-enrol
 * button on ContactDetailPage and the bulk toolbar. There is at most one
 * canonical sequence per org (enforced by a partial unique index).
 */
export function useCanonicalSequence(orgId: string | undefined) {
  return useQuery({
    queryKey: ['sequence-canonical', orgId],
    queryFn: async (): Promise<Sequence | null> => {
      if (!orgId) return null
      const { data, error } = await supabase
        .from('sequences')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_canonical', true)
        .maybeSingle()
      if (error) throw error
      return data ?? null
    },
    enabled: !!orgId,
  })
}

export function useSequence(id: string) {
  return useQuery({
    queryKey: ['sequence', id],
    queryFn: async (): Promise<Sequence> => {
      const { data, error } = await supabase
        .from('sequences')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

export function useSequenceSteps(sequenceId: string) {
  return useQuery({
    queryKey: ['sequence-steps', sequenceId],
    queryFn: async (): Promise<SequenceStep[]> => {
      const { data, error } = await supabase
        .from('sequence_steps')
        .select('id, sequence_id, step_number, delay_days, prompt_instructions')
        .eq('sequence_id', sequenceId)
        .order('step_number', { ascending: true })
      if (error) throw error
      return (data ?? []) as SequenceStep[]
    },
    enabled: !!sequenceId,
  })
}

export function useSequenceEnrolments(sequenceId: string) {
  return useQuery({
    queryKey: ['sequence-enrolments', sequenceId],
    queryFn: async (): Promise<SequenceEnrolment[]> => {
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .select(`
          id, org_id, sequence_id, contact_id, current_step, status,
          enrolled_at, next_step_due_at, last_step_fired_at, last_status_message, failure_count,
          contact:contacts(id, full_name, venue:venues(name))
        `)
        .eq('sequence_id', sequenceId)
        .order('enrolled_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as SequenceEnrolment[]
    },
    enabled: !!sequenceId,
  })
}

// ── Mutations: sequences + steps ──────────────────────────────────

export interface SequenceUpsert {
  name: string
  description?: string | null
  is_active?: boolean
  steps: Array<{
    step_number: number
    delay_days: number
    prompt_instructions: string
  }>
}

export function useCreateSequence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      org_id,
      created_by_user_id,
      payload,
    }: {
      org_id: string
      created_by_user_id: string
      payload: SequenceUpsert
    }): Promise<{ id: string }> => {
      if (payload.steps.length === 0) {
        throw new Error('A sequence needs at least one step.')
      }
      if (payload.steps.length > MAX_STEPS_PER_SEQUENCE) {
        throw new Error(`Max ${MAX_STEPS_PER_SEQUENCE} steps per sequence in v1.`)
      }
      const { data: seq, error: seqErr } = await supabase
        .from('sequences')
        .insert({
          org_id,
          created_by_user_id,
          name: payload.name,
          description: payload.description ?? null,
          is_active: payload.is_active ?? true,
        })
        .select('id')
        .single()
      if (seqErr) throw seqErr

      const stepsRows = payload.steps.map((s) => ({
        org_id,
        sequence_id: seq.id,
        step_number: s.step_number,
        delay_days: s.delay_days,
        prompt_instructions: s.prompt_instructions,
        step_type: 'email',
      }))
      const { error: stepsErr } = await supabase.from('sequence_steps').insert(stepsRows)
      if (stepsErr) throw stepsErr

      return { id: seq.id }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] })
      toast.success('Sequence created')
    },
    onError: (err: Error) => toast.error(`Couldn't create sequence: ${err.message}`),
  })
}

export function useUpdateSequence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      org_id,
      payload,
    }: {
      id: string
      org_id: string
      payload: SequenceUpsert
    }) => {
      if (payload.steps.length === 0) {
        throw new Error('A sequence needs at least one step.')
      }
      if (payload.steps.length > MAX_STEPS_PER_SEQUENCE) {
        throw new Error(`Max ${MAX_STEPS_PER_SEQUENCE} steps per sequence in v1.`)
      }

      const { error: seqErr } = await supabase
        .from('sequences')
        .update({
          name: payload.name,
          description: payload.description ?? null,
          is_active: payload.is_active ?? true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (seqErr) throw seqErr

      // Replace step set — simpler than diffing for v1, and the worker only
      // looks up by (sequence_id, step_number) so atomicity inside one
      // request is fine for a tiny step list.
      const { error: delErr } = await supabase
        .from('sequence_steps')
        .delete()
        .eq('sequence_id', id)
      if (delErr) throw delErr

      const stepsRows = payload.steps.map((s) => ({
        org_id,
        sequence_id: id,
        step_number: s.step_number,
        delay_days: s.delay_days,
        prompt_instructions: s.prompt_instructions,
        step_type: 'email',
      }))
      const { error: stepsErr } = await supabase.from('sequence_steps').insert(stepsRows)
      if (stepsErr) throw stepsErr
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['sequences'] })
      qc.invalidateQueries({ queryKey: ['sequence', vars.id] })
      qc.invalidateQueries({ queryKey: ['sequence-steps', vars.id] })
      toast.success('Sequence saved')
    },
    onError: (err: Error) => toast.error(`Couldn't save sequence: ${err.message}`),
  })
}

export function useDeleteSequence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sequences').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] })
      toast.success('Sequence deleted')
    },
    onError: (err: Error) => toast.error(`Couldn't delete sequence: ${err.message}`),
  })
}

// ── Mutations: enrolments ─────────────────────────────────────────

export interface BulkEnrolResult {
  enrolled: number
  skipped_already_enrolled: number
  skipped_dnc: number
  skipped_suppressed: number
  skipped_no_email: number
}

/**
 * Best-effort enrolment for one or more contacts. Skips contacts that are
 * DNC, on the suppression list, lack an email, or are already actively
 * enrolled in the same sequence. Returns the counts so the caller can
 * surface a useful toast.
 */
export function useEnrolContacts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      org_id,
      enrolled_by_user_id,
      sequence_id,
      contact_ids,
    }: {
      org_id: string
      enrolled_by_user_id: string
      sequence_id: string
      contact_ids: string[]
    }): Promise<BulkEnrolResult> => {
      const result: BulkEnrolResult = {
        enrolled: 0,
        skipped_already_enrolled: 0,
        skipped_dnc: 0,
        skipped_suppressed: 0,
        skipped_no_email: 0,
      }
      if (contact_ids.length === 0) return result

      const [contactRes, suppressionRes, existingRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('id, email, do_not_contact')
          .in('id', contact_ids),
        supabase
          .from('suppression_list')
          .select('email, domain_suppression')
          .eq('org_id', org_id),
        supabase
          .from('sequence_enrollments')
          .select('contact_id')
          .eq('sequence_id', sequence_id)
          .eq('status', 'active')
          .in('contact_id', contact_ids),
      ])

      if (contactRes.error) throw contactRes.error
      if (suppressionRes.error) throw suppressionRes.error
      if (existingRes.error) throw existingRes.error

      const alreadyEnrolled = new Set(
        (existingRes.data ?? []).map((r) => r.contact_id).filter(Boolean) as string[],
      )
      const suppressionSet = new Set<string>()
      const domainSet = new Set<string>()
      for (const row of suppressionRes.data ?? []) {
        if (row.domain_suppression) domainSet.add(row.email.toLowerCase())
        else suppressionSet.add(row.email.toLowerCase())
      }
      function isSuppressed(email: string | null): boolean {
        if (!email) return false
        const raw = email.trim().toLowerCase()
        const at = raw.indexOf('@')
        if (at < 0) return false
        const local = raw.slice(0, at).split('+')[0]
        const domain = raw.slice(at + 1)
        return suppressionSet.has(`${local}@${domain}`) || domainSet.has(domain)
      }

      const toInsert: Array<{
        org_id: string
        sequence_id: string
        contact_id: string
        enrolled_by_user_id: string
        status: 'active'
      }> = []
      for (const c of contactRes.data ?? []) {
        if (alreadyEnrolled.has(c.id)) {
          result.skipped_already_enrolled += 1
          continue
        }
        if (c.do_not_contact) {
          result.skipped_dnc += 1
          continue
        }
        if (!c.email) {
          result.skipped_no_email += 1
          continue
        }
        if (isSuppressed(c.email)) {
          result.skipped_suppressed += 1
          continue
        }
        toInsert.push({
          org_id,
          sequence_id,
          contact_id: c.id,
          enrolled_by_user_id,
          status: 'active',
        })
      }

      if (toInsert.length > 0) {
        const { error } = await supabase.from('sequence_enrollments').insert(toInsert)
        if (error) throw error
        result.enrolled = toInsert.length
      }

      return result
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['sequences'] })
      qc.invalidateQueries({ queryKey: ['sequence-enrolments', vars.sequence_id] })
    },
    onError: (err: Error) => toast.error(`Couldn't enrol contacts: ${err.message}`),
  })
}

export function useUpdateEnrolment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string
      status: EnrolmentStatus
    }) => {
      const { error } = await supabase
        .from('sequence_enrollments')
        .update({ status })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] })
      qc.invalidateQueries({ queryKey: ['sequence-enrolments'] })
      toast.success('Enrolment updated')
    },
    onError: (err: Error) => toast.error(`Couldn't update enrolment: ${err.message}`),
  })
}
