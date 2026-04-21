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
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useOvernightReplies,
  useTodayBriefingTasks,
  useNewCandidates,
  useReengagementOpportunities,
  type BriefingReply,
} from '@/lib/queries/briefing'
import { useCompleteTask, useCreateTask } from '@/lib/queries/tasks'
import { useCreateActivity, useArchiveActivity } from '@/lib/queries/activities'
import { useUpdateDealStage } from '@/lib/queries/deals'
import { useStages } from '@/lib/queries/stages'
import { useAuth } from '@/hooks/useAuth'
import { formatRelative, venueTypeLabel } from '@/lib/utils'
import { RefreshCw, CheckCircle, Clock, UserSearch, Repeat, Reply, Archive, MoveRight, ListTodo, ChevronDown, ChevronUp, Filter } from 'lucide-react'
import { addDays, endOfDay } from 'date-fns'

export function BriefingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const completeTask = useCompleteTask()
  const createTask = useCreateTask()
  const createActivity = useCreateActivity()
  const archiveActivity = useArchiveActivity()
  const updateDealStage = useUpdateDealStage()
  const { data: stages } = useStages()

  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())
  const [refreshing, setRefreshing] = useState(false)
  const [icpFilterOn, setIcpFilterOn] = useState(true)

  // Reply dialog state
  const [replyTarget, setReplyTarget] = useState<BriefingReply | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)

  // Expanded reply bodies
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())

  // Move stage dialog state
  const [moveTarget, setMoveTarget] = useState<BriefingReply | null>(null)
  const [moveStageId, setMoveStageId] = useState('')

  const { data: replies, isLoading: repliesLoading } = useOvernightReplies()
  const { data: todayTasks, isLoading: tasksLoading } = useTodayBriefingTasks()
  const { data: candidates, isLoading: candidatesLoading } = useNewCandidates()
  const { data: reengagement, isLoading: reengagementLoading } = useReengagementOpportunities()

  const icp = (user?.icp_config ?? {}) as {
    venue_types?: string[]
    cover_count_min?: number | null
    cover_count_max?: number | null
    suburbs?: string[]
  }

  const filteredCandidates = icpFilterOn && candidates
    ? candidates.filter((c) => {
        const venueTypesOk = !icp.venue_types?.length ||
          (c.venue_type_guess && icp.venue_types.includes(c.venue_type_guess))
        const suburbsOk = !icp.suburbs?.length ||
          (c.suburb && icp.suburbs.map((s) => s.toLowerCase()).includes(c.suburb.toLowerCase()))
        return venueTypesOk && suburbsOk
      })
    : candidates

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

  function toggleReplyExpand(id: string) {
    setExpandedReplies((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleReplySubmit() {
    if (!replyTarget || !user || !replyText.trim()) return
    setReplySubmitting(true)
    try {
      await createActivity.mutateAsync({
        org_id: user.org_id,
        contact_id: replyTarget.contact_id ?? undefined,
        deal_id: replyTarget.deal_id ?? undefined,
        activity_type: 'email_manual',
        subject: `Re: ${replyTarget.subject ?? ''}`,
        body: replyText.trim(),
      })
      setReplyTarget(null)
      setReplyText('')
    } finally {
      setReplySubmitting(false)
    }
  }

  function handleArchive(id: string) {
    archiveActivity.mutate(id)
  }

  async function handleMoveStage() {
    if (!moveTarget?.deal_id || !moveStageId) return
    await updateDealStage.mutateAsync({ dealId: moveTarget.deal_id, stageId: moveStageId })
    setMoveTarget(null)
    setMoveStageId('')
  }

  function handleCreateTask(reply: BriefingReply) {
    if (!user) return
    createTask.mutate({
      org_id: user.org_id,
      title: `Follow up: ${reply.contact_name}`,
      contact_id: reply.contact_id ?? undefined,
      deal_id: reply.deal_id ?? undefined,
      due_at: addDays(new Date(), 1).toISOString(),
      task_type: 'follow_up',
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
                  <div key={reply.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{reply.contact_name}</p>
                        {reply.venue_name && (
                          <p className="text-xs text-muted-foreground">{reply.venue_name}</p>
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
                      <div>
                        <p className={`text-sm text-muted-foreground ${expandedReplies.has(reply.id) ? '' : 'line-clamp-2'}`}>
                          {reply.body}
                        </p>
                        {reply.body.length > 120 && (
                          <button
                            className="text-xs text-primary flex items-center gap-0.5 mt-0.5 hover:underline"
                            onClick={() => toggleReplyExpand(reply.id)}
                          >
                            {expandedReplies.has(reply.id) ? <><ChevronUp className="w-3 h-3" />Less</> : <><ChevronDown className="w-3 h-3" />More</>}
                          </button>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => { setReplyTarget(reply); setReplyText('') }}
                      >
                        <Reply className="w-3 h-3" />
                        Reply
                      </Button>
                      {reply.deal_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => { setMoveTarget(reply); setMoveStageId('') }}
                        >
                          <MoveRight className="w-3 h-3" />
                          Move stage
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => handleCreateTask(reply)}
                        disabled={createTask.isPending}
                      >
                        <ListTodo className="w-3 h-3" />
                        Create task
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => handleArchive(reply.id)}
                        disabled={archiveActivity.isPending}
                      >
                        <Archive className="w-3 h-3" />
                        Archive
                      </Button>
                    </div>
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
                    {filteredCandidates?.length ?? 0}
                  </Badge>
                )}
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-0 pb-0">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {icpFilterOn
                  ? `${filteredCandidates?.length ?? 0} of ${candidates?.length ?? 0} match your ICP`
                  : `${candidates?.length ?? 0} total`}
              </span>
              <button
                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${
                  icpFilterOn
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground border-border hover:text-foreground'
                }`}
                onClick={(e) => { e.stopPropagation(); setIcpFilterOn((v) => !v) }}
              >
                <Filter className="w-3 h-3" />
                Matches my ICP
              </button>
            </div>
            {candidatesLoading && (
              <p className="text-sm text-muted-foreground px-4 py-4">Loading…</p>
            )}
            {!candidatesLoading && (!filteredCandidates || filteredCandidates.length === 0) && (
              <p className="text-sm text-muted-foreground px-4 py-4">
                {icpFilterOn && (candidates?.length ?? 0) > 0
                  ? 'No candidates match your ICP. Toggle filter off to see all.'
                  : 'Nothing here today.'}
              </p>
            )}
            {filteredCandidates && filteredCandidates.length > 0 && (
              <div className="divide-y">
                {filteredCandidates.map((candidate) => (
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
      {/* Reply dialog */}
      <Dialog open={!!replyTarget} onOpenChange={(v) => !v && setReplyTarget(null)}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Reply to {replyTarget?.contact_name}</DialogTitle>
          </DialogHeader>
          {replyTarget?.subject && (
            <p className="text-xs text-muted-foreground">Re: {replyTarget.subject}</p>
          )}
          <Textarea
            rows={5}
            placeholder="Type your reply…"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setReplyTarget(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!replyText.trim() || replySubmitting}
              onClick={handleReplySubmit}
            >
              {replySubmitting ? 'Logging…' : 'Log reply'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move deal stage dialog */}
      <Dialog open={!!moveTarget} onOpenChange={(v) => !v && setMoveTarget(null)}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Move deal to stage</DialogTitle>
          </DialogHeader>
          <Select value={moveStageId} onValueChange={setMoveStageId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a stage" />
            </SelectTrigger>
            <SelectContent>
              {stages?.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setMoveTarget(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!moveStageId || updateDealStage.isPending}
              onClick={handleMoveStage}
            >
              {updateDealStage.isPending ? 'Moving…' : 'Move'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
