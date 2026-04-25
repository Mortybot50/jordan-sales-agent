import { useState } from 'react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { CapsLabel, MetricNumber } from '@/components/primitives'
import {
  useUpdateDeal,
  useDeleteDeal,
  useUpdateDealStage,
  useMarkInstallConfirmed,
  useMarkInstalled,
} from '@/lib/queries/deals'
import { useContactActivities } from '@/lib/queries/activities'
import { useStages } from '@/lib/queries/stages'
import { dealFormSchema, type DealFormValues } from '@/lib/schemas/deal'
import { formatCurrency, formatDate, formatRelative, activityTypeLabel, cn } from '@/lib/utils'
import { format, addMonths, formatDistanceToNowStrict } from 'date-fns'
import type { Deal } from '@/lib/queries/deals'
import type { ActivityType } from '@/lib/queries/activities'
import {
  Trash2, Mail, MailOpen, MousePointerClick, Reply, Phone, CalendarCheck,
  CheckSquare, ArrowRight, AlertCircle, UserMinus, PlusCircle, StickyNote,
  Calendar, Activity, Pause, Play, Wrench, CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react'
import { MarkOutcomeDialog } from './MarkOutcomeDialog'

interface DealDrawerProps {
  deal: Deal
  open: boolean
  onClose: () => void
}

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

function isCurrentMonth(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

function nextMonthLabel(): string {
  return format(addMonths(new Date(), 1), 'MMMM')
}

export function DealDrawer({ deal, open, onClose }: DealDrawerProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [outcomeIntent, setOutcomeIntent] = useState<'won' | 'lost' | null>(null)
  const [installScheduledFor, setInstallScheduledFor] = useState<string>(
    deal.install_scheduled_for ?? '',
  )
  const { data: stages } = useStages()
  const { data: activities } = useContactActivities(deal.contact_id ?? '')
  const updateDeal = useUpdateDeal()
  const deleteDeal = useDeleteDeal()
  const updateStage = useUpdateDealStage()
  const markConfirmed = useMarkInstallConfirmed()
  const markInstalled = useMarkInstalled()

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealFormSchema),
    defaultValues: {
      title: deal.title ?? '',
      stage_id: deal.stage_id ?? '',
      contract_value: deal.contract_value ?? undefined,
      follow_up_due: deal.follow_up_due ? deal.follow_up_due.split('T')[0] : '',
      notes: deal.notes ?? '',
    },
  })

  function onInvalid(errors: FieldErrors<DealFormValues>) {
    console.error('[DealDrawer.handleSave] validation failed:', errors)
    const first = Object.entries(errors)[0]
    if (first) {
      const [field, err] = first
      const message = (err as { message?: string })?.message ?? 'Invalid value'
      toast.error('Cannot save deal — check the form', {
        description: `${field}: ${message}`,
      })
    }
  }

  async function handleSave(values: DealFormValues) {
    const oldStageName = deal.stage?.name
    const newStage = stages?.find((s) => s.id === values.stage_id)
    const newStageName = newStage?.name

    await updateDeal.mutateAsync({
      id: deal.id,
      org_id: deal.org_id,
      title: values.title,
      stage_id: values.stage_id,
      contract_value: values.contract_value ?? null,
      follow_up_due: values.follow_up_due || null,
      notes: values.notes || null,
      from_stage: oldStageName,
      to_stage: newStageName,
    })
    onClose()
  }

  async function handleDelete() {
    await deleteDeal.mutateAsync(deal.id)
    setConfirmDelete(false)
    onClose()
  }

  async function moveToStageByName(stageName: string) {
    const target = stages?.find((s) => s.name === stageName)
    if (!target) {
      toast.error(`Stage "${stageName}" not found`)
      return
    }
    await updateStage.mutateAsync({ dealId: deal.id, stageId: target.id })
  }

  async function handleMarkConfirmed() {
    await markConfirmed.mutateAsync({
      dealId: deal.id,
      scheduledFor: installScheduledFor || undefined,
    })
  }

  async function handleMarkInstalled() {
    await markInstalled.mutateAsync(deal.id)
  }

  const dealActivities = (activities ?? []).filter((a) => a.deal_id === deal.id)
  const acv = deal.acv != null ? Number(deal.acv) : null
  const tcv = deal.tcv != null ? Number(deal.tcv) : null
  const commission = deal.commission_amount != null ? Number(deal.commission_amount) : null
  const stageName = deal.stage?.name ?? ''
  const isHeld = stageName === 'Hold for Next Month'
  const isClosedWon = /won/i.test(stageName) && !/lost/i.test(stageName)
  const contributesToGate = !!deal.close_won_at && isCurrentMonth(deal.close_won_at) && !isHeld
  const isLost = /lost/i.test(stageName)
  const isClosedStage = !!deal.stage?.is_closed
  const needsOutcomeTag = isClosedStage && !deal.outcome

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg overflow-y-auto"
        >
          <SheetHeader className="mb-4">
            <SheetTitle className="text-lg">
              {deal.title ?? 'Untitled deal'}
            </SheetTitle>
            <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
              {deal.contact?.full_name && <span>{deal.contact.full_name}</span>}
              {deal.venue?.name && (
                <>
                  <span>·</span>
                  <span>{deal.venue.name}</span>
                </>
              )}
              {deal.product?.label && (
                <>
                  <span>·</span>
                  <span className="text-ink-muted font-medium">{deal.product.label}</span>
                </>
              )}
            </div>
          </SheetHeader>

          {/* ── Financial panel ─────────────────────────────── */}
          {(acv != null || tcv != null || commission != null) && (
            <div className="mb-5 rounded-[10px] border border-hairline bg-surface-2 p-3 space-y-2">
              <CapsLabel>Financial</CapsLabel>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">ACV</p>
                  <MetricNumber value={acv} format="currency" minimumFractionDigits={0} maximumFractionDigits={0} className="text-[16px] font-semibold text-ink" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">TCV</p>
                  <MetricNumber value={tcv} format="currency" minimumFractionDigits={0} maximumFractionDigits={0} className="text-[16px] font-semibold text-ink" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Commission</p>
                  <MetricNumber value={commission} format="currency" minimumFractionDigits={0} maximumFractionDigits={0} className="text-[16px] font-semibold text-ink" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Term</p>
                  <p className="text-[16px] font-semibold text-ink jordan-tnum">
                    {deal.term_months ?? '—'} mo
                  </p>
                </div>
              </div>
              {contributesToGate && acv != null && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-[6px] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)] px-2 py-1 text-[11px] font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Close Won this month — contributes {formatCurrency(acv)} to monthly gate
                </div>
              )}
            </div>
          )}

          {/* ── Outcome (Won / Lost) panel ─────────────────────── */}
          {deal.outcome === 'won' && (
            <div className="mb-5 rounded-[10px] border border-[color:var(--jordan-accent-mint)]/40 bg-[color:var(--jordan-accent-mint-soft)] p-3 flex items-start justify-between gap-3">
              <div>
                <CapsLabel className="text-[color:var(--jordan-success-text)]">Closed Won</CapsLabel>
                <p className="text-[12px] text-ink-muted mt-0.5">
                  {deal.final_value != null
                    ? `Final value ${formatCurrency(Number(deal.final_value))}`
                    : 'Final value not captured'}
                  {deal.closed_at ? ` · ${format(new Date(deal.closed_at), 'd MMM yyyy')}` : ''}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setOutcomeIntent('won')}
              >
                Edit
              </Button>
            </div>
          )}
          {deal.outcome === 'lost' && (
            <div className="mb-5 rounded-[10px] border border-[color:var(--jordan-danger)]/40 bg-[color:var(--jordan-danger-soft)] p-3 flex items-start justify-between gap-3">
              <div>
                <CapsLabel className="text-[color:var(--jordan-danger-text)]">Closed Lost</CapsLabel>
                <p className="text-[12px] text-ink-muted mt-0.5">
                  {deal.lost_reason ? deal.lost_reason : 'No reason captured'}
                  {deal.closed_at ? ` · ${format(new Date(deal.closed_at), 'd MMM yyyy')}` : ''}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setOutcomeIntent('lost')}
              >
                Edit
              </Button>
            </div>
          )}
          {needsOutcomeTag && (
            <div className="mb-5 rounded-[10px] border border-[color:var(--jordan-warm)]/50 bg-[color:var(--jordan-warm-soft,transparent)] p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[color:var(--jordan-warm-text)] text-[12px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]">
                <AlertTriangle className="w-3.5 h-3.5" />
                Outcome not set
              </div>
              <p className="text-[12px] text-ink-muted">
                This deal sits in a closed stage but hasn't been marked Won or Lost.
                Tag it so the dashboard reflects accurate commission + gate progress.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  onClick={() => setOutcomeIntent('won')}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Mark as Won
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setOutcomeIntent('lost')}
                >
                  <XCircle className="w-3.5 h-3.5 mr-1" />
                  Mark as Lost
                </Button>
              </div>
            </div>
          )}

          {/* ── Install Lifecycle panel ─────────────────────── */}
          {isClosedWon && (
            <div className="mb-5 rounded-[10px] border border-hairline bg-surface-2 p-3 space-y-3">
              <CapsLabel>Install Lifecycle</CapsLabel>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Status</p>
                  <p className="font-medium text-ink">
                    {deal.install_completed_at
                      ? '✅ Installed'
                      : deal.install_confirmed_at
                        ? '🛠 Pending Install'
                        : '⏳ Awaiting confirmation'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Scheduled for</p>
                  <p className="text-ink">
                    {deal.install_scheduled_for
                      ? format(new Date(deal.install_scheduled_for), 'd MMM')
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Confirmed</p>
                  <p className="text-ink">
                    {deal.install_confirmed_at
                      ? `${format(new Date(deal.install_confirmed_at), 'd MMM')} (${formatDistanceToNowStrict(new Date(deal.install_confirmed_at))} ago)`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Installed</p>
                  <p className="text-ink">
                    {deal.install_completed_at
                      ? format(new Date(deal.install_completed_at), 'd MMM')
                      : '—'}
                  </p>
                </div>
              </div>

              {!deal.install_completed_at && (
                <>
                  {!deal.install_confirmed_at && (
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label>Schedule install for</Label>
                        <Input
                          type="date"
                          value={installScheduledFor}
                          onChange={(e) => setInstallScheduledFor(e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleMarkConfirmed}
                        disabled={markConfirmed.isPending}
                      >
                        <Wrench className="w-3.5 h-3.5 mr-1" />
                        Mark install confirmed
                      </Button>
                    </div>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    onClick={handleMarkInstalled}
                    disabled={markInstalled.isPending}
                    className="w-full"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    Mark installed
                  </Button>
                </>
              )}

              {deal.install_completed_at && commission != null && (
                <div className="rounded-[6px] bg-[color:var(--jordan-accent-mint-soft)] border border-[color:var(--jordan-accent-mint)]/30 px-3 py-2 text-[12px] text-[color:var(--jordan-success-text)] font-medium">
                  Commission earned: {formatCurrency(commission)} · {format(new Date(deal.install_completed_at), 'd MMM yyyy')}
                </div>
              )}
            </div>
          )}

          {/* ── Hold-for-next-month CTAs ─────────────────────── */}
          {isHeld && (
            <div className="mb-5 rounded-[10px] border border-[color:var(--jordan-accent-mint)]/30 bg-[color:var(--jordan-accent-mint-soft)] p-3 space-y-2">
              <CapsLabel className="text-[color:var(--jordan-success-text)]">
                Held for {nextMonthLabel()}
              </CapsLabel>
              <p className="text-[12px] text-ink-muted">
                This deal won't count toward this month's gate. Move when ready.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => moveToStageByName('Negotiation')}
                  disabled={updateStage.isPending}
                  className="flex-1"
                >
                  <Play className="w-3.5 h-3.5 mr-1" />
                  Back to Negotiation
                </Button>
                <Button
                  size="sm"
                  onClick={() => moveToStageByName('Closed Won')}
                  disabled={updateStage.isPending}
                  className="flex-1"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Move to Close Won
                </Button>
              </div>
            </div>
          )}

          {!isHeld && !isClosedWon && !isLost && (
            <div className="mb-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => moveToStageByName('Hold for Next Month')}
                disabled={updateStage.isPending}
                className="text-[12px]"
              >
                <Pause className="w-3.5 h-3.5 mr-1" />
                Hold for next month
              </Button>
            </div>
          )}

          {/* ── Edit form ────────────────────────────────────── */}
          <form onSubmit={form.handleSubmit(handleSave, onInvalid)} className="space-y-4">
            {Object.keys(form.formState.errors).length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Please fix the highlighted fields before saving.
              </div>
            )}
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                {...form.register('title')}
                className={cn(form.formState.errors.title && 'border-destructive')}
              />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Stage</Label>
              <Select
                value={form.watch('stage_id') ?? ''}
                onValueChange={(v) => form.setValue('stage_id', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Legacy contract value</Label>
                <Input
                  type="number"
                  min={0}
                  {...form.register('contract_value', {
                    setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                  })}
                />
              </div>
              <div className="space-y-1">
                <Label>Follow-up due</Label>
                <Input type="date" {...form.register('follow_up_due')} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea {...form.register('notes')} rows={3} />
            </div>

            <div className="flex items-center justify-between pt-1 gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Delete
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={updateDeal.isPending}>
                  {updateDeal.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </form>

          <Separator className="my-5" />

          {/* Meta info */}
          <div className="grid grid-cols-2 gap-3 text-sm mb-5">
            <div>
              <p className="text-xs text-muted-foreground">Days in stage</p>
              <p className="font-semibold">{deal.days_in_stage ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last touch</p>
              <p>{formatRelative(deal.last_touch_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Follow-up</p>
              <p>{formatDate(deal.follow_up_due)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Close Won</p>
              <p>{deal.close_won_at ? format(new Date(deal.close_won_at), 'd MMM yyyy') : '—'}</p>
            </div>
          </div>

          <Separator className="mb-4" />

          {/* Activity timeline */}
          <div>
            <h3 className="text-sm font-semibold mb-3">
              Activity{dealActivities.length > 0 ? ` (${dealActivities.length})` : ''}
            </h3>
            {dealActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity on this deal yet.</p>
            ) : (
              <div className="space-y-2">
                {dealActivities.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-2.5">
                    <div className="mt-0.5 text-muted-foreground shrink-0">
                      <ActivityIcon type={activity.activity_type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-xs h-4">
                          {activityTypeLabel(activity.activity_type)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatRelative(activity.occurred_at)}
                        </span>
                      </div>
                      {activity.subject && (
                        <p className="text-sm truncate mt-0.5">{activity.subject}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Mark Won / Lost — opened from outcome banner or "needs outcome" CTA */}
      <MarkOutcomeDialog
        deal={outcomeIntent ? deal : null}
        initialOutcome={outcomeIntent ?? 'won'}
        open={!!outcomeIntent}
        onClose={() => setOutcomeIntent(null)}
      />

      {/* Delete confirm */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete deal?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete "{deal.title ?? 'this deal'}" and all
            associated data. This cannot be undone.
          </p>
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleteDeal.isPending}
              onClick={handleDelete}
            >
              {deleteDeal.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
