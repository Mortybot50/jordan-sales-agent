import { useEffect, useState } from 'react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import { useUpdateNotificationPrefs, useSendTestPing } from '@/lib/queries/notifications'
import { notificationPrefsSchema, type NotificationPrefsValues } from '@/lib/schemas/notifications'
import { cn } from '@/lib/utils'

// 0-23 (and 24 for end). Mirrors the morning-briefing time picker for visual
// consistency. We don't bother with a slider primitive — two Selects are
// clearer for the "from this hour to that hour" semantics.
const START_HOURS = Array.from({ length: 24 }, (_, i) => i)
const END_HOURS = Array.from({ length: 25 }, (_, i) => i) // 0..24 — 24 means midnight (exclusive end)

function formatHour(h: number): string {
  if (h === 0) return '12:00am'
  if (h === 12) return '12:00pm'
  if (h === 24) return '12:00am (next day)'
  if (h < 12) return `${h}:00am`
  return `${h - 12}:00pm`
}

export function NotificationsSection() {
  const { user } = useAuth()
  const updatePrefs = useUpdateNotificationPrefs()
  const testPing = useSendTestPing()

  // The form mirrors the user's current values. We hydrate from useAuth (which
  // already loads the new columns) rather than firing a second query — saves
  // a round-trip and keeps invalidation simple.
  const form = useForm<NotificationPrefsValues>({
    resolver: zodResolver(notificationPrefsSchema),
    defaultValues: {
      notify_whatsapp_e164: user?.notify_whatsapp_e164 ?? null,
      notify_warm_replies: user?.notify_warm_replies ?? true,
      notify_quiet_hours_start: user?.notify_quiet_hours_start ?? null,
      notify_quiet_hours_end: user?.notify_quiet_hours_end ?? null,
    },
  })

  // Reset form when auth state hydrates (e.g. after page reload, the user
  // object arrives async — keep the form in sync with the latest values).
  useEffect(() => {
    if (!user) return
    form.reset({
      notify_whatsapp_e164: user.notify_whatsapp_e164 ?? null,
      notify_warm_replies: user.notify_warm_replies,
      notify_quiet_hours_start: user.notify_quiet_hours_start,
      notify_quiet_hours_end: user.notify_quiet_hours_end,
    })
    // form is stable from react-hook-form — deliberately not in deps to avoid
    // re-running on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.notify_whatsapp_e164, user?.notify_warm_replies, user?.notify_quiet_hours_start, user?.notify_quiet_hours_end])

  const warmEnabled = form.watch('notify_warm_replies')
  const quietStart = form.watch('notify_quiet_hours_start')
  const quietEnd = form.watch('notify_quiet_hours_end')
  const [phoneRaw, setPhoneRaw] = useState(user?.notify_whatsapp_e164 ?? '')
  // Mirrors the last-persisted number so the "Send test ping" button enables
  // immediately after the very first save. useAuth holds its user object in
  // local state and isn't subscribed to the ['user'] React Query key the
  // update mutation invalidates — so without this local mirror the button
  // would stay disabled until a full page reload.
  const [savedNumber, setSavedNumber] = useState<string | null>(user?.notify_whatsapp_e164 ?? null)

  // Keep the visible input in sync when the form resets above. We need a
  // controlled-ish bridge because the zod transform turns "" into null at
  // validation time, but the user is still typing.
  useEffect(() => {
    setPhoneRaw(user?.notify_whatsapp_e164 ?? '')
    setSavedNumber(user?.notify_whatsapp_e164 ?? null)
  }, [user?.notify_whatsapp_e164])

  async function onSubmit(values: NotificationPrefsValues) {
    if (!user) return
    await updatePrefs.mutateAsync({
      id: user.id,
      notify_whatsapp_e164: values.notify_whatsapp_e164,
      notify_warm_replies: values.notify_warm_replies,
      notify_quiet_hours_start: values.notify_quiet_hours_start,
      notify_quiet_hours_end: values.notify_quiet_hours_end,
    })
    setSavedNumber(values.notify_whatsapp_e164 ?? null)
  }

  function onInvalid(errors: FieldErrors<NotificationPrefsValues>) {
    const first = Object.entries(errors)[0]
    if (first) {
      const [field, err] = first
      const message = (err as { message?: string })?.message ?? 'Invalid value'
      toast.error('Cannot save notification settings', { description: `${field}: ${message}` })
    }
  }

  const hasNumber = !!savedNumber && savedNumber.trim() !== ''
  const quietConfigured = quietStart != null && quietEnd != null && quietStart !== quietEnd

  return (
    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-5 max-w-lg">
      <p className="text-xs text-muted-foreground -mt-1">
        Real-time WhatsApp ping when a positive reply lands (confidence ≥ 80%).
        Same number used for any future operational alerts (bounce spikes,
        cron failures) — they're table-supported but UI's not wired yet.
      </p>

      <div className="space-y-1">
        <Label htmlFor="notify_whatsapp_e164">WhatsApp number (E.164)</Label>
        <Input
          id="notify_whatsapp_e164"
          placeholder="+61416104718"
          value={phoneRaw}
          onChange={(e) => {
            setPhoneRaw(e.target.value)
            form.setValue('notify_whatsapp_e164', e.target.value as unknown as string | null, {
              shouldValidate: true,
            })
          }}
          className={cn(form.formState.errors.notify_whatsapp_e164 && 'border-destructive')}
        />
        {form.formState.errors.notify_whatsapp_e164 && (
          <p className="text-xs text-destructive">
            {form.formState.errors.notify_whatsapp_e164.message}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Country code prefix required. Leave blank to disable all pings.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Warm-reply WhatsApp pings</p>
          <p className="text-xs text-muted-foreground">
            Fire when classify-reply-intent tags a positive reply ≥ 0.8
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={warmEnabled}
          onClick={() => form.setValue('notify_warm_replies', !warmEnabled, { shouldDirty: true })}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
            warmEnabled ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
              warmEnabled ? 'translate-x-6' : 'translate-x-1',
            )}
          />
        </button>
      </div>

      <div className="space-y-2">
        <Label>Quiet hours (AEST)</Label>
        <div className="grid grid-cols-2 gap-3">
          <Select
            value={quietStart == null ? '' : String(quietStart)}
            onValueChange={(v) => form.setValue('notify_quiet_hours_start', v === '' ? null : Number(v), { shouldDirty: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="From…" />
            </SelectTrigger>
            <SelectContent>
              {START_HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={quietEnd == null ? '' : String(quietEnd)}
            onValueChange={(v) => form.setValue('notify_quiet_hours_end', v === '' ? null : Number(v), { shouldDirty: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="To…" />
            </SelectTrigger>
            <SelectContent>
              {END_HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {quietConfigured
              ? `Pings skipped between ${formatHour(quietStart!)} and ${formatHour(quietEnd!)} AEST`
              : 'No quiet hours — pings fire 24/7'}
          </p>
          {(quietStart != null || quietEnd != null) && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => {
                form.setValue('notify_quiet_hours_start', null, { shouldDirty: true })
                form.setValue('notify_quiet_hours_end', null, { shouldDirty: true })
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" disabled={updatePrefs.isPending}>
          {updatePrefs.isPending ? 'Saving…' : 'Save notifications'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 text-xs"
          disabled={!hasNumber || testPing.isPending}
          onClick={() => {
            if (!user) return
            testPing.mutate(user.id)
          }}
          title={hasNumber ? 'Enqueue a test WhatsApp ping' : 'Save a WhatsApp number first'}
        >
          {testPing.isPending ? 'Sending…' : 'Send test ping'}
        </Button>
      </div>
    </form>
  )
}
