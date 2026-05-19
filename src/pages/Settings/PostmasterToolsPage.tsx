/**
 * PostmasterToolsPage — manual Postmaster Tools grade entry (Week 3).
 *
 * Revision 2 explicitly bans an automated postmaster API poller. The user
 * visits https://postmaster.google.com weekly, reads the IP and domain
 * reputation grade (High / Medium / Low / Bad), and records it here.
 * The latest grade per domain surfaces on the sending analytics dashboard.
 *
 * Also includes DNS / verification instructions: each sending domain needs
 * a `postmaster-verification` TXT to claim the property at Postmaster Tools,
 * separate from DKIM/SPF/DMARC (those are already set up).
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, ExternalLink, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import { useEmailAccounts } from '@/lib/queries/email-accounts'
import {
  usePostmasterGrades,
  useRecordPostmasterGrade,
  type PostmasterGrade,
} from '@/lib/queries/leadflow-analytics'
import { supabase } from '@/lib/supabase'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

type Grade = PostmasterGrade['grade']

const GRADES: { value: Grade; label: string; tone: 'green' | 'amber' | 'red' | 'muted' }[] = [
  { value: 'High', label: 'High', tone: 'green' },
  { value: 'Medium', label: 'Medium', tone: 'amber' },
  { value: 'Low', label: 'Low', tone: 'red' },
  { value: 'Bad', label: 'Bad', tone: 'red' },
  { value: 'Unknown', label: 'Unknown', tone: 'muted' },
]

function gradeBadgeClass(grade: Grade): string {
  const meta = GRADES.find((g) => g.value === grade)
  if (!meta) return 'text-muted-foreground text-xs'
  if (meta.tone === 'green') return 'bg-green-100 text-green-700 border-0 text-xs'
  if (meta.tone === 'amber') return 'bg-amber-100 text-amber-700 border-0 text-xs'
  if (meta.tone === 'red') return 'bg-red-100 text-red-700 border-0 text-xs'
  return 'bg-muted text-muted-foreground border-0 text-xs'
}

export function PostmasterToolsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: accounts } = useEmailAccounts()
  const { data: grades } = usePostmasterGrades()
  const recordGrade = useRecordPostmasterGrade()

  const sendingDomains = useMemo(() => {
    const set = new Set<string>()
    for (const a of accounts ?? []) {
      if (a.domain) set.add(a.domain)
    }
    return Array.from(set).sort()
  }, [accounts])

  const [domain, setDomain] = useState('')
  const [grade, setGrade] = useState<Grade>('High')
  const [notes, setNotes] = useState('')

  const deleteGrade = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('postmaster_grades')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leadflow-analytics', 'postmaster-grades'] })
      toast.success('Entry deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function handleRecord() {
    if (!user) return
    if (!domain) {
      toast.error('Pick a domain')
      return
    }
    await recordGrade.mutateAsync({
      org_id: user.org_id,
      user_id: user.id,
      domain,
      grade,
      notes: notes.trim() || null,
    })
    setNotes('')
  }

  // Group grades by domain, latest first
  const gradesByDomain = useMemo(() => {
    const map = new Map<string, PostmasterGrade[]>()
    for (const g of grades ?? []) {
      const arr = map.get(g.domain) ?? []
      arr.push(g)
      map.set(g.domain, arr)
    }
    return map
  }, [grades])

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div>
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Settings
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Postmaster Tools</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Google Postmaster Tools shows your sender reputation per domain.
          Check it weekly and record the grade here — it's the most reliable
          deliverability signal you can get.
        </p>
      </div>

      {/* INSTRUCTIONS */}
      <Card>
        <CardContent className="py-3 px-4 space-y-3 text-sm">
          <p className="font-medium">How to set up Postmaster Tools for each domain</p>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-muted-foreground">
            <li>
              Go to{' '}
              <a
                href="https://postmaster.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                postmaster.google.com
                <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>Add each sending domain as a property</li>
            <li>
              Google gives you a{' '}
              <code className="text-xs bg-muted px-1 rounded">
                postmaster-verification
              </code>{' '}
              TXT record — add it to your DNS (Cloudflare / registrar)
            </li>
            <li>
              Click Verify in Postmaster Tools — propagation usually takes 5-30
              minutes
            </li>
            <li>
              Wait 48 hours for data to flow in, then come back weekly to check
              the grade
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            DKIM, SPF and DMARC are already set up — only the{' '}
            <code className="text-xs bg-muted px-1 rounded">
              postmaster-verification
            </code>{' '}
            TXT is new.
          </p>
        </CardContent>
      </Card>

      {/* RECORD GRADE */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Record today's grade</h2>
        <Card>
          <CardContent className="py-3 px-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="domain">Domain</Label>
                <Select value={domain} onValueChange={setDomain}>
                  <SelectTrigger id="domain">
                    <SelectValue placeholder="Pick a domain" />
                  </SelectTrigger>
                  <SelectContent>
                    {sendingDomains.length === 0 && (
                      <SelectItem value="__none__" disabled>
                        Add an inbox first
                      </SelectItem>
                    )}
                    {sendingDomains.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="grade">Grade</Label>
                <Select value={grade} onValueChange={(v) => setGrade(v as Grade)}>
                  <SelectTrigger id="grade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADES.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. dropped from High to Medium after Wednesday batch"
              />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleRecord}
              disabled={recordGrade.isPending || !domain}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {recordGrade.isPending ? 'Saving…' : 'Record grade'}
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* HISTORY */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">History</h2>
        {gradesByDomain.size === 0 ? (
          <p className="text-xs text-muted-foreground">No grades recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {Array.from(gradesByDomain.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([d, list]) => (
                <Card key={d}>
                  <CardContent className="py-3 px-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-mono">{d}</p>
                      <Badge className={gradeBadgeClass(list[0].grade)}>
                        Latest: {list[0].grade}
                      </Badge>
                    </div>
                    <ul className="space-y-1">
                      {list.slice(0, 8).map((g) => (
                        <li
                          key={g.id}
                          className="text-xs flex items-center justify-between gap-2"
                        >
                          <span className="text-muted-foreground">
                            {new Date(g.recorded_at).toLocaleDateString('en-AU', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                          <Badge variant="outline" className={gradeBadgeClass(g.grade)}>
                            {g.grade}
                          </Badge>
                          {g.notes && (
                            <span className="text-muted-foreground truncate flex-1">
                              {g.notes}
                            </span>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteGrade.mutate(g.id)}
                            disabled={deleteGrade.isPending}
                            title="Delete entry"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default PostmasterToolsPage
