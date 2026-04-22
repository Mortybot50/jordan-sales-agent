# Suppression List Audit — 2026-04-22

**Trigger:** Jordan asked during the afternoon demo: "can I give it a list of customers to NOT reach out to?"

**Verdict:** Table exists (compliance-only). No app surface, no filter points. **Deferred — new feature scope.**

---

## What exists today

### Database

- `supabase/migrations/20260421000001_initial_schema.sql:360` — `suppression_list` table with:
  - `email` (lowercased, unique per-org via functional index)
  - `reason` — enum: `bounce_hard`, `bounce_soft`, `unsubscribe`, `spam_complaint`
  - `source` — enum: `sendgrid_webhook`, `instantly_webhook`, `manual`
  - `suppressed_at`
- `supabase/migrations/20260421000002_rls_policies.sql:269-276` — RLS enabled, select + insert policies scoped to the user's org.
- `src/types/database.ts:764` — generated TypeScript row/insert/update types.

### App

- **Zero references.** `grep -rn suppression\|suppressed` across `src/` only returns the generated types file. No hooks, no queries, no UI, no outbound filter anywhere.
- `README.md:145` describes the table purpose as "Spam Act 2003 compliance" — confirming intent was webhook-driven, not user-driven.

## Gap vs Jordan's ask

Jordan wants a **user-curated do-not-contact list** — paste-in customers he doesn't want the agent touching. The existing table was designed for automated webhook inserts (hard bounces, unsubscribes, spam complaints). Even if we landed a CSV into it today, nothing downstream reads it.

## Proposed v1 scope (next dispatch)

### Schema migration

- Add `reason = 'manual_exclude'` to the check constraint.
- No new table needed.

### UI (Settings → Suppression List)

- Paste-email textarea (accept comma/newline-separated).
- CSV upload (email column).
- Table listing current entries: email, reason, suppressed_at, source badge, remove button.
- Bulk remove.

### Filter points (the important part)

- **Sequence enrolment / outbound sends** — wherever we build the "next contact to email" query.
- **AI draft generation** — `src/lib/queries/drafts.ts` — skip suppressed addresses.
- **Morning briefing** — `useReengagementOpportunities` should not surface suppressed contacts.
- **Optional:** Overnight Replies — leave inbound visible so Jordan can unsuppress manually if the contact warms back up. (Recommend default = show inbound.)

### Open scope questions

- **Per-email vs per-domain?** Jordan might want to exclude a whole restaurant group by domain (`@gruponamed.com.au`). Recommend shipping per-email first, domain wildcard as v2 — otherwise we drag the dispatch.
- **Suppress by contact_id as well?** Contacts can have multiple emails/phones. Simplest v1: email-only. Contact-level suppression is v2.

---

## Summary for Morty

- Don't tell Jordan "we have it" — the compliance table doesn't answer his question.
- Schedule v1 dispatch: manual-source enum + Settings UI + three filter points (sequence, drafts, briefing).
- Confirm per-email-only v1 scope with Jordan before building.
