// TODO(week-8): Build morning briefing page
// - 5 sections (always in order):
//   1. Overnight replies — new inbound replies from pipeline contacts
//   2. Follow-ups due today — warm leads Jordan should touch today (ordered by lead score)
//   3. New auto-sourced venues — ICP-matched candidates from Google Places + signal worker
//   4. Re-engagement opportunities — contacts gone quiet 6+ weeks with new signal
//   5. What happened yesterday — opens, replies, meetings from previous day's sends
// - One-by-one review, keyboard-navigable ("approve + next" in one keypress)
// - Deep-link tokens in 7am email: /app/briefing?token=<review_token> (HMAC-signed, 24h TTL)

export function BriefingPage() {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-1">Morning Briefing</h2>
      <p className="text-muted-foreground text-sm">
        Daily briefing coming in Week 8.
      </p>
    </div>
  )
}
