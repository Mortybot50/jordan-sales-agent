import {
  ErrorAlert,
  MetricNumber,
  SkeletonBlock,
  EmptyState,
} from '@/components/primitives'
import { TrendingUp } from 'lucide-react'
import { usePipelineHealth } from '@/lib/queries/dashboard'

export function PipelineHealth() {
  const { data: stages, isLoading, error, refetch } = usePipelineHealth()

  const totalCount = stages?.reduce((sum, s) => sum + s.count, 0) ?? 0
  const totalValue = stages?.reduce((sum, s) => sum + s.value, 0) ?? 0

  return (
    <section className="rounded-[6px] border border-hairline bg-surface-1 overflow-hidden">
      <header className="px-4 py-3 border-b border-hairline flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Pipeline Health</h2>
          <p className="text-[11px] text-ink-faint mt-0.5">Active deals by stage</p>
        </div>
        {!isLoading && !error && totalCount > 0 && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
              Total
            </div>
            <div className="text-[13px] font-semibold text-ink">
              <MetricNumber value={totalValue} format="currency" />{' '}
              <span className="text-ink-faint font-normal">· {totalCount}</span>
            </div>
          </div>
        )}
      </header>
      <div className="p-4">
        {isLoading && <SkeletonBlock height={24} />}
        {error && (
          <ErrorAlert
            compact
            title="Failed to load pipeline"
            error={error}
            onRetry={() => refetch()}
          />
        )}
        {!isLoading && !error && totalCount === 0 && (
          <EmptyState
            compact
            icon={TrendingUp}
            title="No deals in pipeline yet"
            body="Create a deal from a contact to start tracking it here."
          />
        )}
        {!isLoading && !error && stages && totalCount > 0 && (
          <div className="space-y-4">
            {/* Hairline stacked bar */}
            <div className="flex h-2 overflow-hidden rounded-[2px] bg-surface-3">
              {stages
                .filter((s) => s.count > 0)
                .map((stage, idx, arr) => {
                  const pct = (stage.count / totalCount) * 100
                  return (
                    <div
                      key={stage.stage_name}
                      style={{ width: `${pct}%`, backgroundColor: stage.color ?? 'var(--jordan-accent)' }}
                      title={`${stage.stage_name}: ${stage.count} · ${pct.toFixed(0)}%`}
                      className={idx < arr.length - 1 ? 'border-r border-surface-1' : undefined}
                    />
                  )
                })}
            </div>

            {/* Legend rows */}
            <div className="space-y-1.5">
              {stages.map((stage) => {
                const pct = totalCount > 0 ? Math.round((stage.count / totalCount) * 100) : 0
                return (
                  <div
                    key={stage.stage_name}
                    className="grid items-center gap-3 text-[12px]"
                    style={{ gridTemplateColumns: '10px 1fr auto auto 48px' }}
                  >
                    <span
                      className="size-2 rounded-[2px]"
                      style={{ backgroundColor: stage.color ?? 'var(--jordan-accent)' }}
                    />
                    <span className="truncate text-ink">{stage.stage_name}</span>
                    <MetricNumber value={stage.count} className="text-ink-muted" />
                    <MetricNumber
                      value={stage.value}
                      format="currency"
                      className="text-ink-muted"
                    />
                    <span className="jordan-tnum text-right text-ink-faint">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
