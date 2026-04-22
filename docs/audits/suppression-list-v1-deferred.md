# Suppression List v1 — deferred scope

**Shipped:** 2026-04-22 — `feature/suppression-list`.

Suppression List v1 covers the manual-exclusion case end-to-end (single,
bulk, CSV, domain) and enforces suppression at every current outbound
surface (sequence-adjacent contact import, AI draft generation, morning
briefing digest).

## Deferred: Gmail sent-folder auto-import

Jordan's original request also mentioned:

> "Don't re-email anyone I've emailed in last 30 days."

This requires, at minimum:

1. Google OAuth scope expansion to include `gmail.readonly` (or
   `gmail.metadata`). The app already has `gmail.modify` for reply-watching,
   but scope changes trigger re-consent for every existing user and need
   the Google OAuth verification team's blessing — non-trivial given the
   pending verification (4–6 weeks) already blocked on the reply-watching
   scope.
2. A scheduled sync worker that walks the user's sent folder, normalises
   recipients, and upserts to `suppression_list` with `reason='manual_exclude'`
   and `source='gmail_sent_import'`. Needs a cursor (History API or
   message-id checkpoint) to avoid re-scanning the whole sent folder every
   run.
3. Deletion / TTL semantics — the manual list is permanent, but sent-folder
   entries should probably expire after N days (Jordan said "last 30 days").
   That's a new `expires_at` column, or a separate `suppression_sent_sync`
   table whose entries are joined in at lookup time. Design decision needed.
4. UI — a per-entry badge showing the source (`via Gmail sent folder`),
   a "Last synced" timestamp, and a trigger to run a sync on demand.

Deferred because it's independent of the v1 killer request (paste-in
manual exclusions) and carries a long lead-time dependency (OAuth
verification). v1 already prevents the double-contact nightmare for
anyone Jordan proactively adds.

## Next dispatch

When the Gmail OAuth scope and verification land, pick this up as its
own ticket. Likely 1 migration (new columns or sibling table), 1 new
Edge Function (sync worker), and a small Settings section to kick off
a sync + show last-run status.
