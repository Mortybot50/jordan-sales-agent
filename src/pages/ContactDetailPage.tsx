import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Briefcase,
  Globe,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  Sparkles,
  Workflow,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

import {
  ActivityIcon,
  DraftTypeBadge,
  EmptyState,
  ErrorAlert,
  FieldRow,
  IntentBadge,
  MetricNumber,
  PageHeader,
  ScoreBadge,
  SkeletonBlock,
  StatusPill,
  TemperatureChip,
  getActivityMeta,
} from '@/components/primitives'

import { ClaudePanel } from '@/components/claude/ClaudePanel'
import { useContact, useUpdateContact } from '@/lib/queries/contacts'
import { useVenueGroupBadges } from '@/lib/queries/venue-groups'
import { AssignToGroupCombobox } from '@/components/venue-groups/AssignToGroupCombobox'
import { GroupChip } from '@/components/venue-groups/GroupChip'
import { useContactDeals, useCreateDeal } from '@/lib/queries/deals'
import { cleanDealTitle } from '@/lib/dealTitle'
import { PackageDealForm } from '@/components/pipeline/PackageDealForm'
import type { PackageDealValues } from '@/lib/schemas/deal'
import {
  useContactActivities,
  useCreateActivity,
} from '@/lib/queries/activities'
import { useGenerateDraft } from '@/lib/queries/drafts'
import {
  useSequences,
  useEnrolContacts,
  useCanonicalSequence,
} from '@/lib/queries/sequences'
import { useAuth } from '@/hooks/useAuth'
import {
  activityFormSchema,
  type ActivityFormValues,
} from '@/lib/schemas/activity'
import {
  formatCurrency,
  formatDate,
  formatRelative,
  roleLabel,
  venueTypeLabel,
} from '@/lib/utils'
import type { DraftType } from '@/lib/queries/drafts'

const ROLES = [
  { value: 'venue_manager', label: 'Venue Manager' },
  { value: 'owner', label: 'Owner' },
  { value: 'f_b_director', label: 'F&B Director' },
  { value: 'head_chef', label: 'Head Chef' },
  { value: 'events_manager', label: 'Events Manager' },
]

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const { data: contact, isLoading, error, refetch } = useContact(id ?? '')
  const { data: deals } = useContactDeals(id ?? '')
  const { data: activities } = useContactActivities(id ?? '')
  const { data: groupBadges } = useVenueGroupBadges()

  const updateContact = useUpdateContact(id ?? '')
  const createDeal = useCreateDeal()
  const createActivity = useCreateActivity()
  const generateDraft = useGenerateDraft()

  const [dealDialogOpen, setDealDialogOpen] = useState(false)
  const [activityDialogOpen, setActivityDialogOpen] = useState(false)
  const [draftDialogOpen, setDraftDialogOpen] = useState(false)
  const [draftType, setDraftType] = useState<DraftType>('cold_outreach')
  const [draftHint, setDraftHint] = useState('')
  const [enrolDialogOpen, setEnrolDialogOpen] = useState(false)
  const [selectedSequenceId, setSelectedSequenceId] = useState<string>('')
  const [claudeOpen, setClaudeOpen] = useState(false)

  const sequencesQ = useSequences()
  const enrolContacts = useEnrolContacts()
  const canonicalSequenceQ = useCanonicalSequence(user?.org_id)

  // Quick-enrol into the canonical Hospitality 3-Touch (seeded per-org).
  // Same plumbing as the dialog enrol — Day-0 draft is produced by the
  // sequence-tick worker (template path) and lands in the Drafts queue
  // with status='pending' for Jordan's manual approval. No auto-send.
  async function handleQuickEnrolCanonical() {
    if (!user || !contact || !canonicalSequenceQ.data) return
    try {
      const res = await enrolContacts.mutateAsync({
        org_id: user.org_id,
        enrolled_by_user_id: user.id,
        sequence_id: canonicalSequenceQ.data.id,
        contact_ids: [contact.id],
      })
      if (res.enrolled === 1) {
        toast.success(
          'Enrolled in Hospitality 3-Touch — Day-0 draft will appear in Drafts shortly',
        )
      } else if (res.skipped_already_enrolled > 0) {
        toast.error('Already actively enrolled in this sequence.')
      } else if (res.skipped_dnc > 0) {
        toast.error('Contact is marked Do Not Contact.')
      } else if (res.skipped_suppressed > 0) {
        toast.error('Contact is on the suppression list.')
      } else if (res.skipped_no_email > 0) {
        toast.error('Contact has no email address.')
      } else {
        toast.error('Could not enrol contact.')
      }
    } catch {
      /* toast via mutation */
    }
  }

  async function handleEnrol() {
    if (!user || !contact || !selectedSequenceId) return
    try {
      const res = await enrolContacts.mutateAsync({
        org_id: user.org_id,
        enrolled_by_user_id: user.id,
        sequence_id: selectedSequenceId,
        contact_ids: [contact.id],
      })
      if (res.enrolled === 1) {
        toast.success('Enrolled in sequence — first draft will appear soon')
      } else if (res.skipped_already_enrolled > 0) {
        toast.error('Already actively enrolled in this sequence.')
      } else if (res.skipped_dnc > 0) {
        toast.error('Contact is marked Do Not Contact.')
      } else if (res.skipped_suppressed > 0) {
        toast.error('Contact is on the suppression list.')
      } else if (res.skipped_no_email > 0) {
        toast.error('Contact has no email address.')
      } else {
        toast.error('Could not enrol contact.')
      }
      setEnrolDialogOpen(false)
      setSelectedSequenceId('')
    } catch {
      /* toast via mutation */
    }
  }

  type ActivityFilter = 'all' | 'email' | 'call' | 'note' | 'meeting'
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')

  // Maps DB activity_type values to UI tab buckets. Email covers all
  // outbound/inbound + status (sent/opened/clicked/reply/bounce/unsubscribe).
  function activityBucket(t: string): ActivityFilter {
    if (
      t === 'email_sent' ||
      t === 'email_opened' ||
      t === 'email_clicked' ||
      t === 'reply_received' ||
      t === 'email_inbound' ||
      t === 'email_outbound' ||
      t === 'email_manual' ||
      t === 'bounce' ||
      t === 'unsubscribe'
    )
      return 'email'
    if (t === 'call_note') return 'call'
    if (t === 'note' || t === 'voice_note') return 'note'
    if (t === 'meeting_note' || t === 'meeting_booked') return 'meeting'
    return 'all'
  }

  const activityCounts = (activities ?? []).reduce(
    (acc, a) => {
      const b = activityBucket(a.activity_type)
      if (b !== 'all') acc[b] = (acc[b] ?? 0) + 1
      return acc
    },
    { email: 0, call: 0, note: 0, meeting: 0 } as Record<Exclude<ActivityFilter, 'all'>, number>,
  )

  const filteredActivities =
    activityFilter === 'all'
      ? activities ?? []
      : (activities ?? []).filter(
          (a) => activityBucket(a.activity_type) === activityFilter,
        )

  const filterEmptyMessage: Record<ActivityFilter, { title: string; body: string }> = {
    all: {
      title: 'No activity yet',
      body: 'Log a call, meeting or note to start building the timeline.',
    },
    email: {
      title: 'No emails on this contact yet',
      body: 'Send an outbound email or wait for inbound — they\'ll show up here.',
    },
    call: {
      title: 'No call notes yet',
      body: 'Log one from this contact or the deal drawer after a call.',
    },
    note: {
      title: 'No notes yet',
      body: 'Add a freeform note or voice note about this contact.',
    },
    meeting: {
      title: 'No meetings yet',
      body: 'Log a meeting note or booked meeting once one is on the books.',
    },
  }

  const activityForm = useForm<ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: { occurred_at: new Date().toISOString().split('T')[0] },
  })

  // Inline editing state per field (role, email, phone, linkedin_url, notes)
  type EditableField = 'role' | 'email' | 'phone' | 'linkedin_url' | 'notes'
  const [editingField, setEditingField] = useState<EditableField | null>(null)
  const [fieldDraft, setFieldDraft] = useState<Record<string, string>>({})
  // Empty fields hide behind an expander — the wall-of-"—" was Jordan's #2
  // complaint. Expanding reveals them for editing.
  const [showEmptyFields, setShowEmptyFields] = useState(false)

  function openField(name: EditableField) {
    if (!contact) return
    setFieldDraft((d) => ({
      ...d,
      [name]: ((contact[name as keyof typeof contact] as string) ?? '') as string,
    }))
    setEditingField(name)
  }

  async function commitField(name: EditableField) {
    if (!contact) return
    const value = (fieldDraft[name] ?? '').trim()
    await updateContact.mutateAsync({
      [name]: value === '' ? null : value,
    })
    setEditingField(null)
  }

  async function submitPackageDeal(values: PackageDealValues) {
    if (!user || !contact) return
    const deal = await createDeal.mutateAsync({
      org_id: user.org_id,
      // SOURCE FIX: strip suffix patterns from user-typed deal titles
      // e.g. "The Espy — Purezza intro" → "The Espy"
      title: cleanDealTitle(values.title),
      contact_id: contact.id,
      venue_id: contact.venue_id ?? undefined,
      stage_id: values.stage_id,
      product_id: values.product_id,
      owner_user_id: user.id,
      term_months: values.term_months,
      commission_pct: values.commission_pct,
      weekly_price_override: values.weekly_price,
      follow_up_due: values.follow_up_due,
      notes: values.notes,
    })
    setDealDialogOpen(false)
    if (deal?.id) {
      navigate(`/pipeline?deal=${deal.id}`)
    } else {
      navigate('/pipeline')
    }
  }

  async function submitActivity(values: ActivityFormValues) {
    if (!user || !contact) return
    await createActivity.mutateAsync({
      org_id: user.org_id,
      contact_id: contact.id,
      activity_type: values.activity_type,
      subject: values.subject,
      body: values.body,
      occurred_at: values.occurred_at
        ? new Date(values.occurred_at).toISOString()
        : undefined,
    })
    setActivityDialogOpen(false)
    activityForm.reset()
  }

  function onActivityInvalid(errors: FieldErrors<ActivityFormValues>) {
    const first = Object.entries(errors)[0]
    if (first) {
      const [field, err] = first
      const message = (err as { message?: string })?.message ?? 'Invalid value'
      toast.error('Cannot log activity — check the form', {
        description: `${field}: ${message}`,
      })
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 max-w-[1400px] space-y-5">
        <SkeletonBlock height={28} width={180} />
        <SkeletonBlock height={72} />
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px] gap-4">
          <SkeletonBlock height={320} />
          <SkeletonBlock height={320} />
          <SkeletonBlock height={320} />
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl">
        <ErrorAlert error={error} onRetry={() => refetch()} title="Couldn't load contact" />
      </div>
    )
  }
  if (!contact) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl">
        <EmptyState title="Contact not found" body="This contact may have been deleted." />
      </div>
    )
  }

  const venue = contact.venue as
    | {
        id: string
        name: string
        venue_type: string | null
        address: string | null
        suburb: string | null
        website: string | null
        cover_count: number | null
        licence_type: string | null
        avg_spend_tier: string | null
        neighbourhood: string | null
      }
    | null
    | undefined

  const score = contact.lead_score?.score ?? null

  // Where-the-lead-is-at context for the header + next-step banner: the
  // contact's primary OPEN deal (newest open; else newest of any).
  const primaryDeal =
    (deals ?? []).find((d) => !d.stage?.is_closed && !d.closed_at) ?? (deals ?? [])[0] ?? null
  const nextStepDueAt = primaryDeal?.next_step_due_at ?? primaryDeal?.follow_up_due ?? null
  const nextStepNote = primaryDeal?.next_step_note ?? null
  const nextStepOverdue =
    !!nextStepDueAt && new Date(nextStepDueAt).getTime() < new Date().setHours(0, 0, 0, 0)

  // PST-imported contacts predate the activities table — their history lives
  // in the deal's thread_excerpt. Surface it as timeline entries so the
  // interaction story isn't empty.
  const pstThreads = (deals ?? [])
    .filter((d) => d.thread_excerpt && (d.thread_excerpt.subject || d.thread_excerpt.last_body))
    .map((d) => ({
      dealId: d.id,
      subject: d.thread_excerpt?.subject ?? null,
      body: d.thread_excerpt?.last_body ?? null,
      at: d.last_touch_at ?? null,
    }))

  // Which detail fields are empty (hidden behind the expander).
  const fieldEmpty = {
    role: !contact.role,
    email: !contact.email,
    phone: !contact.phone,
    linkedin_url: !contact.linkedin_url,
    notes: !contact.notes,
  }
  const emptyFieldCount = Object.values(fieldEmpty).filter(Boolean).length

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] space-y-5">
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate('/contacts')}
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-faint transition-colors hover:text-ink-muted"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to contacts
      </button>

      {/* Header — the 3-second test: name, where the lead is at, what's next */}
      <PageHeader
        eyebrow={venue?.name ? `${venue.name}` : 'Contact'}
        title={contact.full_name}
        description={
          <span className="inline-flex items-center gap-2 flex-wrap">
            <TemperatureChip
              temperature={primaryDeal?.temperature}
              source={primaryDeal?.temperature_source}
            />
            {primaryDeal?.stage?.name && (
              <StatusPill tone="accent">{primaryDeal.stage.name}</StatusPill>
            )}
            {contact.role && (
              <StatusPill tone="neutral">{roleLabel(contact.role)}</StatusPill>
            )}
            {score != null && <ScoreBadge score={score} withLabel />}
            {contact.email && <span className="text-ink-muted">{contact.email}</span>}
          </span>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setClaudeOpen(true)}
            >
              <MessageSquare className="w-4 h-4 mr-1.5" />
              Ask Claude
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setDraftDialogOpen(true)}
              disabled={generateDraft.isPending}
            >
              {generateDraft.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  Generate draft
                </>
              )}
            </Button>
            {canonicalSequenceQ.data && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={handleQuickEnrolCanonical}
                disabled={enrolContacts.isPending}
                title="Enrol in Jordan's canonical 3-touch hospitality cadence"
              >
                {enrolContacts.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Workflow className="w-4 h-4 mr-1.5" />
                )}
                Hospitality 3-Touch
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setEnrolDialogOpen(true)}
            >
              <Workflow className="w-4 h-4 mr-1.5" />
              Enrol in sequence
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={() => setDealDialogOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add to pipeline
            </Button>
          </>
        }
      />

      {/* NEXT STEP — the single most prominent element after the name. */}
      {(nextStepNote || nextStepDueAt) ? (
        <div
          className={
            nextStepOverdue
              ? 'flex items-start gap-2.5 rounded-[var(--jordan-radius-md)] border-2 border-[color:var(--jordan-danger)] bg-[color:var(--jordan-danger-soft)] px-4 py-3'
              : 'flex items-start gap-2.5 rounded-[var(--jordan-radius-md)] border border-[color:var(--jordan-accent)]/40 bg-[color:var(--jordan-accent-soft)] px-4 py-3'
          }
          data-testid="next-step-banner"
        >
          <span className="text-[18px] leading-none mt-0.5" aria-hidden>
            {nextStepOverdue ? '⏰' : '📌'}
          </span>
          <div className="min-w-0">
            <p
              className={
                nextStepOverdue
                  ? 'text-[11px] font-bold uppercase tracking-[var(--jordan-tracking-label)] text-[color:var(--jordan-danger-text)]'
                  : 'text-[11px] font-semibold uppercase tracking-[var(--jordan-tracking-label)] text-[color:var(--jordan-accent-hover)]'
              }
            >
              {nextStepOverdue ? 'Next step — OVERDUE' : 'Next step'}
              {nextStepDueAt && (
                <> · {nextStepOverdue ? 'was due' : 'due'} {new Date(nextStepDueAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</>
              )}
            </p>
            <p className="mt-0.5 text-[14px] font-medium text-ink">
              {nextStepNote ?? 'Follow up'}
            </p>
          </div>
        </div>
      ) : (
        primaryDeal && !primaryDeal.stage?.is_closed && (
          <div className="flex items-center gap-2 rounded-[var(--jordan-radius-md)] border border-dashed border-hairline px-4 py-2.5 text-[12px] text-ink-muted" data-testid="next-step-banner">
            <span aria-hidden>📌</span>
            No next step set — open the deal below and add one so this lead doesn't drift.
          </div>
        )
      )}

      {/* Three-pane workbench (collapses to stacked on <lg) */}
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        {/* ─── Pane 1 — Attributes ──────────────────────────────── */}
        <section
          aria-label="Contact details"
          className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1"
        >
          <header className="flex items-center justify-between border-b border-hairline px-3 py-2">
            <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
              Details
            </span>
          </header>
          <div className="px-3">
            {(!fieldEmpty.role || showEmptyFields) && (
            <FieldRow
              label="Role"
              value={contact.role ? roleLabel(contact.role) : <span className="text-ink-disabled">—</span>}
              editing={editingField === 'role'}
              onEditingChange={(e) => (e ? openField('role') : setEditingField(null))}
              onCommit={() => commitField('role')}
            >
              {({ commit, close }) => (
                <Select
                  value={fieldDraft.role ?? ''}
                  onValueChange={(v) => {
                    setFieldDraft((d) => ({ ...d, role: v }))
                    commit()
                  }}
                  open
                  onOpenChange={(o) => !o && close()}
                >
                  <SelectTrigger className="h-7 text-[13px]">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldRow>
            )}

            {(!fieldEmpty.email || showEmptyFields) && (
            <FieldRow
              label="Email"
              value={
                contact.email ? (
                  <span className="truncate text-ink">{contact.email}</span>
                ) : (
                  <span className="text-ink-disabled">—</span>
                )
              }
              editing={editingField === 'email'}
              onEditingChange={(e) => (e ? openField('email') : setEditingField(null))}
              onCommit={() => commitField('email')}
            >
              {({ commit, close }) => (
                <Input
                  autoFocus
                  type="email"
                  value={fieldDraft.email ?? ''}
                  onChange={(e) =>
                    setFieldDraft((d) => ({ ...d, email: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commit()
                    }
                    if (e.key === 'Escape') close()
                  }}
                  className="h-7 text-[13px]"
                />
              )}
            </FieldRow>
            )}

            {(!fieldEmpty.phone || showEmptyFields) && (
            <FieldRow
              label="Phone"
              value={
                contact.phone ? (
                  <span className="jordan-tnum font-mono text-ink">{contact.phone}</span>
                ) : (
                  <span className="text-ink-disabled">—</span>
                )
              }
              editing={editingField === 'phone'}
              onEditingChange={(e) => (e ? openField('phone') : setEditingField(null))}
              onCommit={() => commitField('phone')}
            >
              {({ commit, close }) => (
                <Input
                  autoFocus
                  type="tel"
                  value={fieldDraft.phone ?? ''}
                  onChange={(e) =>
                    setFieldDraft((d) => ({ ...d, phone: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commit()
                    }
                    if (e.key === 'Escape') close()
                  }}
                  className="h-7 text-[13px]"
                />
              )}
            </FieldRow>
            )}

            {(!fieldEmpty.linkedin_url || showEmptyFields) && (
            <FieldRow
              label="LinkedIn"
              value={
                contact.linkedin_url ? (
                  <a
                    href={contact.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-[color:var(--jordan-accent)] hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View profile
                  </a>
                ) : (
                  <span className="text-ink-disabled">—</span>
                )
              }
              editing={editingField === 'linkedin_url'}
              onEditingChange={(e) =>
                e ? openField('linkedin_url') : setEditingField(null)
              }
              onCommit={() => commitField('linkedin_url')}
            >
              {({ commit, close }) => (
                <Input
                  autoFocus
                  type="url"
                  value={fieldDraft.linkedin_url ?? ''}
                  onChange={(e) =>
                    setFieldDraft((d) => ({ ...d, linkedin_url: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commit()
                    }
                    if (e.key === 'Escape') close()
                  }}
                  className="h-7 text-[13px]"
                />
              )}
            </FieldRow>
            )}

            {(!fieldEmpty.notes || showEmptyFields) && (
            <FieldRow
              label="Notes"
              value={
                contact.notes ? (
                  <span className="line-clamp-2 whitespace-pre-wrap text-ink">
                    {contact.notes}
                  </span>
                ) : (
                  <span className="text-ink-disabled">—</span>
                )
              }
              editing={editingField === 'notes'}
              onEditingChange={(e) => (e ? openField('notes') : setEditingField(null))}
              onCommit={() => commitField('notes')}
            >
              {({ commit, close }) => (
                <Textarea
                  autoFocus
                  value={fieldDraft.notes ?? ''}
                  onChange={(e) =>
                    setFieldDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault()
                      commit()
                    }
                    if (e.key === 'Escape') close()
                  }}
                  rows={3}
                  className="text-[13px]"
                />
              )}
            </FieldRow>
            )}

            {emptyFieldCount > 0 && (
              <button
                type="button"
                className="w-full py-2 text-left text-[11px] text-ink-faint hover:text-ink-muted transition-colors"
                onClick={() => setShowEmptyFields((v) => !v)}
                data-testid="empty-fields-toggle"
              >
                {showEmptyFields
                  ? '− Hide empty fields'
                  : `+ Show ${emptyFieldCount} empty field${emptyFieldCount === 1 ? '' : 's'}`}
              </button>
            )}
          </div>

          {venue && (
            <>
              <header className="flex items-center justify-between border-y border-hairline bg-surface-2 px-3 py-2">
                <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                  Venue
                </span>
                {venue.venue_type && (
                  <StatusPill tone="neutral" className="h-[16px] text-[10px]">
                    {venueTypeLabel(venue.venue_type)}
                  </StatusPill>
                )}
              </header>
              <dl className="px-3 py-2 text-[13px] space-y-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                    {venue.name}
                  </dt>
                  {groupBadges?.[venue.id] && (
                    <dd className="mt-0.5">
                      <GroupChip name={groupBadges[venue.id].group_name} />
                    </dd>
                  )}
                  {venue.address && (
                    <dd className="mt-0.5 flex items-start gap-1.5 text-ink-muted">
                      <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-ink-faint" />
                      <span>
                        {venue.address}
                        {venue.suburb && `, ${venue.suburb}`}
                      </span>
                    </dd>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {venue.cover_count != null && (
                    <div>
                      <dt className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                        Covers
                      </dt>
                      <dd className="jordan-tnum font-mono text-ink">
                        <MetricNumber value={venue.cover_count} />
                      </dd>
                    </div>
                  )}
                  {venue.avg_spend_tier && (
                    <div>
                      <dt className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                        Avg spend
                      </dt>
                      <dd className="jordan-tnum font-mono text-ink">
                        {venue.avg_spend_tier}
                      </dd>
                    </div>
                  )}
                  {venue.licence_type && (
                    <div>
                      <dt className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                        Licence
                      </dt>
                      <dd className="capitalize text-ink-muted">
                        {venue.licence_type.replace(/_/g, ' ')}
                      </dd>
                    </div>
                  )}
                  {venue.neighbourhood && (
                    <div>
                      <dt className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                        Neighbourhood
                      </dt>
                      <dd className="text-ink-muted">{venue.neighbourhood}</dd>
                    </div>
                  )}
                </div>
                {venue.website && (
                  <div>
                    <dt className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                      Website
                    </dt>
                    <dd className="mt-0.5 flex items-center gap-1.5">
                      <Globe className="w-3 h-3 text-ink-faint" />
                      <a
                        href={venue.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-[color:var(--jordan-accent)] hover:underline"
                      >
                        {venue.website.replace(/^https?:\/\//, '')}
                      </a>
                    </dd>
                  </div>
                )}
                {user && (
                  <div>
                    <dt className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint mb-1">
                      Group
                    </dt>
                    <dd>
                      <AssignToGroupCombobox
                        venueId={venue.id}
                        currentGroupId={groupBadges?.[venue.id]?.group_id ?? null}
                        orgId={user.org_id}
                      />
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </section>

        {/* ─── Pane 2 — Activity timeline ──────────────────────── */}
        <section
          aria-label="Activity"
          className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1"
        >
          <header className="flex items-center justify-between border-b border-hairline px-3 py-2">
            <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
              Activity
              {activities && activities.length > 0 && (
                <span className="ml-1.5 jordan-tnum font-mono normal-case tracking-normal">
                  {activities.length}
                </span>
              )}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[12px]"
              onClick={() => setActivityDialogOpen(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Log
            </Button>
          </header>

          {/* Filter tabs */}
          {activities && activities.length > 0 && (
            <div className="border-b border-hairline px-3 py-1.5">
              <Tabs
                value={activityFilter}
                onValueChange={(v) => setActivityFilter(v as ActivityFilter)}
              >
                <TabsList variant="line" className="h-7">
                  <TabsTrigger value="all" className="text-[11px] px-2">
                    All
                  </TabsTrigger>
                  <TabsTrigger value="email" className="text-[11px] px-2">
                    Email ({activityCounts.email})
                  </TabsTrigger>
                  <TabsTrigger value="call" className="text-[11px] px-2">
                    Call ({activityCounts.call})
                  </TabsTrigger>
                  <TabsTrigger value="note" className="text-[11px] px-2">
                    Note ({activityCounts.note})
                  </TabsTrigger>
                  <TabsTrigger value="meeting" className="text-[11px] px-2">
                    Meeting ({activityCounts.meeting})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}

          {(!activities || activities.length === 0) ? (
            pstThreads.length > 0 ? (
              <ol className="relative px-3 py-3">
                <div aria-hidden className="absolute left-[22px] top-3 bottom-3 w-px bg-hairline" />
                {pstThreads.map((t) => (
                  <li key={t.dealId} className="relative flex gap-3 py-2">
                    <div className="relative z-[1] flex h-6 items-start">
                      <ActivityIcon type="email_inbound" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                          Mailbox thread
                        </span>
                        <span className="ml-auto jordan-tnum font-mono text-[11px] text-ink-faint shrink-0">
                          {t.at ? formatRelative(t.at) : 'imported'}
                        </span>
                      </div>
                      {t.subject && (
                        <p className="mt-0.5 text-[13px] text-ink truncate">{t.subject}</p>
                      )}
                      {t.body && (
                        <p className="mt-0.5 text-[12px] text-ink-muted line-clamp-3 whitespace-pre-wrap">
                          {t.body}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-ink-faint italic">
                        Imported from Jordan's mailbox — full thread lives in email.
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
            <EmptyState
              compact
              title={filterEmptyMessage.all.title}
              body={filterEmptyMessage.all.body}
            />
            )
          ) : filteredActivities.length === 0 ? (
            <EmptyState
              compact
              title={filterEmptyMessage[activityFilter].title}
              body={filterEmptyMessage[activityFilter].body}
            />
          ) : (
            <ol className="relative px-3 py-3">
              {/* Vertical rail */}
              <div
                aria-hidden
                className="absolute left-[22px] top-3 bottom-3 w-px bg-hairline"
              />
              {filteredActivities.map((a) => {
                const meta = getActivityMeta(a.activity_type)
                return (
                  <li key={a.id} className="relative flex gap-3 py-2">
                    <div className="relative z-[1] flex h-6 items-start">
                      <ActivityIcon type={a.activity_type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                          {meta.label}
                        </span>
                        {(a.activity_type === 'reply_received' || a.activity_type === 'email_inbound') && (
                          <IntentBadge
                            intent={(a.metadata as Record<string, unknown> | null)?.intent as string | null}
                          />
                        )}
                        {a.deal?.title && (
                          <>
                            <span className="text-ink-faint">·</span>
                            <Link
                              to={`/pipeline?deal=${a.deal.id}`}
                              className="text-[12px] text-ink-muted truncate hover:text-ink hover:underline"
                            >
                              {a.deal.title}
                            </Link>
                          </>
                        )}
                        <span className="ml-auto jordan-tnum font-mono text-[11px] text-ink-faint shrink-0">
                          {formatRelative(a.occurred_at)}
                        </span>
                      </div>
                      {a.subject && (
                        <p className="mt-0.5 text-[13px] text-ink truncate">
                          {a.subject}
                        </p>
                      )}
                      {a.body && (
                        <p className="mt-0.5 text-[12px] text-ink-muted line-clamp-2 whitespace-pre-wrap">
                          {a.body}
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        {/* ─── Pane 3 — Deals + drafts ─────────────────────────── */}
        <section
          aria-label="Deals and drafts"
          className="flex flex-col gap-4 min-w-0"
        >
          <div className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1">
            <header className="flex items-center justify-between border-b border-hairline px-3 py-2">
              <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                Deals
                {deals && deals.length > 0 && (
                  <span className="ml-1.5 jordan-tnum font-mono normal-case tracking-normal">
                    {deals.length}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[12px]"
                onClick={() => setDealDialogOpen(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                New deal
              </Button>
            </header>

            {(!deals || deals.length === 0) ? (
              <EmptyState
                compact
                icon={Briefcase}
                title="No deals yet"
                body="Track interest and movement by adding this contact to a pipeline stage."
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {deals.map((d) => (
                  <li
                    key={d.id}
                    className="cursor-pointer px-3 py-2.5 text-[13px] transition-colors hover:bg-surface-3"
                    onClick={() => navigate(`/pipeline?deal=${d.id}`)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">
                        {d.title ?? 'Untitled deal'}
                      </span>
                      <span className="ml-auto jordan-tnum font-mono text-[13px] text-ink">
                        {formatCurrency(d.contract_value)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      {d.stage?.name && (
                        <StatusPill tone="accent" className="h-[16px] text-[10px]">
                          {d.stage.name}
                        </StatusPill>
                      )}
                      <span className="ml-auto jordan-tnum font-mono text-[11px] text-ink-faint">
                        {d.follow_up_due
                          ? `Follow up ${formatDate(d.follow_up_due)}`
                          : `${d.days_in_stage ?? 0}d in stage`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1">
            <header className="flex items-center justify-between border-b border-hairline px-3 py-2">
              <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                AI drafts
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[12px]"
                onClick={() => setDraftDialogOpen(true)}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1" />
                Generate
              </Button>
            </header>
            <div className="px-3 py-3 text-[12px] text-ink-muted space-y-1.5">
              <p>Generate a cold outreach, follow-up, or reply tailored to this contact.</p>
              <div className="flex flex-wrap gap-1.5">
                <DraftTypeBadge type="cold_outreach" />
                <DraftTypeBadge type="follow_up" />
                <DraftTypeBadge type="reply" />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── Dialogs (kept) ────────────────────────────────────── */}
      {/* Add Deal — package picker with live ACV/TCV/commission readouts */}
      <Dialog open={dealDialogOpen} onOpenChange={setDealDialogOpen}>
        <DialogContent className="max-w-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Add to pipeline</DialogTitle>
          </DialogHeader>
          {dealDialogOpen && contact && (
            <PackageDealForm
              key={contact.id}
              defaultTitleSeed={contact.full_name}
              onSubmit={submitPackageDeal}
              onCancel={() => setDealDialogOpen(false)}
              submitting={createDeal.isPending}
              submitLabel="Add deal"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Generate Draft */}
      <Dialog open={draftDialogOpen} onOpenChange={setDraftDialogOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Generate AI draft</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <div className="space-y-1">
              <Label>Draft type</Label>
              <Select value={draftType} onValueChange={(v) => setDraftType(v as DraftType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cold_outreach">Cold outreach</SelectItem>
                  <SelectItem value="follow_up">Follow-up</SelectItem>
                  <SelectItem value="reply">Reply</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>
                Context hint{' '}
                <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Textarea
                rows={3}
                placeholder="e.g. mention the nearby venue install, ask about Thursday call"
                value={draftHint}
                onChange={(e) => setDraftHint(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDraftDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={generateDraft.isPending}
                onClick={async () => {
                  if (!id) return
                  try {
                    await generateDraft.mutateAsync({
                      contact_id: id,
                      draft_type: draftType,
                      context_hint: draftHint || undefined,
                    })
                    setDraftDialogOpen(false)
                    setDraftHint('')
                    navigate('/drafts')
                  } catch {
                    /* error shown by mutation toast */
                  }
                }}
              >
                {generateDraft.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-1.5" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log Activity */}
      <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Log activity</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={activityForm.handleSubmit(submitActivity, onActivityInvalid)}
            className="space-y-3 mt-2"
          >
            {Object.keys(activityForm.formState.errors).length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Please fix the highlighted fields before saving.
              </div>
            )}
            <div className="space-y-1">
              <Label>Type *</Label>
              <Select
                value={activityForm.watch('activity_type') ?? ''}
                onValueChange={(v) =>
                  activityForm.setValue(
                    'activity_type',
                    v as ActivityFormValues['activity_type'],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call_note">Call</SelectItem>
                  <SelectItem value="meeting_note">Meeting</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="email_outbound">Outbound email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Subject *</Label>
              <Input {...activityForm.register('subject')} placeholder="e.g. Intro call" />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                {...activityForm.register('body')}
                rows={3}
                placeholder="What happened?"
              />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" {...activityForm.register('occurred_at')} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setActivityDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={createActivity.isPending}>
                {createActivity.isPending ? 'Saving…' : 'Log activity'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ask Claude — per-contact drawer */}
      <ClaudePanel
        open={claudeOpen}
        onOpenChange={setClaudeOpen}
        scope="contact"
        contactId={contact.id}
        eyebrow={contact.full_name}
      />

      {/* Enrol in sequence */}
      <Dialog open={enrolDialogOpen} onOpenChange={setEnrolDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enrol in sequence</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[12px] text-ink-muted">
              Jordan still reviews every draft — sequences just schedule the
              next touch and queue the AI draft.
            </p>
            <div className="space-y-1">
              <Label>Sequence</Label>
              <Select
                value={selectedSequenceId}
                onValueChange={setSelectedSequenceId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a sequence" />
                </SelectTrigger>
                <SelectContent>
                  {(sequencesQ.data ?? [])
                    .filter((s) => s.is_active && s.step_count > 0)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        <span className="ml-2 text-ink-faint">
                          · {s.step_count} step{s.step_count === 1 ? '' : 's'}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {(sequencesQ.data ?? []).filter(
                (s) => s.is_active && s.step_count > 0,
              ).length === 0 && (
                <p className="text-[11px] text-ink-faint">
                  No active sequences with steps. Create one on the{' '}
                  <a
                    href="/sequences"
                    className="text-[color:var(--jordan-accent)] hover:underline"
                  >
                    Sequences page
                  </a>
                  .
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setEnrolDialogOpen(false)}
              disabled={enrolContacts.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleEnrol}
              disabled={!selectedSequenceId || enrolContacts.isPending}
            >
              {enrolContacts.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Enrolling…
                </>
              ) : (
                'Enrol'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
