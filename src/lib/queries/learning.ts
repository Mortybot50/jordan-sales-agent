import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export interface ProposedRule {
  id: string
  text: string
  evidence_drafts: string[]
  status: 'pending' | 'approved' | 'rejected'
  decided_at: string | null
}

export interface LearningDigest {
  id: string
  org_id: string
  user_id: string
  week_start: string
  week_end: string
  drafts_analysed: number
  proposed_rules: ProposedRule[]
  status: 'pending' | 'partially_actioned' | 'fully_actioned' | 'dismissed'
  generated_at: string
}

/** Fetch the active digest (pending or partially_actioned) for the current user. */
export function useActiveLearningDigest(userId: string | undefined) {
  return useQuery({
    queryKey: ['learning-digest', userId],
    enabled: !!userId,
    queryFn: async (): Promise<LearningDigest | null> => {
      const { data, error } = await supabase
        .from('learning_digests')
        .select('id, org_id, user_id, week_start, week_end, drafts_analysed, proposed_rules, status, generated_at')
        .eq('user_id', userId!)
        .in('status', ['pending', 'partially_actioned'])
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as unknown as LearningDigest | null) ?? null
    },
  })
}

/** Decide a single rule. On approve, append the rule text to users.voice_rules. */
export function useDecideRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      digestId,
      ruleId,
      decision,
      userId,
    }: {
      digestId: string
      ruleId: string
      decision: 'approved' | 'rejected'
      userId: string
    }) => {
      // Load the current digest
      const { data: digest, error: fetchErr } = await supabase
        .from('learning_digests')
        .select('proposed_rules')
        .eq('id', digestId)
        .single()
      if (fetchErr) throw fetchErr

      const rules = (digest?.proposed_rules as unknown as ProposedRule[]) ?? []
      const nowIso = new Date().toISOString()
      const updatedRules = rules.map((r) =>
        r.id === ruleId
          ? { ...r, status: decision, decided_at: nowIso }
          : r,
      )

      // If approving, append rule text to users.voice_rules
      if (decision === 'approved') {
        const rule = rules.find((r) => r.id === ruleId)
        if (rule) {
          const { data: userRow } = await supabase
            .from('users')
            .select('voice_rules')
            .eq('id', userId)
            .single()
          const current = (userRow?.voice_rules ?? '').trim()
          const newLine = `- ${rule.text}`
          const next = current ? `${current}\n${newLine}` : newLine
          const { error: userErr } = await supabase
            .from('users')
            .update({ voice_rules: next } as never)
            .eq('id', userId)
          if (userErr) throw userErr
        }
      }

      // Recompute digest status based on the decided set
      const allDecided = updatedRules.every((r) => r.status !== 'pending')
      const anyApproved = updatedRules.some((r) => r.status === 'approved')
      const anyRejected = updatedRules.some((r) => r.status === 'rejected')
      let nextStatus: LearningDigest['status'] = 'pending'
      if (allDecided) {
        if (anyApproved) nextStatus = 'fully_actioned'
        else if (anyRejected) nextStatus = 'dismissed'
        else nextStatus = 'fully_actioned'
      } else if (anyApproved || anyRejected) {
        nextStatus = 'partially_actioned'
      }

      const { error: updateErr } = await supabase
        .from('learning_digests')
        .update({
          proposed_rules: updatedRules as never,
          status: nextStatus,
          updated_at: nowIso,
        } as never)
        .eq('id', digestId)
      if (updateErr) throw updateErr
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['learning-digest'] })
      qc.invalidateQueries({ queryKey: ['user'] })
      toast.success(
        vars.decision === 'approved' ? 'Rule added to your voice rules' : 'Rule dismissed',
      )
    },
    onError: (err: Error) => toast.error(`Failed to save decision: ${err.message}`),
  })
}
