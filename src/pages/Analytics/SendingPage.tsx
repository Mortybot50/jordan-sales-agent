/**
 * SendingPage — LeadFlow native sender analytics dashboard (Week 3).
 *
 * Per-inbox card grid + per-domain rollup table + at-risk banner + 14-day
 * sends-over-time sparkline + seed placement summary + Postmaster grades
 * surface + cron health widget.
 *
 * Everything reads from the email_send_events / email_pixel_hits /
 * inbox_placement_seeds / postmaster_grades / cron_job_run_status sources
 * with RLS scoped to the caller's org.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, Pause, ExternalLink, RefreshCcw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useEmailAccounts, type EmailAccount } from '@/lib/queries/email-accounts'
import {
  useLeadflowSendEvents,
  useLatestPostmasterGradeByDomain,
  useInboxPlacementSeeds,
  useCronHealth,
  usePauseInbox,
  computeInboxDailyStats,
  computeDomainRollups,
  computeSendsOverTime,
  detectInboxesAtRisk,
  type InboxDailyStats,
  type DomainRollup,
  type SendsOverTimePoint,
} from '@/lib/queries/leadflow-analytics'

// ---------------------------------------------------------------------------
// Sparkline (inline SVG, no chart dep)
// ---------------------------------------------------------------------------

function StackedSparkline({ points }: { points: SendsOverTimePoint[] }) {
  const width = 640
  const height = 120
  const padding = { top: 8, right: 8, bottom: 22, left: 32 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxY = useMemo(() => {
    const m = Math.max(1, ...points.map((p) => p.sent + p.bounced))
    return m
  }, [points])

  const stepX = innerW / Math.max(1, points.length - 1)
  const yFor = (v: number) => padding.top + innerH - (v / maxY) * innerH

  const pathFor = (key: keyof Pick<SendsOverTimePoint, 'sent' | 'bounced' | 'replied'>) => {
    if (points.length === 0) return ''
    return points
      .map((p, i) => {
        const x = padding.left + i * stepX
        const y = yFor(p[key])
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }

  // Y-axis labels (0, max/2, max)
  const yLabels = [0, Math.round(maxY / 2), maxY]

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block"
      role="img"
      aria-label="Sends over time, last 14 days"
    >
      <rect
        x={padding.left}
        y={padding.top}
        width={innerW}
        height={innerH}
        fill="transparent"
        stroke="currentColor"
        strokeOpacity={0.06}
      />
      {yLabels.map((label, i) => (
        <g key={i}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={yFor(label)}
            y2={yFor(label)}
            stroke="currentColor"
            strokeOpacity={0.05}
          />
          <text
            x={padding.left - 4}
            y={yFor(label) + 3}
            textAnchor="end"
            fontSize="9"
            fill="currentColor"
            fillOpacity={0.5}
          >
            {label}
          </text>
        </g>
      ))}
      <path d={pathFor('sent')} fill="none" stroke="#16a34a" strokeWidth={1.5} />
      <path d={pathFor('bounced')} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <path d={pathFor('replied')} fill="none" stroke="#2563eb" strokeWidth={1.5} />
      {/* X labels: first, mid, last */}
      {points.length > 0 && (
        <>
          <text
            x={padding.left}
            y={height - 6}
            fontSize="9"
            fill="currentColor"
            fillOpacity={0.5}
          >
            {points[0].date.slice(5)}
          </text>
          <text
            x={padding.left + innerW / 2}
            y={height - 6}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
            fillOpacity={0.5}
          >
            {points[Math.floor(points.length / 2)].date.slice(5)}
          </text>
          <text
            x={width - padding.right}
            y={height - 6}
            textAnchor="end"
            fontSize="9"
            fill="currentColor"
            fillOpacity={0.5}
          >
            {points[points.length - 1].date.slice(5)}
          </text>
        </>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Inbox card
// ---------------------------------------------------------------------------

function ReputationDot({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />
  }
  const colour =
    score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return <span className={`inline-block w-2 h-2 rounded-full ${colour}`} />
}

function InboxCard({
  account,
  stats,
  atRisk,
}: {
  account: EmailAccount
  stats: InboxDailyStats | undefined
  atRisk: boolean
}) {
  return (
    <Card className={atRisk ? 'border-red-300' : undefined}>
      <CardContent className="py-3 px-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{account.email_address}</p>
            <p className="text-xs text-muted-foreground truncate">
              {account.brand ?? '—'} · {account.icp_segment ?? '—'} · cap{' '}
              {account.daily_send_cap}/day
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ReputationDot score={stats?.reputation_score ?? account.reputation_score} />
            <span className="text-xs font-mono">
              {(stats?.reputation_score ?? account.reputation_score)?.toFixed(1) ?? '—'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1 text-center">
          <div>
            <p className="text-base font-semibold leading-tight">{stats?.sent_today ?? 0}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Sent</p>
          </div>
          <div>
            <p className="text-base font-semibold leading-tight">{stats?.opened_today ?? 0}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Opened</p>
          </div>
          <div>
            <p className="text-base font-semibold leading-tight">{stats?.replied_today ?? 0}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Replied</p>
          </div>
          <div>
            <p
              className={`text-base font-semibold leading-tight ${
                (stats?.bounced_today ?? 0) > 0 ? 'text-red-600' : ''
              }`}
            >
              {stats?.bounced_today ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Bounced</p>
          </div>
        </div>

        {stats && stats.bounce_rate_24h > 0 && (
          <p className="text-[10px] text-muted-foreground">
            Bounce rate (24h):{' '}
            <span
              className={
                stats.bounce_rate_24h > 2 ? 'text-red-600 font-medium' : 'text-foreground'
              }
            >
              {stats.bounce_rate_24h.toFixed(1)}%
            </span>
          </p>
        )}

        <Badge
          variant="outline"
          className={
            account.status === 'active'
              ? 'text-green-700 border-green-200 text-[10px]'
              : account.status === 'paused'
                ? 'text-muted-foreground text-[10px]'
                : account.status === 'bounced_recently'
                  ? 'text-red-700 border-red-200 text-[10px]'
                  : 'text-amber-700 border-amber-200 text-[10px]'
          }
        >
          {account.status}
        </Badge>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SendingPage() {
  const qc = useQueryClient()
  const { data: accounts, isLoading: accountsLoading } = useEmailAccounts()
  const { data: events, isLoading: eventsLoading } = useLeadflowSendEvents()
  const { data: seeds } = useInboxPlacementSeeds()
  const gradesByDomain = useLatestPostmasterGradeByDomain()
  const { data: cronHealth } = useCronHealth()
  const pauseInbox = usePauseInbox()

  const accountList = accounts ?? []
  const eventsList = events ?? []

  const inboxStats: InboxDailyStats[] = useMemo(
    () => computeInboxDailyStats(eventsList, accountList),
    [eventsList, accountList],
  )

  const domainRollups: DomainRollup[] = useMemo(
    () => computeDomainRollups(eventsList, accountList),
    [eventsList, accountList],
  )

  const sendsOverTime = useMemo(() => computeSendsOverTime(eventsList, 14), [eventsList])

  const atRisk = useMemo(() => detectInboxesAtRisk(inboxStats), [inboxStats])
  const atRiskById = useMemo(() => new Set(atRisk.map((r) => r.email_account_id)), [atRisk])

  function statsFor(accountId: string): InboxDailyStats | undefined {
    return inboxStats.find((s) => s.email_account_id === accountId)
  }

  function reasonText(code: string) {
    if (code === 'bounce_rate_high') return 'Bounce rate >2% in last 24h'
    if (code === 'spam_complaints') return '≥1 spam complaint in last 24h'
    if (code === 'reputation_drop') return 'Reputation dropped 10+ points'
    return code
  }

  const totalSentToday = inboxStats.reduce((acc, s) => acc + s.sent_today, 0)
  const totalRepliedToday = inboxStats.reduce((acc, s) => acc + s.replied_today, 0)
  const totalBouncedToday = inboxStats.reduce((acc, s) => acc + s.bounced_today, 0)

  // ---- Seed placement summary (last 7 days)
  const seedSummary = useMemo(() => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const recent = (seeds ?? []).filter((s) => s.sent_at >= cutoff)
    const total = recent.length
    const inboxCount = recent.filter((s) => s.placement === 'inbox').length
    const promos = recent.filter((s) => s.placement === 'promotions').length
    const spam = recent.filter((s) => s.placement === 'spam').length
    const unrecorded = recent.filter((s) => s.placement == null).length
    const inboxPct = total - unrecorded > 0
      ? Math.round((inboxCount / (total - unrecorded)) * 100)
      : null
    return { total, inboxCount, promos, spam, unrecorded, inboxPct }
  }, [seeds])

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-2">Sending analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Per-inbox health, domain rollups, deliverability signals.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => qc.invalidateQueries({ queryKey: ['leadflow-analytics'] })}
        >
          <RefreshCcw className="w-3.5 h-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* AT-RISK BANNER */}
      {atRisk.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-3 px-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <p className="text-sm font-semibold text-red-700">
                {atRisk.length} inbox{atRisk.length === 1 ? '' : 'es'} at risk
              </p>
            </div>
            <div className="space-y-1">
              {atRisk.map((r) => {
                const account = accountList.find((a) => a.id === r.email_account_id)
                if (!account) return null
                return (
                  <div
                    key={r.email_account_id}
                    className="flex items-start justify-between gap-2 text-xs"
                  >
                    <div>
                      <p className="font-medium text-red-700">{account.email_address}</p>
                      <ul className="text-red-600 list-disc pl-4">
                        {r.reasons.map((reason, i) => (
                          <li key={i}>{reasonText(reason.code)}</li>
                        ))}
                      </ul>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      onClick={() => pauseInbox.mutate(r.email_account_id)}
                      disabled={pauseInbox.isPending || account.status === 'paused'}
                    >
                      <Pause className="w-3 h-3 mr-1" />
                      Pause inbox
                    </Button>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* TODAY TOTALS */}
      <div className="grid grid-cols-3 gap-3 max-w-md">
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-semibold leading-tight">{totalSentToday}</p>
            <p className="text-xs text-muted-foreground">Sent today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-semibold leading-tight">{totalRepliedToday}</p>
            <p className="text-xs text-muted-foreground">Replied today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p
              className={`text-2xl font-semibold leading-tight ${totalBouncedToday > 0 ? 'text-red-600' : ''}`}
            >
              {totalBouncedToday}
            </p>
            <p className="text-xs text-muted-foreground">Bounced today</p>
          </CardContent>
        </Card>
      </div>

      {/* PER-INBOX CARDS */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Per-inbox</h2>
        {accountsLoading || eventsLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : accountList.length === 0 ? (
          <Card>
            <CardContent className="py-6 px-4 text-center">
              <p className="text-sm font-medium">No inboxes yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add a sending inbox in{' '}
                <Link
                  to="/settings/email-accounts"
                  className="text-primary hover:underline"
                >
                  Settings → Email Accounts
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {accountList.map((acct) => (
              <InboxCard
                key={acct.id}
                account={acct}
                stats={statsFor(acct.id)}
                atRisk={atRiskById.has(acct.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* PER-DOMAIN ROLLUP */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Per-domain (7-day)</h2>
        {domainRollups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sends in the last 7 days.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-3 py-2">Domain</th>
                    <th className="text-right px-3 py-2">Inboxes</th>
                    <th className="text-right px-3 py-2">Sent</th>
                    <th className="text-right px-3 py-2">Reply rate</th>
                    <th className="text-right px-3 py-2">Bounce rate</th>
                    <th className="text-right px-3 py-2">Spam rate</th>
                    <th className="text-right px-3 py-2">Postmaster</th>
                  </tr>
                </thead>
                <tbody>
                  {domainRollups.map((d) => {
                    const grade = gradesByDomain.get(d.domain)
                    return (
                      <tr key={d.domain} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{d.domain}</td>
                        <td className="px-3 py-2 text-right">{d.inbox_count}</td>
                        <td className="px-3 py-2 text-right">{d.sent_7d}</td>
                        <td className="px-3 py-2 text-right">
                          {d.reply_rate_7d_pct.toFixed(1)}%
                        </td>
                        <td
                          className={`px-3 py-2 text-right ${
                            d.bounce_rate_7d_pct > 2 ? 'text-red-600 font-medium' : ''
                          }`}
                        >
                          {d.bounce_rate_7d_pct.toFixed(1)}%
                        </td>
                        <td
                          className={`px-3 py-2 text-right ${
                            d.spam_rate_7d_pct > 0.1 ? 'text-red-600 font-medium' : ''
                          }`}
                        >
                          {d.spam_rate_7d_pct.toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 text-right">
                          {grade ? (
                            <Badge
                              variant="outline"
                              className={
                                grade.grade === 'High'
                                  ? 'text-green-700 border-green-200 text-xs'
                                  : grade.grade === 'Medium'
                                    ? 'text-amber-700 border-amber-200 text-xs'
                                    : grade.grade === 'Low' || grade.grade === 'Bad'
                                      ? 'text-red-700 border-red-200 text-xs'
                                      : 'text-muted-foreground text-xs'
                              }
                            >
                              {grade.grade}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        <p className="text-xs text-muted-foreground">
          Record Postmaster Tools grades in{' '}
          <Link to="/settings/postmaster-tools" className="text-primary hover:underline">
            Settings → Postmaster Tools
          </Link>
          .
        </p>
      </section>

      {/* SENDS-OVER-TIME CHART */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Sends over time (last 14 days)</h2>
        <Card>
          <CardContent className="py-3 px-4">
            <StackedSparkline points={sendsOverTime} />
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-2">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-green-600 inline-block" /> Sent
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-red-600 inline-block" /> Bounced
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-blue-600 inline-block" /> Replied
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* SEED PLACEMENT SUMMARY */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Seed placement (last 7 days)</h2>
          <Link
            to="/settings/seed-test"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            Manage seeds
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
        <Card>
          <CardContent className="py-3 px-4">
            {seedSummary.total === 0 ? (
              <p className="text-sm text-muted-foreground">
                No seed tests in the last 7 days. Set up seeds in{' '}
                <Link to="/settings/seed-test" className="text-primary hover:underline">
                  Settings → Seed Test
                </Link>
                .
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2 text-center">
                <div>
                  <p className="text-base font-semibold">
                    {seedSummary.inboxPct != null ? `${seedSummary.inboxPct}%` : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Inbox rate
                  </p>
                </div>
                <div>
                  <p className="text-base font-semibold">{seedSummary.inboxCount}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Inbox
                  </p>
                </div>
                <div>
                  <p className="text-base font-semibold">{seedSummary.promos}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Promos
                  </p>
                </div>
                <div>
                  <p
                    className={`text-base font-semibold ${seedSummary.spam > 0 ? 'text-red-600' : ''}`}
                  >
                    {seedSummary.spam}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Spam
                  </p>
                </div>
              </div>
            )}
            {seedSummary.unrecorded > 0 && (
              <p className="text-[10px] text-amber-700 mt-2">
                {seedSummary.unrecorded} unrecorded — open Seed Test to record placement.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* CRON HEALTH */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Cron health</h2>
        {!cronHealth || cronHealth.length === 0 ? (
          <p className="text-xs text-muted-foreground">No cron runs recorded yet.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-3 py-2">Job</th>
                    <th className="text-left px-3 py-2">Last run</th>
                    <th className="text-right px-3 py-2">HTTP</th>
                    <th className="text-right px-3 py-2">Failures (24h)</th>
                  </tr>
                </thead>
                <tbody>
                  {cronHealth
                    .filter((j) => j.jobname.startsWith('leadflow-'))
                    .map((j) => (
                      <tr key={j.jobname} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono">{j.jobname}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {j.last_run_at
                            ? new Date(j.last_run_at).toLocaleString('en-AU')
                            : '—'}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono ${
                            j.last_http_status && (j.last_http_status < 200 || j.last_http_status >= 300)
                              ? 'text-red-600'
                              : ''
                          }`}
                        >
                          {j.last_http_status ?? '—'}
                        </td>
                        <td
                          className={`px-3 py-2 text-right ${j.failures_24h > 0 ? 'text-red-600 font-medium' : ''}`}
                        >
                          {j.failures_24h}
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

export default SendingPage
