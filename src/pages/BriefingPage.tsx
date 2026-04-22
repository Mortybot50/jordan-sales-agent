import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Accordion } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
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
  EmptyState,
  PageHeader,
  SkeletonRow,
  StatusPill,
} from '@/components/primitives'
import { BriefingSection } from '@/components/briefing/BriefingSection'
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
import {
  RefreshCw,
  CheckCircle,
  Clock,
  UserSearch,
  Repeat,
  Reply,
  Archive,
  MoveRight,
  ListTodo,
  ChevronDown,
  ChevronUp,
  Filter,
  MailOpen,
  Inbox,
  Users2,
  CalendarClock,
} from 'lucide-react'
import { addDays, endOfDay, format } from 'date-fns'

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

  const [replyTarget, setReplyTarget] = useState<BriefingReply | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)

  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())

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

  const todayLabel = format(new Date(), "EEEE · d MMM yyyy")
  const aestTime = lastRefreshed.toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Australia/Melbourne',
  })

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <PageHeader
        eyebrow={todayLabel}
        title="Morning Briefing"
        description={
          <span className="text-ink-muted">
            Last synced {formatRelative(lastRefreshed.toISOString())}{' '}
            <span className="jordan-tnum text-ink-faint">· {aestTime} AEST</span>
          </span>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      <Accordion type="multiple" defaultValue={defaultOpen} className="space-y-3">
        {/* Section 1: Overnight Replies */}
        <BriefingSection
          id="replies"
          icon={MailOpen}
          tone="success"
          title="Overnight Replies"
          count={repliesLoading ? undefined : replies?.length ?? 0}
        >
          {repliesLoading && (
            <div className="divide-y divide-hairline">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonRow key={i} columns={3} height={56} />
              ))}
            </div>
          )}
          {!repliesLoading && (!replies || replies.length === 0) && (
            <EmptyState
              compact
              icon={Inbox}
              title="No new replies overnight"
              body="Replies from sequences land here first thing."
            />
          )}
          {replies && replies.length > 0 && (
            <div className="divide-y divide-hairline">
              {replies.map((reply) => (
                <div key={reply.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[13px] font-medium text-ink">
                        {reply.contact_name}
                      </p>
                      {reply.venue_name && (
                        <p className="break-words text-[12px] text-ink-muted">
                          {reply.venue_name}
                        </p>
                      )}
                    </div>
                    <span className="jordan-tnum shrink-0 text-[11px] text-ink-faint">
                      {formatRelative(reply.occurred_at)}
                    </span>
                  </div>
                  {reply.subject && (
                    <p className="break-words text-[13px] font-medium text-ink">
                      {reply.subject}
                    </p>
                  )}
                  {reply.body && (
                    <div>
                      <p
                        className={`break-words text-[13px] leading-5 text-ink-muted ${
                          expandedReplies.has(reply.id) ? '' : 'line-clamp-3'
                        }`}
                      >
                        {reply.body}
                      </p>
                      {reply.body.length > 120 && (
                        <button
                          className="mt-0.5 flex items-center gap-0.5 text-[11px] text-[var(--jordan-accent)] hover:underline"
                          onClick={() => toggleReplyExpand(reply.id)}
                        >
                          {expandedReplies.has(reply.id) ? (
                            <>
                              <ChevronUp className="size-3" />
                              Less
                            </>
                          ) : (
                            <>
                              <ChevronDown className="size-3" />
                              More
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => {
                        setReplyTarget(reply)
                        setReplyText('')
                      }}
                    >
                      <Reply className="size-3" />
                      Reply
                    </Button>
                    {reply.deal_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-[11px]"
                        onClick={() => {
                          setMoveTarget(reply)
                          setMoveStageId('')
                        }}
                      >
                        <MoveRight className="size-3" />
                        Move stage
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => handleCreateTask(reply)}
                      disabled={createTask.isPending}
                    >
                      <ListTodo className="size-3" />
                      Create task
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-[11px] text-ink-muted hover:text-ink"
                      onClick={() => handleArchive(reply.id)}
                      disabled={archiveActivity.isPending}
                    >
                      <Archive className="size-3" />
                      Archive
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </BriefingSection>

        {/* Section 2: Follow-ups Due Today */}
        <BriefingSection
          id="tasks"
          icon={Clock}
          tone="accent"
          title="Follow-ups Due Today"
          count={tasksLoading ? undefined : todayTasks?.length ?? 0}
        >
          {tasksLoading && (
            <div className="divide-y divide-hairline">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonRow key={i} columns={3} height={48} />
              ))}
            </div>
          )}
          {!tasksLoading && (!todayTasks || todayTasks.length === 0) && (
            <EmptyState
              compact
              icon={CalendarClock}
              title="Nothing due today"
              body="Re-engagement and generated tasks land here."
            />
          )}
          {todayTasks && todayTasks.length > 0 && (
            <div className="divide-y divide-hairline">
              {todayTasks.map((task) => (
                <div key={task.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-medium text-ink line-clamp-2">
                      {task.title}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                      {task.contact_name && (
                        <span className="break-words">{task.contact_name}</span>
                      )}
                      {task.venue_name && (
                        <>
                          <span className="text-ink-faint">·</span>
                          <span className="break-words">{task.venue_name}</span>
                        </>
                      )}
                      {task.deal_title && (
                        <>
                          <span className="text-ink-faint">·</span>
                          <span className="break-words italic">{task.deal_title}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                    onClick={() => handleMarkDone(task.id)}
                    disabled={completeTask.isPending}
                  >
                    <CheckCircle className="size-3.5" />
                    Done
                  </Button>
                </div>
              ))}
            </div>
          )}
        </BriefingSection>

        {/* Section 3: New Auto-sourced Candidates */}
        <BriefingSection
          id="candidates"
          icon={UserSearch}
          tone="warning"
          title="New Auto-sourced Candidates"
          count={candidatesLoading ? undefined : filteredCandidates?.length ?? 0}
          headerAction={
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-[var(--jordan-radius-sm)] border px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--jordan-accent-ring)] ${
                icpFilterOn
                  ? 'border-[color:var(--jordan-accent)] bg-[var(--jordan-accent-soft)] text-[var(--jordan-accent-hover)]'
                  : 'border-hairline bg-surface-1 text-ink-muted hover:bg-surface-3'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                setIcpFilterOn((v) => !v)
              }}
            >
              <Filter className="size-3" />
              Matches ICP
            </button>
          }
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="jordan-tnum text-[11px] text-ink-faint">
              {icpFilterOn
                ? `${filteredCandidates?.length ?? 0} of ${candidates?.length ?? 0} match your ICP`
                : `${candidates?.length ?? 0} total`}
            </span>
          </div>
          {candidatesLoading && (
            <div className="divide-y divide-hairline">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonRow key={i} columns={3} height={48} />
              ))}
            </div>
          )}
          {!candidatesLoading && (!filteredCandidates || filteredCandidates.length === 0) && (
            <EmptyState
              compact
              icon={Users2}
              title={
                icpFilterOn && (candidates?.length ?? 0) > 0
                  ? 'No ICP-matching candidates'
                  : 'No new candidates today'
              }
              body={
                icpFilterOn && (candidates?.length ?? 0) > 0
                  ? 'Toggle the ICP filter off to see every new candidate.'
                  : 'New sourced venues will appear here when found.'
              }
            />
          )}
          {filteredCandidates && filteredCandidates.length > 0 && (
            <div className="divide-y divide-hairline">
              {filteredCandidates.map((candidate) => (
                <div key={candidate.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-medium text-ink">
                      {candidate.name ?? 'Unnamed venue'}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                      {candidate.venue_type_guess && (
                        <span>{venueTypeLabel(candidate.venue_type_guess)}</span>
                      )}
                      {candidate.address && (
                        <>
                          {candidate.venue_type_guess && (
                            <span className="text-ink-faint">·</span>
                          )}
                          <span className="break-words">
                            {candidate.suburb ?? candidate.address}
                          </span>
                        </>
                      )}
                      {candidate.icp_score_guess != null && (
                        <>
                          <span className="text-ink-faint">·</span>
                          <StatusPill tone="warm" className="jordan-tnum" uppercase>
                            ICP {candidate.icp_score_guess}
                          </StatusPill>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => navigate('/contacts/new')}
                  >
                    Convert
                  </Button>
                </div>
              ))}
            </div>
          )}
        </BriefingSection>

        {/* Section 4: Re-engagement Opportunities */}
        <BriefingSection
          id="reengagement"
          icon={Repeat}
          tone="warm"
          title="Re-engagement Opportunities"
          count={reengagementLoading ? undefined : reengagement?.length ?? 0}
        >
          {reengagementLoading && (
            <div className="divide-y divide-hairline">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonRow key={i} columns={3} height={48} />
              ))}
            </div>
          )}
          {!reengagementLoading && (!reengagement || reengagement.length === 0) && (
            <EmptyState
              compact
              icon={Users2}
              title="Everyone is warm"
              body="Silent contacts will surface here."
            />
          )}
          {reengagement && reengagement.length > 0 && (
            <div className="divide-y divide-hairline">
              {reengagement.map((contact) => (
                <div key={contact.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-medium text-ink">
                      {contact.full_name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                      {contact.venue_name && (
                        <span className="break-words">{contact.venue_name}</span>
                      )}
                      {contact.venue_name && <span className="text-ink-faint">·</span>}
                      <span className="jordan-tnum font-medium text-[var(--jordan-warm-text)]">
                        {contact.days_silent}d silent
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => handleReengage(contact.id, contact.full_name)}
                    disabled={createTask.isPending}
                  >
                    Start follow-up
                  </Button>
                </div>
              ))}
            </div>
          )}
        </BriefingSection>
      </Accordion>

      {/* Reply dialog */}
      <Dialog open={!!replyTarget} onOpenChange={(v) => !v && setReplyTarget(null)}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Reply to {replyTarget?.contact_name}</DialogTitle>
          </DialogHeader>
          {replyTarget?.subject && (
            <p className="text-[11px] text-ink-muted">Re: {replyTarget.subject}</p>
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
