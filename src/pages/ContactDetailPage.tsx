import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
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
import { Textarea } from '@/components/ui/textarea'
import { useContact, useUpdateContact } from '@/lib/queries/contacts'
import { useContactDeals, useCreateDeal } from '@/lib/queries/deals'
import { useContactActivities, useCreateActivity } from '@/lib/queries/activities'
import { useStages } from '@/lib/queries/stages'
import { useGenerateDraft } from '@/lib/queries/drafts'
import { useAuth } from '@/hooks/useAuth'
import { dealFormSchema, type DealFormValues } from '@/lib/schemas/deal'
import { activityFormSchema, type ActivityFormValues } from '@/lib/schemas/activity'
import {
  formatCurrency,
  formatDate,
  formatRelative,
  venueTypeLabel,
  roleLabel,
  activityTypeLabel,
  cn,
} from '@/lib/utils'
import {
  ArrowLeft,
  Globe,
  MapPin,
  Pencil,
  X,
  Check,
  Plus,
  Mail,
  MailOpen,
  MousePointerClick,
  Reply,
  Phone,
  CalendarCheck,
  CheckSquare,
  ArrowRight,
  AlertCircle,
  UserMinus,
  PlusCircle,
  StickyNote,
  Calendar,
  Activity,
  Sparkles,
  Loader2,
} from 'lucide-react'
import type { ActivityType } from '@/lib/queries/activities'
import type { DraftType } from '@/lib/queries/drafts'

const contactEditSchema = z.object({
  full_name: z.string().min(1, 'Name is required'),
  role: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  linkedin_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  notes: z.string().optional(),
})
type ContactEditValues = z.infer<typeof contactEditSchema>

function ActivityIcon({ type }: { type: ActivityType }) {
  const cls = 'w-4 h-4 shrink-0'
  switch (type) {
    case 'email_sent': case 'email_outbound': return <Mail className={cls} />
    case 'email_opened': return <MailOpen className={cls} />
    case 'email_clicked': return <MousePointerClick className={cls} />
    case 'reply_received': case 'email_inbound': return <Reply className={cls} />
    case 'call_note': return <Phone className={cls} />
    case 'meeting_note': return <CalendarCheck className={cls} />
    case 'meeting_booked': return <Calendar className={cls} />
    case 'task_completed': return <CheckSquare className={cls} />
    case 'stage_change': return <ArrowRight className={cls} />
    case 'bounce': return <AlertCircle className={cls} />
    case 'unsubscribe': return <UserMinus className={cls} />
    case 'deal_created': return <PlusCircle className={cls} />
    case 'note': return <StickyNote className={cls} />
    default: return <Activity className={cls} />
  }
}

function scoreBadge(score: number | null | undefined) {
  if (score == null) return null
  if (score >= 80) return <Badge className="bg-red-100 text-red-700 border-0">Hot · {score}</Badge>
  if (score >= 50) return <Badge className="bg-amber-100 text-amber-700 border-0">Warm · {score}</Badge>
  return <Badge className="bg-slate-100 text-slate-600 border-0">Cold · {score}</Badge>
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const { data: contact, isLoading, error } = useContact(id ?? '')
  const { data: deals } = useContactDeals(id ?? '')
  const { data: activities } = useContactActivities(id ?? '')
  const { data: stages } = useStages()

  const updateContact = useUpdateContact(id ?? '')
  const createDeal = useCreateDeal()
  const createActivity = useCreateActivity()

  const [editing, setEditing] = useState(false)
  const [dealDialogOpen, setDealDialogOpen] = useState(false)
  const [activityDialogOpen, setActivityDialogOpen] = useState(false)
  const [draftDialogOpen, setDraftDialogOpen] = useState(false)
  const [draftType, setDraftType] = useState<DraftType>('cold_outreach')
  const [draftHint, setDraftHint] = useState('')

  const generateDraft = useGenerateDraft()

  const editForm = useForm<ContactEditValues>({
    resolver: zodResolver(contactEditSchema),
  })

  const dealForm = useForm<DealFormValues>({
    resolver: zodResolver(dealFormSchema),
    defaultValues: { contract_value: 800 },
  })

  const activityForm = useForm<ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: { occurred_at: new Date().toISOString().split('T')[0] },
  })

  function startEdit() {
    if (!contact) return
    editForm.reset({
      full_name: contact.full_name,
      role: contact.role ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      linkedin_url: contact.linkedin_url ?? '',
      notes: contact.notes ?? '',
    })
    setEditing(true)
  }

  async function saveEdit(values: ContactEditValues) {
    await updateContact.mutateAsync({
      full_name: values.full_name,
      role: values.role || null,
      email: values.email || null,
      phone: values.phone || null,
      linkedin_url: values.linkedin_url || null,
      notes: values.notes || null,
    })
    setEditing(false)
  }

  async function submitDeal(values: DealFormValues) {
    if (!user || !contact) return
    await createDeal.mutateAsync({
      org_id: user.org_id,
      title: values.title,
      contact_id: contact.id,
      venue_id: contact.venue_id ?? undefined,
      stage_id: values.stage_id,
      contract_value: values.contract_value,
      follow_up_due: values.follow_up_due,
      notes: values.notes,
    })
    setDealDialogOpen(false)
    dealForm.reset()
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

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }
  if (error) {
    return (
      <div className="text-destructive text-sm p-4">
        Failed to load: {error.message}
      </div>
    )
  }
  if (!contact) {
    return <div className="p-6 text-sm text-muted-foreground">Contact not found.</div>
  }

  const venue = contact.venue as {
    id: string
    name: string
    venue_type: string | null
    address: string | null
    suburb: string | null
    website: string | null
    cover_count: number | null
  } | null | undefined

  const encodedAddress = encodeURIComponent(
    [venue?.address, venue?.suburb].filter(Boolean).join(', ') ?? ''
  )

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      {/* Back */}
      <button
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => navigate('/contacts')}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to contacts
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          {editing ? (
            <Input
              {...editForm.register('full_name')}
              className="text-2xl font-semibold h-auto py-1 text-2xl"
            />
          ) : (
            <h1 className="text-2xl font-semibold">{contact.full_name}</h1>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {contact.role && (
              <Badge variant="outline">{roleLabel(contact.role)}</Badge>
            )}
            {venue?.name && (
              <span className="text-sm text-muted-foreground">{venue.name}</span>
            )}
            {contact.lead_score?.score != null &&
              scoreBadge(contact.lead_score.score)}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDraftDialogOpen(true)}
            disabled={generateDraft.isPending}
          >
            {generateDraft.isPending
              ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Generating…</>
              : <><Sparkles className="w-4 h-4 mr-1.5" />Generate Draft</>
            }
          </Button>
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Pencil className="w-4 h-4 mr-1.5" />
              Edit
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
              >
                <X className="w-4 h-4 mr-1.5" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={editForm.handleSubmit(saveEdit)}
                disabled={updateContact.isPending}
              >
                <Check className="w-4 h-4 mr-1.5" />
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Contact fields */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contact Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Role</Label>
                <Select
                  value={editForm.watch('role') ?? ''}
                  onValueChange={(v) => editForm.setValue('role', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="venue_manager">Venue Manager</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="f_b_director">F&B Director</SelectItem>
                    <SelectItem value="head_chef">Head Chef</SelectItem>
                    <SelectItem value="events_manager">Events Manager</SelectItem>
                  </SelectContent>
                </Select>
                {editForm.formState.errors.role && (
                  <p className="text-xs text-destructive">{editForm.formState.errors.role.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input {...editForm.register('email')} type="email" />
                {editForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{editForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input {...editForm.register('phone')} type="tel" />
              </div>
              <div className="space-y-1">
                <Label>LinkedIn URL</Label>
                <Input {...editForm.register('linkedin_url')} type="url" />
                {editForm.formState.errors.linkedin_url && (
                  <p className="text-xs text-destructive">{editForm.formState.errors.linkedin_url.message}</p>
                )}
              </div>
              <div className="col-span-full space-y-1">
                <Label>Notes</Label>
                <Textarea {...editForm.register('notes')} rows={3} />
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd>{contact.email ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Phone</dt>
                <dd>{contact.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">LinkedIn</dt>
                <dd>
                  {contact.linkedin_url ? (
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline truncate block max-w-[160px]"
                    >
                      View profile
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              {contact.notes && (
                <div className="col-span-full">
                  <dt className="text-xs text-muted-foreground">Notes</dt>
                  <dd className="text-sm whitespace-pre-wrap">{contact.notes}</dd>
                </div>
              )}
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Venue card */}
      {venue && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{venue.name}</CardTitle>
            {venue.venue_type && (
              <Badge variant="outline" className="w-fit">
                {venueTypeLabel(venue.venue_type)}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
              {venue.address && (
                <div className="col-span-full">
                  <dt className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Address
                  </dt>
                  <dd>
                    {venue.address}
                    {venue.suburb && `, ${venue.suburb}`}
                  </dd>
                </div>
              )}
              {venue.cover_count != null && (
                <div>
                  <dt className="text-xs text-muted-foreground">Covers</dt>
                  <dd>{venue.cover_count}</dd>
                </div>
              )}
              {venue.website && (
                <div>
                  <dt className="text-xs text-muted-foreground flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Website
                  </dt>
                  <dd>
                    <a
                      href={venue.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {venue.website.replace(/^https?:\/\//, '')}
                    </a>
                  </dd>
                </div>
              )}
            </dl>

            {encodedAddress && (
              <div className="rounded-lg overflow-hidden border">
                {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? (
                  <iframe
                    src={`https://www.google.com/maps/embed/v1/place?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&q=${encodedAddress}`}
                    width="100%"
                    height="192"
                    style={{ border: 0, display: 'block' }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    title="Venue location"
                  />
                ) : (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-3 text-sm text-primary hover:underline"
                  >
                    <MapPin className="w-4 h-4 shrink-0" />
                    View on Google Maps
                  </a>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Deals section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            Deals {deals && deals.length > 0 && <span className="text-muted-foreground font-normal">({deals.length})</span>}
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDealDialogOpen(true)}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add to pipeline
          </Button>
        </div>

        {(!deals || deals.length === 0) && (
          <p className="text-sm text-muted-foreground py-3">No deals yet. Add this contact to the pipeline to start tracking.</p>
        )}

        {deals && deals.length > 0 && (
          <div className="space-y-2">
            {deals.map((deal) => (
              <div key={deal.id} className="border rounded-lg p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{deal.title ?? 'Untitled deal'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {deal.follow_up_due ? `Follow-up: ${formatDate(deal.follow_up_due)}` : 'No follow-up set'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {deal.stage?.name && (
                    <Badge
                      variant="outline"
                      style={deal.stage.color ? { borderColor: deal.stage.color, color: deal.stage.color } : {}}
                    >
                      {deal.stage.name}
                    </Badge>
                  )}
                  <span className="text-sm font-medium">
                    {formatCurrency(deal.contract_value)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {deal.days_in_stage ?? 0}d in stage
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Activities section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            Activity {activities && activities.length > 0 && (
              <span className="text-muted-foreground font-normal">({activities.length})</span>
            )}
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActivityDialogOpen(true)}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Log activity
          </Button>
        </div>

        {(!activities || activities.length === 0) && (
          <p className="text-sm text-muted-foreground py-3">No activity logged yet.</p>
        )}

        {activities && activities.length > 0 && (
          <div className="space-y-1">
            {activities.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                <div className="mt-0.5 text-muted-foreground">
                  <ActivityIcon type={activity.activity_type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground">
                      {activityTypeLabel(activity.activity_type)}
                    </span>
                    {activity.deal?.title && (
                      <>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs">{activity.deal.title}</span>
                      </>
                    )}
                  </div>
                  {activity.subject && (
                    <p className="text-sm truncate mt-0.5">{activity.subject}</p>
                  )}
                  {activity.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {activity.body}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0 pt-0.5">
                  {formatRelative(activity.occurred_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Deal Dialog */}
      <Dialog open={dealDialogOpen} onOpenChange={setDealDialogOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Add to Pipeline</DialogTitle>
          </DialogHeader>
          <form onSubmit={dealForm.handleSubmit(submitDeal)} className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label>Deal title *</Label>
              <Input {...dealForm.register('title')} placeholder="e.g. Purezza x The Espy" />
              {dealForm.formState.errors.title && (
                <p className="text-xs text-destructive">{dealForm.formState.errors.title.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Stage *</Label>
              <Select
                value={dealForm.watch('stage_id') ?? ''}
                onValueChange={(v) => dealForm.setValue('stage_id', v)}
              >
                <SelectTrigger className={cn(dealForm.formState.errors.stage_id && 'border-destructive')}>
                  <SelectValue placeholder="Select a stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dealForm.formState.errors.stage_id && (
                <p className="text-xs text-destructive">{dealForm.formState.errors.stage_id.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Contract value (AUD)</Label>
              <Input
                type="number"
                min={0}
                {...dealForm.register('contract_value', { valueAsNumber: true })}
                placeholder="800"
              />
            </div>
            <div className="space-y-1">
              <Label>Follow-up due</Label>
              <Input type="date" {...dealForm.register('follow_up_due')} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setDealDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={createDeal.isPending}>
                {createDeal.isPending ? 'Adding…' : 'Add deal'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Generate Draft Dialog */}
      <Dialog open={draftDialogOpen} onOpenChange={setDraftDialogOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Generate AI Draft</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            {!import.meta.env.VITE_SUPABASE_URL && (
              <p className="text-sm text-amber-600 bg-amber-50 rounded px-3 py-2">
                Anthropic API key not yet configured — ask admin.
              </p>
            )}
            <div className="space-y-1">
              <Label>Draft type</Label>
              <Select value={draftType} onValueChange={(v) => setDraftType(v as DraftType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cold_outreach">Cold Outreach</SelectItem>
                  <SelectItem value="follow_up">Follow-up</SelectItem>
                  <SelectItem value="reply">Reply (to their last message)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Context hint <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                rows={3}
                placeholder="e.g. mention the nearby venue install, ask about Thursday call"
                value={draftHint}
                onChange={(e) => setDraftHint(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDraftDialogOpen(false)}>
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
                    // error shown by mutation
                  }
                }}
              >
                {generateDraft.isPending
                  ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Generating…</>
                  : <><Sparkles className="w-4 h-4 mr-1.5" />Generate</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log Activity Dialog */}
      <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Log Activity</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={activityForm.handleSubmit(submitActivity)}
            className="space-y-3 mt-2"
          >
            <div className="space-y-1">
              <Label>Type *</Label>
              <Select
                value={activityForm.watch('activity_type') ?? ''}
                onValueChange={(v) =>
                  activityForm.setValue(
                    'activity_type',
                    v as ActivityFormValues['activity_type']
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
                  <SelectItem value="email_outbound">Outbound Email</SelectItem>
                </SelectContent>
              </Select>
              {activityForm.formState.errors.activity_type && (
                <p className="text-xs text-destructive">
                  {activityForm.formState.errors.activity_type.message}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Subject *</Label>
              <Input {...activityForm.register('subject')} placeholder="e.g. Intro call" />
              {activityForm.formState.errors.subject && (
                <p className="text-xs text-destructive">
                  {activityForm.formState.errors.subject.message}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea {...activityForm.register('body')} rows={3} placeholder="What happened?" />
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
              <Button
                type="submit"
                className="flex-1"
                disabled={createActivity.isPending}
              >
                {createActivity.isPending ? 'Saving…' : 'Log activity'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
