import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Loader2,
  Plus,
  Save,
  Trash2,
  Pause,
  Play,
  X as XIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  DataTable,
  EmptyState,
  ErrorAlert,
  PageHeader,
  StatusPill,
  SkeletonBlock,
  type ColumnDef,
} from '@/components/primitives'
import {
  MAX_STEPS_PER_SEQUENCE,
  useSequence,
  useSequenceSteps,
  useSequenceEnrolments,
  useUpdateSequence,
  useUpdateEnrolment,
  type EnrolmentStatus,
  type SequenceEnrolment,
} from '@/lib/queries/sequences'
import { useAuth } from '@/hooks/useAuth'
import { formatRelative } from '@/lib/utils'

interface DraftStep {
  step_number: number
  delay_days: number
  prompt_instructions: string
}

function stepsAreDirty(a: DraftStep[], b: DraftStep[]): boolean {
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].step_number !== b[i].step_number ||
      a[i].delay_days !== b[i].delay_days ||
      a[i].prompt_instructions !== b[i].prompt_instructions
    ) {
      return true
    }
  }
  return false
}

function statusPill(status: EnrolmentStatus | string | null) {
  switch (status) {
    case 'active':
      return (
        <StatusPill tone="success" uppercase>
          Active
        </StatusPill>
      )
    case 'paused':
      return (
        <StatusPill tone="warm" uppercase>
          Paused
        </StatusPill>
      )
    case 'completed':
      return (
        <StatusPill tone="neutral" uppercase>
          Completed
        </StatusPill>
      )
    case 'cancelled':
      return (
        <StatusPill tone="cold" uppercase>
          Cancelled
        </StatusPill>
      )
    case 'reply_received':
      return (
        <StatusPill tone="success" uppercase>
          Replied
        </StatusPill>
      )
    case 'failed':
      return (
        <StatusPill tone="cold" uppercase>
          Failed
        </StatusPill>
      )
    default:
      return <StatusPill tone="neutral">{status ?? '—'}</StatusPill>
  }
}

export function SequenceEditPage() {
  const { id } = useParams<{ id: string }>()
  const sequenceId = id ?? ''
  const { user } = useAuth()
  const navigate = useNavigate()

  const seqQ = useSequence(sequenceId)
  const stepsQ = useSequenceSteps(sequenceId)
  const enrolQ = useSequenceEnrolments(sequenceId)

  const updateSeq = useUpdateSequence()
  const updateEnrol = useUpdateEnrolment()

  // Local form state, hydrated once per loaded sequence/steps payload.
  // We track which payload we've seeded from and re-seed on identity change
  // (typed render-time pattern from the React docs — avoids setState-in-effect).
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [steps, setSteps] = useState<DraftStep[]>([])
  const [initialSteps, setInitialSteps] = useState<DraftStep[]>([])
  const [seededSeqId, setSeededSeqId] = useState<string | null>(null)
  const [seededStepsForSeqId, setSeededStepsForSeqId] = useState<string | null>(null)

  if (seqQ.data && seededSeqId !== seqQ.data.id) {
    setSeededSeqId(seqQ.data.id)
    setName(seqQ.data.name)
    setDescription(seqQ.data.description ?? '')
    setIsActive(seqQ.data.is_active ?? true)
  }

  if (stepsQ.data && seededStepsForSeqId !== sequenceId) {
    const loaded: DraftStep[] = stepsQ.data.map((s) => ({
      step_number: s.step_number,
      delay_days: s.delay_days,
      prompt_instructions: s.prompt_instructions ?? '',
    }))
    setSeededStepsForSeqId(sequenceId)
    setSteps(loaded)
    setInitialSteps(loaded)
  }

  const isDirty = useMemo(() => {
    if (!seqQ.data) return false
    if (name !== seqQ.data.name) return true
    if ((description || null) !== (seqQ.data.description ?? null)) return true
    if (isActive !== (seqQ.data.is_active ?? true)) return true
    if (stepsAreDirty(steps, initialSteps)) return true
    return false
  }, [name, description, isActive, steps, initialSteps, seqQ.data])

  function setStepField<K extends keyof DraftStep>(
    idx: number,
    key: K,
    value: DraftStep[K],
  ) {
    setSteps((curr) => {
      const next = curr.slice()
      next[idx] = { ...next[idx], [key]: value }
      return next
    })
  }

  function addStep() {
    if (steps.length >= MAX_STEPS_PER_SEQUENCE) return
    setSteps((curr) => [
      ...curr,
      {
        step_number: curr.length + 1,
        delay_days: 3,
        prompt_instructions:
          'Follow-up step. Keep under 70 words. Reference the previous touch without rehashing it. End with a low-friction question.',
      },
    ])
  }

  function removeStep(idx: number) {
    setSteps((curr) => {
      const next = curr.filter((_, i) => i !== idx)
      // Renumber to keep step_number contiguous starting at 1.
      return next.map((s, i) => ({ ...s, step_number: i + 1 }))
    })
  }

  function moveStep(idx: number, direction: -1 | 1) {
    const target = idx + direction
    if (target < 0 || target >= steps.length) return
    setSteps((curr) => {
      const next = curr.slice()
      const [moved] = next.splice(idx, 1)
      next.splice(target, 0, moved)
      return next.map((s, i) => ({ ...s, step_number: i + 1 }))
    })
  }

  async function handleSave() {
    if (!user || !seqQ.data) return
    const cleanName = name.trim()
    if (!cleanName) {
      toast.error('Sequence name is required.')
      return
    }
    if (steps.length === 0) {
      toast.error('A sequence needs at least one step.')
      return
    }
    for (const s of steps) {
      if (!s.prompt_instructions.trim()) {
        toast.error(`Step ${s.step_number} needs prompt instructions.`)
        return
      }
      if (s.delay_days < 0) {
        toast.error(`Step ${s.step_number} delay must be 0 or greater.`)
        return
      }
    }
    try {
      await updateSeq.mutateAsync({
        id: sequenceId,
        org_id: user.org_id,
        payload: {
          name: cleanName,
          description: description.trim() || null,
          is_active: isActive,
          steps: steps.map((s) => ({
            step_number: s.step_number,
            delay_days: s.delay_days,
            prompt_instructions: s.prompt_instructions.trim(),
          })),
        },
      })
    } catch {
      /* toast via mutation */
    }
  }

  const enrolColumns: ColumnDef<SequenceEnrolment>[] = [
    {
      id: 'contact',
      header: 'Contact',
      cell: (e) =>
        e.contact ? (
          <Link
            to={`/contacts/${e.contact.id}`}
            className="font-medium text-ink hover:text-[color:var(--jordan-accent)]"
          >
            {e.contact.full_name}
            {e.contact.venue?.name && (
              <span className="ml-1 text-ink-faint">· {e.contact.venue.name}</span>
            )}
          </Link>
        ) : (
          <span className="text-ink-faint">Unknown</span>
        ),
    },
    {
      id: 'step',
      header: 'Step',
      width: '70px',
      align: 'right',
      numeric: true,
      cell: (e) => (
        <span className="font-mono jordan-tnum">
          {e.current_step ?? 0}/{steps.length}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: '120px',
      cell: (e) => statusPill(e.status),
    },
    {
      id: 'next',
      header: 'Next due',
      width: '140px',
      cell: (e) =>
        e.status === 'active' ? (
          <span className="text-ink-muted text-[12px]">
            {formatRelative(e.next_step_due_at)}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      id: 'last',
      header: 'Last fired',
      width: '140px',
      cell: (e) =>
        e.last_step_fired_at ? (
          <span className="text-ink-muted text-[12px]">
            {formatRelative(e.last_step_fired_at)}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      id: 'actions',
      header: '',
      width: '160px',
      align: 'right',
      cell: (e) => (
        <div className="flex items-center justify-end gap-1">
          {e.status === 'active' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)]"
              onClick={() =>
                updateEnrol.mutate({ id: e.id, status: 'paused' })
              }
              disabled={updateEnrol.isPending}
            >
              <Pause className="mr-1 h-3 w-3" />
              Pause
            </Button>
          )}
          {e.status === 'paused' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)]"
              onClick={() =>
                updateEnrol.mutate({ id: e.id, status: 'active' })
              }
              disabled={updateEnrol.isPending}
            >
              <Play className="mr-1 h-3 w-3" />
              Resume
            </Button>
          )}
          {(e.status === 'active' || e.status === 'paused') && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-[var(--jordan-danger-text)] hover:bg-[var(--jordan-danger-soft)]"
              onClick={() =>
                updateEnrol.mutate({ id: e.id, status: 'cancelled' })
              }
              disabled={updateEnrol.isPending}
            >
              <XIcon className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ]

  if (seqQ.error) {
    return (
      <div className="p-4 sm:p-6 max-w-[1200px]">
        <ErrorAlert
          error={seqQ.error}
          onRetry={() => seqQ.refetch()}
          title="Couldn't load sequence"
        />
      </div>
    )
  }

  if (seqQ.isLoading || !seqQ.data) {
    return (
      <div className="p-4 sm:p-6 max-w-[1200px] space-y-4">
        <SkeletonBlock className="h-12" />
        <SkeletonBlock className="h-64" />
      </div>
    )
  }

  const enrolments = enrolQ.data ?? []
  const activeCount = enrolments.filter((e) => e.status === 'active').length

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] space-y-5">
      <button
        type="button"
        onClick={() => navigate('/sequences')}
        className="flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to sequences
      </button>

      <PageHeader
        eyebrow="Sequence"
        title={name || 'Untitled sequence'}
        description={
          <span className="inline-flex items-center gap-2">
            {isActive ? (
              <StatusPill tone="success" uppercase>
                Active
              </StatusPill>
            ) : (
              <StatusPill tone="neutral" uppercase>
                Paused
              </StatusPill>
            )}
            <span className="text-ink-muted">
              {steps.length} step{steps.length === 1 ? '' : 's'} · {activeCount} active
              enrolment{activeCount === 1 ? '' : 's'}
            </span>
          </span>
        }
        actions={
          <Button
            size="sm"
            className="h-8"
            onClick={handleSave}
            disabled={!isDirty || updateSeq.isPending}
          >
            {updateSeq.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-1.5" />
                Save changes
              </>
            )}
          </Button>
        }
      />

      {/* Metadata */}
      <section
        aria-label="Sequence metadata"
        className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 p-4 space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Hospitality cold outbound"
            />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsActive((v) => !v)}
              className="h-9"
            >
              {isActive ? (
                <>
                  <Pause className="w-3.5 h-3.5 mr-1.5" />
                  Pause sequence
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Activate sequence
                </>
              )}
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label>
            Description{' '}
            <span className="text-muted-foreground text-xs">(optional)</span>
          </Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this sequence for?"
            maxLength={300}
          />
        </div>
        <p className="text-[11px] text-ink-faint">
          Pausing a sequence stops the worker from generating new drafts for its
          active enrolments. Existing drafts in your queue stay there.
        </p>
      </section>

      {/* Steps */}
      <section aria-label="Steps" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Steps</h2>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={addStep}
            disabled={steps.length >= MAX_STEPS_PER_SEQUENCE}
            title={
              steps.length >= MAX_STEPS_PER_SEQUENCE
                ? `Max ${MAX_STEPS_PER_SEQUENCE} steps per sequence in v1`
                : undefined
            }
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add step
          </Button>
        </div>

        {steps.length === 0 ? (
          <EmptyState
            title="No steps yet"
            body="A sequence needs at least one step before the worker can fire it."
            action={
              <Button size="sm" onClick={addStep}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add first step
              </Button>
            }
          />
        ) : (
          <ol className="space-y-3">
            {steps.map((step, idx) => (
              <li
                key={idx}
                className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-[color:var(--jordan-accent-soft)] px-1.5 text-[12px] font-semibold text-[color:var(--jordan-accent-hover)] jordan-tnum">
                      {step.step_number}
                    </span>
                    <span className="text-[13px] font-medium text-ink">
                      Step {step.step_number}
                      {idx === 0 && (
                        <span className="ml-2 text-[11px] text-ink-faint">
                          (initial — sent on enrolment)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => moveStep(idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Move step ${step.step_number} up`}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => moveStep(idx, 1)}
                      disabled={idx === steps.length - 1}
                      aria-label={`Move step ${step.step_number} down`}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-[var(--jordan-danger-text)] hover:bg-[var(--jordan-danger-soft)]"
                      onClick={() => removeStep(idx)}
                      aria-label={`Remove step ${step.step_number}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <div className="space-y-1">
                    <Label>Delay (days)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      value={step.delay_days}
                      onChange={(e) =>
                        setStepField(
                          idx,
                          'delay_days',
                          Math.max(0, Number(e.target.value) || 0),
                        )
                      }
                      className="font-mono jordan-tnum"
                    />
                    <p className="text-[11px] text-ink-faint">
                      {idx === 0
                        ? 'Step 1 fires immediately (delay 0).'
                        : `Days after previous step.`}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label>Prompt instructions</Label>
                    <Textarea
                      rows={3}
                      value={step.prompt_instructions}
                      onChange={(e) =>
                        setStepField(idx, 'prompt_instructions', e.target.value)
                      }
                      placeholder="What should this email do? Tone, length, CTA…"
                      maxLength={600}
                    />
                    <p className="text-[11px] text-ink-faint">
                      Claude generates the email from your voice rules + this
                      instruction. Be specific (length, tone, CTA).
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Enrolments */}
      <section aria-label="Enrolments" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Enrolled contacts</h2>
          <span className="text-[11px] text-ink-faint">
            {enrolments.length} total
          </span>
        </div>

        {enrolQ.error ? (
          <ErrorAlert
            error={enrolQ.error}
            onRetry={() => enrolQ.refetch()}
            title="Couldn't load enrolments"
          />
        ) : !enrolQ.isLoading && enrolments.length === 0 ? (
          <EmptyState
            title="No enrolments yet"
            body="Enrol contacts from the contact detail page or from a bulk selection on the Contacts list."
          />
        ) : (
          <DataTable<SequenceEnrolment>
            rows={enrolments}
            columns={enrolColumns}
            rowKey={(e) => e.id}
            loading={enrolQ.isLoading}
            ariaLabel="Sequence enrolments"
          />
        )}
      </section>

    </div>
  )
}
