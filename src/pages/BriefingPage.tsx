import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  useOvernightReplies,
  useTodayBriefingTasks,
  useNewCandidates,
  useReengagementOpportunities,
} from '@/lib/queries/briefing'
import { useCompleteTask, useCreateTask } from '@/lib/queries/tasks'
import { useAuth } from '@/hooks/useAuth'
import { formatRelative, venueTypeLabel } from '@/lib/utils'
import { RefreshCw, CheckCircle, Clock, UserSearch, Repeat } from 'lucide-react'
import { endOfDay } from 'date-fns'

export function BriefingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const completeTask = useCompleteTask()
  const createTask = useCreateTask()

  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())
  const [refreshing, setRefreshing] = useState(false)

  const { data: replies, isLoading: repliesLoading } = useOvernightReplies()
  const { data: todayTasks, isLoading: tasksLoading } = useTodayBriefingTasks()
  const { data: candidates, isLoading: candidatesLoading } = useNewCandidates()
  const { data: reengagement, isLoading: reengagementLoading } = useReengagementOpportunities()

  async function handleRefresh() {
    setRefreshing(true)
    await queryClient.invalidateQueries({ queryKey: ['briefing'] })
    setLastRefreshed(new Date())
    setRefreshing(false)
  }

  function handleMarkDone(taskId: string) {
    completeTask.mutate(taskId)
  }

  function handleReengage(contactId: string, name: string) {
    if (!user) return
    createTask.mutate({
      org_id: user.org_id,
      title: `Re-engage ${name}`,
      contact_id: contactId,
      due_at: endOfDay(new Date()).toISOString(),
      task_type: 'reengagement',
    })
  }

  const defaultOpen = ['replies', 'tasks', 'candidates', 'reengagement']

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Morning Briefing</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Last refreshed {formatRelative(lastRefreshed.toISOString())}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Accordion type="multiple" defaultValue={defaultOpen} className="space-y-3">
        {/* Section 1: Overnight Replies */}
        <AccordionItem value="replies" className="border rounded-xl overflow-hidden">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-accent/50">
            <div className="flex items-center gap-2.5 text-left">
              <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                <RefreshCw className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <span className="text-sm font-semibold">Overnight Replies</span>
                {!repliesLoading && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    {replies?.length ?? 0}
                  </Badge>
                )}
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-0 pb-0">
            {repliesLoading && (
              <p className="text-sm text-muted-foreground px-4 py-4">Loading…</p>
            )}
            {!repliesLoading && (!replies || replies.length === 0) && (
              <p className="text-sm text-muted-foreground px-4 py-4">
                Nothing here today.
              </p>
            )}
            {replies && replies.length > 0 && (
              <div className="divide-y">
                {replies.map((reply) => (
                  <div key={reply.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{reply.contact_name}</p>
                        {reply.venue_name && (
                          <p className="text-xs text-muted-foreground">
                            {reply.venue_name}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatRelative(reply.occurred_at)}
                      </span>
                    </div>
                    {reply.subject && (
                      <p className="text-sm font-medium">{reply.subject}</p>
                    )}
                    {reply.body && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {reply.body}
                      </p>
                    )}
                    <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 inline-block">
                      AI draft pending — AI layer ships Week 3
                    </p>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Section 2: Follow-ups Due Today */}
        <AccordionItem value="tasks" className="border rounded-xl overflow-hidden">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-accent/50">
            <div className="flex items-center gap-2.5 text-left">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <span className="text-sm font-semibold">Follow-ups Due Today</span>
                {!tasksLoading && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    {todayTasks?.length ?? 0}
                  </Badge>
                )}
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-0 pb-0">
            {tasksLoading && (
              <p className="text-sm text-muted-foreground px-4 py-4">Loading…</p>
            )}
            {!tasksLoading && (!todayTasks || todayTasks.length === 0) && (
              <p className="text-sm text-muted-foreground px-4 py-4">
                Nothing here today.
              </p>
            )}
            {todayTasks && todayTasks.length > 0 && (
              <div className="divide-y">
                {todayTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        {task.contact_name && (
                          <span>{task.contact_name}</span>
                        )}
                        {task.venue_name && (
                          <>
                            <span>·</span>
                            <span>{task.venue_name}</span>
                          </>
                        )}
                        {task.deal_title && (
                          <>
                            <span>·</span>
                            <span className="italic">{task.deal_title}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={() => handleMarkDone(task.id)}
                      disabled={completeTask.isPending}
                    >
                      <CheckCircle className="w-3.5 h-3.5 mr-1" />
                      Done
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Section 3: New Auto-sourced Candidates */}
        <AccordionItem value="candidates" className="border rounded-xl overflow-hidden">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-accent/50">
            <div className="flex items-center gap-2.5 text-left">
              <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                <UserSearch className="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <span className="text-sm font-semibold">New Auto-sourced Candidates</span>
                {!candidatesLoading && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    {candidates?.length ?? 0}
                  </Badge>
                )}
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-0 pb-0">
            {candidatesLoading && (
              <p className="text-sm text-muted-foreground px-4 py-4">Loading…</p>
            )}
            {!candidatesLoading && (!candidates || candidates.length === 0) && (
              <p className="text-sm text-muted-foreground px-4 py-4">
                Nothing here today.
              </p>
            )}
            {candidates && candidates.length > 0 && (
              <div className="divide-y">
                {candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {candidate.name ?? 'Unnamed venue'}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        {candidate.venue_type_guess && (
                          <span>{venueTypeLabel(candidate.venue_type_guess)}</span>
                        )}
                        {candidate.address && (
                          <>
                            {candidate.venue_type_guess && <span>·</span>}
                            <span className="truncate max-w-[150px]">
                              {candidate.suburb ?? candidate.address}
                            </span>
                          </>
                        )}
                        {candidate.icp_score_guess != null && (
                          <>
                            <span>·</span>
                            <Badge className="bg-amber-100 text-amber-700 border-0 text-xs h-4">
                              ICP {candidate.icp_score_guess}
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={() => navigate('/contacts/new')}
                    >
                      Convert
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Section 4: Re-engagement Opportunities */}
        <AccordionItem
          value="reengagement"
          className="border rounded-xl overflow-hidden"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-accent/50">
            <div className="flex items-center gap-2.5 text-left">
              <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                <Repeat className="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <span className="text-sm font-semibold">Re-engagement Opportunities</span>
                {!reengagementLoading && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    {reengagement?.length ?? 0}
                  </Badge>
                )}
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-0 pb-0">
            {reengagementLoading && (
              <p className="text-sm text-muted-foreground px-4 py-4">Loading…</p>
            )}
            {!reengagementLoading && (!reengagement || reengagement.length === 0) && (
              <p className="text-sm text-muted-foreground px-4 py-4">
                Nothing here today.
              </p>
            )}
            {reengagement && reengagement.length > 0 && (
              <div className="divide-y">
                {reengagement.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {contact.full_name}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        {contact.venue_name && (
                          <span className="truncate">{contact.venue_name}</span>
                        )}
                        <span>·</span>
                        <span className="text-amber-600 font-medium">
                          {contact.days_silent}d silent
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={() => handleReengage(contact.id, contact.full_name)}
                      disabled={createTask.isPending}
                    >
                      Start follow-up
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
