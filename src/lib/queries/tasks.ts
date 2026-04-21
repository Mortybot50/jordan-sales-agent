import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { startOfDay, endOfDay } from 'date-fns'

export interface Task {
  id: string
  org_id: string
  deal_id: string | null
  contact_id: string | null
  title: string
  description: string | null
  due_at: string | null
  completed_at: string | null
  task_type: string | null
  created_at: string | null
  contact?: {
    id: string
    full_name: string
  } | null
  deal?: {
    id: string
    title: string | null
    stage?: {
      name: string
    } | null
  } | null
}

export function useTodayTasks() {
  return useQuery({
    queryKey: ['tasks', 'today'],
    queryFn: async (): Promise<Task[]> => {
      const today = new Date()
      const { data, error } = await supabase
        .from('tasks')
        .select(`
          *,
          contact:contacts(id, full_name),
          deal:deals(id, title, stage:pipeline_stages(name))
        `)
        .lte('due_at', endOfDay(today).toISOString())
        .gte('due_at', startOfDay(today).toISOString())
        .is('completed_at', null)
        .order('due_at')

      if (error) throw error
      return data ?? []
    },
  })
}

export function useTodayTaskCount() {
  return useQuery({
    queryKey: ['tasks', 'today', 'count'],
    queryFn: async (): Promise<number> => {
      const today = new Date()
      const { count, error } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .lte('due_at', endOfDay(today).toISOString())
        .gte('due_at', startOfDay(today).toISOString())
        .is('completed_at', null)

      if (error) throw error
      return count ?? 0
    },
  })
}

export function useCompleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tasks')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Task completed')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      org_id: string
      title: string
      contact_id?: string
      deal_id?: string
      due_at?: string
      task_type?: string
    }) => {
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          org_id: input.org_id,
          title: input.title,
          contact_id: input.contact_id ?? null,
          deal_id: input.deal_id ?? null,
          due_at: input.due_at ?? null,
          task_type: input.task_type ?? 'general',
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Task created')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
