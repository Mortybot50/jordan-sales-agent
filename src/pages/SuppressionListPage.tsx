import { useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import { toast } from 'sonner'
import {
  DataTable,
  type ColumnDef,
  FacetBar,
  type FacetDef,
  PageHeader,
  StatusPill,
} from '@/components/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/hooks/useAuth'
import {
  useSuppressionList,
  useAddSuppressionEmail,
  useAddSuppressionDomain,
  useBulkAddSuppression,
  useRemoveSuppression,
  type SuppressionEntry,
  type SuppressionReason,
} from '@/lib/queries/suppression'
import { normaliseEmail, isValidEmail } from '@/lib/suppression'
import { ArrowLeft, ShieldAlert, Trash2, Upload, FileText, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

type ParsedPreviewRow = { email: string; notes: string | null; valid: boolean }

const REASON_LABEL: Record<SuppressionReason, string> = {
  manual_exclude: 'Manual',
  bounce_hard: 'Hard bounce',
  bounce_soft: 'Soft bounce',
  unsubscribe: 'Unsubscribed',
  spam_complaint: 'Spam complaint',
}

const REASON_TONE: Record<SuppressionReason, 'neutral' | 'danger' | 'warning'> = {
  manual_exclude: 'neutral',
  bounce_hard: 'danger',
  bounce_soft: 'warning',
  unsubscribe: 'warning',
  spam_complaint: 'danger',
}

function parseBulkPaste(raw: string): string[] {
  return raw
    .split(/[\s,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function SuppressionListPage() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const { data: entries, isLoading, error, refetch } = useSuppressionList()
  const addOne = useAddSuppressionEmail()
  const addDomain = useAddSuppressionDomain()
  const bulkAdd = useBulkAddSuppression()
  const remove = useRemoveSuppression()

  // Inputs
  const [singleEmail, setSingleEmail] = useState('')
  const [singleNotes, setSingleNotes] = useState('')
  const [domainInput, setDomainInput] = useState('')
  const [domainNotes, setDomainNotes] = useState('')
  const [bulkText, setBulkText] = useState('')

  // CSV
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [csvPreview, setCsvPreview] = useState<ParsedPreviewRow[] | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<Record<string, string[]>>({})
  const [deleteTarget, setDeleteTarget] = useState<SuppressionEntry | null>(null)

  const bulkPreview = useMemo(() => {
    const raw = parseBulkPaste(bulkText)
    const seen = new Set<string>()
    const rows: ParsedPreviewRow[] = []
    for (const r of raw) {
      const email = normaliseEmail(r)
      const valid = isValidEmail(email)
      if (valid && seen.has(email)) continue
      if (valid) seen.add(email)
      rows.push({ email, notes: null, valid })
    }
    return rows
  }, [bulkText])

  const validBulkCount = bulkPreview.filter((r) => r.valid).length
  const invalidBulkCount = bulkPreview.length - validBulkCount

  const facets: FacetDef[] = [
    {
      id: 'reason',
      label: 'Reason',
      mode: 'multi',
      options: [
        { value: 'manual_exclude', label: 'Manual' },
        { value: 'bounce_hard', label: 'Hard bounce' },
        { value: 'bounce_soft', label: 'Soft bounce' },
        { value: 'unsubscribe', label: 'Unsubscribed' },
        { value: 'spam_complaint', label: 'Spam complaint' },
      ],
    },
    {
      id: 'scope',
      label: 'Scope',
      mode: 'multi',
      options: [
        { value: 'email', label: 'Email' },
        { value: 'domain', label: 'Domain' },
      ],
    },
  ]

  const filtered = useMemo(() => {
    const list = entries ?? []
    const s = search.trim().toLowerCase()
    const reasonFilter = selection.reason ?? []
    const scopeFilter = selection.scope ?? []

    return list.filter((e) => {
      if (s && !e.email.toLowerCase().includes(s) && !(e.notes ?? '').toLowerCase().includes(s)) {
        return false
      }
      if (reasonFilter.length > 0 && !reasonFilter.includes(e.reason)) return false
      if (scopeFilter.length > 0) {
        const isDomain = e.domain_suppression
        if (!scopeFilter.includes(isDomain ? 'domain' : 'email')) return false
      }
      return true
    })
  }, [entries, search, selection])

  async function handleAddSingle() {
    if (!user) return
    await addOne.mutateAsync({
      org_id: user.org_id,
      user_id: user.id,
      email: singleEmail,
      notes: singleNotes || null,
    })
    setSingleEmail('')
    setSingleNotes('')
  }

  async function handleAddDomain() {
    if (!user) return
    await addDomain.mutateAsync({
      org_id: user.org_id,
      user_id: user.id,
      domain: domainInput,
      notes: domainNotes || null,
    })
    setDomainInput('')
    setDomainNotes('')
  }

  async function handleBulkAdd() {
    if (!user || validBulkCount === 0) return
    const rows = bulkPreview.filter((r) => r.valid).map((r) => ({ email: r.email }))
    await bulkAdd.mutateAsync({
      org_id: user.org_id,
      user_id: user.id,
      rows,
      source: 'manual_bulk',
    })
    setBulkText('')
  }

  function handleCsvFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows: ParsedPreviewRow[] = []
        const seen = new Set<string>()
        for (const raw of result.data) {
          const emailCol =
            raw['email'] ?? raw['Email'] ?? raw['EMAIL'] ?? raw['email_address'] ?? Object.values(raw)[0]
          if (!emailCol) continue
          const email = normaliseEmail(String(emailCol))
          const valid = isValidEmail(email)
          if (valid && seen.has(email)) continue
          if (valid) seen.add(email)
          const notes = raw['notes'] ?? raw['Notes'] ?? null
          rows.push({ email, notes: notes ? String(notes) : null, valid })
        }
        if (rows.length === 0) {
          toast.error('CSV has no recognisable email column')
          return
        }
        setCsvPreview(rows)
      },
      error: (err) => toast.error(`CSV parse failed: ${err.message}`),
    })
  }

  async function handleCsvCommit() {
    if (!user || !csvPreview) return
    const rows = csvPreview.filter((r) => r.valid)
    if (rows.length === 0) {
      toast.error('No valid emails in CSV')
      return
    }
    await bulkAdd.mutateAsync({
      org_id: user.org_id,
      user_id: user.id,
      rows: rows.map((r) => ({ email: r.email, notes: r.notes })),
      source: 'manual_csv',
    })
    setCsvPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const columns: ColumnDef<SuppressionEntry>[] = [
    {
      id: 'email',
      header: 'Email / Domain',
      width: 'minmax(200px, 2fr)',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-ink">{row.email}</span>
          {row.domain_suppression && (
            <StatusPill tone="warning" className="shrink-0 h-[16px] px-1 text-[10px]">
              Domain
            </StatusPill>
          )}
        </span>
      ),
    },
    {
      id: 'reason',
      header: 'Reason',
      width: 'minmax(120px, 1fr)',
      cell: (row) => (
        <StatusPill tone={REASON_TONE[row.reason as SuppressionReason] ?? 'neutral'} className="h-[18px] px-1.5 text-[10px]">
          {REASON_LABEL[row.reason as SuppressionReason] ?? row.reason}
        </StatusPill>
      ),
    },
    {
      id: 'notes',
      header: 'Notes',
      width: 'minmax(120px, 1.6fr)',
      cell: (row) =>
        row.notes ? (
          <span className="truncate text-ink-muted">{row.notes}</span>
        ) : (
          <span className="text-ink-disabled">—</span>
        ),
    },
    {
      id: 'added',
      header: 'Added',
      width: 'minmax(100px, 0.9fr)',
      cell: (row) =>
        row.suppressed_at ? (
          <span className="text-ink-muted">
            {formatDistanceToNow(new Date(row.suppressed_at), { addSuffix: true })}
          </span>
        ) : (
          <span className="text-ink-disabled">—</span>
        ),
    },
    {
      id: 'source',
      header: 'Source',
      width: 'minmax(100px, 1fr)',
      cell: (row) => (
        <span className="truncate text-ink-muted">{row.source ?? '—'}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      width: '56px',
      align: 'right',
      cell: (row) => (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            setDeleteTarget(row)
          }}
          title="Remove"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      ),
    },
  ]

  const anyFilters =
    search.trim().length > 0 ||
    Object.values(selection).some((v) => v && v.length > 0)

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1200px]">
      <button
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => navigate('/settings')}
        type="button"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to settings
      </button>

      <PageHeader
        eyebrow="Settings"
        title="Suppression list"
        description={`${entries?.length ?? 0} entr${(entries?.length ?? 0) === 1 ? 'y' : 'ies'} — these addresses will never receive outbound.`}
      />

      {/* Single add */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add a single address</CardTitle>
          <p className="text-xs text-muted-foreground">
            The most common case — one email you've already contacted personally.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
              <Label htmlFor="single-email" className="sr-only">Email</Label>
              <Input
                id="single-email"
                type="email"
                placeholder="you@their-venue.com.au"
                value={singleEmail}
                onChange={(e) => setSingleEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && singleEmail.trim()) handleAddSingle()
                }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <Label htmlFor="single-notes" className="sr-only">Notes</Label>
              <Input
                id="single-notes"
                placeholder="Note (e.g. existing customer)"
                value={singleNotes}
                onChange={(e) => setSingleNotes(e.target.value)}
              />
            </div>
            <Button
              type="button"
              className="shrink-0"
              onClick={handleAddSingle}
              disabled={!singleEmail.trim() || addOne.isPending}
            >
              {addOne.isPending ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk paste */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bulk paste</CardTitle>
          <p className="text-xs text-muted-foreground">
            Paste one email per line (commas, spaces and semicolons also work).
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            rows={5}
            placeholder="jane@cafe.com.au&#10;dom@bar.com.au&#10;…"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            className="font-mono text-xs"
          />
          {bulkPreview.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-ink-muted">
                <strong className="text-foreground">{validBulkCount}</strong> valid
              </span>
              {invalidBulkCount > 0 && (
                <span className="text-amber-600">
                  <strong>{invalidBulkCount}</strong> invalid — will be skipped
                </span>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleBulkAdd}
              disabled={validBulkCount === 0 || bulkAdd.isPending}
            >
              {bulkAdd.isPending ? 'Adding…' : `Add ${validBulkCount || ''} email${validBulkCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CSV upload */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">CSV upload</CardTitle>
          <p className="text-xs text-muted-foreground">
            File must include an <code className="text-[11px] bg-muted px-1 rounded">email</code> column. Optional <code className="text-[11px] bg-muted px-1 rounded">notes</code> column.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleCsvFile(f)
            }}
          />
          {!csvPreview ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Choose CSV file
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span>
                  <strong>{csvPreview.filter((r) => r.valid).length}</strong> valid rows
                </span>
                {csvPreview.some((r) => !r.valid) && (
                  <span className="text-amber-600 inline-flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {csvPreview.filter((r) => !r.valid).length} invalid
                  </span>
                )}
              </div>
              <div className="border rounded-md max-h-60 overflow-auto">
                <table className="text-xs w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1 font-medium">Email</th>
                      <th className="text-left px-2 py-1 font-medium">Notes</th>
                      <th className="text-left px-2 py-1 font-medium w-16">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1 font-mono">{r.email}</td>
                        <td className="px-2 py-1 text-muted-foreground">{r.notes ?? '—'}</td>
                        <td className="px-2 py-1">
                          {r.valid ? (
                            <span className="text-emerald-600">ok</span>
                          ) : (
                            <span className="text-amber-600">invalid</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {csvPreview.length > 50 && (
                  <div className="px-2 py-1 text-xs text-muted-foreground border-t">
                    …and {csvPreview.length - 50} more
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCsvPreview(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleCsvCommit}
                  disabled={csvPreview.filter((r) => r.valid).length === 0 || bulkAdd.isPending}
                >
                  {bulkAdd.isPending ? 'Importing…' : `Import ${csvPreview.filter((r) => r.valid).length} rows`}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Domain */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Suppress a whole domain</CardTitle>
          <p className="text-xs text-muted-foreground">
            Blocks every email <em>@ that domain</em>. Use for your own business domain (e.g. <code className="text-[11px] bg-muted px-1 rounded">puretu.com</code>) or any competitor.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
              <Label htmlFor="domain-input" className="sr-only">Domain</Label>
              <Input
                id="domain-input"
                placeholder="puretu.com"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && domainInput.trim()) handleAddDomain()
                }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <Label htmlFor="domain-notes" className="sr-only">Notes</Label>
              <Input
                id="domain-notes"
                placeholder="Note (optional)"
                value={domainNotes}
                onChange={(e) => setDomainNotes(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={handleAddDomain}
              disabled={!domainInput.trim() || addDomain.isPending}
            >
              {addDomain.isPending ? 'Adding…' : 'Suppress domain'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* List */}
      <div className="space-y-3">
        <FacetBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search email, domain or notes…"
          facets={facets}
          selection={selection}
          onSelectionChange={(facetId, values) => {
            setSelection((s) => ({ ...s, [facetId]: values }))
          }}
          onClear={() => {
            setSelection({})
            setSearch('')
          }}
          summary={
            <span>
              {filtered.length} <span className="text-ink-disabled">of</span> {entries?.length ?? 0}
            </span>
          }
        />

        <DataTable
          ariaLabel="Suppression list"
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          loading={isLoading}
          error={error as Error | null}
          onRetry={() => refetch()}
          empty={{
            icon: ShieldAlert,
            title: anyFilters ? 'No suppressions match your filters' : 'No suppressions yet',
            body: anyFilters
              ? 'Try clearing filters or adjusting the search.'
              : "Paste a list of customers you've already emailed from your own inbox to prevent double-contact.",
          }}
        />
      </div>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Remove from suppression?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              <strong className="font-mono">{deleteTarget?.email}</strong>
              {deleteTarget?.domain_suppression && (
                <StatusPill tone="warning" className="ml-2 h-[16px] px-1 text-[10px]">Domain</StatusPill>
              )}
            </p>
            <p className="text-sm text-amber-600 bg-amber-50 rounded px-3 py-2">
              After removing, this address can receive outbound again. Only remove if you want to re-enable contact.
            </p>
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
              disabled={remove.isPending}
              onClick={async () => {
                if (!deleteTarget) return
                await remove.mutateAsync(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              {remove.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
