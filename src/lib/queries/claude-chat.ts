import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type ClaudeScope = 'global' | 'contact'

export interface ClaudeConversation {
  id: string
  org_id: string
  user_id: string
  scope: ClaudeScope
  contact_id: string | null
  title: string | null
  created_at: string
  updated_at: string
}

export interface ClaudeMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  model: string | null
  created_at: string
}

// Generated Database types don't yet know about claude_conversations /
// claude_messages — added in migration 20260526051228. Cast to an untyped
// SupabaseClient here so the queries compile until the next `supabase gen
// types typescript` regen. Same pattern other PRs have used pre-regen.
const sb = supabase as unknown as SupabaseClient

/** Find the existing conversation row for (user, scope, contact). The Edge
 *  Function creates one on first message — this hook just surfaces what's
 *  there for hydration on mount.
 */
export function useClaudeConversation(scope: ClaudeScope, contactId?: string | null) {
  return useQuery({
    queryKey: ['claude-conversation', scope, contactId ?? null],
    queryFn: async (): Promise<ClaudeConversation | null> => {
      let q = sb
        .from('claude_conversations')
        .select('*')
        .eq('scope', scope)
        .limit(1)
      q = scope === 'contact' && contactId
        ? q.eq('contact_id', contactId)
        : q.is('contact_id', null)
      const { data, error } = await q.maybeSingle()
      if (error) throw error
      return (data as ClaudeConversation | null) ?? null
    },
    enabled: scope === 'global' || !!contactId,
  })
}

export function useClaudeMessages(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: ['claude-messages', conversationId ?? null],
    queryFn: async (): Promise<ClaudeMessage[]> => {
      if (!conversationId) return []
      const { data, error } = await sb
        .from('claude_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as ClaudeMessage[]
    },
    enabled: !!conversationId,
  })
}

export function useInvalidateClaude() {
  const qc = useQueryClient()
  return (scope: ClaudeScope, contactId?: string | null, conversationId?: string | null) => {
    qc.invalidateQueries({ queryKey: ['claude-conversation', scope, contactId ?? null] })
    if (conversationId) qc.invalidateQueries({ queryKey: ['claude-messages', conversationId] })
  }
}
