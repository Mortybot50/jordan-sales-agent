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
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['briefing', 'tasks-today'] })
      await qc.cancelQueries({ queryKey: ['tasks'] })

      const previousBriefing = qc.getQueryData(['briefing', 'tasks-today'])
      const previousTasksToday = qc.getQueryData(['tasks', 'today'])

      qc.setQueryData<Array<{ id: string }> | undefined>(
        ['briefing', 'tasks-today'],
        (old) => old?.filter((t) => t.id !== id),
      )
      qc.setQueryData<Array<{ id: string }> | undefined>(
        ['tasks', 'today'],
        (old) => old?.filter((t) => t.id !== id),
      )

      return { previousBriefing, previousTasksToday }
    },
    onError: (err: Error, _id, context) => {
      if (context?.previousBriefing !== undefined) {
        qc.setQueryData(['briefing', 'tasks-today'], context.previousBriefing)
      }
      if (context?.previousTasksToday !== undefined) {
        qc.setQueryData(['tasks', 'today'], context.previousTasksToday)
      }
      toast.error(err.message)
    },
    onSuccess: () => {
      toast.success('Task completed')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['briefing'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
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
