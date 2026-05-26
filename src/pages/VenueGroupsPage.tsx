import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  type ColumnDef,
} from '@/components/primitives'
import { useAuth } from '@/hooks/useAuth'
import {
  useVenueGroups,
  useDeleteVenueGroup,
  type VenueGroupWithCount,
} from '@/lib/queries/venue-groups'
import { VenueGroupForm } from '@/components/venue-groups/VenueGroupForm'
import { VenueGroupDrawer } from '@/components/venue-groups/VenueGroupDrawer'

export function VenueGroupsPage() {
  const { user } = useAuth()
  const { data, isLoading, error, refetch } = useVenueGroups()
  const deleteMut = useDeleteVenueGroup()

  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<VenueGroupWithCount | null>(null)
  const [drawerFor, setDrawerFor] = useState<VenueGroupWithCount | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<VenueGroupWithCount | null>(
    null,
  )

  const rows = useMemo<VenueGroupWithCount[]>(() => {
    const all = data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.abn ? g.abn.toLowerCase().includes(q) : false),
    )
  }, [data, search])

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(g: VenueGroupWithCount) {
    setEditing(g)
    setFormOpen(true)
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await deleteMut.mutateAsync(confirmDelete.id)
      setConfirmDelete(null)
    } catch {
      /* toast via mutation */
    }
  }

  const columns: ColumnDef<VenueGroupWithCount>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 'minmax(200px, 1.6fr)',
      cell: (g) => (
        <button
          onClick={() => setDrawerFor(g)}
          className="font-medium text-ink hover:text-[color:var(--jordan-accent)] text-left truncate"
        >
          {g.name}
        </button>
      ),
    },
    {
      id: 'members',
      header: 'Members',
      width: '110px',
      align: 'right',
      numeric: true,
      cell: (g) => (
        <span className="font-mono jordan-tnum">
          {g.member_count}{' '}
          <span className="text-ink-faint">
            site{g.member_count === 1 ? '' : 's'}
          </span>
        </span>
      ),
    },
    {
      id: 'abn',
      header: 'ABN',
      width: 'minmax(120px, 0.8fr)',
      cell: (g) =>
        g.abn ? (
          <span className="text-ink-muted jordan-tnum font-mono text-[12px]">
            {g.abn}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      id: 'notes',
      header: 'Notes',
      width: 'minmax(160px, 1.4fr)',
      cell: (g) =>
        g.notes ? (
          <span className="text-ink-muted truncate" title={g.notes}>
            {g.notes}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      id: 'created',
      header: 'Created',
      width: '120px',
      cell: (g) =>
        g.created_at ? (
          <span className="text-ink-muted text-[12px] jordan-tnum">
            {formatDistanceToNow(new Date(g.created_at), { addSuffix: true })}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      id: 'actions',
      header: '',
      width: '90px',
      cell: (g) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label={`Edit ${g.name}`}
            onClick={(e) => {
              e.stopPropagation()
              openEdit(g)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-[var(--jordan-danger-text)] hover:bg-[var(--jordan-danger-soft)]"
            aria-label={`Delete ${g.name}`}
            onClick={(e) => {
              e.stopPropagation()
              setConfirmDelete(g)
            }}
            disabled={deleteMut.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] space-y-5">
      <PageHeader
        eyebrow="Leads"
        title="Venue Groups"
        description="Merge multiple venues that belong to one corporate parent (Solotel, Lucas, Australian Venue Co) so the pipeline view shows the group, not 10 separate rows."
        actions={
          <Button
            size="sm"
            className="h-8"
            onClick={openCreate}
            disabled={!user}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            New group
          </Button>
        }
      />

      {/* Search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or ABN…"
          className="h-8 max-w-sm"
          aria-label="Search venue groups"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="text-[12px] text-ink-faint hover:text-ink self-start sm:self-center"
          >
            Clear
          </button>
        )}
      </div>

      {error ? (
        <ErrorAlert
          error={error}
          onRetry={() => refetch()}
          title="Couldn't load groups"
        />
      ) : !isLoading && (data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Building2}
          title="No venue groups yet"
          body="Create your first group to merge multi-site venues (e.g. all 10 Solotel sites under one parent)."
          action={
            <Button size="sm" onClick={openCreate} disabled={!user}>
              <Plus className="w-4 h-4 mr-1.5" />
              Create your first group
            </Button>
          }
        />
      ) : (
        <DataTable<VenueGroupWithCount>
          rows={rows}
          columns={columns}
          rowKey={(g) => g.id}
          loading={isLoading}
          ariaLabel="Venue groups"
        />
      )}

      {user && (
        <VenueGroupForm
          open={formOpen}
          onOpenChange={(o) => {
            setFormOpen(o)
            if (!o) setEditing(null)
          }}
          editing={editing}
          orgId={user.org_id}
        />
      )}

      <VenueGroupDrawer
        groupId={drawerFor?.id ?? null}
        open={!!drawerFor}
        onOpenChange={(o) => !o && setDrawerFor(null)}
      />

      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this group?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.member_count && confirmDelete.member_count > 0
                ? `${confirmDelete.member_count} venue${
                    confirmDelete.member_count === 1 ? '' : 's'
                  } currently in this group will be unlinked but kept. This can't be undone.`
                : "The group will be removed. This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={deleteMut.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleteMut.isPending}
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
