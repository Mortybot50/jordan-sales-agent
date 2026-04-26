import { useState } from 'react'
import { Tag as TagIcon, Trash2, Ban, ShieldOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  type Contact,
  isValidTag,
  useBulkDeleteContacts,
  useBulkSetDnc,
  useBulkTagContacts,
  useDistinctContactTags,
} from '@/lib/queries/contacts'
import { useBulkAddSuppression } from '@/lib/queries/suppression'
import { useAuth } from '@/hooks/useAuth'

interface Props {
  selected: Contact[]
  onClear: () => void
}

/**
 * Sticky toolbar that appears when ≥1 contact is selected on the
 * ContactsPage. Hosts all four bulk actions: Tag, Suppress, Mark DNC,
 * Delete. Selection clears after each successful action.
 *
 * Dark Anchor styling: near-black surface, mint accent on the count,
 * tracked uppercase action labels, destructive actions in muted red.
 */
export function ContactBulkActionsToolbar({ selected, onClear }: Props) {
  const { user } = useAuth()
  const ids = selected.map((c) => c.id)
  const count = selected.length

  const [confirmOpen, setConfirmOpen] = useState<null | 'delete' | 'suppress' | 'dnc'>(null)
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')

  const bulkDelete = useBulkDeleteContacts()
  const bulkDnc = useBulkSetDnc()
  const bulkTag = useBulkTagContacts()
  const bulkSuppress = useBulkAddSuppression()
  const { data: distinctTags } = useDistinctContactTags()

  function reset() {
    setConfirmOpen(null)
    setTagPopoverOpen(false)
    setTagInput('')
    onClear()
  }

  async function doDelete() {
    await bulkDelete.mutateAsync(ids)
    reset()
  }

  async function doDnc() {
    await bulkDnc.mutateAsync({ ids, value: true })
    reset()
  }

  async function doSuppress() {
    if (!user) return
    const rows = selected
      .filter((c) => !!c.email)
      .map((c) => ({ email: c.email as string, notes: 'Bulk-suppressed from Contacts table' }))
    if (rows.length === 0) {
      toast.error('No selected contacts have an email — nothing to suppress.')
      setConfirmOpen(null)
      return
    }
    await bulkSuppress.mutateAsync({
      org_id: user.org_id,
      user_id: user.id,
      rows,
      source: 'manual_bulk',
    })
    reset()
  }

  async function doTag() {
    if (!user) return
    const tag = tagInput.trim().toLowerCase()
    if (!isValidTag(tag)) {
      toast.error('Tag must be lowercase, 1-30 chars, letters/numbers/dashes only.')
      return
    }
    await bulkTag.mutateAsync({ org_id: user.org_id, ids, tag })
    reset()
  }

  function applyExistingTag(tag: string) {
    if (!user) return
    bulkTag.mutate(
      { org_id: user.org_id, ids, tag },
      {
        onSuccess: () => reset(),
      },
    )
  }

  return (
    <>
      <div
        role="region"
        aria-label="Bulk actions"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-[var(--jordan-radius-md)] border border-hairline bg-[#0c0e10] px-3 py-2 text-ink-muted shadow-sm"
      >
        <span className="text-[12px] tracking-[var(--jordan-tracking-label)]">
          <span className="jordan-tnum text-[13px] font-semibold text-[var(--jordan-accent)]">
            {count}
          </span>{' '}
          <span className="uppercase">selected</span>
        </span>

        <span className="h-4 w-px bg-hairline" aria-hidden />

        {/* Tag — popover */}
        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-muted hover:text-ink"
            >
              <TagIcon className="mr-1 h-3.5 w-3.5" />
              Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-2 p-3">
            <label className="block text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
              Tag name
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                doTag()
              }}
              className="flex gap-2"
            >
              <Input
                autoFocus
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="high-priority"
                className="h-8 text-[13px]"
                maxLength={30}
              />
              <Button
                type="submit"
                size="sm"
                className="h-8"
                disabled={bulkTag.isPending || tagInput.trim().length === 0}
              >
                Apply
              </Button>
            </form>
            <p className="text-[11px] text-ink-faint">
              Lowercase, 1-30 chars, letters/numbers/dashes.
            </p>
            {distinctTags && distinctTags.length > 0 && (
              <div className="space-y-1 pt-2">
                <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                  Existing tags
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {distinctTags.slice(0, 12).map(({ tag, count: tc }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => applyExistingTag(tag)}
                      disabled={bulkTag.isPending}
                      className="rounded-[var(--jordan-radius-sm)] border border-hairline bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted hover:bg-surface-3 hover:text-ink"
                    >
                      {tag}
                      <span className="ml-1 text-ink-faint">{tc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Mark DNC */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-muted hover:text-ink"
          onClick={() => setConfirmOpen('dnc')}
        >
          <Ban className="mr-1 h-3.5 w-3.5" />
          Mark Do Not Call
        </Button>

        {/* Suppress */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-muted hover:text-ink"
          onClick={() => setConfirmOpen('suppress')}
        >
          <ShieldOff className="mr-1 h-3.5 w-3.5" />
          Suppress
        </Button>

        {/* Delete (destructive) */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-[var(--jordan-danger-text)] hover:bg-[var(--jordan-danger-soft)]"
          onClick={() => setConfirmOpen('delete')}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Delete
        </Button>

        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint"
            onClick={onClear}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Confirm — Delete */}
      <Dialog open={confirmOpen === 'delete'} onOpenChange={(o) => !o && setConfirmOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {count} contact{count === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(null)} disabled={bulkDelete.isPending}>
              Cancel
            </Button>
            <Button
              onClick={doDelete}
              disabled={bulkDelete.isPending}
              className="bg-[var(--jordan-danger)] text-white hover:bg-[var(--jordan-danger)]/90"
            >
              Delete {count}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm — Suppress */}
      <Dialog open={confirmOpen === 'suppress'} onOpenChange={(o) => !o && setConfirmOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suppress {count} contact{count === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              They&apos;ll be added to your suppression list and removed from all active sequences.
              Contacts without an email address will be skipped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(null)} disabled={bulkSuppress.isPending}>
              Cancel
            </Button>
            <Button onClick={doSuppress} disabled={bulkSuppress.isPending}>
              Suppress
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm — DNC */}
      <Dialog open={confirmOpen === 'dnc'} onOpenChange={(o) => !o && setConfirmOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {count} contact{count === 1 ? '' : 's'} as Do Not Call?</DialogTitle>
            <DialogDescription>They won&apos;t receive any further outreach.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(null)} disabled={bulkDnc.isPending}>
              Cancel
            </Button>
            <Button onClick={doDnc} disabled={bulkDnc.isPending}>
              Mark DNC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
