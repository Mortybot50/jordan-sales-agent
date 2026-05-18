/**
 * EmailAccountsPage — manage the LeadFlow native sender inboxes.
 *
 * Week 1: add / edit / delete inboxes and run a self-targeted SMTP test.
 * Pacing / warmup / drain-queue UI lands in Week 2.
 *
 * SMTP passwords are sent in plaintext over HTTPS to /api/email-accounts/save
 * which encrypts server-side with TOKEN_ENCRYPTION_KEY before insert. The
 * browser never holds the key and we never select the ciphertext back —
 * the password field is a write-only "leave blank to keep existing" affordance.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Send,
  CheckCircle2,
  AlertCircle,
  Pause,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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
  useEmailAccounts,
  useSaveEmailAccount,
  useDeleteEmailAccount,
  useTestEmailAccountConnection,
  type EmailAccount,
  type EmailAccountStatus,
  type EmailAccountBrand,
  type EmailAccountSegment,
  type SaveEmailAccountPayload,
} from '@/lib/queries/email-accounts'

const BRANDS: { value: NonNullable<EmailAccountBrand>; label: string }[] = [
  { value: 'purezza', label: 'Purezza' },
  { value: 'culligan', label: 'Culligan' },
  { value: 'zip', label: 'Zip' },
]

const SEGMENTS: { value: NonNullable<EmailAccountSegment>; label: string }[] = [
  { value: 'hospitality', label: 'Hospitality' },
  { value: 'office', label: 'Office' },
  { value: 'trade', label: 'Trade' },
]

const STATUSES: {
  value: EmailAccountStatus
  label: string
  tone: 'green' | 'amber' | 'red' | 'muted'
}[] = [
  { value: 'active', label: 'Active', tone: 'green' },
  { value: 'warming', label: 'Warming', tone: 'amber' },
  { value: 'paused', label: 'Paused', tone: 'muted' },
  { value: 'bounced_recently', label: 'Bounced recently', tone: 'red' },
]

interface FormValues {
  email_address: string
  display_name: string
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_password: string
  reply_to_address: string
  send_signature: string
  daily_send_cap: number
  brand: '' | NonNullable<EmailAccountBrand>
  icp_segment: '' | NonNullable<EmailAccountSegment>
  status: EmailAccountStatus
}

function defaultFormValues(account?: EmailAccount | null): FormValues {
  return {
    email_address: account?.email_address ?? '',
    display_name: account?.display_name ?? '',
    smtp_host: account?.smtp_host ?? 'smtp.gmail.com',
    smtp_port: account?.smtp_port ?? 587,
    smtp_username: account?.smtp_username ?? '',
    smtp_password: '',
    reply_to_address: account?.reply_to_address ?? '',
    send_signature: account?.send_signature ?? '',
    daily_send_cap: account?.daily_send_cap ?? 50,
    brand: account?.brand ?? '',
    icp_segment: account?.icp_segment ?? '',
    status: account?.status ?? 'active',
  }
}

function StatusBadge({ status }: { status: EmailAccountStatus }) {
  const meta = STATUSES.find((s) => s.value === status)
  if (!meta) return null
  const className =
    meta.tone === 'green'
      ? 'bg-green-100 text-green-700 border-0'
      : meta.tone === 'amber'
        ? 'bg-amber-100 text-amber-700 border-0'
        : meta.tone === 'red'
          ? 'bg-red-100 text-red-700 border-0'
          : 'bg-muted text-muted-foreground border-0'
  return <Badge className={`${className} text-xs`}>{meta.label}</Badge>
}

interface InboxRowProps {
  account: EmailAccount
  onEdit: () => void
  onDelete: () => void
}

function InboxRow({ account, onEdit, onDelete }: InboxRowProps) {
  const testConnection = useTestEmailAccountConnection()

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-3 py-3 px-4">
        <div className="flex-1 min-w-[220px] space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{account.email_address}</p>
            <StatusBadge status={account.status} />
            {account.brand && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                {account.brand}
              </Badge>
            )}
            {account.icp_segment && (
              <Badge variant="outline" className="text-[10px] capitalize">
                {account.icp_segment}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {account.smtp_host}:{account.smtp_port} · cap {account.daily_send_cap}/day
            {account.last_send_at ? (
              <> · last sent {new Date(account.last_send_at).toLocaleString('en-AU')}</>
            ) : (
              <> · never sent</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => testConnection.mutate(account.id)}
            disabled={testConnection.isPending}
            title="Send a test email to this inbox"
          >
            <Send className="w-3 h-3 mr-1" />
            {testConnection.isPending ? 'Testing…' : 'Test'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onEdit}
            title="Edit inbox"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Delete inbox"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface InboxDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: EmailAccount | null
}

function InboxDialog({ open, onOpenChange, editing }: InboxDialogProps) {
  const save = useSaveEmailAccount()
  const isEdit = !!editing
  const form = useForm<FormValues>({ defaultValues: defaultFormValues(editing) })

  // Reset the form whenever the dialog opens with a different target.
  // Without this, switching from "edit Inbox A" to "edit Inbox B" would
  // keep A's values in the form because react-hook-form caches defaults.
  function handleOpenChange(v: boolean) {
    if (v) form.reset(defaultFormValues(editing))
    onOpenChange(v)
  }

  async function onSubmit(values: FormValues) {
    const payload: SaveEmailAccountPayload = {
      ...(isEdit ? { id: editing!.id } : {}),
      email_address: values.email_address.trim().toLowerCase(),
      display_name: values.display_name.trim() || null,
      smtp_host: values.smtp_host.trim(),
      smtp_port: Number(values.smtp_port),
      smtp_username: values.smtp_username.trim(),
      reply_to_address: values.reply_to_address.trim() || null,
      send_signature: values.send_signature.trim() || null,
      daily_send_cap: Number(values.daily_send_cap),
      brand: values.brand || null,
      icp_segment: values.icp_segment || null,
      status: values.status,
    }
    // Only send the password when the user typed one — server-side this
    // means "keep existing ciphertext" on edit. On create the API requires it.
    if (values.smtp_password) {
      payload.smtp_password = values.smtp_password
    } else if (!isEdit) {
      toast.error('SMTP app password is required when adding a new inbox')
      return
    }

    try {
      await save.mutateAsync(payload)
      onOpenChange(false)
    } catch {
      // toast handled by the mutation's onError
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit inbox' : 'Add inbox'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="email_address">Email address *</Label>
              <Input
                id="email_address"
                type="email"
                required
                placeholder="jordan.purezza@purezza.com.au"
                {...form.register('email_address', { required: true })}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="display_name">Display name (the "From" name)</Label>
              <Input
                id="display_name"
                placeholder="Jordan @ Purezza"
                {...form.register('display_name')}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="smtp_host">SMTP host</Label>
              <Input id="smtp_host" {...form.register('smtp_host')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtp_port">SMTP port</Label>
              <Input
                id="smtp_port"
                type="number"
                min={1}
                max={65535}
                {...form.register('smtp_port', { valueAsNumber: true })}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="smtp_username">SMTP username</Label>
              <Input
                id="smtp_username"
                placeholder="usually the same as the email address"
                {...form.register('smtp_username')}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="smtp_password">
                SMTP app password {isEdit && <span className="text-muted-foreground text-xs">(leave blank to keep existing)</span>}
              </Label>
              <Input
                id="smtp_password"
                type="password"
                autoComplete="new-password"
                placeholder={isEdit ? '••••••••••••••••' : 'xxxx xxxx xxxx xxxx'}
                {...form.register('smtp_password')}
              />
              <p className="text-xs text-muted-foreground">
                For Gmail, generate an{' '}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:underline"
                >
                  App Password
                </a>{' '}
                with 2FA enabled. Encrypted server-side before storage; never sent back to the browser.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="daily_send_cap">Daily send cap</Label>
              <Input
                id="daily_send_cap"
                type="number"
                min={0}
                max={1000}
                {...form.register('daily_send_cap', { valueAsNumber: true })}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="status">Status</Label>
              <Select
                value={form.watch('status')}
                onValueChange={(v) => form.setValue('status', v as EmailAccountStatus)}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="brand">Brand (optional)</Label>
              <Select
                value={form.watch('brand') || '__none__'}
                onValueChange={(v) =>
                  form.setValue(
                    'brand',
                    v === '__none__' ? '' : (v as NonNullable<EmailAccountBrand>),
                  )
                }
              >
                <SelectTrigger id="brand">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {BRANDS.map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="icp_segment">Segment (optional)</Label>
              <Select
                value={form.watch('icp_segment') || '__none__'}
                onValueChange={(v) =>
                  form.setValue(
                    'icp_segment',
                    v === '__none__' ? '' : (v as NonNullable<EmailAccountSegment>),
                  )
                }
              >
                <SelectTrigger id="icp_segment">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {SEGMENTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="reply_to_address">Reply-to (optional)</Label>
              <Input
                id="reply_to_address"
                type="email"
                placeholder="leave blank to use the sending address"
                {...form.register('reply_to_address')}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="send_signature">Email signature (optional)</Label>
              <Textarea
                id="send_signature"
                rows={3}
                placeholder="Jordan Smith&#10;Sales · Purezza&#10;0400 000 000"
                {...form.register('send_signature')}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add inbox'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EmailAccountsPage() {
  const { data: accounts, isLoading } = useEmailAccounts()
  const deleteAccount = useDeleteEmailAccount()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<EmailAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EmailAccount | null>(null)

  function handleAdd() {
    setEditing(null)
    setDialogOpen(true)
  }

  function handleEdit(account: EmailAccount) {
    setEditing(account)
    setDialogOpen(true)
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    await deleteAccount.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
  }

  const accountList = accounts ?? []
  const activeCount = accountList.filter((a) => a.status === 'active').length
  const pausedCount = accountList.filter((a) => a.status === 'paused').length
  const warmingCount = accountList.filter((a) => a.status === 'warming').length

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div>
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Settings
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Email inboxes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          The inboxes LeadFlow sends cold outreach from. Each inbox owns its own
          SMTP credentials, daily cap, brand and target segment.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={handleAdd} size="sm">
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add inbox
        </Button>
        {accountList.length > 0 && (
          <div className="text-xs text-muted-foreground flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-green-600" />
              {activeCount} active
            </span>
            {warmingCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-600" />
                {warmingCount} warming
              </span>
            )}
            {pausedCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Pause className="w-3 h-3" />
                {pausedCount} paused
              </span>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : accountList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center text-center py-10 px-4 gap-2">
            <AlertCircle className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm font-medium">No inboxes yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Add your first sending inbox — typically a Gmail or Workspace
              mailbox with an app password — to start cold outbound.
            </p>
            <Button type="button" size="sm" className="mt-2" onClick={handleAdd}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add inbox
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {accountList.map((account) => (
            <InboxRow
              key={account.id}
              account={account}
              onEdit={() => handleEdit(account)}
              onDelete={() => setDeleteTarget(account)}
            />
          ))}
        </div>
      )}

      <InboxDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      {/* Delete confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Delete inbox?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{deleteTarget?.email_address}</span>{' '}
            and its encrypted SMTP credentials will be removed. Queued sends from
            this inbox will fail. This cannot be undone.
          </p>
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleteAccount.isPending}
              onClick={handleConfirmDelete}
            >
              {deleteAccount.isPending ? 'Deleting…' : 'Delete inbox'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
