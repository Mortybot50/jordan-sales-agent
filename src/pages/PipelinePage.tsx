// TODO(week-2): Build full Kanban pipeline UI
// - Kanban board (desktop): stages as columns, drag to move stage, auto-log stage change
// - List view (mobile): sortable by follow_up_due, last_touch_at, lead score
// - Filter by stage, score tier, venue type
// - Quick-add deal from any view
// - Stage change → auto-trigger relevant sequence step or task

export function PipelinePage() {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-1">Pipeline</h2>
      <p className="text-muted-foreground text-sm">
        Kanban board coming in Week 2.
      </p>
    </div>
  )
}
