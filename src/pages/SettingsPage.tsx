// TODO(week-4+): Build full settings page
// - Profile: name, signature, Calendly link
// - Sending: Jordan's personal Gmail OAuth (GATE-6 pending — Google OAuth verification, 4-6 week lead time)
//   ARCHITECTURE DECISION: Using Jordan's personal Gmail as send-from for v1 (GATE-1 resolved 2026-04-21)
//   NOT using outreach.purezza.com.au — Jordan is not restricted to Purezza infra
//   Cold email outbound: Instantly.ai (GATE-4 pending Morty setup)
//   Transactional email (briefing digest, notifications): SendGrid
// - ICP configuration: venue types, excluded types, geo filter, cover count range
// - Sequences: manage 3-step sequences (Week 5)
// - Gmail connection: OAuth flow for inbound reply watching (Week 4)
// - Notifications: morning briefing time, email digest on/off
// - Export data: full CSV export

export function SettingsPage() {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-1">Settings</h2>
      <p className="text-muted-foreground text-sm">
        Settings coming in later weeks.
      </p>
    </div>
  )
}
