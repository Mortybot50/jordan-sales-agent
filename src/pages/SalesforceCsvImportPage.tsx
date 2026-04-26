import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  Download,
  ArrowLeft,
  SkipForward,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CapsLabel } from '@/components/primitives'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import type { Json } from '@/types/database'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Salesforce default column header → LeadFlow internal field key */
const SF_DEFAULTS: Record<string, string> = {
  'First Name': 'first_name',
  'Last Name': 'last_name',
  'Email': 'email',
  'Phone': 'phone',
  'Mobile': 'phone',
  'Account Name': 'venue_name',
  'Company': 'venue_name',
  'Title': 'sf_title',
  'Job Title': 'sf_title',
  'Lead Source': 'sf_lead_source',
  'Lead Status': 'sf_stage',
  'Stage': 'sf_stage',
  'Owner': 'sf_owner',
  'Owner Full Name': 'sf_owner',
  'Created Date': 'sf_created_date',
  'CreatedDate': 'sf_created_date',
}

interface LeadFlowField {
  key: string
  label: string
  required?: boolean
  hint?: string
}

const LEADFLOW_FIELDS: LeadFlowField[] = [
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'last_name', label: 'Last Name', required: true },
  { key: 'email', label: 'Email', hint: 'Used for dedup' },
  { key: 'phone', label: 'Phone' },
  { key: 'venue_name', label: 'Account / Venue' },
  { key: 'sf_title', label: 'Job Title', hint: 'Saved to metadata' },
  { key: 'sf_lead_source', label: 'Lead Source', hint: 'Saved to metadata' },
  { key: 'sf_stage', label: 'Stage / Lead Status', hint: 'Creates a deal' },
  { key: 'sf_owner', label: 'Owner / Rep', hint: 'Saved to metadata' },
  { key: 'sf_created_date', label: 'Created Date', hint: 'Saved to metadata' },
]

const STEP_LABELS = ['UPLOAD', 'MAP', 'PREVIEW', 'IMPORT'] as const

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'done'

type DupAction = 'skip' | 'update'

interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
  activities: number
  deals: number
}

const TEMPLATE_CSV = [
  'First Name,Last Name,Email,Phone,Account Name,Title,Lead Source,Lead Status,Owner,Created Date',
  'Jane,Smith,jane.smith@thegrand.com.au,0412 345 678,The Grand Hotel,General Manager,Website,New Lead,Jordan Smith,2025-01-15',
  'Marcus,Chen,m.chen@harbourbistro.com.au,0423 456 789,Harbour Bistro,Owner,Referral,Contacted,Jordan Smith,2025-02-20',
].join('\n')

const CHUNK_SIZE = 100

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const header of headers) {
    const exact = SF_DEFAULTS[header]
    if (exact && !mapping[exact]) {
      mapping[exact] = header
      continue
    }
    // Case-insensitive fallback
    for (const [sfCol, fieldKey] of Object.entries(SF_DEFAULTS)) {
      if (!mapping[fieldKey] && header.toLowerCase() === sfCol.toLowerCase()) {
        mapping[fieldKey] = header
      }
    }
  }
  return mapping
}

function getField(
  row: Record<string, string>,
  fieldKey: string,
  mapping: Record<string, string>,
): string {
  const col = mapping[fieldKey]
  return col ? (row[col] ?? '').trim() : ''
}

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'salesforce-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SalesforceCsvImportPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([])
  const [allRows, setAllRows] = useState<Record<string, string>[]>([])
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([])

  // Preview / dedup state
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [dupEmails, setDupEmails] = useState<Set<string>>(new Set())
  const [dupAction, setDupAction] = useState<DupAction>('skip')

  // Import progress
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')

  // Result
  const [result, setResult] = useState<ImportResult | null>(null)

  const stepIdx = step === 'upload' ? 0 : step === 'map' ? 1 : step === 'preview' ? 2 : 3

  // -------------------------------------------------------------------------
  // File parsing
  // -------------------------------------------------------------------------

  function parseFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a .csv file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large — maximum 5 MB')
      return
    }
    setFileName(file.name)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? []
        setParsedHeaders(headers)
        setAllRows(results.data)
        setPreviewRows(results.data.slice(0, 20))
        setColumnMapping(autoMap(headers))
        setStep('map')
      },
      error: (err) => toast.error(`CSV parse failed: ${err.message}`),
    })
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }, [])

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  // -------------------------------------------------------------------------
  // Preview step — fetch existing emails for dedup
  // -------------------------------------------------------------------------

  async function goToPreview() {
    if (!user) return
    setLoadingPreview(true)
    setStep('preview')

    const { data: existing } = await supabase
      .from('contacts')
      .select('email')
      .eq('org_id', user.org_id)
      .not('email', 'is', null)

    const existingEmails = new Set(
      (existing ?? []).map((c) => (c.email ?? '').toLowerCase()).filter(Boolean),
    )

    const emailCol = columnMapping['email']
    const dupSet = new Set<string>()
    if (emailCol) {
      for (const row of allRows) {
        const email = (row[emailCol] ?? '').trim().toLowerCase()
        if (email && existingEmails.has(email)) dupSet.add(email)
      }
    }

    setDupEmails(dupSet)
    setLoadingPreview(false)
  }

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  async function runImport() {
    if (!user) return
    setStep('importing')
    setProgress(0)
    setProgressText('Preparing…')

    const counts = { created: 0, updated: 0, skipped: 0, activities: 0, deals: 0 }
    const errors: string[] = []
    const importedAt = new Date().toISOString()
    const emailCol = columnMapping['email']
    const stageCol = columnMapping['sf_stage']

    // Build email → existing contact id map (for update mode)
    const emailToId: Record<string, string> = {}
    if (emailCol && dupAction === 'update' && dupEmails.size > 0) {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id, email')
        .eq('org_id', user.org_id)
        .not('email', 'is', null)
      for (const c of existing ?? []) {
        if (c.email) emailToId[c.email.toLowerCase()] = c.id
      }
    }

    // Fetch pipeline stages once for deal creation
    const stageMap: Record<string, string> = {}
    if (stageCol) {
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name')
        .eq('org_id', user.org_id)
      for (const s of stages ?? []) stageMap[s.name.toLowerCase()] = s.id
    }

    // Venue name → id cache
    const venueCache: Record<string, string> = {}

    const total = allRows.length

    for (let chunkStart = 0; chunkStart < total; chunkStart += CHUNK_SIZE) {
      const chunk = allRows.slice(chunkStart, chunkStart + CHUNK_SIZE)

      type PendingCreate = {
        row: {
          org_id: string
          full_name: string
          email: string | null
          phone: string | null
          venue_id: string | null
          metadata: Json
        }
        stageId: string | null
      }

      const toCreate: PendingCreate[] = []
      const toUpdate: Array<{
        id: string
        full_name: string
        phone: string | null
        venue_id: string | null
        metadata: Json
        stageId: string | null
      }> = []

      for (const csvRow of chunk) {
        const get = (k: string) => getField(csvRow, k, columnMapping)

        const firstName = get('first_name')
        const lastName = get('last_name')
        if (!firstName && !lastName) {
          counts.skipped++
          continue
        }
        const fullName = [firstName, lastName].filter(Boolean).join(' ')
        const email = get('email')
        const emailLower = email.toLowerCase()
        const isDup = email && dupEmails.has(emailLower)

        if (isDup && dupAction === 'skip') {
          counts.skipped++
          continue
        }

        // Build metadata from Salesforce-specific fields + unmapped columns
        const metadata: Record<string, unknown> = {}
        const sfTitle = get('sf_title')
        const sfLeadSource = get('sf_lead_source')
        const sfStageVal = get('sf_stage')
        const sfOwner = get('sf_owner')
        const sfCreatedDate = get('sf_created_date')
        if (sfTitle) metadata.sf_title = sfTitle
        if (sfLeadSource) metadata.sf_lead_source = sfLeadSource
        if (sfStageVal) metadata.sf_stage = sfStageVal
        if (sfOwner) metadata.sf_owner = sfOwner
        if (sfCreatedDate) metadata.sf_created_date = sfCreatedDate

        // Unmapped columns → metadata.sf_extra
        const mappedCols = new Set(Object.values(columnMapping))
        const extra: Record<string, string> = {}
        for (const [k, v] of Object.entries(csvRow)) {
          if (!mappedCols.has(k) && v.trim()) extra[k] = v.trim()
        }
        if (Object.keys(extra).length > 0) metadata.sf_extra = extra

        // Venue lookup / create
        let venueId: string | null = null
        const venueName = get('venue_name')
        if (venueName) {
          const cacheKey = venueName.toLowerCase()
          if (venueCache[cacheKey]) {
            venueId = venueCache[cacheKey]
          } else {
            const { data: existing } = await supabase
              .from('venues')
              .select('id')
              .eq('org_id', user.org_id)
              .ilike('name', venueName)
              .maybeSingle()
            if (existing?.id) {
              venueId = existing.id
            } else {
              const { data: created } = await supabase
                .from('venues')
                .insert({ org_id: user.org_id, name: venueName })
                .select('id')
                .single()
              venueId = created?.id ?? null
            }
            if (venueId) venueCache[cacheKey] = venueId
          }
        }

        // Stage lookup
        const stageId = sfStageVal ? (stageMap[sfStageVal.toLowerCase()] ?? null) : null

        const metadataJson = metadata as unknown as Json

        if (isDup && dupAction === 'update' && email && emailToId[emailLower]) {
          toUpdate.push({
            id: emailToId[emailLower],
            full_name: fullName,
            phone: get('phone') || null,
            venue_id: venueId,
            metadata: metadataJson,
            stageId,
          })
        } else {
          toCreate.push({
            row: {
              org_id: user.org_id,
              full_name: fullName,
              email: email || null,
              phone: get('phone') || null,
              venue_id: venueId,
              metadata: metadataJson,
            },
            stageId,
          })
        }
      }

      // Bulk create
      if (toCreate.length > 0) {
        const { data: newContacts, error: insertErr } = await supabase
          .from('contacts')
          .insert(toCreate.map((p) => p.row))
          .select('id')

        if (insertErr) {
          errors.push(`Chunk at row ${chunkStart + 1}: ${insertErr.message}`)
        } else if (newContacts) {
          counts.created += newContacts.length

          // Bulk insert activities
          const importMeta: Json = {
            source: 'salesforce_csv',
            filename: fileName,
            imported_at: importedAt,
          }
          const actRows = newContacts.map((c) => ({
            org_id: user.org_id,
            contact_id: c.id,
            activity_type: 'import' as const,
            subject: 'Imported from Salesforce CSV',
            metadata: importMeta,
            occurred_at: importedAt,
          }))
          const { error: actErr } = await supabase.from('activities').insert(actRows)
          if (!actErr) counts.activities += newContacts.length

          // Create deals where stage is mapped
          if (stageCol) {
            const dealRows = newContacts
              .map((c, i) => ({ c, stageId: toCreate[i]?.stageId ?? null }))
              .filter(({ stageId }) => stageId !== null)
              .map(({ c, stageId }) => ({
                org_id: user.org_id,
                contact_id: c.id,
                stage_id: stageId!,
                title: 'Salesforce Import',
              }))
            if (dealRows.length > 0) {
              const { error: dealErr } = await supabase.from('deals').insert(dealRows)
              if (!dealErr) counts.deals += dealRows.length
            }
          }
        }
      }

      // Sequential updates (can't bulk-update different rows in one call easily)
      for (const u of toUpdate) {
        const { error: updateErr } = await supabase
          .from('contacts')
          .update({
            full_name: u.full_name,
            phone: u.phone,
            venue_id: u.venue_id,
            metadata: u.metadata,
            updated_at: new Date().toISOString(),
          })
          .eq('id', u.id)
        if (updateErr) {
          errors.push(`Update ${u.id}: ${updateErr.message}`)
        } else {
          counts.updated++
          // Log activity for updated contact
          const updateMeta: Json = {
            source: 'salesforce_csv',
            filename: fileName,
            imported_at: importedAt,
          }
          await supabase.from('activities').insert({
            org_id: user.org_id,
            contact_id: u.id,
            activity_type: 'import',
            subject: 'Updated from Salesforce CSV',
            metadata: updateMeta,
            occurred_at: importedAt,
          })
          counts.activities++
        }
      }

      const processed = Math.min(chunkStart + CHUNK_SIZE, total)
      setProgress(Math.round((processed / total) * 100))
      setProgressText(`${processed} / ${total} rows…`)
    }

    setResult({
      created: counts.created,
      updated: counts.updated,
      skipped: counts.skipped,
      errors,
      activities: counts.activities,
      deals: counts.deals,
    })
    setStep('done')

    const summary = [
      counts.created > 0 && `${counts.created} created`,
      counts.updated > 0 && `${counts.updated} updated`,
      counts.deals > 0 && `${counts.deals} deals`,
    ]
      .filter(Boolean)
      .join(', ')
    toast.success(`Import complete — ${summary || 'no contacts imported'}`)
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const dupCount = dupEmails.size
  const emailMapped = !!columnMapping['email']
  const stageMapped = !!columnMapping['sf_stage']

  const rowsToImport = (() => {
    if (step !== 'preview') return allRows.length
    const emailCol = columnMapping['email']
    let skip = 0
    if (emailCol && dupAction === 'skip') skip = dupCount
    return allRows.length - skip
  })()

  // -------------------------------------------------------------------------
  // JSX
  // -------------------------------------------------------------------------

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      {/* Back nav */}
      <button
        type="button"
        onClick={() => navigate('/contacts')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to contacts
      </button>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEP_LABELS.map((label, idx) => {
          const active = stepIdx === idx
          const done = stepIdx > idx
          return (
            <div key={label} className="flex items-center gap-1">
              {idx > 0 && (
                <div
                  className={cn(
                    'w-6 h-px',
                    done || active
                      ? 'bg-[color:var(--jordan-ink)]'
                      : 'bg-border',
                  )}
                />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0',
                    active
                      ? 'bg-[color:var(--jordan-ink)] text-white'
                      : done
                      ? 'bg-[color:var(--jordan-ink)] text-white'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {idx + 1}
                </div>
                <CapsLabel
                  className={cn(
                    active
                      ? 'text-[color:var(--jordan-ink)]'
                      : done
                      ? 'text-ink-muted'
                      : 'text-ink-faint',
                  )}
                >
                  {label}
                </CapsLabel>
              </div>
            </div>
          )
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* STEP 1: UPLOAD                                                      */}
      {/* ------------------------------------------------------------------ */}
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Dark hero card */}
          <div className="rounded-[10px] bg-[color:var(--jordan-ink)] border border-[color:var(--jordan-dark-border)] p-6 text-white space-y-5">
            <div>
              <CapsLabel tone="onDark" className="text-[color:var(--jordan-dark-faint)] block mb-1">
                Data Import
              </CapsLabel>
              <h1 className="text-xl font-semibold">Salesforce CSV Import</h1>
              <p className="text-sm text-[color:var(--jordan-dark-muted)] mt-1">
                Paste or upload your Salesforce export to bulk-create contacts, deals, and activities.
              </p>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors select-none',
                dragging
                  ? 'border-white bg-white/10'
                  : 'border-white/25 hover:border-white/50 hover:bg-white/5',
              )}
            >
              <Upload className="w-8 h-8 mx-auto mb-3 text-white/60" />
              <p className="text-sm font-medium">Drop your Salesforce export here</p>
              <p className="text-xs text-[color:var(--jordan-dark-muted)] mt-1">
                or click to browse · .csv only · max 5 MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          </div>

          {/* Template download + expected fields */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Expected Salesforce columns</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={downloadTemplate}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download template
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'First Name', 'Last Name', 'Email', 'Phone',
                  'Account Name', 'Title', 'Lead Source', 'Lead Status',
                  'Owner', 'Created Date',
                ].map((col) => (
                  <Badge key={col} variant="outline" className="text-xs font-normal">
                    {col}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Other columns are preserved in contact metadata.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* STEP 2: MAP                                                         */}
      {/* ------------------------------------------------------------------ */}
      {step === 'map' && (
        <div className="space-y-5">
          {/* File info */}
          <div className="flex items-center gap-2 text-sm">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">{fileName}</span>
            <Badge variant="outline">{allRows.length} rows</Badge>
          </div>

          {/* Preview table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Preview — first 5 rows</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      {parsedHeaders.slice(0, 6).map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                      {parsedHeaders.length > 6 && (
                        <th className="px-3 py-2 text-muted-foreground">
                          +{parsedHeaders.length - 6} more
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {allRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {parsedHeaders.slice(0, 6).map((h) => (
                          <td key={h} className="px-3 py-1.5 max-w-[130px] truncate">
                            {row[h] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Field mapper */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Map CSV columns → LeadFlow fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {LEADFLOW_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <div className="w-44 shrink-0">
                    <p className="text-sm leading-none">
                      {field.label}
                      {field.required && <span className="text-destructive ml-0.5">*</span>}
                    </p>
                    {field.hint && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{field.hint}</p>
                    )}
                  </div>
                  <div className="flex-1">
                    <Select
                      value={columnMapping[field.key] ?? '__none__'}
                      onValueChange={(v) =>
                        setColumnMapping((prev) => ({
                          ...prev,
                          [field.key]: v === '__none__' ? '' : v,
                        }))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="— skip —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— skip —</SelectItem>
                        {parsedHeaders.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}

              {!emailMapped && (
                <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded px-3 py-2">
                  Email is not mapped — duplicate detection will be skipped.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('upload')}>
              Back
            </Button>
            <Button onClick={goToPreview} className="flex-1">
              Preview &amp; check duplicates
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* STEP 3: PREVIEW                                                     */}
      {/* ------------------------------------------------------------------ */}
      {step === 'preview' && (
        <div className="space-y-5">
          {loadingPreview ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-7 h-7 rounded-full border-[3px] border-primary border-t-transparent animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground">Checking for duplicates…</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className="text-2xl font-bold jordan-tnum">{allRows.length}</p>
                    <p className="text-xs text-muted-foreground">Total rows</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className="text-2xl font-bold text-amber-600 jordan-tnum">{dupCount}</p>
                    <p className="text-xs text-muted-foreground">Duplicates</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className="text-2xl font-bold text-green-600 jordan-tnum">{rowsToImport}</p>
                    <p className="text-xs text-muted-foreground">Will import</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className="text-2xl font-bold jordan-tnum">
                      {stageMapped ? '✓' : '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">Deals stage</p>
                  </CardContent>
                </Card>
              </div>

              {/* Dedup action picker */}
              {dupCount > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {dupCount} duplicate email{dupCount > 1 ? 's' : ''} found
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDupAction('skip')}
                        className={cn(
                          'flex items-start gap-2 rounded-lg border p-3 text-left transition-colors',
                          dupAction === 'skip'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40',
                        )}
                      >
                        <SkipForward className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">Skip duplicates</p>
                          <p className="text-xs text-muted-foreground">
                            Leave existing contacts unchanged
                          </p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDupAction('update')}
                        className={cn(
                          'flex items-start gap-2 rounded-lg border p-3 text-left transition-colors',
                          dupAction === 'update'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40',
                        )}
                      >
                        <RefreshCw className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">Update duplicates</p>
                          <p className="text-xs text-muted-foreground">
                            Overwrite name, phone &amp; metadata
                          </p>
                        </div>
                      </button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Row preview */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Preview — first {previewRows.length} rows
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                            Name
                          </th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                            Email
                          </th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                            Account
                          </th>
                          {stageMapped && (
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                              Stage
                            </th>
                          )}
                          <th className="px-3 py-2 text-muted-foreground" />
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => {
                          const get = (k: string) => getField(row, k, columnMapping)
                          const email = get('email').toLowerCase()
                          const isDup = email && dupEmails.has(email)
                          return (
                            <tr
                              key={i}
                              className={cn(
                                'border-b last:border-0',
                                isDup && dupAction === 'skip' && 'opacity-40',
                              )}
                            >
                              <td className="px-3 py-1.5 font-medium">
                                {[get('first_name'), get('last_name')].filter(Boolean).join(' ') || '—'}
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground max-w-[160px] truncate">
                                {get('email') || '—'}
                              </td>
                              <td className="px-3 py-1.5 max-w-[120px] truncate">
                                {get('venue_name') || '—'}
                              </td>
                              {stageMapped && (
                                <td className="px-3 py-1.5 max-w-[100px] truncate">
                                  {get('sf_stage') || '—'}
                                </td>
                              )}
                              <td className="px-3 py-1.5">
                                {isDup && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] text-amber-600 border-amber-300"
                                  >
                                    dup
                                  </Badge>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {allRows.length > 20 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                      + {allRows.length - 20} more rows not shown
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep('map')}>
                  Back
                </Button>
                <Button onClick={runImport} className="flex-1">
                  Import {rowsToImport} contacts
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* STEP 4: IMPORTING                                                   */}
      {/* ------------------------------------------------------------------ */}
      {step === 'importing' && (
        <div className="space-y-6 py-10">
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto" />
            <p className="text-sm font-medium">Importing contacts…</p>
            <p className="text-xs text-muted-foreground">{progressText}</p>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* DONE                                                                */}
      {/* ------------------------------------------------------------------ */}
      {step === 'done' && result && (
        <div className="space-y-5">
          <div className="text-center space-y-2 py-4">
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto" />
            <h2 className="text-lg font-semibold">Import complete</h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-green-600 jordan-tnum">{result.created}</p>
                <p className="text-xs text-muted-foreground">Contacts created</p>
              </CardContent>
            </Card>
            {result.updated > 0 && (
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-2xl font-bold text-blue-600 jordan-tnum">{result.updated}</p>
                  <p className="text-xs text-muted-foreground">Contacts updated</p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-amber-600 jordan-tnum">{result.skipped}</p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold jordan-tnum">{result.activities}</p>
                <p className="text-xs text-muted-foreground">Activities logged</p>
              </CardContent>
            </Card>
            {result.deals > 0 && (
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-2xl font-bold jordan-tnum">{result.deals}</p>
                  <p className="text-xs text-muted-foreground">Deals created</p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-destructive jordan-tnum">
                  {result.errors.length}
                </p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </CardContent>
            </Card>
          </div>

          {result.errors.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                  <AlertCircle className="w-4 h-4" />
                  Errors ({result.errors.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <li key={i} className="text-xs text-destructive">
                      {e}
                    </li>
                  ))}
                  {result.errors.length > 20 && (
                    <li className="text-xs text-muted-foreground">
                      … and {result.errors.length - 20} more
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}

          <Button onClick={() => navigate('/contacts')} className="w-full">
            View Contacts
          </Button>
        </div>
      )}
    </div>
  )
}
