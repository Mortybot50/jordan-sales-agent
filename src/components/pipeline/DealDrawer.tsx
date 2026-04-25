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
import { useUpdateDeal, useDeleteDeal } from '@/lib/queries/deals'
import { useContactActivities } from '@/lib/queries/activities'
import { useStages } from '@/lib/queries/stages'
import { dealFormSchema, type DealFormValues } from '@/lib/schemas/deal'
import { formatCurrency, formatDate, formatRelative, activityTypeLabel } from '@/lib/utils'
import type { Deal } from '@/lib/queries/deals'
import type { ActivityType } from '@/lib/queries/activities'
import {
  Trash2,
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
} from 'lucide-react'

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

export function DealDrawer({ deal, open, onClose }: DealDrawerProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data: stages } = useStages()
  const { data: activities } = useContactActivities(deal.contact_id ?? '')
  const updateDeal = useUpdateDeal()
  const deleteDeal = useDeleteDeal()

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealFormSchema),
    defaultValues: {
      title: deal.title ?? '',
      stage_id: deal.stage_id ?? '',
      contract_value: deal.contract_value ?? 800,
      follow_up_due: deal.follow_up_due
        ? deal.follow_up_due.split('T')[0]
        : '',
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
      contract_value: values.contract_value,
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

  // Filter activities to this deal
  const dealActivities = (activities ?? []).filter(
    (a) => a.deal_id === deal.id
  )

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
              {deal.contact?.full_name && (
                <span>{deal.contact.full_name}</span>
              )}
              {deal.venue?.name && (
                <>
                  <span>·</span>
                  <span>{deal.venue.name}</span>
                </>
              )}
            </div>
          </SheetHeader>

          <form onSubmit={form.handleSubmit(handleSave, onInvalid)} className="space-y-4">
            {Object.keys(form.formState.errors).length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Please fix the highlighted fields before saving.
              </div>
            )}
            <div className="space-y-1">
              <Label>Title</Label>
              <Input {...form.register('title')} />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.title.message}
                </p>
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
                <Label>Contract value (AUD)</Label>
                <Input
                  type="number"
                  min={0}
                  {...form.register('contract_value', { valueAsNumber: true })}
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
              <p className="text-xs text-muted-foreground">Current value</p>
              <p className="font-semibold">{formatCurrency(deal.contract_value)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Days in stage</p>
              <p className="font-semibold">{deal.days_in_stage ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Follow-up</p>
              <p>{formatDate(deal.follow_up_due)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last touch</p>
              <p>{formatRelative(deal.last_touch_at)}</p>
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
