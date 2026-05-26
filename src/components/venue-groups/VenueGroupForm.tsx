import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import {
  venueGroupFormSchema,
  DEFAULT_VENUE_GROUP_FORM_VALUES,
  type VenueGroupFormValues,
} from '@/lib/schemas/venue-groups'
import {
  useCreateVenueGroup,
  useUpdateVenueGroup,
  type VenueGroupWithCount,
} from '@/lib/queries/venue-groups'

interface VenueGroupFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing?: VenueGroupWithCount | null
  orgId: string
  onSaved?: (id: string) => void
}

function initialValues(
  editing: VenueGroupWithCount | null | undefined,
): VenueGroupFormValues {
  if (!editing) return DEFAULT_VENUE_GROUP_FORM_VALUES
  return {
    name: editing.name,
    abn: editing.abn,
    notes: editing.notes,
  }
}

export function VenueGroupForm(props: VenueGroupFormProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && (
        <VenueGroupFormBody
          // Remount when switching rows mid-dialog so state initialises cleanly.
          key={props.editing?.id ?? '__new__'}
          {...props}
        />
      )}
    </Dialog>
  )
}

function VenueGroupFormBody({
  onOpenChange,
  editing,
  orgId,
  onSaved,
}: VenueGroupFormProps) {
  const isEdit = !!editing
  const createMut = useCreateVenueGroup()
  const updateMut = useUpdateVenueGroup()
  const isPending = createMut.isPending || updateMut.isPending

  const [values, setValues] = useState<VenueGroupFormValues>(() =>
    initialValues(editing),
  )
  const [errors, setErrors] = useState<
    Partial<Record<keyof VenueGroupFormValues, string>>
  >({})

  function set<K extends keyof VenueGroupFormValues>(
    key: K,
    next: VenueGroupFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: next }))
  }

  async function handleSave() {
    const parsed = venueGroupFormSchema.safeParse(values)
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof VenueGroupFormValues | undefined
        if (key && !next[key]) next[key] = issue.message
      }
      setErrors(next)
      toast.error('Please fix the highlighted fields')
      return
    }
    setErrors({})

    const payload = {
      name: parsed.data.name,
      abn: parsed.data.abn?.trim() ? parsed.data.abn.trim() : null,
      notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null,
    }

    try {
      if (isEdit && editing) {
        await updateMut.mutateAsync({ id: editing.id, payload })
        onSaved?.(editing.id)
      } else {
        const res = await createMut.mutateAsync({ org_id: orgId, payload })
        onSaved?.(res.id)
      }
      onOpenChange(false)
    } catch {
      /* toast via mutation */
    }
  }

  return (
    <DialogContent className="max-w-md sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit group' : 'New group'}</DialogTitle>
        <DialogDescription>
          Groups merge multiple venues under one corporate parent (Solotel,
          Lucas, Australian Venue Co). Assign venues to the group from the
          Contacts view.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 mt-2">
        <div className="space-y-1">
          <Label htmlFor="vg-name">Name *</Label>
          <Input
            id="vg-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Solotel"
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

        <div className="space-y-1">
          <Label htmlFor="vg-abn">
            ABN{' '}
            <span className="text-ink-faint text-[11px] font-normal">
              (optional)
            </span>
          </Label>
          <Input
            id="vg-abn"
            value={values.abn ?? ''}
            onChange={(e) => set('abn', e.target.value)}
            placeholder="11 digits"
            aria-invalid={!!errors.abn}
            maxLength={20}
            inputMode="numeric"
          />
          {errors.abn && (
            <p className="text-[12px] text-[color:var(--jordan-danger-text)]">
              {errors.abn}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="vg-notes">
            Notes{' '}
            <span className="text-ink-faint text-[11px] font-normal">
              (optional)
            </span>
          </Label>
          <Textarea
            id="vg-notes"
            value={values.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Key contact, head office, anything that's helpful at a glance."
            maxLength={1000}
            rows={3}
          />
          {errors.notes && (
            <p className="text-[12px] text-[color:var(--jordan-danger-text)]">
              {errors.notes}
            </p>
          )}
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
            'Create group'
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
