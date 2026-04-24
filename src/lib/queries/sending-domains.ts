import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Database } from '@/types/database'

export type SendingDomain = Database['public']['Tables']['sending_domains']['Row']
export type SendingDomainInsert = Database['public']['Tables']['sending_domains']['Insert']
export type SendingDomainUpdate = Database['public']['Tables']['sending_domains']['Update']

export type SendingDomainStatus = SendingDomain['status']
export type DnsStatus = 'unknown' | 'pass' | 'fail' | 'missing'

/** Fetch the current user's single sending domain row, or null. */
export function useSendingDomain(userId: string | undefined) {
  return useQuery({
    queryKey: ['sending-domain', userId],
    enabled: !!userId,
    queryFn: async (): Promise<SendingDomain | null> => {
      const { data, error } = await supabase
        .from('sending_domains')
        .select('*')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data ?? null
    },
  })
}

export function useCreateSendingDomain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: SendingDomainInsert): Promise<SendingDomain> => {
      const { data, error } = await supabase
        .from('sending_domains')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sending-domain'] })
      toast.success('Sending domain added')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateSendingDomain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & SendingDomainUpdate) => {
      const { data, error } = await supabase
        .from('sending_domains')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sending-domain'] })
      toast.success('Sending domain updated')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
