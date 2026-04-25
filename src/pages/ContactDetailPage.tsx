import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Briefcase,
  Globe,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
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
  ActivityIcon,
  DraftTypeBadge,
  EmptyState,
  ErrorAlert,
  FieldRow,
  MetricNumber,
  PageHeader,
  ScoreBadge,
  SkeletonBlock,
  StatusPill,
  getActivityMeta,
} from '@/components/primitives'

import { useContact, useUpdateContact } from '@/lib/queries/contacts'
import { useContactDeals, useCreateDeal } from '@/lib/queries/deals'
import { PackageDealForm } from '@/components/pipeline/PackageDealForm'
import type { PackageDealValues } from '@/lib/schemas/deal'
import {
  useContactActivities,
  useCreateActivity,
} from '@/lib/queries/activities'
import { useGenerateDraft } from '@/lib/queries/drafts'
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

  const updateContact = useUpdateContact(id ?? '')
  const createDeal = useCreateDeal()
  const createActivity = useCreateActivity()
  const generateDraft = useGenerateDraft()

  const [dealDialogOpen, setDealDialogOpen] = useState(false)
  const [activityDialogOpen, setActivityDialogOpen] = useState(false)
  const [draftDialogOpen, setDraftDialogOpen] = useState(false)
  const [draftType, setDraftType] = useState<DraftType>('cold_outreach')
  const [draftHint, setDraftHint] = useState('')

  const activityForm = useForm<ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: { occurred_at: new Date().toISOString().split('T')[0] },
  })

  // Inline editing state per field (role, email, phone, linkedin_url, notes)
  type EditableField = 'role' | 'email' | 'phone' | 'linkedin_url' | 'notes'
  const [editingField, setEditingField] = useState<EditableField | null>(null)
  const [fieldDraft, setFieldDraft] = useState<Record<string, string>>({})

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
      title: values.title,
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
    console.error('[ContactDetail.submitActivity] validation failed:', errors)
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

      {/* Header */}
      <PageHeader
        eyebrow={venue?.name ? `${venue.name}` : 'Contact'}
        title={contact.full_name}
        description={
          <span className="inline-flex items-center gap-2">
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

          {(!activities || activities.length === 0) ? (
            <EmptyState
              compact
              title="No activity yet"
              body="Log a call, meeting or note to start building the timeline."
            />
          ) : (
            <ol className="relative px-3 py-3">
              {/* Vertical rail */}
              <div
                aria-hidden
                className="absolute left-[22px] top-3 bottom-3 w-px bg-hairline"
              />
              {activities.map((a) => {
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
                        {a.deal?.title && (
                          <>
                            <span className="text-ink-faint">·</span>
                            <span className="text-[12px] text-ink-muted truncate">
                              {a.deal.title}
                            </span>
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
                Add
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
                    className="px-3 py-2.5 text-[13px] transition-colors hover:bg-surface-3"
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
    </div>
  )
}
