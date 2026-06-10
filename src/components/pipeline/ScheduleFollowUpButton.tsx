import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format, addDays, parseISO } from 'date-fns'
import { CalendarClock, Sparkles, Settings as SettingsIcon } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { CapsLabel } from '@/components/primitives'
import { toast } from 'sonner'
import { useGenerateDraft, useScheduleDraft } from '@/lib/queries/drafts'
import type { Deal } from '@/lib/queries/deals'

interface ScheduleFollowUpButtonProps {
  deal: Deal
}

/**
 * Primary action below Deal Details — opens a popover with a date/time
 * picker and a Generate Draft button. On generate:
 *   1. Call generate-draft (passes thread_excerpt as context_hint so the
 *      model has the actual conversation, not just the activity log).
 *   2. PATCH the returned draft row with scheduled_send_at = picked time.
 *   3. Toast with a link to /drafts?id=<draft_id>.
 *
 * Voice rules come from `users.voice_rules` (resolved server-side in the
 * Edge Function). We surface a hint + link to Settings → Voice Rules so the
 * user knows where to tune the tone.
 */
export function ScheduleFollowUpButton({ deal }: ScheduleFollowUpButtonProps) {
  const [open, setOpen] = useState(false)

  // Default date — current follow_up_due, else tomorrow.
  const defaultDate = (() => {
    if (deal.follow_up_due) {
      const d = parseISO(deal.follow_up_due)
      if (!isNaN(d.getTime())) return format(d, 'yyyy-MM-dd')
    }
    return format(addDays(new Date(), 1), 'yyyy-MM-dd')
  })()

  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState('09:30')

  const generate = useGenerateDraft()
  const schedule = useScheduleDraft()
  const isBusy = generate.isPending || schedule.isPending

  function contextHintFromDeal(): string {
    const t = deal.thread_excerpt
    if (!t) return ''
    const parts: string[] = []
    if (t.subject) parts.push(`Recent subject: ${t.subject}`)
    if (t.last_from) parts.push(`Last inbound from: ${t.last_from}`)
    if (t.last_date) parts.push(`Last contact: ${t.last_date}`)
    const inbound = t.msg_count_inbound ?? 0
    const outbound = t.msg_count_outbound ?? 0
    parts.push(`Thread so far: ${inbound} inbound, ${outbound} outbound`)
    if (t.last_body) {
      const body = t.last_body.slice(0, 280)
      parts.push(`Last message excerpt: "${body}"`)
    }
    return parts.join('\n')
  }

  async function handleGenerate() {
    if (!deal.contact_id) {
      toast.error("Can't generate — deal has no contact linked.")
      return
    }
    if (!date || !time) {
      toast.error('Pick a date + time first.')
      return
    }

    // Build the scheduled send timestamp — interpret the picker values as
    // local time. We round-trip through ISO so PostgreSQL stores it as a
    // timestamptz.
    const local = new Date(`${date}T${time}:00`)
    if (isNaN(local.getTime())) {
      toast.error("That date/time didn't parse — try again.")
      return
    }
    if (local.getTime() < Date.now()) {
      toast.error('Schedule a future time, not the past.')
      return
    }

    try {
      const draft = await generate.mutateAsync({
        contact_id: deal.contact_id,
        draft_type: 'follow_up',
        context_hint: contextHintFromDeal() || undefined,
      })
      if (!draft?.id) {
        throw new Error('generate-draft returned without a draft id')
      }
      // Lock the draft to THIS drawer's deal. `generate-draft` picks the
      // most-recent-open deal by contact, which can differ when the contact
      // has multiple open deals (Codex Pattern B P2 finding).
      await schedule.mutateAsync({
        id: draft.id,
        at: local.toISOString(),
        dealId: deal.id,
      })
      setOpen(false)
      toast.success(
        `Draft scheduled for ${format(local, 'd MMM, h:mma')} — review in Drafts.`,
        {
          action: {
            label: 'Open',
            onClick: () => {
              window.location.href = `/drafts?id=${draft.id}`
            },
          },
        },
      )
    } catch (err) {
      const msg = (err as Error).message
      if (msg && !msg.startsWith('Cannot generate draft')) {
        toast.error(`Schedule failed: ${msg}`)
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          className="w-full"
          aria-label="Schedule follow-up email"
        >
          <CalendarClock className="w-3.5 h-3.5 mr-1" />
          Schedule follow-up email
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 space-y-3">
        <CapsLabel>Schedule follow-up</CapsLabel>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Date</Label>
            <Input
              type="date"
              value={date}
              min={format(new Date(), 'yyyy-MM-dd')}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 text-[13px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Time (AEST)</Label>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-8 text-[13px]"
            />
          </div>
        </div>

        <Separator />

        <div className="rounded-[6px] border border-hairline bg-surface-2 px-2 py-1.5 text-[11px] text-ink-muted">
          Using your saved voice rules.{' '}
          <Link
            to="/settings#voice-rules"
            className="text-ink underline-offset-2 hover:underline"
          >
            <SettingsIcon className="inline w-3 h-3 -mt-px" />{' '}
            Edit in Settings
          </Link>
        </div>

        <Button
          type="button"
          size="sm"
          className="w-full"
          onClick={handleGenerate}
          disabled={isBusy || !deal.contact_id}
        >
          <Sparkles className="w-3.5 h-3.5 mr-1" />
          {isBusy ? 'Generating…' : 'Generate draft'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
