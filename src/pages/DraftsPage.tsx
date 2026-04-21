// TODO(week-3): Build Draft Review Queue UI
// - Segmented queue: Urgent (max 3) / Today / New Leads
// - Each draft card: subject, body, context card (venue type, last activity, ICP score reason)
// - Actions: Approve (sends immediately), Edit then Approve, Skip (snooze 24h), Reject
// - Keyboard shortcuts: a = approve, e = edit, s = skip, r = reject, n = next
// - Edit history logged to draft_edits for the learning loop
// - Mobile: swipe right = approve, swipe left = skip
// GATE-4: Sending via Instantly.ai (pending Morty setup)
// GATE-6: Gmail OAuth for inbound reply watching (pending Google OAuth verification, 4-6 week lead time)

export function DraftsPage() {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-1">Draft Queue</h2>
      <p className="text-muted-foreground text-sm">
        AI draft review queue coming in Week 3.
      </p>
    </div>
  )
}
