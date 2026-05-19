/**
 * SeedTestPage — daily inbox-placement seed tests (Week 3).
 *
 * The user enters seed addresses they control across 5 major providers
 * (Hotmail, Outlook, Gmail personal, ProtonMail, Yahoo), one per provider.
 * A "Run today's seed batch" button records one row per (domain, provider)
 * pair into inbox_placement_seeds. Then the user walks through their seed
 * inboxes and records placement (Inbox / Promotions / Spam) via radio
 * buttons. We DO NOT actually send the seed emails here — Jordan sends
 * those manually from his Gmail Sent folder so the SMTP path is identical
 * to a real cold send (no instrumentation skew). The table just records
 * the test attempt + manual placement result.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Send, Trash2 } from 'lucide-react'
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
  useInboxPlacementSeeds,
  useRecordSeedSend,
  useUpdateSeedPlacement,
  type InboxPlacementSeed,
} from '@/lib/queries/leadflow-analytics'
import { toast } from 'sonner'

type Provider = InboxPlacementSeed['seed_provider']

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'hotmail', label: 'Hotmail' },
  { value: 'outlook', label: 'Outlook' },
  { value: 'gmail_personal', label: 'Gmail (personal)' },
  { value: 'protonmail', label: 'ProtonMail' },
  { value: 'yahoo', label: 'Yahoo' },
]

interface SeedAddressEntry {
  provider: Provider
  address: string
}

const STORAGE_KEY = 'leadflow.seed-addresses.v1'

function loadAddresses(): SeedAddressEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SeedAddressEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e) =>
        typeof e?.address === 'string' &&
        PROVIDERS.some((p) => p.value === e.provider),
    )
  } catch {
    return []
  }
}

function saveAddresses(entries: SeedAddressEntry[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // ignore
  }
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

export function SeedTestPage() {
  const { user } = useAuth()
  const { data: accounts } = useEmailAccounts()
  const { data: seeds } = useInboxPlacementSeeds()
  const recordSend = useRecordSeedSend()
  const updatePlacement = useUpdateSeedPlacement()

  const [addresses, setAddresses] = useState<SeedAddressEntry[]>(() => loadAddresses())
  const [newProvider, setNewProvider] = useState<Provider>('hotmail')
  const [newAddress, setNewAddress] = useState('')

  // Build the unique list of sending domains from email_accounts.
  const sendingDomains = useMemo(() => {
    const set = new Set<string>()
    for (const a of accounts ?? []) {
      if (a.domain) set.add(a.domain)
    }
    return Array.from(set).sort()
  }, [accounts])

  function persist(updated: SeedAddressEntry[]) {
    setAddresses(updated)
    saveAddresses(updated)
  }

  function handleAddAddress() {
    const trimmed = newAddress.trim().toLowerCase()
    if (!isValidEmail(trimmed)) {
      toast.error('Enter a valid email address')
      return
    }
    if (addresses.some((a) => a.provider === newProvider && a.address === trimmed)) {
      toast.message('Already added')
      return
    }
    persist([...addresses, { provider: newProvider, address: trimmed }])
    setNewAddress('')
  }

  function handleRemoveAddress(entry: SeedAddressEntry) {
    persist(
      addresses.filter(
        (a) => !(a.provider === entry.provider && a.address === entry.address),
      ),
    )
  }

  async function handleRunBatch() {
    if (!user) return
    if (sendingDomains.length === 0) {
      toast.error('Add a sending inbox first in Settings → Email Accounts')
      return
    }
    if (addresses.length === 0) {
      toast.error('Add at least one seed address')
      return
    }
    let recorded = 0
    for (const domain of sendingDomains) {
      for (const entry of addresses) {
        try {
          await recordSend.mutateAsync({
            org_id: user.org_id,
            user_id: user.id,
            domain,
            seed_address: entry.address,
            seed_provider: entry.provider,
          })
          recorded++
        } catch (err) {
          // toast.error fires in the mutation onError; just keep counting
          // eslint-disable-next-line no-console
          console.error('[SeedTestPage] insert failed:', err)
        }
      }
    }
    toast.success(
      `Recorded ${recorded} seed send${recorded === 1 ? '' : 's'} — now send the actual emails from each inbox`,
    )
  }

  // Show only seeds from the last 14 days, grouped by day.
  const recentSeeds = useMemo(() => {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    return (seeds ?? []).filter((s) => s.sent_at >= cutoff)
  }, [seeds])

  const unrecordedCount = recentSeeds.filter((s) => s.placement == null).length

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
        <h1 className="text-2xl font-semibold mt-2">Daily seed test</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Send a real email from each of your inboxes to seed addresses you
          control at major providers, then check where each one landed. The
          numbers feed into the at-risk alerts on the sending dashboard.
        </p>
      </div>

      {/* SEED ADDRESS CONFIG */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Your seed addresses</h2>
        <p className="text-xs text-muted-foreground">
          One address per provider works fine. Use real inboxes you can check —
          burner Gmail, your own Hotmail, etc. We store these in your browser
          only.
        </p>
        <Card>
          <CardContent className="p-3 space-y-2">
            {addresses.length === 0 ? (
              <p className="text-xs text-muted-foreground">No seed addresses yet.</p>
            ) : (
              <div className="space-y-1">
                {addresses.map((entry) => (
                  <div
                    key={`${entry.provider}:${entry.address}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {PROVIDERS.find((p) => p.value === entry.provider)?.label ??
                        entry.provider}
                    </Badge>
                    <span className="font-mono text-xs truncate flex-1">
                      {entry.address}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveAddress(entry)}
                      title="Remove seed address"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr_auto] gap-2 pt-2 border-t">
              <div className="space-y-1">
                <Label htmlFor="provider" className="sr-only">
                  Provider
                </Label>
                <Select
                  value={newProvider}
                  onValueChange={(v) => setNewProvider(v as Provider)}
                >
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="address" className="sr-only">
                  Address
                </Label>
                <Input
                  id="address"
                  type="email"
                  placeholder="your-seed@gmail.com"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddAddress()
                    }
                  }}
                />
              </div>
              <Button type="button" variant="outline" onClick={handleAddAddress}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* RUN BATCH */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Run today's batch</h2>
        <Card>
          <CardContent className="py-3 px-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              This records a row for every (domain × provider) pair so you can
              tick placement as you go. Then send the actual emails — one per
              row — manually from each inbox.
            </p>
            <div className="text-xs text-muted-foreground">
              Sending domains: <strong>{sendingDomains.length}</strong> · seed
              addresses: <strong>{addresses.length}</strong> · will record{' '}
              <strong>{sendingDomains.length * addresses.length}</strong> rows
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleRunBatch}
              disabled={
                recordSend.isPending ||
                sendingDomains.length === 0 ||
                addresses.length === 0
              }
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              {recordSend.isPending ? 'Recording…' : "Run today's seed batch"}
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* RECORD PLACEMENT */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Record placement</h2>
          {unrecordedCount > 0 && (
            <Badge variant="outline" className="text-xs text-amber-700 border-amber-200">
              {unrecordedCount} unrecorded
            </Badge>
          )}
        </div>
        {recentSeeds.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent seed tests.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-3 py-2">Sent</th>
                    <th className="text-left px-3 py-2">Domain → Provider</th>
                    <th className="text-left px-3 py-2">Seed</th>
                    <th className="text-left px-3 py-2">Placement</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSeeds.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(s.sent_at).toLocaleString('en-AU', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono">
                        {s.domain} →{' '}
                        {PROVIDERS.find((p) => p.value === s.seed_provider)?.label ??
                          s.seed_provider}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono truncate max-w-[180px]">
                        {s.seed_address}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          {(['inbox', 'promotions', 'spam', 'unknown'] as const).map(
                            (p) => {
                              const selected = s.placement === p
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() =>
                                    updatePlacement.mutate({ id: s.id, placement: p })
                                  }
                                  disabled={updatePlacement.isPending}
                                  className={
                                    'px-2 py-0.5 rounded-full text-[10px] border transition-colors capitalize ' +
                                    (selected
                                      ? p === 'inbox'
                                        ? 'bg-green-100 text-green-700 border-green-200'
                                        : p === 'promotions'
                                          ? 'bg-amber-100 text-amber-700 border-amber-200'
                                          : p === 'spam'
                                            ? 'bg-red-100 text-red-700 border-red-200'
                                            : 'bg-muted text-muted-foreground'
                                      : 'border-input hover:bg-accent text-muted-foreground')
                                  }
                                >
                                  {p}
                                </button>
                              )
                            },
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}

export default SeedTestPage
