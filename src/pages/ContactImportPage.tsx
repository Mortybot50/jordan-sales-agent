import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
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
import { useCreateContact } from '@/lib/queries/contacts'
import { useCreateVenue } from '@/lib/queries/venues'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react'

const EXPECTED_FIELDS = [
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'last_name', label: 'Last Name', required: true },
  { key: 'role', label: 'Role', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'linkedin_url', label: 'LinkedIn URL', required: false },
  { key: 'venue_name', label: 'Venue Name', required: false },
  { key: 'venue_type', label: 'Venue Type', required: false },
  { key: 'venue_address', label: 'Venue Address', required: false },
  { key: 'venue_cover_count', label: 'Venue Cover Count', required: false },
]

type Step = 'upload' | 'map' | 'importing' | 'done'

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of EXPECTED_FIELDS) {
    const match = headers.find((h) => {
      const norm = h.toLowerCase().replace(/[\s_-]+/g, '_')
      return (
        norm === field.key ||
        norm.includes(field.key.replace('_', '')) ||
        field.key.includes(norm)
      )
    })
    if (match) mapping[field.key] = match
  }
  return mapping
}

export function ContactImportPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const createContact = useCreateContact()
  const createVenue = useCreateVenue()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [dragging, setDragging] = useState(false)
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([])
  const [allRows, setAllRows] = useState<Record<string, string>[]>([])
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [fileName, setFileName] = useState('')

  function parseFile(file: File) {
    setFileName(file.name)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? []
        setParsedHeaders(headers)
        setAllRows(results.data)
        setPreviewRows(results.data.slice(0, 5))
        setColumnMapping(autoMap(headers))
        setStep('map')
      },
    })
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv')) parseFile(file)
  }, [])

  function get(row: Record<string, string>, field: string): string {
    const col = columnMapping[field]
    return col ? (row[col] ?? '').trim() : ''
  }

  async function runImport() {
    if (!user) return
    setStep('importing')
    setProgress(0)

    const imported = { count: 0 }
    const skipped = { count: 0 }
    const errors: string[] = []
    const venueCache: Record<string, string> = {}

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i]
      const firstName = get(row, 'first_name')
      const lastName = get(row, 'last_name')

      if (!firstName || !lastName) {
        skipped.count++
        setProgress(Math.round(((i + 1) / allRows.length) * 100))
        continue
      }

      try {
        let venueId: string | undefined

        const venueName = get(row, 'venue_name')
        if (venueName) {
          if (venueCache[venueName.toLowerCase()]) {
            venueId = venueCache[venueName.toLowerCase()]
          } else {
            // Check if venue exists in this org
            const { data: existing } = await supabase
              .from('venues')
              .select('id')
              .eq('org_id', user.org_id)
              .ilike('name', venueName)
              .maybeSingle()

            if (existing?.id) {
              venueId = existing.id
            } else {
              const venueType = get(row, 'venue_type') || undefined
              const venueAddress = get(row, 'venue_address') || undefined
              const coverCount = get(row, 'venue_cover_count')

              const newVenue = await createVenue.mutateAsync({
                org_id: user.org_id,
                name: venueName,
                venue_type: venueType,
                address: venueAddress,
                cover_count: coverCount ? parseInt(coverCount, 10) : undefined,
              })
              venueId = newVenue.id
            }

            if (venueId) venueCache[venueName.toLowerCase()] = venueId
          }
        }

        await createContact.mutateAsync({
          org_id: user.org_id,
          first_name: firstName,
          last_name: lastName,
          role: get(row, 'role') || undefined,
          email: get(row, 'email') || undefined,
          phone: get(row, 'phone') || undefined,
          linkedin_url: get(row, 'linkedin_url') || undefined,
          venue_id: venueId,
        })

        imported.count++
      } catch (err) {
        errors.push(
          `Row ${i + 1} (${firstName} ${lastName}): ${(err as Error).message}`
        )
      }

      setProgress(Math.round(((i + 1) / allRows.length) * 100))
    }

    setResult({
      imported: imported.count,
      skipped: skipped.count,
      errors,
    })
    setStep('done')
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      <button
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => navigate('/contacts')}
        type="button"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to contacts
      </button>

      <div>
        <h1 className="text-2xl font-semibold">Import Contacts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload a CSV file to bulk-import contacts and venues.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(['upload', 'map', 'importing', 'done'] as Step[]).map((s, idx) => (
          <div key={s} className="flex items-center gap-2">
            {idx > 0 && <div className="w-6 h-px bg-border" />}
            <div
              className={`flex items-center gap-1 ${
                step === s
                  ? 'text-primary font-medium'
                  : ['done', 'importing'].includes(step) && idx < ['upload', 'map', 'importing', 'done'].indexOf(step)
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center ${
                step === s ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}>
                {idx + 1}
              </span>
              <span className="capitalize">{s}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/50'
            }`}
          >
            <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">Drop a CSV file here, or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">Accepts .csv files only</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Expected columns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {EXPECTED_FIELDS.map((f) => (
                  <Badge
                    key={f.key}
                    variant={f.required ? 'default' : 'outline'}
                    className="text-xs"
                  >
                    {f.label}
                    {f.required && ' *'}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">* Required fields</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 2: Map columns */}
      {step === 'map' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">{fileName}</span>
            <Badge variant="outline">{allRows.length} rows</Badge>
          </div>

          {/* Preview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Preview (first 5 rows)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      {parsedHeaders.slice(0, 6).map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">
                          {h}
                        </th>
                      ))}
                      {parsedHeaders.length > 6 && (
                        <th className="px-3 py-2 text-muted-foreground">+{parsedHeaders.length - 6} more</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {parsedHeaders.slice(0, 6).map((h) => (
                          <td key={h} className="px-3 py-1.5 max-w-[120px] truncate">
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

          {/* Mapping */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Map columns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {EXPECTED_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <div className="w-40 text-sm shrink-0">
                    {field.label}
                    {field.required && (
                      <span className="text-destructive ml-0.5">*</span>
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
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setStep('upload')}
            >
              Back
            </Button>
            <Button onClick={runImport} className="flex-1">
              Start import ({allRows.length} rows)
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Importing */}
      {step === 'importing' && (
        <div className="space-y-4 py-8">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto" />
            <p className="text-sm font-medium">Importing contacts…</p>
            <p className="text-xs text-muted-foreground">{progress}% complete</p>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="text-center space-y-3 py-4">
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto" />
            <h2 className="text-lg font-semibold">Import complete</h2>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-green-600">{result.imported}</p>
                <p className="text-xs text-muted-foreground">Imported</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-amber-600">{result.skipped}</p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-destructive">{result.errors.length}</p>
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
                  {result.errors.map((err, i) => (
                    <li key={i} className="text-xs text-destructive">
                      {err}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Button onClick={() => navigate('/contacts')} className="w-full">
            Back to Contacts
          </Button>
        </div>
      )}
    </div>
  )
}
