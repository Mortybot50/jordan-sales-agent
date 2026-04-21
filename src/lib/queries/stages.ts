import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export interface PipelineStage {
  id: string
  org_id: string
  name: string
  position: number
  is_closed: boolean | null
  color: string | null
  created_at: string | null
}

export function useStages() {
  return useQuery({
    queryKey: ['stages'],
    queryFn: async (): Promise<PipelineStage[]> => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .order('position')

      if (error) throw error
      return data ?? []
    },
  })
}

export function useCreateStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ org_id, name, position }: { org_id: string; name: string; position: number }) => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .insert({ org_id, name, position })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stages'] })
      toast.success('Stage created')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; position?: number; color?: string }) => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stages'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reassign_to }: { id: string; reassign_to?: string }) => {
      if (reassign_to) {
        await supabase
          .from('deals')
          .update({ stage_id: reassign_to })
          .eq('stage_id', id)
      }
      const { error } = await supabase.from('pipeline_stages').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stages'] })
      qc.invalidateQueries({ queryKey: ['deals'] })
      toast.success('Stage deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
