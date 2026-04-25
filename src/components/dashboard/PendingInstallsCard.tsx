import { Link } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { CapsLabel, MetricNumber, SkeletonBlock, EmptyState } from '@/components/primitives'
import { usePipelineFinancials, type PendingInstall } from '@/lib/queries/monthlyGate'
import { formatDistanceToNowStrict, format } from 'date-fns'

function statusFor(install: PendingInstall): { label: string; tone: 'mint' | 'amber' | 'neutral' } {
  if (install.install_confirmed_at) {
    return { label: 'Confirmed', tone: 'mint' }
  }
  if (install.install_scheduled_for) {
    return { label: 'Scheduled', tone: 'amber' }
  }
  return { label: 'Awaiting', tone: 'neutral' }
}

function toneClass(tone: 'mint' | 'amber' | 'neutral'): string {
  if (tone === 'mint') return 'bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)]'
  if (tone === 'amber') return 'bg-[color:var(--jordan-warm-soft,transparent)] text-[color:var(--jordan-warm-text)]'
  return 'bg-surface-2 text-ink-faint'
}

export function PendingInstallsCard() {
  const { data, isLoading } = usePipelineFinancials()

  if (isLoading || !data) {
    return <SkeletonBlock height={220} className="rounded-[10px]" />
  }

  const installs = data.pendingInstalls

  return (
    <div className="rounded-[10px] border border-hairline bg-surface-1 p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <CapsLabel className="text-ink-faint">Pending installs</CapsLabel>
          <p className="text-[13px] text-ink-muted mt-0.5">
            Signed deals awaiting completion · oldest first
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-ink jordan-tnum">
          <Wrench className="size-3" />
          {installs.length}
        </span>
      </div>

      {installs.length === 0 ? (
        <EmptyState
          compact
          title="No pending installs"
          body="Signed deals will appear here until installed."
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {installs.slice(0, 8).map((it) => {
            const status = statusFor(it)
            const signedAgo = formatDistanceToNowStrict(new Date(it.signed_at), { addSuffix: false })
            return (
              <li key={it.deal_id} className="py-2.5 first:pt-0 last:pb-0">
                <Link
                  to={`/pipeline?deal=${it.deal_id}`}
                  className="flex items-center justify-between gap-3 group focus:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink truncate group-hover:text-brand">
                      {it.title ?? it.venue_name ?? it.contact_name ?? 'Untitled deal'}
                    </p>
                    <p className="text-[11px] text-ink-faint truncate">
                      {it.product_label ?? '—'} · signed {signedAgo} ago
                      {it.install_scheduled_for && (
                        <> · install {format(new Date(it.install_scheduled_for), 'd MMM')}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)] ${toneClass(status.tone)}`}
                    >
                      {status.label}
                    </span>
                    <MetricNumber
                      value={it.acv}
                      format="currency"
                      minimumFractionDigits={0}
                      maximumFractionDigits={0}
                      className="text-[12px] font-semibold text-ink"
                    />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
