import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
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
import { useUpdateUserProfile } from '@/lib/queries/users'
import { useStages, useCreateStage, useDeleteStage, useUpdateStage } from '@/lib/queries/stages'
import { useDeals } from '@/lib/queries/deals'
import { profileFormSchema, icpFormSchema, type ProfileFormValues, type IcpFormValues } from '@/lib/schemas/user'
import { venueTypeLabel, cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, ChevronUp, ChevronDown, CheckCircle2, XCircle, CheckCircle, ExternalLink } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

const VENUE_TYPES = [
  'restaurant', 'cafe', 'hotel', 'event_space', 'bar',
  'club', 'pub', 'qsr', 'function_centre', 'other',
] as const

// --- Profile Tab ---
function ProfileTab() {
  const { user } = useAuth()
  const updateProfile = useUpdateUserProfile()

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      full_name: user?.full_name ?? '',
      calendly_url: user?.calendly_url ?? '',
      email_signature: user?.email_signature ?? '',
    },
  })

  async function onSubmit(values: ProfileFormValues) {
    if (!user) return
    await updateProfile.mutateAsync({
      id: user.id,
      full_name: values.full_name,
      calendly_url: values.calendly_url || undefined,
      email_signature: values.email_signature || undefined,
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-lg">
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
        <Label htmlFor="email_signature">Email signature</Label>
        <Textarea
          id="email_signature"
          rows={5}
          placeholder="Jordan Smith&#10;Sales Manager · Purezza&#10;jordan@purezza.com.au"
          {...form.register('email_signature')}
        />
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

      <Button type="submit" disabled={updateProfile.isPending}>
        {updateProfile.isPending ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
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

// --- ICP Tab ---
function IcpTab() {
  const { user } = useAuth()
  const updateProfile = useUpdateUserProfile()

  const icp = user?.icp_config ?? {}

  const form = useForm<IcpFormValues>({
    resolver: zodResolver(icpFormSchema),
    defaultValues: {
      venue_types: (icp.venue_types as string[]) ?? [],
      excluded_types: (icp.excluded_types as string[]) ?? [],
      min_cover_count: (icp.min_cover_count as number | null) ?? null,
      max_cover_count: (icp.max_cover_count as number | null) ?? null,
      geo_radius_km: (icp.geo_radius_km as number | null) ?? null,
      geo_postcode: (icp.geo_postcode as string) ?? '',
    },
  })

  const selectedTypes = form.watch('venue_types') ?? []
  const excludedTypes = form.watch('excluded_types') ?? []

  function toggleType(type: string, field: 'venue_types' | 'excluded_types') {
    const current = form.getValues(field) ?? []
    if (current.includes(type)) {
      form.setValue(field, current.filter((t) => t !== type))
    } else {
      form.setValue(field, [...current, type])
    }
  }

  async function onSubmit(values: IcpFormValues) {
    if (!user) return
    await updateProfile.mutateAsync({
      id: user.id,
      icp_config: {
        venue_types: values.venue_types ?? [],
        excluded_types: values.excluded_types ?? [],
        min_cover_count: values.min_cover_count ?? null,
        max_cover_count: values.max_cover_count ?? null,
        geo_radius_km: values.geo_radius_km ?? null,
        geo_postcode: values.geo_postcode ?? null,
      },
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 max-w-lg">
      <div className="space-y-2">
        <Label>Target venue types</Label>
        <div className="flex flex-wrap gap-1.5">
          {VENUE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type, 'venue_types')}
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
          {VENUE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type, 'excluded_types')}
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
            placeholder="50"
            {...form.register('min_cover_count')}
          />
        </div>
        <div className="space-y-1">
          <Label>Max cover count</Label>
          <Input
            type="number"
            min={0}
            placeholder="500"
            {...form.register('max_cover_count')}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Geo radius (km)</Label>
          <Input
            type="number"
            min={0}
            max={500}
            placeholder="25"
            {...form.register('geo_radius_km')}
          />
        </div>
        <div className="space-y-1">
          <Label>Centre postcode</Label>
          <Input
            placeholder="3000"
            {...form.register('geo_postcode')}
          />
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

  const isAnthropicConfigured = !!import.meta.env.VITE_SUPABASE_URL // placeholder indicator

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
    </div>
  )
}

// --- Main Settings Page ---
export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const defaultTab = ['profile', 'stages', 'icp', 'integrations'].includes(tabParam ?? '')
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

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="stages">Pipeline Stages</TabsTrigger>
          <TabsTrigger value="icp">ICP</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileTab />
            </CardContent>
          </Card>
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
      </Tabs>
    </div>
  )
}
