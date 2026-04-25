import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Json } from '@/types/database'

export function useUpdateUserProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, icp_config, email_notifications, ...rest }: {
      id: string
      full_name?: string
      calendly_url?: string
      email_signature?: string
      voice_rules?: string | null
      default_commission_pct?: number | null
      icp_config?: Record<string, unknown>
      email_notifications?: Record<string, unknown>
    }) => {
      const updates = {
        ...rest,
        ...(icp_config !== undefined ? { icp_config: icp_config as Json } : {}),
        ...(email_notifications !== undefined ? { email_notifications: email_notifications as Json } : {}),
      }
      const { data, error } = await supabase
        .from('users')
        .update(updates as never)
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
