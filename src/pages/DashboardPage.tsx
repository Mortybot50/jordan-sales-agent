import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// TODO(week-2): Build full dashboard with KPI bar, warm leads list, pipeline health summary
// KPI bar: Reply Rate, Meeting Rate, Pipeline Value, Follow-ups Due Today, Closes This Month
// Design decision: Dashboard is action-first (Today view), not metrics-first
// KPI bar lives below the fold. Top of page = queue count + urgent items + "Start your morning" CTA

const KPI_PLACEHOLDERS = [
  { label: 'Reply Rate', value: '—', note: 'this week' },
  { label: 'Meeting Rate', value: '—', note: 'this month' },
  { label: 'Pipeline Value', value: '—', note: 'active deals' },
  { label: 'Follow-ups Due', value: '—', note: 'today' },
  { label: 'Closes This Month', value: '—', note: 'month to date' },
]

export function DashboardPage() {
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-semibold">Good morning, Jordan.</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Week 1 scaffold — pipeline data will appear here once contacts are imported.
        </p>
      </div>

      {/* KPI Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {KPI_PLACEHOLDERS.map(({ label, value, note }) => (
          <Card key={label}>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty state */}
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground text-sm">
            No active leads yet. Import your Salesforce contacts to get started.
          </p>
          {/* TODO(week-8): Replace with CSV import button */}
        </CardContent>
      </Card>
    </div>
  )
}
