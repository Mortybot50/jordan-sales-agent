import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import {
  useSendingDomain,
  useCreateSendingDomain,
  useUpdateSendingDomain,
  type SendingDomain,
  type SendingDomainStatus,
} from '@/lib/queries/sending-domains'
import { cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, Mail } from 'lucide-react'

const STATUS_LABEL: Record<SendingDomainStatus, string> = {
  not_configured: 'Not configured',
  pending_dns: 'Pending DNS',
  warming_up: 'Warming up',
  active: 'Active',
  paused: 'Paused',
  error: 'Error',
}

const STATUS_TONE: Record<SendingDomainStatus, string> = {
  not_configured: 'bg-muted text-muted-foreground',
  pending_dns: 'bg-amber-50 text-amber-700 border-amber-200',
  warming_up: 'bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)]',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-muted text-muted-foreground',
  error: 'bg-red-50 text-red-700 border-red-200',
}

const STATUS_OPTIONS: SendingDomainStatus[] = [
  'not_configured',
  'pending_dns',
  'warming_up',
  'active',
  'paused',
  'error',
]

type DnsFieldStatus = 'unknown' | 'pass' | 'fail' | 'missing'
const DNS_OPTIONS: DnsFieldStatus[] = ['unknown', 'pass', 'fail', 'missing']

function DnsChip({ label, value }: { label: string; value: string | null }) {
  const v = (value ?? 'unknown') as DnsFieldStatus
  const tone =
    v === 'pass'
      ? 'bg-green-100 text-green-700'
      : v === 'fail' || v === 'missing'
        ? 'bg-red-50 text-red-700'
        : 'bg-muted text-muted-foreground'
  return (
    <div className={cn('px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1', tone)}>
      <span className="uppercase tracking-wide">{label}</span>
      <span>·</span>
      <span>{v}</span>
    </div>
  )
}

interface FormValues {
  domain: string
  status: SendingDomainStatus
  provider: string
  spf_status: DnsFieldStatus
  dkim_status: DnsFieldStatus
  dmarc_status: DnsFieldStatus
  inbox_count: number
  warmup_day: number
  warmup_target_day: number
  notes: string
}

function defaultsFromRow(row: SendingDomain | null): FormValues {
  return {
    domain: row?.domain ?? '',
    status: (row?.status as SendingDomainStatus) ?? 'not_configured',
    provider: row?.provider ?? '',
    spf_status: (row?.spf_status as DnsFieldStatus) ?? 'unknown',
    dkim_status: (row?.dkim_status as DnsFieldStatus) ?? 'unknown',
    dmarc_status: (row?.dmarc_status as DnsFieldStatus) ?? 'unknown',
    inbox_count: row?.inbox_count ?? 0,
    warmup_day: row?.warmup_day ?? 0,
    warmup_target_day: row?.warmup_target_day ?? 21,
    notes: row?.notes ?? '',
  }
}

function EditModal({
  open,
  onOpenChange,
  row,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  row: SendingDomain | null
}) {
  const { user } = useAuth()
  const create = useCreateSendingDomain()
  const update = useUpdateSendingDomain()
  const [values, setValues] = useState<FormValues>(defaultsFromRow(row))

  useEffect(() => {
    if (open) setValues(defaultsFromRow(row))
  }, [open, row])

  function set<K extends keyof FormValues>(key: K, v: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  const isPending = create.isPending || update.isPending
  const isNew = !row

  async function handleSave() {
    if (!user) return
    const trimmedDomain = values.domain.trim()
    if (!trimmedDomain) {
      return
    }
    const payload = {
      domain: trimmedDomain,
      status: values.status,
      provider: values.provider.trim() || null,
      spf_status: values.spf_status,
      dkim_status: values.dkim_status,
      dmarc_status: values.dmarc_status,
      inbox_count: values.inbox_count,
      warmup_day: values.warmup_day,
      warmup_target_day: values.warmup_target_day,
      notes: values.notes.trim() || null,
    }
    if (isNew) {
      await create.mutateAsync({
        ...payload,
        user_id: user.id,
        org_id: user.org_id,
      })
    } else {
      await update.mutateAsync({ id: row.id, ...payload })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add sending domain' : 'Edit sending domain'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sd-domain">Domain</Label>
            <Input
              id="sd-domain"
              placeholder="jordan-hospitality.com.au"
              value={values.domain}
              onChange={(e) => set('domain', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={values.status}
                onValueChange={(v) => set('status', v as SendingDomainStatus)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Provider</Label>
              <Input
                placeholder="instantly / google_workspace"
                value={values.provider}
                onChange={(e) => set('provider', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(['spf_status','dkim_status','dmarc_status'] as const).map((field) => (
              <div key={field} className="space-y-1">
                <Label className="uppercase text-[11px] tracking-wide">
                  {field.replace('_status','')}
                </Label>
                <Select
                  value={values[field]}
                  onValueChange={(v) => set(field, v as DnsFieldStatus)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DNS_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>Inboxes</Label>
              <Input
                type="number"
                min={0}
                value={values.inbox_count}
                onChange={(e) => set('inbox_count', Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1">
              <Label>Warmup day</Label>
              <Input
                type="number"
                min={0}
                value={values.warmup_day}
                onChange={(e) => set('warmup_day', Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1">
              <Label>Target day</Label>
              <Input
                type="number"
                min={1}
                value={values.warmup_target_day}
                onChange={(e) => set('warmup_target_day', Number(e.target.value) || 21)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              placeholder="Anything you want to remember about this domain"
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={isPending || !values.domain.trim()}
          >
            {isPending ? 'Saving…' : isNew ? 'Add domain' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-6 text-center space-y-3">
      <Mail className="w-6 h-6 mx-auto text-muted-foreground" />
      <p className="text-sm">No sending domain configured yet.</p>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">
        Week 5: buy a domain (~$15/yr) + Google Workspace (~$19/mo) + wire to
        Instantly.ai. Purezza IT blocks your work Gmail for cold volume — a
        satellite domain keeps deliverability (and your day job) safe.
      </p>
      <Button size="sm" onClick={onAdd}>Add sending domain</Button>
    </div>
  )
}

function Checklist({ row }: { row: SendingDomain }) {
  const items: { label: string; done: boolean }[] = [
    { label: 'Domain purchased', done: !!row.domain },
    { label: `Inboxes ready (${row.inbox_count})`, done: row.inbox_count > 0 },
    { label: 'SPF pass', done: row.spf_status === 'pass' },
    { label: 'DKIM pass', done: row.dkim_status === 'pass' },
    { label: 'DMARC pass', done: row.dmarc_status === 'pass' },
    { label: `Provider: ${row.provider ?? '—'}`, done: !!row.provider },
  ]
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              'inline-block w-3.5 h-3.5 rounded border text-[10px] leading-none flex items-center justify-center',
              it.done
                ? 'bg-[color:var(--jordan-accent-mint)] border-[color:var(--jordan-accent-mint)] text-white'
                : 'border-muted-foreground/30',
            )}
          >
            {it.done ? '✓' : ''}
          </span>
          <span className={cn(it.done ? 'text-foreground' : 'text-muted-foreground')}>
            {it.label}
          </span>
        </li>
      ))}
    </ul>
  )
}

function WarmupProgress({ row }: { row: SendingDomain }) {
  const pct = Math.max(
    0,
    Math.min(100, Math.round((row.warmup_day / Math.max(1, row.warmup_target_day)) * 100)),
  )
  return (
    <div className="space-y-1.5">
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-[color:var(--jordan-accent-mint)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Day {row.warmup_day} of {row.warmup_target_day}. Keep Instantly warmup
        running. Do not increase send volume until Day {row.warmup_target_day}.
      </p>
    </div>
  )
}

function ErrorState({ row }: { row: SendingDomain }) {
  const failures: string[] = []
  if (row.spf_status === 'fail') failures.push('SPF record failing')
  if (row.dkim_status === 'fail') failures.push('DKIM record failing')
  if (row.dmarc_status === 'fail' || row.dmarc_status === 'missing') {
    failures.push(`DMARC ${row.dmarc_status === 'missing' ? 'missing' : 'failing'}`)
  }
  if (failures.length === 0) failures.push('Manual error flag set. Check notes for details.')

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="flex items-center gap-2 text-amber-700">
        <AlertTriangle className="w-4 h-4" />
        <p className="text-sm font-medium">Fix these records in your DNS provider before sending.</p>
      </div>
      <ul className="list-disc pl-5 text-xs text-amber-800 space-y-0.5">
        {failures.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  )
}

function ActiveState({ row }: { row: SendingDomain }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-green-700">
        <CheckCircle2 className="w-4 h-4" />
        Ready to send. Monitor deliverability weekly.
      </div>
      <div className="flex flex-wrap gap-1.5">
        <DnsChip label="SPF" value={row.spf_status} />
        <DnsChip label="DKIM" value={row.dkim_status} />
        <DnsChip label="DMARC" value={row.dmarc_status} />
        <div className="px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
          Inboxes · {row.inbox_count}
        </div>
      </div>
    </div>
  )
}

export function SendingInfrastructureCard() {
  const { user } = useAuth()
  const { data: row, isLoading } = useSendingDomain(user?.id)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Sending Infrastructure</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Satellite domain, inboxes, DNS records, warmup progress.
          </p>
        </div>
        {row && (
          <Badge
            variant="outline"
            className={cn('text-[11px]', STATUS_TONE[row.status as SendingDomainStatus])}
          >
            {STATUS_LABEL[row.status as SendingDomainStatus]}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && !row && <EmptyState onAdd={() => setEditOpen(true)} />}
        {!isLoading && row && (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-mono">{row.domain}</p>
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            </div>

            {row.status === 'not_configured' || row.status === 'pending_dns' ? (
              <Checklist row={row} />
            ) : row.status === 'warming_up' ? (
              <WarmupProgress row={row} />
            ) : row.status === 'active' ? (
              <ActiveState row={row} />
            ) : row.status === 'error' ? (
              <ErrorState row={row} />
            ) : (
              <p className="text-xs text-muted-foreground">
                Paused. Resume sending from Instantly and set status back to
                active when you're ready.
              </p>
            )}

            {row.notes && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {row.notes}
              </p>
            )}
          </>
        )}
      </CardContent>

      <EditModal open={editOpen} onOpenChange={setEditOpen} row={row ?? null} />
    </Card>
  )
}
