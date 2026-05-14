import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
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
import { useAuth } from '@/hooks/useAuth'
import { canAdmin } from '@/lib/auth'
import { useUpdateUserProfile } from '@/lib/queries/users'
import { useStages, useCreateStage, useDeleteStage, useUpdateStage } from '@/lib/queries/stages'
import { useDeals } from '@/lib/queries/deals'
import { profileFormSchema, icpFormSchema, type ProfileFormValues, type IcpFormValues } from '@/lib/schemas/user'
import { venueTypeLabel, cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, ChevronUp, ChevronDown, CheckCircle2, XCircle, CheckCircle, ExternalLink, ShieldAlert, ArrowRight, Link2, Copy, Calendar, Circle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSuppressionList } from '@/lib/queries/suppression'
import { SendingInfrastructureCard } from '@/components/settings/SendingInfrastructureCard'

// --- Profile Tab ---
function ProfileTab() {
  const { user } = useAuth()
  const updateProfile = useUpdateUserProfile()
  const [briefingEnabled, setBriefingEnabled] = useState(user?.email_notifications?.morning_briefing ?? true)
  const [briefingHour, setBriefingHour] = useState(user?.email_notifications?.briefing_time_hour ?? 7)
  const [pausedUntil, setPausedUntil] = useState<string | null>(
    user?.email_notifications?.morning_briefing_paused_until ?? null,
  )
  const [sendingTest, setSendingTest] = useState(false)

  const isDev = import.meta.env.MODE === 'development'
  const showManualTrigger = isDev || canAdmin(user)

  const isPaused = !!pausedUntil && new Date(pausedUntil) > new Date()
  const pausedUntilLabel = pausedUntil
    ? new Date(pausedUntil).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    : null

  // Compute next send time as a hint when enabled.
  function nextSendLabel(): string {
    const now = new Date()
    // 7am Melbourne next occurrence — using user's chosen hour.
    const target = new Date(now)
    // Get current Melbourne hour to decide if today's slot is past.
    const melbHourStr = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      hour: 'numeric',
      hour12: false,
    }).format(now)
    const melbHour = parseInt(melbHourStr, 10) % 24
    if (melbHour >= briefingHour) {
      target.setDate(target.getDate() + 1)
    }
    return target.toLocaleDateString('en-AU', {
      weekday: 'short',
      timeZone: 'Australia/Melbourne',
    }) + ` ${briefingHour}am AEST`
  }

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      full_name: user?.full_name ?? '',
      calendly_url: user?.calendly_url ?? '',
      calendly_account_email: user?.calendly_account_email ?? '',
      email_signature: user?.email_signature ?? '',
      default_commission_pct: user?.default_commission_pct ?? null,
    },
  })

  async function onSubmit(values: ProfileFormValues) {
    if (!user) return
    await updateProfile.mutateAsync({
      id: user.id,
      full_name: values.full_name,
      calendly_url: values.calendly_url || undefined,
      calendly_account_email: values.calendly_account_email
        ? values.calendly_account_email.toLowerCase().trim()
        : null,
      email_signature: values.email_signature || undefined,
      default_commission_pct:
        values.default_commission_pct == null || Number.isNaN(values.default_commission_pct)
          ? null
          : values.default_commission_pct,
      email_notifications: {
        morning_briefing: briefingEnabled,
        briefing_time_hour: briefingHour,
        morning_briefing_paused_until: pausedUntil,
      },
    })
  }

  async function handlePause7Days() {
    if (!user) return
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    setPausedUntil(until)
    await updateProfile.mutateAsync({
      id: user.id,
      email_notifications: {
        morning_briefing: briefingEnabled,
        briefing_time_hour: briefingHour,
        morning_briefing_paused_until: until,
      },
    })
  }

  async function handleResumePause() {
    if (!user) return
    setPausedUntil(null)
    await updateProfile.mutateAsync({
      id: user.id,
      email_notifications: {
        morning_briefing: briefingEnabled,
        briefing_time_hour: briefingHour,
        morning_briefing_paused_until: null,
      },
    })
  }

  async function handleSendTestBriefing() {
    if (!user) return
    setSendingTest(true)
    try {
      const { data, error } = await supabase.functions.invoke('send-morning-briefing', {
        body: { mode: 'manual', user_id: user.id, force: true },
      })
      if (error) throw error
      const result = data as { sent?: number; skipped_already_sent_today?: number; errors?: string[] }
      if (result?.sent && result.sent > 0) {
        toast.success('Test briefing sent — check your inbox')
      } else if (result?.skipped_already_sent_today) {
        toast.message('Already sent today', {
          description: 'Idempotency guard fired — clear briefing_sends to re-send.',
        })
      } else if (result?.errors?.length) {
        toast.error(`Send failed: ${result.errors[0]}`)
      } else {
        toast.message('No briefing sent', { description: JSON.stringify(result) })
      }
    } catch (e) {
      toast.error(`Manual trigger failed: ${(e as Error).message}`)
    } finally {
      setSendingTest(false)
    }
  }

  function onInvalid(errors: FieldErrors<ProfileFormValues>) {
    console.error('[Settings.ProfileTab] validation failed:', errors)
    const first = Object.entries(errors)[0]
    if (first) {
      const [field, err] = first
      const message = (err as { message?: string })?.message ?? 'Invalid value'
      toast.error('Cannot save profile — check the form', {
        description: `${field}: ${message}`,
      })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-4 max-w-lg">
      <div className="space-y-1">
        <Label htmlFor="full_name">Full name *</Label>
        <Input
          id="full_name"
          {...form.register('full_name')}
          className={cn(form.formState.errors.full_name && 'border-destructive')}
        />
        {form.formState.errors.full_name && (
          <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="calendly_url">Calendly URL</Label>
        <Input
          id="calendly_url"
          type="url"
          placeholder="https://calendly.com/yourname"
          {...form.register('calendly_url')}
          className={cn(form.formState.errors.calendly_url && 'border-destructive')}
        />
        {form.formState.errors.calendly_url && (
          <p className="text-xs text-destructive">{form.formState.errors.calendly_url.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="calendly_account_email">Calendly account email</Label>
        <Input
          id="calendly_account_email"
          type="email"
          placeholder="you@example.com"
          {...form.register('calendly_account_email')}
          className={cn(form.formState.errors.calendly_account_email && 'border-destructive')}
        />
        <p className="text-xs text-muted-foreground">
          The email on your Calendly account (the one Calendly sends bookings from).
          Used to route incoming webhook events to your account.
        </p>
        {form.formState.errors.calendly_account_email && (
          <p className="text-xs text-destructive">
            {form.formState.errors.calendly_account_email.message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="email_signature">Email signature</Label>
        <Textarea
          id="email_signature"
          rows={5}
          placeholder="Jordan Smith&#10;Sales Manager · Purezza&#10;jordan@purezza.com.au"
          {...form.register('email_signature')}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="default_commission_pct">Default commission %</Label>
        <div className="relative max-w-[160px]">
          <Input
            id="default_commission_pct"
            type="number"
            step="0.01"
            min={0}
            max={100}
            placeholder="7.50"
            className={cn(
              'pr-7',
              form.formState.errors.default_commission_pct && 'border-destructive',
            )}
            {...form.register('default_commission_pct', {
              setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
            })}
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            %
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Pre-fills new deals when no package is selected. Picking a package still uses
          its catalogue rate.
        </p>
        {form.formState.errors.default_commission_pct && (
          <p className="text-xs text-destructive">
            {form.formState.errors.default_commission_pct.message}
          </p>
        )}
      </div>

      <Separator />

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Calendly Webhook URL</Label>
        <p className="text-xs text-muted-foreground">
          Register this URL in Calendly → Integrations → Webhooks to auto-log bookings:
        </p>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={`${window.location.origin}/api/webhooks/calendly`}
            className="font-mono text-xs bg-muted"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/calendly`)
              toast.success('Copied')
            }}
          >
            Copy
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Events: <code className="text-xs bg-muted px-1 rounded">invitee.created</code> and{' '}
          <code className="text-xs bg-muted px-1 rounded">invitee.canceled</code>
        </p>
      </div>

      <Separator />

      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Email Notifications</Label>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Morning briefing</p>
            <p className="text-xs text-muted-foreground">
              {isPaused
                ? `Paused until ${pausedUntilLabel}`
                : briefingEnabled
                  ? `Next briefing: ${nextSendLabel()}`
                  : 'Receive your daily digest at 7am AEST'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={briefingEnabled}
            onClick={() => setBriefingEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${briefingEnabled ? 'bg-primary' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${briefingEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {briefingEnabled && (
          <div className="space-y-1">
            <Label htmlFor="briefing_hour">Briefing time</Label>
            <Select value={String(briefingHour)} onValueChange={(v) => setBriefingHour(Number(v))}>
              <SelectTrigger id="briefing_hour" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 6, 7, 8, 9].map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h}:00am AEST
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {briefingEnabled && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {isPaused ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleResumePause}
                disabled={updateProfile.isPending}
              >
                Resume now
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handlePause7Days}
                disabled={updateProfile.isPending}
              >
                Pause for 7 days
              </Button>
            )}
            {showManualTrigger && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleSendTestBriefing}
                disabled={sendingTest}
                title="Trigger send-morning-briefing for your account (admin/dev only)"
              >
                {sendingTest ? 'Sending…' : 'Send me a test briefing now'}
              </Button>
            )}
          </div>
        )}
      </div>

      <Button type="submit" disabled={updateProfile.isPending}>
        {updateProfile.isPending ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  )
}

// --- Voice & Style Rules ---
function VoiceRulesSection() {
  const { user } = useAuth()
  const updateProfile = useUpdateUserProfile()
  const [value, setValue] = useState(user?.voice_rules ?? '')

  useEffect(() => {
    setValue(user?.voice_rules ?? '')
  }, [user?.voice_rules])

  async function handleSave() {
    if (!user) return
    await updateProfile.mutateAsync({
      id: user.id,
      voice_rules: value.trim() === '' ? null : value,
    })
  }

  return (
    <div className="space-y-3 max-w-lg">
      <p className="text-xs text-muted-foreground">
        Rules injected into every AI draft. Use plain English bullets. Examples:
        "Never use specific times like 1:48pm", "Stay under 80 words for cold outreach".
        Leave blank to use Jordan's default voice only.
      </p>
      <Textarea
        rows={8}
        className="font-mono text-xs"
        placeholder={'- Never use oddly specific times like "1:48pm"\n- Stay under 80 words for cold outreach\n- Don\'t include a Calendly link unless the venue has explicitly asked to chat\n- Always reference {{public_booking_url}} in follow-up emails (not openers)'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="button" onClick={handleSave} disabled={updateProfile.isPending}>
        {updateProfile.isPending ? 'Saving…' : 'Save voice rules'}
      </Button>
    </div>
  )
}

// --- Pipeline Stages Tab ---
function PipelineStagesTab() {
  const { user } = useAuth()
  const { data: stages } = useStages()
  const { data: deals } = useDeals()
  const createStage = useCreateStage()
  const updateStage = useUpdateStage()
  const deleteStage = useDeleteStage()

  const [newStageName, setNewStageName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [reassignTo, setReassignTo] = useState<string>('')

  const deleteStageData = stages?.find((s) => s.id === deleteTarget)
  const dealsInDeleteStage = deals?.filter((d) => d.stage_id === deleteTarget) ?? []

  async function handleAddStage() {
    if (!user || !newStageName.trim()) return
    const maxPos = Math.max(...(stages?.map((s) => s.position) ?? [0]))
    await createStage.mutateAsync({
      org_id: user.org_id,
      name: newStageName.trim(),
      position: maxPos + 1,
    })
    setNewStageName('')
  }

  async function handleSaveEdit(id: string) {
    if (!editingName.trim()) return
    await updateStage.mutateAsync({ id, name: editingName.trim() })
    setEditingId(null)
  }

  async function handleMoveUp(id: string) {
    const idx = stages?.findIndex((s) => s.id === id) ?? -1
    if (idx <= 0 || !stages) return
    const above = stages[idx - 1]
    const current = stages[idx]
    await updateStage.mutateAsync({ id: current.id, position: above.position })
    await updateStage.mutateAsync({ id: above.id, position: current.position })
  }

  async function handleMoveDown(id: string) {
    const idx = stages?.findIndex((s) => s.id === id) ?? -1
    if (idx < 0 || idx >= (stages?.length ?? 0) - 1 || !stages) return
    const below = stages[idx + 1]
    const current = stages[idx]
    await updateStage.mutateAsync({ id: current.id, position: below.position })
    await updateStage.mutateAsync({ id: below.id, position: current.position })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteStage.mutateAsync({
      id: deleteTarget,
      reassign_to: dealsInDeleteStage.length > 0 ? reassignTo : undefined,
    })
    setDeleteTarget(null)
    setReassignTo('')
  }

  return (
    <div className="space-y-4 max-w-lg">
      {/* Stages list */}
      <div className="border rounded-lg divide-y">
        {(!stages || stages.length === 0) && (
          <p className="text-sm text-muted-foreground px-4 py-4">No stages yet.</p>
        )}
        {stages?.map((stage, index) => (
          <div key={stage.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex flex-col shrink-0">
              <button
                type="button"
                className="p-0 h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-default transition-colors"
                onClick={() => handleMoveUp(stage.id)}
                disabled={index === 0 || updateStage.isPending}
                title="Move up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="p-0 h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-default transition-colors"
                onClick={() => handleMoveDown(stage.id)}
                disabled={index === (stages?.length ?? 0) - 1 || updateStage.isPending}
                title="Move down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            {stage.color && (
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: stage.color }}
              />
            )}
            {editingId === stage.id ? (
              <div className="flex-1 flex items-center gap-2">
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="h-7 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit(stage.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => handleSaveEdit(stage.id)}
                >
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => setEditingId(null)}
                >
                  <XCircle className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <>
                <span
                  className="flex-1 text-sm cursor-pointer hover:text-primary transition-colors"
                  onClick={() => {
                    setEditingId(stage.id)
                    setEditingName(stage.name)
                  }}
                >
                  {stage.name}
                </span>
                {stage.is_closed && (
                  <Badge variant="outline" className="text-xs">Closed</Badge>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setDeleteTarget(stage.id)
                    setReassignTo('')
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        ))}

        {/* Add new stage */}
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Input
            placeholder="New stage name…"
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            className="h-7 text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddStage()
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={handleAddStage}
            disabled={!newStageName.trim() || createStage.isPending}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* Delete confirm dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Delete "{deleteStageData?.name}"?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {dealsInDeleteStage.length > 0 ? (
              <>
                <p className="text-sm text-amber-600 bg-amber-50 rounded px-3 py-2">
                  {dealsInDeleteStage.length} deal{dealsInDeleteStage.length !== 1 ? 's' : ''} will need reassigning.
                </p>
                <div className="space-y-1">
                  <Label>Move deals to</Label>
                  <Select value={reassignTo} onValueChange={setReassignTo}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a stage" />
                    </SelectTrigger>
                    <SelectContent>
                      {stages
                        ?.filter((s) => s.id !== deleteTarget)
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                This stage has no deals. It will be permanently removed.
              </p>
            )}
          </div>
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
              disabled={
                deleteStage.isPending ||
                (dealsInDeleteStage.length > 0 && !reassignTo)
              }
              onClick={handleDelete}
            >
              {deleteStage.isPending ? 'Deleting…' : 'Delete stage'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const ALL_VENUE_TYPES = [
  'restaurant', 'cafe', 'hotel', 'event_space', 'bar',
  'club', 'pub', 'qsr', 'function_centre', 'franchise_chain', 'other',
] as const

const LICENCE_TYPES = ['on_premises', 'general_late', 'packaged_liquor', 'restaurant_&_cafe'] as const
const SPEND_TIERS = ['$', '$$', '$$$', '$$$$'] as const

// --- ICP Tab ---
function IcpTab() {
  const { user } = useAuth()
  const updateProfile = useUpdateUserProfile()

  const icp = user?.icp_config ?? {}

  const [suburbInput, setSuburbInput] = useState('')

  const form = useForm<IcpFormValues>({
    resolver: zodResolver(icpFormSchema),
    defaultValues: {
      venue_types: (icp.venue_types as string[]) ?? [],
      excluded_types: (icp.excluded_types as string[]) ?? [],
      cover_count_min: (icp.cover_count_min as number | null) ?? (icp.min_cover_count as number | null) ?? null,
      cover_count_max: (icp.cover_count_max as number | null) ?? (icp.max_cover_count as number | null) ?? null,
      suburbs: (icp.suburbs as string[]) ?? [],
      licence_types: (icp.licence_types as string[]) ?? [],
      avg_spend_tiers: (icp.avg_spend_tiers as string[]) ?? [],
    },
  })

  const selectedTypes = form.watch('venue_types') ?? []
  const excludedTypes = form.watch('excluded_types') ?? []
  const suburbs = form.watch('suburbs') ?? []
  const selectedLicence = form.watch('licence_types') ?? []
  const selectedTiers = form.watch('avg_spend_tiers') ?? []

  function toggleArr(val: string, field: 'venue_types' | 'excluded_types' | 'licence_types' | 'avg_spend_tiers') {
    const current = form.getValues(field) ?? []
    form.setValue(field, current.includes(val) ? current.filter((t) => t !== val) : [...current, val])
  }

  function addSuburb() {
    const trimmed = suburbInput.trim()
    if (!trimmed || suburbs.includes(trimmed)) { setSuburbInput(''); return }
    form.setValue('suburbs', [...suburbs, trimmed])
    setSuburbInput('')
  }

  function removeSuburb(s: string) {
    form.setValue('suburbs', suburbs.filter((x) => x !== s))
  }

  async function onSubmit(values: IcpFormValues) {
    if (!user) return
    await updateProfile.mutateAsync({
      id: user.id,
      icp_config: {
        venue_types: values.venue_types ?? [],
        excluded_types: values.excluded_types ?? [],
        cover_count_min: values.cover_count_min ?? null,
        cover_count_max: values.cover_count_max ?? null,
        suburbs: values.suburbs ?? [],
        licence_types: values.licence_types ?? [],
        avg_spend_tiers: values.avg_spend_tiers ?? [],
      },
    })
  }

  function onInvalid(errors: FieldErrors<IcpFormValues>) {
    console.error('[Settings.IcpTab] validation failed:', errors)
    const first = Object.entries(errors)[0]
    if (first) {
      const [field, err] = first
      const message = (err as { message?: string })?.message ?? 'Invalid value'
      toast.error('Cannot save ICP — check the form', {
        description: `${field}: ${message}`,
      })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-5 max-w-lg">
      <p className="text-xs text-muted-foreground -mt-1">
        Hospitality ICP: cover count, suburb, licence type, kitchen style,
        service style, spend tier. Melbourne hospitality cycle is typically
        60–90 days with a single decision-maker; fit here is what makes cold
        outreach land.
      </p>
      <div className="space-y-2">
        <Label>Target venue types</Label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_VENUE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleArr(type, 'venue_types')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs border transition-colors',
                selectedTypes.includes(type)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-input hover:bg-accent'
              )}
            >
              {venueTypeLabel(type)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Excluded venue types</Label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_VENUE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleArr(type, 'excluded_types')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs border transition-colors',
                excludedTypes.includes(type)
                  ? 'bg-destructive text-destructive-foreground border-destructive'
                  : 'border-input hover:bg-accent'
              )}
            >
              {venueTypeLabel(type)}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Min cover count</Label>
          <Input
            type="number"
            min={0}
            placeholder="40"
            {...form.register('cover_count_min', { valueAsNumber: true })}
          />
        </div>
        <div className="space-y-1">
          <Label>Max cover count</Label>
          <Input
            type="number"
            min={0}
            placeholder="300"
            {...form.register('cover_count_max', { valueAsNumber: true })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Target suburbs <span className="text-muted-foreground text-xs">(leave empty = all)</span></Label>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Fitzroy"
            value={suburbInput}
            onChange={(e) => setSuburbInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSuburb() } }}
            className="flex-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={addSuburb}>Add</Button>
        </div>
        {suburbs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {suburbs.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-xs">
                {s}
                <button type="button" onClick={() => removeSuburb(s)} className="hover:text-destructive">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Licence types</Label>
        <div className="flex flex-wrap gap-1.5">
          {LICENCE_TYPES.map((lt) => (
            <button
              key={lt}
              type="button"
              onClick={() => toggleArr(lt, 'licence_types')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs border transition-colors capitalize',
                selectedLicence.includes(lt)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-input hover:bg-accent'
              )}
            >
              {lt.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Avg spend tier</Label>
        <div className="flex gap-1.5">
          {SPEND_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => toggleArr(tier, 'avg_spend_tiers')}
              className={cn(
                'px-3 py-1 rounded-lg text-xs border font-mono transition-colors',
                selectedTiers.includes(tier)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-input hover:bg-accent'
              )}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      <Button type="submit" disabled={updateProfile.isPending}>
        {updateProfile.isPending ? 'Saving…' : 'Save ICP config'}
      </Button>
    </form>
  )
}

// --- Integrations Tab ---
function IntegrationsTab() {
  const { user } = useAuth()
  const qc = useQueryClient()

  // Check if Gmail is connected
  const { data: gmailConnection } = useQuery({
    queryKey: ['gmail-connection'],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('gmail_connections')
        .select('id, email, watch_expires_at')
        .eq('user_id', user?.id ?? '')
        .maybeSingle()
      return data as { id: string; email: string; watch_expires_at: string | null } | null
    },
    enabled: !!user?.id,
  })

  const disconnectGmail = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('gmail_connections')
        .delete()
        .eq('user_id', user?.id ?? '')
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gmail-connection'] })
      toast.success('Gmail disconnected')
    },
  })

  async function handleConnectGmail() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      toast.error('Please log in first')
      return
    }
    window.location.href = `/api/oauth/gmail/start`
  }

  // ANTHROPIC_API_KEY is server-only; browser bundle cannot introspect it.
  // Draft generation runs in an edge function — if the key were missing,
  // generation would fail loudly there. Showing "Configured" here reflects
  // intent, not a real check; remove the badge if a true health probe is added.
  const isAnthropicConfigured = true

  return (
    <div className="space-y-3 max-w-lg">
      {/* Gmail */}
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
          <div>
            <p className="text-sm font-medium">Gmail</p>
            <p className="text-xs text-muted-foreground">
              {gmailConnection
                ? `Connected as ${gmailConnection.email}`
                : 'Inbound reply watching + send-from'}
            </p>
            {!gmailConnection && (
              <p className="text-xs text-amber-600 mt-0.5">
                Test-users only — Google OAuth verification pending (4–6 weeks)
              </p>
            )}
          </div>
          {gmailConnection ? (
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-700 border-0 text-xs shrink-0">
                <CheckCircle className="w-3 h-3 mr-1" />
                Connected
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => disconnectGmail.mutate()}
                disabled={disconnectGmail.isPending}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleConnectGmail}>
              <ExternalLink className="w-3 h-3 mr-1" />
              Connect Gmail
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Anthropic */}
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
          <div>
            <p className="text-sm font-medium">Anthropic</p>
            <p className="text-xs text-muted-foreground">AI draft generation — claude-sonnet-4-6</p>
          </div>
          {isAnthropicConfigured ? (
            <Badge className="bg-green-100 text-green-700 border-0 text-xs shrink-0">
              Configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs shrink-0 text-amber-600 border-amber-200">
              Key needed
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Calendly */}
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
          <div>
            <p className="text-sm font-medium">Calendly</p>
            <p className="text-xs text-muted-foreground">Auto-log meeting bookings as activities</p>
            <p className="text-xs text-muted-foreground mt-0.5">Set your token in Profile to activate</p>
          </div>
          <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
            Not connected
          </Badge>
        </CardContent>
      </Card>

      {/* Instantly.ai */}
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
          <div>
            <p className="text-sm font-medium">Instantly.ai</p>
            <p className="text-xs text-muted-foreground">Cold outbound sequencing — Week 4</p>
          </div>
          <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
            Week 4
          </Badge>
        </CardContent>
      </Card>

      {/* Resend */}
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
          <div>
            <p className="text-sm font-medium">Resend</p>
            <p className="text-xs text-muted-foreground">Morning briefing email digest</p>
          </div>
          <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
            Not connected
          </Badge>
        </CardContent>
      </Card>

      {/* Workers (owner / admin) */}
      {canAdmin(user) && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
            <div>
              <p className="text-sm font-medium">Workers</p>
              <p className="text-xs text-muted-foreground">
                Background worker observability — last fired, status, items processed
              </p>
            </div>
            <Link
              to="/admin/workers"
              className="shrink-0 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View runs
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// --- Suppression summary tab ---
function SuppressionTab() {
  const { data: entries, isLoading } = useSuppressionList()
  const total = entries?.length ?? 0
  const manual = (entries ?? []).filter((e) => e.reason === 'manual_exclude').length
  const compliance = total - manual

  return (
    <div className="space-y-4 max-w-lg">
      <Card>
        <CardContent className="flex items-start gap-3 py-4 px-4">
          <div className="shrink-0 size-9 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium">Outbound firewall</p>
            <p className="text-xs text-muted-foreground">
              Every contact is checked against the suppression list before we draft, enrol or brief. Addresses added here will never receive outbound.
            </p>
            {!isLoading && (
              <p className="text-xs text-muted-foreground pt-1">
                <strong className="text-foreground">{total}</strong> total · {manual} manual · {compliance} compliance
              </p>
            )}
          </div>
          <Link
            to="/settings/suppression-list"
            className="shrink-0 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Manage
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

// --- Connect Calendly walkthrough card ---
function CalendlyStepIcon({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
  ) : (
    <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
  )
}

function ConnectCalendlyCard() {
  const { user } = useAuth()
  const updateProfile = useUpdateUserProfile()
  const webhookUrl = `${window.location.origin}/api/webhooks/calendly`

  // Step 4 derives from a live probe of the deployed env var.
  const { data: webhookStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['calendly-webhook-status'],
    queryFn: async () => {
      const res = await fetch('/api/webhooks/calendly/status', {
        headers: { 'cache-control': 'no-store' },
      })
      if (!res.ok) return { configured: false }
      return (await res.json()) as { configured: boolean }
    },
    staleTime: 30_000,
  })

  const step1Done = !!user?.calendly_account_email
  const step2Done = !!user?.calendly_url
  const step3Done = !!user?.calendly_webhook_registered_at
  const step4Done = !!webhookStatus?.configured
  const step5Done = !!user?.calendly_test_booking_at

  async function toggleStep3() {
    if (!user) return
    await updateProfile.mutateAsync({
      id: user.id,
      calendly_webhook_registered_at: step3Done ? null : new Date().toISOString(),
    })
  }

  async function toggleStep5() {
    if (!user) return
    await updateProfile.mutateAsync({
      id: user.id,
      calendly_test_booking_at: step5Done ? null : new Date().toISOString(),
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Connect Calendly
        </CardTitle>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Webhook status:</span>
          {statusLoading ? (
            <Badge variant="outline" className="text-xs">Checking…</Badge>
          ) : step4Done ? (
            <Badge className="bg-green-100 text-green-700 border-0 text-xs">
              <CheckCircle className="w-3 h-3 mr-1" />
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">
              Not configured
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3 text-sm">
          {/* Step 1 */}
          <li className="flex items-start gap-3">
            <CalendlyStepIcon done={step1Done} />
            <div className="flex-1 min-w-0">
              <p className="font-medium">1. Copy your Calendly account email</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calendly → Account Settings → copy your account email → paste it
                into the <em>Calendly account email</em> field above.
              </p>
            </div>
          </li>

          {/* Step 2 */}
          <li className="flex items-start gap-3">
            <CalendlyStepIcon done={step2Done} />
            <div className="flex-1 min-w-0">
              <p className="font-medium">2. Set up your scheduling link</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calendly → create / copy the URL of your event type
                (e.g.{' '}
                <code className="text-xs bg-muted px-1 rounded">
                  https://calendly.com/jordan-leadflow/30min
                </code>
                ) → paste into the <em>Calendly URL</em> field above.
              </p>
            </div>
          </li>

          {/* Step 3 */}
          <li className="flex items-start gap-3">
            <button
              type="button"
              onClick={toggleStep3}
              disabled={updateProfile.isPending}
              className="mt-0.5 cursor-pointer disabled:cursor-default"
              aria-label={step3Done ? 'Mark step 3 incomplete' : 'Mark step 3 complete'}
            >
              <CalendlyStepIcon done={step3Done} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-medium">3. Register the webhook in Calendly</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calendly → Integrations → Webhooks → Create Webhook.
              </p>
              <ul className="text-xs text-muted-foreground mt-1 space-y-0.5 list-disc pl-4">
                <li>
                  URL:{' '}
                  <code className="text-xs bg-muted px-1 rounded break-all">
                    {webhookUrl}
                  </code>
                </li>
                <li>
                  Events:{' '}
                  <code className="text-xs bg-muted px-1 rounded">invitee.created</code>{' '}
                  and{' '}
                  <code className="text-xs bg-muted px-1 rounded">invitee.canceled</code>
                </li>
                <li>Scope: User</li>
              </ul>
              <p className="text-xs text-muted-foreground mt-1">
                Tap the circle on the left when you've created the webhook in Calendly.
              </p>
            </div>
          </li>

          {/* Step 4 */}
          <li className="flex items-start gap-3">
            <CalendlyStepIcon done={step4Done} />
            <div className="flex-1 min-w-0">
              <p className="font-medium">4. Send the signing key to Morty</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calendly will give you a <em>signing key</em> when you create the
                webhook. Copy it and send it to Morty — it goes into Vercel as{' '}
                <code className="text-xs bg-muted px-1 rounded">
                  CALENDLY_WEBHOOK_SIGNING_KEY
                </code>{' '}
                and the webhook activates automatically. This step ticks itself
                green once the key is live.
              </p>
            </div>
          </li>

          {/* Step 5 */}
          <li className="flex items-start gap-3">
            <button
              type="button"
              onClick={toggleStep5}
              disabled={updateProfile.isPending}
              className="mt-0.5 cursor-pointer disabled:cursor-default"
              aria-label={step5Done ? 'Mark step 5 incomplete' : 'Mark step 5 complete'}
            >
              <CalendlyStepIcon done={step5Done} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-medium">5. Test it with a fake booking</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Open your scheduling page, book a fake event using your own email
                (matching a contact in the CRM) — within ~5 seconds a{' '}
                <code className="text-xs bg-muted px-1 rounded">meeting_booked</code>{' '}
                activity should appear on that contact's timeline. Tap the circle
                when you've confirmed it.
              </p>
            </div>
          </li>
        </ol>

        <div className="space-y-1 pt-2 border-t">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            Webhook URL
          </Label>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={webhookUrl}
              className="font-mono text-xs bg-muted"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl)
                toast.success('Copied')
              }}
            >
              <Copy className="w-3.5 h-3.5 mr-1" />
              Copy
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// --- Public Booking Link Card ---
function PublicBookingLinkCard() {
  const { user } = useAuth()
  const qc = useQueryClient()

  // Fetch current public_slug from DB (not in AppUser yet)
  const { data: slugData, isLoading } = useQuery({
    queryKey: ['user-public-slug', user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('users')
        .select('public_slug')
        .eq('id', user?.id ?? '')
        .maybeSingle()
      return (data as { public_slug: string | null } | null)?.public_slug ?? null
    },
    enabled: !!user?.id,
  })

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [slugError, setSlugError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const slug = slugData ?? null
  const bookingUrl = slug ? `${window.location.origin}/book/${slug}` : null

  function handleStartEdit() {
    setEditValue(slug ?? '')
    setSlugError(null)
    setEditing(true)
  }

  async function handleSaveSlug() {
    const trimmed = editValue.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(trimmed)) {
      setSlugError('3–30 chars, lowercase letters, numbers, and hyphens only')
      return
    }
    if (!user) return
    setSaving(true)
    setSlugError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('users')
        .update({ public_slug: trimmed })
        .eq('id', user.id)
      if (error) {
        if (error.code === '23505') {
          setSlugError('That slug is already taken — try another')
        } else {
          setSlugError(error.message)
        }
        return
      }
      qc.invalidateQueries({ queryKey: ['user-public-slug', user.id] })
      setEditing(false)
      toast.success('Booking link updated')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          Public booking link
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : !slug ? (
          <p className="text-xs text-muted-foreground">No booking slug set yet.</p>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={bookingUrl ?? ''}
              className="font-mono text-xs bg-muted flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(bookingUrl ?? '')
                toast.success('Copied')
              }}
            >
              <Copy className="w-3.5 h-3.5 mr-1" />
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              asChild
            >
              <a href={bookingUrl ?? '#'} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
          </div>
        )}

        {slug && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
            Linked into AI drafts — Claude will include this URL when contextually appropriate
          </p>
        )}

        {editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">
                {window.location.origin}/book/
              </span>
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="h-7 text-sm flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSlug()
                  if (e.key === 'Escape') setEditing(false)
                }}
                placeholder="your-name"
              />
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleSaveSlug} disabled={saving}>
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(false)}>
                <XCircle className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
            {slugError && <p className="text-xs text-destructive">{slugError}</p>}
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, hyphens. 3–30 characters.
            </p>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleStartEdit}
          >
            Edit slug
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// --- Main Settings Page ---
export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab = ['profile', 'stages', 'icp', 'integrations', 'suppression'].includes(tabParam ?? '')
    ? tabParam!
    : 'profile'

  useEffect(() => {
    if (searchParams.get('connected') === 'gmail') {
      toast.success('Gmail connected ✓')
      setSearchParams({})
    }
    if (searchParams.get('error')) {
      toast.error(`Connection failed: ${searchParams.get('error')}`)
      setSearchParams({})
    }
  }, [searchParams, setSearchParams])

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your profile, pipeline, ICP, and integrations.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) =>
          setSearchParams(
            (prev) => {
              const p = new URLSearchParams(prev)
              p.set('tab', v)
              return p
            },
            { replace: true },
          )
        }
      >
        <TabsList className="mb-4">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="stages">Pipeline Stages</TabsTrigger>
          <TabsTrigger value="icp">ICP</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="suppression">Suppression</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileTab />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Voice & Style Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <VoiceRulesSection />
            </CardContent>
          </Card>

          <ConnectCalendlyCard />

          <PublicBookingLinkCard />

          <SendingInfrastructureCard />
        </TabsContent>

        <TabsContent value="stages">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pipeline Stages</CardTitle>
              <p className="text-xs text-muted-foreground">
                Click a stage name to rename it. Use ↑/↓ to reorder.
              </p>
            </CardHeader>
            <CardContent>
              <PipelineStagesTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="icp">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ideal Customer Profile</CardTitle>
              <p className="text-xs text-muted-foreground">
                Configure the criteria used to score and surface leads.
              </p>
            </CardHeader>
            <CardContent>
              <IcpTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Integrations</CardTitle>
            </CardHeader>
            <CardContent>
              <IntegrationsTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppression">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Suppression list</CardTitle>
              <p className="text-xs text-muted-foreground">
                Addresses that must never receive outbound — bounces, unsubscribes, and anyone you've already emailed personally.
              </p>
            </CardHeader>
            <CardContent>
              <SuppressionTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
