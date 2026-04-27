import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2, Loader2 } from 'lucide-react'
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
  DataTable,
  EmptyState,
  ErrorAlert,
  PageHeader,
  StatusPill,
  type ColumnDef,
} from '@/components/primitives'
import {
  useCreateSequence,
  useDeleteSequence,
  useSequences,
  type SequenceWithCounts,
} from '@/lib/queries/sequences'
import { useAuth } from '@/hooks/useAuth'

const DEFAULT_NEW_STEPS = [
  {
    step_number: 1,
    delay_days: 0,
    prompt_instructions:
      'Initial outreach. Reference 1 specific detail about their venue. Keep under 80 words. End with a soft open question.',
  },
  {
    step_number: 2,
    delay_days: 3,
    prompt_instructions:
      'Follow-up #1, 3 days after the initial. Brief value reframe. NO "just checking in". 60 words max.',
  },
  {
    step_number: 3,
    delay_days: 5,
    prompt_instructions:
      'Final follow-up, 5 days after #2. Acknowledge the silence, low-friction CTA. 50 words max.',
  },
]

export function SequencesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useSequences()

  const createSeq = useCreateSequence()
  const deleteSeq = useDeleteSequence()

  const [newOpen, setNewOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SequenceWithCounts | null>(null)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  async function handleCreate() {
    if (!user) return
    const name = newName.trim()
    if (!name) {
      toast.error('Sequence name is required.')
      return
    }
    try {
      const res = await createSeq.mutateAsync({
        org_id: user.org_id,
        created_by_user_id: user.id,
        payload: {
          name,
          description: newDescription.trim() || null,
          is_active: true,
          steps: DEFAULT_NEW_STEPS,
        },
      })
      setNewOpen(false)
      setNewName('')
      setNewDescription('')
      navigate(`/sequences/${res.id}`)
    } catch {
      /* toast via mutation */
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await deleteSeq.mutateAsync(confirmDelete.id)
      setConfirmDelete(null)
    } catch {
      /* toast via mutation */
    }
  }

  const columns: ColumnDef<SequenceWithCounts>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (s) => (
        <Link
          to={`/sequences/${s.id}`}
          className="font-medium text-ink hover:text-[color:var(--jordan-accent)]"
        >
          {s.name}
        </Link>
      ),
    },
    {
      id: 'description',
      header: 'Description',
      cell: (s) =>
        s.description ? (
          <span className="text-ink-muted line-clamp-1">{s.description}</span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      id: 'steps',
      header: 'Steps',
      width: '80px',
      align: 'right',
      numeric: true,
      cell: (s) => <span className="font-mono jordan-tnum">{s.step_count}</span>,
    },
    {
      id: 'active_enrolments',
      header: 'Active',
      width: '90px',
      align: 'right',
      numeric: true,
      cell: (s) => <span className="font-mono jordan-tnum">{s.active_enrolments}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      width: '110px',
      cell: (s) =>
        s.is_active ? (
          <StatusPill tone="success" uppercase>
            Active
          </StatusPill>
        ) : (
          <StatusPill tone="neutral" uppercase>
            Paused
          </StatusPill>
        ),
    },
    {
      id: 'actions',
      header: '',
      width: '70px',
      cell: (s) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-[var(--jordan-danger-text)] hover:bg-[var(--jordan-danger-soft)]"
          onClick={(e) => {
            e.stopPropagation()
            setConfirmDelete(s)
          }}
          aria-label={`Delete ${s.name}`}
          disabled={deleteSeq.isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] space-y-5">
      <PageHeader
        eyebrow="Outbound automation"
        title="Sequences"
        description="3-step follow-up automation. Sequences generate drafts in your review queue — Jordan still approves every email before it sends."
        actions={
          <Button size="sm" className="h-8" onClick={() => setNewOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            New sequence
          </Button>
        }
      />

      {error ? (
        <ErrorAlert error={error} onRetry={() => refetch()} title="Couldn't load sequences" />
      ) : !isLoading && (data ?? []).length === 0 ? (
        <EmptyState
          title="No sequences yet"
          body="Sequences automate cold outbound. Jordan still reviews every draft, but the timing is automatic."
          action={
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              Create your first sequence
            </Button>
          }
        />
      ) : (
        <DataTable<SequenceWithCounts>
          rows={data ?? []}
          columns={columns}
          rowKey={(s) => s.id}
          loading={isLoading}
          ariaLabel="Sequences"
        />
      )}

      {/* New sequence dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New sequence</DialogTitle>
            <DialogDescription>
              Starts you with a 3-step cold-outbound template. You can edit each step's
              timing and prompt on the next page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Hospitality cold outbound"
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label>
                Description{' '}
                <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Textarea
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What's this sequence for?"
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={createSeq.isPending}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createSeq.isPending}>
              {createSeq.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Creating…
                </>
              ) : (
                'Create + edit'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete sequence?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.active_enrolments && confirmDelete.active_enrolments > 0
                ? `${confirmDelete.active_enrolments} active enrolment${
                    confirmDelete.active_enrolments === 1 ? '' : 's'
                  } will be cancelled. This can't be undone.`
                : "This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleteSeq.isPending}
              className="bg-[var(--jordan-danger)] text-white hover:bg-[var(--jordan-danger)]/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
