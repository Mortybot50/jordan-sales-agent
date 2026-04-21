import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRelative } from '@/lib/utils'
import { useWarmLeads } from '@/lib/queries/dashboard'
import { useCreateTask } from '@/lib/queries/tasks'
import { useAuth } from '@/hooks/useAuth'
import { endOfDay } from 'date-fns'

export function WarmLeads() {
  const { data: leads, isLoading, error } = useWarmLeads()
  const createTask = useCreateTask()
  const { user } = useAuth()

  function handleFollowUp(lead: { id: string; full_name: string }) {
    if (!user) return
    createTask.mutate({
      org_id: user.org_id,
      title: `Follow up with ${lead.full_name}`,
      contact_id: lead.id,
      due_at: endOfDay(new Date()).toISOString(),
      task_type: 'follow_up',
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Warm Leads</CardTitle>
        <p className="text-xs text-muted-foreground">Score 50–79, not touched in 7+ days</p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && (
          <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
        )}
        {error && (
          <div className="text-destructive text-sm p-4">
            Failed to load: {error.message}
          </div>
        )}
        {!isLoading && !error && (!leads || leads.length === 0) && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No warm leads needing attention right now.
          </div>
        )}
        {!isLoading && leads && leads.length > 0 && (
          <div className="divide-y">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{lead.full_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {lead.venue_name ?? '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">
                    {lead.score}
                  </Badge>
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    {formatRelative(lead.last_touch_at)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 px-2"
                    onClick={() => handleFollowUp(lead)}
                    disabled={createTask.isPending}
                  >
                    Follow up
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
