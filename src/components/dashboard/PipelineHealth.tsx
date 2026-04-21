import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { usePipelineHealth } from '@/lib/queries/dashboard'

export function PipelineHealth() {
  const { data: stages, isLoading, error } = usePipelineHealth()

  const totalCount = stages?.reduce((sum, s) => sum + s.count, 0) ?? 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pipeline Health</CardTitle>
        <p className="text-xs text-muted-foreground">Deals per stage</p>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {error && (
          <div className="text-destructive text-sm">
            Failed to load: {error.message}
          </div>
        )}
        {!isLoading && !error && (!stages || totalCount === 0) && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No deals in pipeline yet.
          </p>
        )}
        {!isLoading && stages && totalCount > 0 && (
          <div className="space-y-4">
            {/* Stacked bar */}
            <div className="flex h-6 rounded-full overflow-hidden gap-px">
              {stages
                .filter((s) => s.count > 0)
                .map((stage) => {
                  const pct = Math.round((stage.count / totalCount) * 100)
                  const bg = stage.color ?? '#6366f1'
                  return (
                    <div
                      key={stage.stage_name}
                      style={{ width: `${pct}%`, backgroundColor: bg }}
                      title={`${stage.stage_name}: ${stage.count} deal${stage.count !== 1 ? 's' : ''}`}
                      className="transition-all"
                    />
                  )
                })}
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {stages.map((stage) => {
                const bg = stage.color ?? '#6366f1'
                return (
                  <div key={stage.stage_name} className="flex items-start gap-2">
                    <div
                      className="w-2 h-2 rounded-full mt-1 shrink-0"
                      style={{ backgroundColor: bg }}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{stage.stage_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {stage.count} deal{stage.count !== 1 ? 's' : ''} · {formatCurrency(stage.value)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
