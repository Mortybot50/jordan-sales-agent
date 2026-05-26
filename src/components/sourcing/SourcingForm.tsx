import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import {
  sourcingFormSchema,
  DEFAULT_SOURCING_FORM_VALUES,
  SCHEDULE_PRESETS,
  type SourcingFormValues,
} from '@/lib/schemas/sourcing'
import { HOSPITALITY_CATEGORIES } from '@/lib/constants/hospitality-categories'
import {
  useCreateLeadSearch,
  useUpdateLeadSearch,
  type LeadSearch,
} from '@/lib/queries/sourcing'
import { SuburbInput } from './SuburbInput'

interface SourcingFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-load this row's values when editing. Omit/null = create mode. */
  editing?: LeadSearch | null
  /** Auth context — required to insert org_id + user_id on create. */
  orgId: string
  userId: string
  onSaved?: (id: string) => void
}

/**
 * Split / join the comma-stored suburb TEXT column. Trims whitespace and
 * drops empty strings so a value like ", Carlton ," round-trips cleanly.
 */
function splitSuburbs(stored: string | null): string[] {
  if (!stored) return []
  return stored
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function joinSuburbs(parts: string[]): string | null {
  const clean = parts.map((s) => s.trim()).filter(Boolean)
  return clean.length === 0 ? null : clean.join(', ')
}

function initialValues(editing: LeadSearch | null | undefined): SourcingFormValues {
  if (!editing) return DEFAULT_SOURCING_FORM_VALUES
  return {
    name: editing.name,
    source_engine:
      editing.source_engine === 'google_places' ? 'google_places' : 'outscraper',
    region: editing.region,
    suburbs: splitSuburbs(editing.suburb),
    // Filter to known categories so an unknown legacy value doesn't crash the
    // zod enum on submit.
    categories: editing.categories.filter(
      (c): c is (typeof HOSPITALITY_CATEGORIES)[number] =>
        (HOSPITALITY_CATEGORIES as readonly string[]).includes(c),
    ),
    limit_per_run: editing.limit_per_run,
    email_extraction: editing.email_extraction,
    schedule_cron: editing.schedule_cron,
  }
}

/**
 * Outer component is the Dialog shell. The inner Body mounts only while
 * the dialog is open, so its useState initialiser sees fresh `editing`
 * each time it opens (no effect-driven resets needed).
 */
export function SourcingForm(props: SourcingFormProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && (
        <SourcingFormBody
          // remount when switching between create/edit-row without closing
          key={props.editing?.id ?? '__new__'}
          {...props}
        />
      )}
    </Dialog>
  )
}

function SourcingFormBody({
  onOpenChange,
  editing,
  orgId,
  userId,
  onSaved,
}: SourcingFormProps) {
  const isEdit = !!editing
  const createMut = useCreateLeadSearch()
  const updateMut = useUpdateLeadSearch()
  const isPending = createMut.isPending || updateMut.isPending

  const [values, setValues] = useState<SourcingFormValues>(() =>
    initialValues(editing),
  )
  const [errors, setErrors] = useState<
    Partial<Record<keyof SourcingFormValues, string>>
  >({})

  function set<K extends keyof SourcingFormValues>(
    key: K,
    next: SourcingFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: next }))
  }

  function toggleCategory(cat: (typeof HOSPITALITY_CATEGORIES)[number]) {
    const present = values.categories.includes(cat)
    set(
      'categories',
      present
        ? values.categories.filter((c) => c !== cat)
        : [...values.categories, cat],
    )
  }

  async function handleSave() {
    const parsed = sourcingFormSchema.safeParse(values)
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SourcingFormValues | undefined
        if (key && !next[key]) next[key] = issue.message
      }
      setErrors(next)
      toast.error('Please fix the highlighted fields')
      return
    }
    setErrors({})

    const payload = {
      name: parsed.data.name.trim(),
      region: parsed.data.region.trim(),
      suburb: joinSuburbs(parsed.data.suburbs),
      categories: [...parsed.data.categories],
      source_engine: parsed.data.source_engine,
      limit_per_run: parsed.data.limit_per_run,
      email_extraction: parsed.data.email_extraction,
      schedule_cron: parsed.data.schedule_cron ?? null,
    }

    try {
      if (isEdit && editing) {
        await updateMut.mutateAsync({ id: editing.id, payload })
        onSaved?.(editing.id)
      } else {
        const res = await createMut.mutateAsync({
          org_id: orgId,
          user_id: userId,
          payload,
        })
        onSaved?.(res.id)
      }
      onOpenChange(false)
    } catch {
      /* toast via mutation */
    }
  }

  const schedulePill = (preset: { label: string; cron: string }) => {
    const active = values.schedule_cron === preset.cron
    return (
      <button
        key={preset.cron}
        type="button"
        onClick={() => set('schedule_cron', active ? null : preset.cron)}
        className={cn(
          'rounded-full px-2.5 py-1 text-[12px] border transition-colors',
          active
            ? 'bg-[color:var(--jordan-accent)] text-white border-[color:var(--jordan-accent)]'
            : 'border-hairline text-ink-muted hover:text-ink hover:bg-surface-3',
        )}
      >
        {preset.label}
      </button>
    )
  }

  return (
    <DialogContent className="max-w-lg sm:max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit search' : 'New search'}</DialogTitle>
        <DialogDescription>
          Searches define what to scrape. Run them on demand — sources land
          as venues + contacts.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 mt-2">
        {/* Name */}
        <div className="space-y-1">
          <Label htmlFor="sourcing-name">Name *</Label>
          <Input
            id="sourcing-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Carlton restaurants"
            aria-invalid={!!errors.name}
            autoFocus
            maxLength={120}
          />
          {errors.name && (
            <p className="text-[12px] text-[color:var(--jordan-danger-text)]">
              {errors.name}
            </p>
          )}
        </div>

        {/* Engine */}
        <div className="space-y-1.5">
          <Label>Source engine *</Label>
          <div className="flex gap-2">
            {(['outscraper', 'google_places'] as const).map((eng) => {
              const active = values.source_engine === eng
              return (
                <button
                  key={eng}
                  type="button"
                  onClick={() => set('source_engine', eng)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-2 text-sm text-left transition-colors',
                    active
                      ? 'border-[color:var(--jordan-accent)] bg-[color:var(--jordan-accent-soft)]'
                      : 'border-hairline hover:bg-surface-3',
                  )}
                >
                  <div className="font-medium text-ink">
                    {eng === 'outscraper' ? 'Outscraper' : 'Google Places'}
                  </div>
                  <div className="text-[11px] text-ink-faint mt-0.5">
                    {eng === 'outscraper'
                      ? 'Includes email enrichment'
                      : 'No email enrichment'}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Region */}
        <div className="space-y-1">
          <Label htmlFor="sourcing-region">Region *</Label>
          <Input
            id="sourcing-region"
            value={values.region}
            onChange={(e) => set('region', e.target.value)}
            placeholder="Victoria"
            aria-invalid={!!errors.region}
            maxLength={60}
          />
          {errors.region && (
            <p className="text-[12px] text-[color:var(--jordan-danger-text)]">
              {errors.region}
            </p>
          )}
        </div>

        {/* Suburbs */}
        <div className="space-y-1">
          <Label htmlFor="sourcing-suburbs">
            Suburbs{' '}
            <span className="text-ink-faint text-[11px] font-normal">
              (optional, up to 20)
            </span>
          </Label>
          <SuburbInput
            id="sourcing-suburbs"
            value={values.suburbs}
            onChange={(v) => set('suburbs', v)}
          />
          <p className="text-[11px] text-ink-faint">
            Leave blank to search the whole region. Multiple suburbs are
            appended to the query phrase (e.g. "restaurant Carlton, Fitzroy
            Victoria Australia").
          </p>
        </div>

        {/* Categories */}
        <div className="space-y-1.5">
          <Label>
            Categories *
            {errors.categories && (
              <span className="ml-2 text-[12px] text-[color:var(--jordan-danger-text)] font-normal">
                {errors.categories}
              </span>
            )}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {HOSPITALITY_CATEGORIES.map((cat) => {
              const active = values.categories.includes(cat)
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[12px] border transition-colors',
                    active
                      ? 'bg-[color:var(--jordan-accent)] text-white border-[color:var(--jordan-accent)]'
                      : 'border-hairline text-ink-muted hover:text-ink hover:bg-surface-3',
                  )}
                >
                  {cat.replace(/_/g, ' ')}
                </button>
              )
            })}
          </div>
        </div>

        {/* Limit */}
        <div className="space-y-1">
          <Label htmlFor="sourcing-limit">Limit per run *</Label>
          <Input
            id="sourcing-limit"
            type="number"
            min={10}
            max={5000}
            step={10}
            value={values.limit_per_run}
            onChange={(e) =>
              set('limit_per_run', Number(e.target.value) || 0)
            }
            aria-invalid={!!errors.limit_per_run}
            className="w-32"
          />
          {errors.limit_per_run && (
            <p className="text-[12px] text-[color:var(--jordan-danger-text)]">
              {errors.limit_per_run}
            </p>
          )}
          <p className="text-[11px] text-ink-faint">
            Outscraper: ~$0.001 per result. Google Places: ~$0.017 per
            result (rates approximate; check current pricing).
          </p>
        </div>

        {/* Email extraction toggle */}
        <div className="flex items-center justify-between rounded-md border border-hairline px-3 py-2">
          <div>
            <Label htmlFor="sourcing-emails" className="cursor-pointer">
              Extract emails
            </Label>
            <p className="text-[11px] text-ink-faint mt-0.5">
              Outscraper only — adds emails_and_contacts enrichment.
            </p>
          </div>
          <input
            id="sourcing-emails"
            type="checkbox"
            checked={values.email_extraction}
            onChange={(e) => set('email_extraction', e.target.checked)}
            className="h-4 w-4 accent-[color:var(--jordan-accent)]"
          />
        </div>

        {/* Schedule */}
        <div className="space-y-1.5">
          <Label htmlFor="sourcing-cron">
            Schedule{' '}
            <span className="text-ink-faint text-[11px] font-normal">
              (optional — saved but not yet auto-run)
            </span>
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {SCHEDULE_PRESETS.map(schedulePill)}
            {values.schedule_cron && (
              <button
                type="button"
                onClick={() => set('schedule_cron', null)}
                className="rounded-full px-2.5 py-1 text-[12px] border border-hairline text-ink-faint hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
          <Input
            id="sourcing-cron"
            value={values.schedule_cron ?? ''}
            onChange={(e) =>
              set('schedule_cron', e.target.value.trim() || null)
            }
            placeholder="Custom cron, e.g. 0 6 * * 1-5"
            maxLength={120}
          />
          <p className="text-[11px] text-ink-faint">
            Phase 1 ships manual "Run now" only. The cron string is stored
            for the follow-up scheduler PR.
          </p>
        </div>
      </div>

      <DialogFooter className="mt-2">
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              Saving…
            </>
          ) : isEdit ? (
            'Save changes'
          ) : (
            'Create search'
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
