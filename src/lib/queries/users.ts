import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Json } from '@/types/database'

export function useUpdateUserProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, icp_config, ...rest }: {
      id: string
      full_name?: string
      calendly_url?: string
      email_signature?: string
      icp_config?: Record<string, unknown>
    }) => {
      const updates = icp_config !== undefined
        ? { ...rest, icp_config: icp_config as Json }
        : rest
      const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user'] })
      toast.success('Profile saved')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
